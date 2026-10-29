"""Variables and variable expressions in Python source, with their exact spans.

A *variable* is any name the code binds: an assignment target, a ``for`` target,
a function parameter, a ``with ... as`` / ``except ... as`` name, a comprehension
variable, or an import alias. Names that are only read (``len``, ``enumerate``)
are not variables.

A *reference* is one place in the source that mentions a variable: the bare name
(``stack``), or a subscript / attribute chain rooted at one (``stack[-1]``,
``temps[stack[-1]]``, ``node.next``). Nested references are all reported, so
``temps[stack[-1]]`` yields itself, ``temps``, ``stack[-1]`` and ``stack``.

Each reference carries ``key``: its source text with whitespace removed, the
string a label or marker that shows the same expression will match exactly.
*Functions* are the file's own ``def``s, with the span of the name on the ``def`` line; *calls* are the places
the file calls one of them by name (``backtrack(i + 1)``), each with the line of the ``def`` it reaches, so the
panel can link a call to its function, and the whole call's ``key`` (``backtrack(i+1)``), the name a trace's
``returns`` gives its value under.
*Uses* say, for each variable in each top-level function (or the module), the lines that read it, update it,
grow it and shrink it (``count.get(k)`` reads, ``count[k] = v`` updates and may grow a dict, ``stack.pop()``
updates and shrinks), so the panel can find where a dict or a list changes.

Positions are 1-based lines and 0-based *character* columns (``ast`` reports
UTF-8 byte offsets; they are converted so the client can index JS strings).
"""

from __future__ import annotations

import ast
import re

MAX_SOURCE_CHARS = 200_000
_SPACE = re.compile(r"\s+")


def _key(text: str) -> str:
    return _SPACE.sub("", text)


def _bound_names(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            names.add(node.id)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            names.add(node.name)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
    return names


def _root(node: ast.AST) -> str | None:
    """The variable a subscript/attribute chain hangs off, or None."""
    while isinstance(node, (ast.Subscript, ast.Attribute)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _char_col(line: str, byte_col: int) -> int:
    return len(line.encode("utf-8")[:byte_col].decode("utf-8", errors="ignore"))


def analyze_python(source: str) -> dict:
    """``{"variables", "references", "functions", "calls", "error"}`` for ``source``.

    A file that does not parse returns no references and the syntax error, so the
    panel still shows the source, just without links. Not cached on the server: a
    result can be large, and a cache keyed by source would let varied requests pin
    memory; the panel caches each file's analysis in the browser.
    """
    if len(source) > MAX_SOURCE_CHARS:
        return {"variables": [], "references": [], "functions": [], "calls": [], "uses": [], "error": "source too large to analyze"}
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return {"variables": [], "references": [], "functions": [], "calls": [], "uses": [], "error": f"line {e.lineno}: {e.msg}"}
    variables = _bound_names(tree)
    lines = source.split("\n")
    references = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Name, ast.Subscript, ast.Attribute)):
            continue
        root = _root(node)
        if root not in variables or node.end_lineno is None or node.end_col_offset is None:
            continue
        text = ast.get_source_segment(source, node)
        if not text:
            continue
        line, end_line = node.lineno, node.end_lineno
        references.append({
            "key": _key(text),
            "root": root,
            "kind": "name" if isinstance(node, ast.Name) else "subscript" if isinstance(node, ast.Subscript) else "attribute",
            "store": isinstance(getattr(node, "ctx", None), ast.Store),
            "line": line,
            "col": _char_col(lines[line - 1], node.col_offset),
            "endLine": end_line,
            "endCol": _char_col(lines[end_line - 1], node.end_col_offset),
        })
    # Function parameters are bindings without an expression node; report them as name references.
    for node in ast.walk(tree):
        if isinstance(node, ast.arg) and node.end_col_offset is not None:
            line = lines[node.lineno - 1]
            col = _char_col(line, node.col_offset)
            references.append({"key": node.arg, "root": node.arg, "kind": "name", "store": True,
                               "line": node.lineno, "col": col, "endLine": node.lineno, "endCol": col + len(node.arg)})
    references.sort(key=lambda r: (r["line"], r["col"], -(r["endCol"] - r["col"])))
    functions, calls = _functions_and_calls(tree, source, lines)
    return {"variables": sorted(variables), "references": references, "functions": functions, "calls": calls,
            "uses": _uses(tree, variables), "error": None}


def _functions_and_calls(tree: ast.AST, source: str, lines: list[str]) -> tuple[list[dict], list[dict]]:
    """The file's ``def``s (name spans) and the calls to them by plain name, in source order.

    A name defined twice links to its first ``def``; calls to anything else (builtins, methods) are not reported.
    """
    functions: list[dict] = []
    first: dict[str, int] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            line = lines[node.lineno - 1]
            col = line.find(node.name, _char_col(line, node.col_offset))
            if col < 0:
                continue
            functions.append({"name": node.name, "line": node.lineno, "col": col, "endCol": col + len(node.name)})
            first[node.name] = min(first.get(node.name, node.lineno), node.lineno)
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in first:
            col = _char_col(lines[node.func.lineno - 1], node.func.col_offset)
            text = ast.get_source_segment(source, node) or node.func.id
            calls.append({"name": node.func.id, "line": node.func.lineno, "col": col, "endCol": col + len(node.func.id),
                          "defLine": first[node.func.id], "key": _key(text)})
    functions.sort(key=lambda f: (f["line"], f["col"]))
    calls.sort(key=lambda c: (c["line"], c["col"]))
    return functions, calls


