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
    """``{"variables": [...], "references": [...], "error": str | None}`` for ``source``.

    A file that does not parse returns no references and the syntax error, so the
    panel still shows the source, just without links. Not cached on the server: a
    result can be large, and a cache keyed by source would let varied requests pin
    memory; the panel caches each file's analysis in the browser.
    """
    if len(source) > MAX_SOURCE_CHARS:
        return {"variables": [], "references": [], "error": "source too large to analyze"}
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return {"variables": [], "references": [], "error": f"line {e.lineno}: {e.msg}"}
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
    return {"variables": sorted(variables), "references": references, "error": None}