# Methods that add to a list, deque, set or dict; that take from one; that change one in place without either.
_GROWS = {"append", "appendleft", "extend", "extendleft", "insert", "add", "setdefault", "update"}
_SHRINKS = {"pop", "popleft", "popitem", "remove", "discard", "clear"}
_CHANGES = {"sort", "reverse", "rotate"}
# heapq's functions take the heap as their first argument.
_HEAP = {"heappush": ("grow",), "heappop": ("shrink",), "heapify": (), "heappushpop": (), "heapreplace": ()}
_DICTS = {"dict", "defaultdict", "Counter", "OrderedDict"}


def _is_dict(value: ast.AST | None) -> bool:
    if isinstance(value, (ast.Dict, ast.DictComp)):
        return True
    func = value.func if isinstance(value, ast.Call) else None
    name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
    return name in _DICTS


def _uses(tree: ast.Module, variables: set[str]) -> list[dict]:
    """For each variable of each top-level function (or the module), the lines that read, update, grow and shrink it.

    A function nested in another shares its scope (it reads the outer one's variables), so scopes are top-level.
    Assigning to a subscript of a dict (one assigned a ``{}``, ``dict()``, ``defaultdict()``, ``Counter()``) may add
    a key, so it grows the dict; of anything else it only updates it.
    """
    scopes: list[tuple[int, int, ast.AST]] = []
    module_body = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.end_lineno is not None:
            scopes.append((node.lineno, node.end_lineno, node))
        else:
            module_body.append(node)
    scopes.append((0, 0, ast.Module(body=module_body, type_ignores=[])))
    out = []
    for start, end, scope in scopes:
        parent: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(scope):
            for child in ast.iter_child_nodes(node):
                parent[child] = node
        dicts = {t.id for node in ast.walk(scope) if isinstance(node, (ast.Assign, ast.AnnAssign)) and _is_dict(node.value)
                 for t in (node.targets if isinstance(node, ast.Assign) else [node.target]) if isinstance(t, ast.Name)}
        found: dict[str, dict[str, set[int]]] = {}
        for node in ast.walk(scope):
            if not isinstance(node, ast.Name) or node.id not in variables:
                continue
            kinds = _kinds(node, parent, node.id in dicts)
            lines = found.setdefault(node.id, {"read": set(), "update": set(), "grow": set(), "shrink": set()})
            for kind in kinds:
                lines[kind].add(node.lineno)
        for name, lines in sorted(found.items()):
            out.append({"name": name, "from": start, "to": end, **{k: sorted(v) for k, v in lines.items()}})
    return out


def _kinds(node: ast.Name, parent: dict[ast.AST, ast.AST], is_dict: bool) -> tuple[str, ...]:
    """What one mention of a name does to it: reads it, or updates it (and maybe grows or shrinks it).

    Changing something inside it (``grid[r][c] = 1``, ``grid[r].append(x)``) updates it; only a change to the
    container itself (``count[k] = v``, ``stack.pop()``) grows or shrinks it.
    """
    up = parent.get(node)
    # Bound or rebound (x = ..., for x in ..., del x); x += ... reads the old value too.
    if isinstance(node.ctx, (ast.Store, ast.Del)):
        return ("read", "update") if isinstance(up, ast.AugAssign) else ("update",)
    # The outermost subscript / attribute chain hanging off the name: what the line does to it is done to the name.
    top: ast.AST = node
    while isinstance(parent.get(top), (ast.Subscript, ast.Attribute)) and parent[top].value is top:
        top = parent[top]
    direct = parent.get(node) is top
    if isinstance(top, (ast.Subscript, ast.Attribute)) and isinstance(top.ctx, ast.Del):
        return ("update", "shrink") if direct and isinstance(top, ast.Subscript) else ("update",)
    if isinstance(top, (ast.Subscript, ast.Attribute)) and isinstance(top.ctx, ast.Store):
        augmented = isinstance(parent.get(top), ast.AugAssign)
        grows = direct and isinstance(top, ast.Subscript) and is_dict and not augmented
        return ("read", "update") if augmented else ("update", "grow") if grows else ("update",)
    call = parent.get(top)
    if isinstance(top, ast.Attribute) and isinstance(call, ast.Call) and call.func is top:
        on_self = parent.get(node) is top
        if top.attr in _GROWS:
            return ("update", "grow") if on_self else ("update",)
        if top.attr in _SHRINKS:
            return ("update", "shrink") if on_self else ("update",)
        if top.attr in _CHANGES:
            return ("update",)
        return ("read",)
    if isinstance(up, ast.Call) and up.args and up.args[0] is node:
        func = up.func
        name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
        if name in _HEAP:
            return ("update", *_HEAP[name])
    return ("read",)
