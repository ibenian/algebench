"""Equation-chain handler — splits chained equalities and merges sub-graphs."""

from __future__ import annotations

from backend.model.semantic_graph import (
    SemanticGraph,
    SemanticGraphNode,
    SemanticGraphEdge,
    Classification,
)

from .preprocessor import LaTeXPreprocessor
from .postprocessor import GraphPostprocessor
from .sympy_translator import latex_to_semantic_graph as _translate

_LOGICAL_CONNECTIVE_COMMANDS = (
    "\\implies", "\\impliedby", "\\iff",
    "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow",
)

_CHAIN_RELATION_COMMANDS = ("\\approx", "\\simeq")

# Logical connectives that, when they join RELATIONS (e.g. ``x = 2 \lor x = 3``),
# must become the ROOT with each relation as a branch — ``Or(Eq, Eq)`` /
# ``And(...)``. Over plain expressions / propositions / sets they stay with the
# translator's infix handling; we intercept ONLY when an operand actually
# contains a relation (so ``(\neg P) \lor (\neg Q)`` and ``dx \wedge dy`` are
# untouched). ``\lor`` binds looser than ``\land`` binds looser than ``=``.
_DISJUNCTION_COMMANDS = ("\\lor", "\\vee")
_CONJUNCTION_COMMANDS = ("\\land", "\\wedge")
_CONNECTIVE_JOIN = {"disjunction": r" \lor ", "conjunction": r" \land "}
_RELATION_TOKENS = (
    "\\leq", "\\geq", "\\neq", "\\le", "\\ge", "\\ne", "\\lt", "\\gt", "\\in",
    "=", "<", ">",
)

_preprocessor = LaTeXPreprocessor()
_postprocessor = GraphPostprocessor()


def _has_top_level_logical_connective(latex: str) -> bool:
    """Return True if *latex* contains a top-level logical connective."""
    if not isinstance(latex, str) or not latex:
        return False
    depth = 0
    i = 0
    L = len(latex)
    while i < L:
        c = latex[i]
        if c == '{':
            depth += 1
            i += 1
            continue
        if c == '}':
            depth = max(0, depth - 1)
            i += 1
            continue
        if depth == 0:
            for cmd in _LOGICAL_CONNECTIVE_COMMANDS:
                if latex.startswith(cmd, i):
                    nxt = latex[i + len(cmd)] if i + len(cmd) < L else ''
                    if not (nxt.isalpha()):
                        return True
        i += 1
    return False


def _has_top_level_statement_comma(latex: str) -> bool:
    r"""Detect whether *latex* contains a top-level ``,`` that acts as a
    statement separator (depth 0 and not backslash-escaped).
    """
    if not isinstance(latex, str) or not latex:
        return False
    depth = 0
    for i, ch in enumerate(latex):
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            if depth > 0:
                depth -= 1
        elif ch == "," and depth == 0:
            bs = 0
            j = i - 1
            while j >= 0 and latex[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 0:
                return True
    return False


def _split_equation_chain_sides(latex: str) -> list[str]:
    """Split *latex* on top-level equality-like operators.

    Splits on bare ``=`` and ``\\approx``, ``\\simeq``, ``\\equiv``.
    Returns the ordered list of sides (trimmed).
    """
    if not isinstance(latex, str) or not latex:
        return []
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    L = len(latex)
    while i < L:
        c = latex[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth = max(0, depth - 1)
        split_adv = 0
        if depth == 0:
            for cmd in _CHAIN_RELATION_COMMANDS:
                if latex.startswith(cmd, i):
                    split_adv = len(cmd)
                    break
            if split_adv == 0 and c == '=':
                prev = latex[i - 1] if i > 0 else ''
                nxt = latex[i + 1] if i + 1 < L else ''
                if prev != '\\' and nxt != '=':
                    split_adv = 1
        if split_adv:
            parts.append(''.join(buf).strip())
            buf = []
            i += split_adv
            continue
        buf.append(c)
        i += 1
    parts.append(''.join(buf).strip())
    return [p for p in parts if p]


def _derive_single_expression(latex: str) -> SemanticGraph | None:
    """Full pipeline for a single expression: preprocess -> translate -> postprocess."""
    if not isinstance(latex, str) or not latex:
        return None
    result = _preprocessor.preprocess(latex)
    try:
        graph = _translate(result.cleaned_latex)
    except Exception:
        return None
    return _postprocessor.postprocess(graph, result)


def _split_top_level(latex: str, commands: tuple[str, ...]) -> list[str]:
    """Split *latex* on top-level occurrences of any command in *commands*.

    Depth-aware over ``{}`` / ``()`` / ``[]``; ignores a command immediately
    followed by a letter (so ``\\lor`` matches but ``\\lorem`` would not).
    Returns the trimmed, non-empty parts (one element if nothing split).
    """
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    L = len(latex)
    while i < L:
        c = latex[i]
        if c in "{([":
            depth += 1
            buf.append(c)
            i += 1
            continue
        if c in "}])":
            depth = max(0, depth - 1)
            buf.append(c)
            i += 1
            continue
        if depth == 0:
            matched = ""
            for cmd in commands:
                if latex.startswith(cmd, i):
                    nxt = latex[i + len(cmd)] if i + len(cmd) < L else ""
                    if not nxt.isalpha():
                        matched = cmd
                        break
            if matched:
                parts.append("".join(buf).strip())
                buf = []
                i += len(matched)
                continue
        buf.append(c)
        i += 1
    parts.append("".join(buf).strip())
    return [p for p in parts if p]


def _tuple_components(side: str) -> list[str] | None:
    r"""If *side* is a parenthesized tuple ``(a, b, …)`` (or the
    ``\left( … \right)`` form), return its top-level comma-separated
    components (2+). Otherwise None — a single parenthesized expression is
    ordinary grouping, not a tuple.
    """
    s = side.strip()
    if s.startswith("\\left("):
        s = "(" + s[len("\\left("):]
    if s.endswith("\\right)"):
        s = s[:-len("\\right)")] + ")"
    if not s.startswith("(") or not s.endswith(")"):
        return None
    # The opening paren must match the FINAL close (one outer group, nothing
    # after it) — reject e.g. ``(a) + (b)``.
    depth = 0
    for i, ch in enumerate(s):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0 and i != len(s) - 1:
                return None
    if depth != 0:
        return None
    inner = s[1:-1]
    # \left / \right are typographic — drop the tokens so a component like
    # ``\left( … \right`` never splits unbalanced (the paren chars themselves
    # still counted above).
    parts: list[str] = []
    buf: list[str] = []
    d = 0
    for ch in inner:
        if ch in "([{":
            d += 1
        elif ch in ")]}":
            d -= 1
        elif ch == "," and d == 0:
            parts.append("".join(buf).strip())
            buf = []
            continue
        buf.append(ch)
    parts.append("".join(buf).strip())
    if len(parts) < 2 or any(not p for p in parts):
        return None
    return parts


def _split_tuple_equation(latex: str) -> tuple[list[str], list[str]] | None:
    r"""Detect a component-wise tuple equation ``(a, b, …) = (c, d, …)``.

    Returns (lhs_components, rhs_components) when BOTH sides are tuples of the
    SAME arity, else None. Only a single top-level ``=`` qualifies.
    """
    sides = _split_equation_chain_sides(latex)
    if len(sides) != 2:
        return None
    lhs = _tuple_components(sides[0])
    rhs = _tuple_components(sides[1])
    if lhs is None or rhs is None or len(lhs) != len(rhs):
        return None
    return lhs, rhs


def _merge_tuple_equation(lhs: list[str], rhs: list[str],
                          original: str) -> SemanticGraph | None:
    r"""Build the graph for ``(a, b, …) = (c, d, …)``: one ``equals`` root over
    two ``tuple`` operator nodes whose operands are the fully-derived component
    graphs, in order. Synthetic ids are namespaced per component; shared symbols
    (``\theta`` in several components) intentionally merge.
    """
    merged_nodes: dict[str, SemanticGraphNode] = {}
    merged_edges: list[SemanticGraphEdge] = []
    tuple_ids = ("__tuple_1", "__tuple_2")

    for ti, (parts, side_tag) in enumerate(((lhs, "tl"), (rhs, "tr"))):
        component_roots: list[str] = []
        for ci, part in enumerate(parts):
            sub = derive_equation_chain_graph(part)   # full pipeline, recursively
            if sub is None or not sub.nodes:
                return None
            prefix = f"{side_tag}{ci}_"

            def _rename(nid: str, p: str = prefix) -> str:
                return p + nid if nid.startswith("__") else nid

            for n in sub.nodes:
                new_id = _rename(n.id)
                cloned = n.model_copy(update={"id": new_id})
                if new_id not in merged_nodes:
                    merged_nodes[new_id] = cloned
                else:
                    existing = merged_nodes[new_id]
                    for field_name in type(n).model_fields:
                        if field_name == "id":
                            continue
                        new_val = getattr(cloned, field_name)
                        if new_val is not None and getattr(existing, field_name) is None:
                            setattr(existing, field_name, new_val)
            for e in sub.edges:
                merged_edges.append(SemanticGraphEdge(
                    from_=_rename(e.from_), to=_rename(e.to)))

            out_set = {e.from_ for e in sub.edges}
            root_candidates = [n.id for n in sub.nodes if n.id not in out_set]
            component_roots.append(_rename(root_candidates[0] if root_candidates
                                           else sub.nodes[0].id))

        tid = tuple_ids[ti]
        merged_nodes[tid] = SemanticGraphNode(
            id=tid, type="operator", op="tuple",
            subexpr="(" + ", ".join(parts) + ")",
        )
        for r in component_roots:
            merged_edges.append(SemanticGraphEdge(from_=r, to=tid))

    equals_id = "__equals_1"
    merged_nodes[equals_id] = SemanticGraphNode(
        id=equals_id, type="relation", op="equals",
        subexpr=original.strip(),
    )
    for tid in tuple_ids:
        merged_edges.append(SemanticGraphEdge(from_=tid, to=equals_id))

    return SemanticGraph(
        nodes=list(merged_nodes.values()),
        edges=merged_edges,
        classification=Classification(kind="algebraic"),
    )


def _has_top_level_relation(latex: str) -> bool:
    """True if *latex* contains a relation (``=``, ``<``, ``\\leq``, …) at depth 0."""
    depth = 0
    i = 0
    L = len(latex)
    while i < L:
        c = latex[i]
        if c in "{([":
            depth += 1
            i += 1
            continue
        if c in "}])":
            depth = max(0, depth - 1)
            i += 1
            continue
        if depth == 0:
            for tok in _RELATION_TOKENS:
                if not latex.startswith(tok, i):
                    continue
                if tok == "=":
                    prev = latex[i - 1] if i > 0 else ""
                    nxt = latex[i + 1] if i + 1 < L else ""
                    if prev in "\\<>=!:" or nxt == "=":
                        continue
                elif tok.startswith("\\"):
                    # Command boundary: a backslash relation token must end at a
                    # non-letter, else `\le` matches `\left`, `\ne` matches `\neg`,
                    # `\in` matches `\int` / `\infty`. Longer tokens (`\leq`, `\neq`,
                    # `\geq`) are listed first, so genuine relations still match.
                    nxt = latex[i + len(tok)] if i + len(tok) < L else ""
                    if nxt.isalpha():
                        continue
                return True
        i += 1
    return False


def _merge_under_connective(parts: list[str], op: str) -> SemanticGraph | None:
    """Parse each *part* as its own relation graph and join under one *op* node.

    Mirrors the equality-chain merge, but the root is a ``disjunction`` /
    ``conjunction`` operator and each branch is a fully-derived operand graph —
    so ``x = 2 \\lor x = 3`` becomes ``Or(Eq(x, 2), Eq(x, 3))``. Synthetic ids
    are namespaced per branch; shared variables (``x``, ``a``, …) intentionally
    merge across branches.
    """
    subgraphs: list[SemanticGraph] = []
    for part in parts:
        sub = derive_equation_chain_graph(part)   # full pipeline, recursively
        if sub is None or not sub.nodes:
            return None
        subgraphs.append(sub)

    merged_nodes: dict[str, SemanticGraphNode] = {}
    merged_edges: list[SemanticGraphEdge] = []
    roots: list[str] = []

    for si, sub in enumerate(subgraphs):
        prefix = f"d{si}_"

        def _rename(nid: str, p: str = prefix) -> str:
            return p + nid if nid.startswith("__") else nid

        for n in sub.nodes:
            new_id = _rename(n.id)
            cloned = n.model_copy(update={"id": new_id})
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                existing = merged_nodes[new_id]
                for field_name in type(n).model_fields:
                    if field_name == "id":
                        continue
                    new_val = getattr(cloned, field_name)
                    if new_val is not None and getattr(existing, field_name) is None:
                        setattr(existing, field_name, new_val)

        for e in sub.edges:
            merged_edges.append(SemanticGraphEdge(
                from_=_rename(e.from_), to=_rename(e.to)))

        out_set = {e.from_ for e in sub.edges}
        root_candidates = [n.id for n in sub.nodes if n.id not in out_set]
        roots.append(_rename(root_candidates[0] if root_candidates
                             else sub.nodes[0].id))

    conn_id = f"__{op}_1"
    merged_nodes[conn_id] = SemanticGraphNode(
        id=conn_id, type="operator", op=op,
        subexpr=_CONNECTIVE_JOIN[op].join(parts),
    )
    for r in roots:
        merged_edges.append(SemanticGraphEdge(from_=r, to=conn_id))

    return SemanticGraph(
        nodes=list(merged_nodes.values()),
        edges=merged_edges,
        classification=Classification(kind="algebraic"),
    )


def derive_equation_chain_graph(latex: str) -> SemanticGraph | None:
    """Derive a semantic graph for a possibly-chained equation.

    For ``a = b = c = d`` each side is parsed as its own sub-graph, then
    merged into a single graph with one central ``__equals_1`` node.
    For simpler cases, delegates to the single-expression pipeline.
    """
    if not isinstance(latex, str) or not latex:
        return None

    latex, early_annotations = _preprocessor.extract_parenthetical_annotations(latex)

    if _has_top_level_logical_connective(latex):
        graph = _derive_single_expression(latex)
        if graph and early_annotations:
            _postprocessor.inject_annotations(graph, early_annotations)
        return graph

    # Logical connective over RELATIONS: make the connective the root with each
    # relation as a branch (Or(Eq, Eq) / And(...)). Disjunction is looser than
    # conjunction, so split `\lor` first; the recursion then handles `\land` and
    # the `=` inside each branch. Intercept only when an operand truly contains a
    # relation — otherwise sets/propositions stay with the translator.
    for _commands, _op in ((_DISJUNCTION_COMMANDS, "disjunction"),
                           (_CONJUNCTION_COMMANDS, "conjunction")):
        _parts = _split_top_level(latex, _commands)
        if len(_parts) >= 2 and any(_has_top_level_relation(p) for p in _parts):
            graph = _merge_under_connective(_parts, _op)
            if graph is not None:
                if early_annotations:
                    _postprocessor.inject_annotations(graph, early_annotations)
                return graph

    # Component-wise tuple equation ``(x, y, z) = (a, b, c)`` — sympy's LaTeX
    # parser has no tuple syntax, so build it here: one ``equals`` root over two
    # ordered ``tuple`` operator nodes (common for vector-valued results:
    # coordinates, vector components, parametric forms).
    tuple_sides = _split_tuple_equation(latex)
    if tuple_sides is not None:
        graph = _merge_tuple_equation(*tuple_sides, original=latex)
        if graph is not None:
            if early_annotations:
                _postprocessor.inject_annotations(graph, early_annotations)
            return graph

    if _has_top_level_statement_comma(latex):
        graph = _derive_single_expression(latex)
        if graph and early_annotations:
            _postprocessor.inject_annotations(graph, early_annotations)
        return graph

    if r"\\" in latex:
        graph = _derive_single_expression(latex)
        if graph and early_annotations:
            _postprocessor.inject_annotations(graph, early_annotations)
        return graph

    sides = _split_equation_chain_sides(latex)
    if len(sides) <= 1:
        graph = _derive_single_expression(latex)
        if graph and early_annotations:
            _postprocessor.inject_annotations(graph, early_annotations)
        return graph
    if len(sides) == 2:
        graph = _derive_single_expression(f"{sides[0]} = {sides[1]}")
        if graph and early_annotations:
            _postprocessor.inject_annotations(graph, early_annotations)
        return graph

    # --- Chain with 3+ sides: per-side preprocess, translate, merge ---
    merged_nodes: dict[str, SemanticGraphNode] = {}
    merged_edges: list[SemanticGraphEdge] = []
    roots: list[str] = []
    dotted_vars: dict[str, int] = {}
    all_annotations: list[dict] = list(early_annotations)

    for si, side in enumerate(sides):
        side, side_anns = _preprocessor.extract_parenthetical_annotations(side)
        all_annotations.extend(side_anns)
        deriv_side = _preprocessor.rewrite_dot_derivatives(side, dotted_vars)
        deriv_side = _preprocessor.normalize_frac_derivatives(deriv_side)
        accent_map: dict[str, str] = {}
        clean_side = _preprocessor.strip_accent_commands(deriv_side, accent_map)
        rewritten, mapping = _preprocessor.substitute_multichar_subscripts(clean_side)

        try:
            sub = _translate(rewritten)
        except Exception:
            return None
        if not sub.nodes:
            return None

        _postprocessor.restore_subscripts(sub, mapping)
        _postprocessor.restore_accents(sub, accent_map)
        _postprocessor.restore_dot_notation(sub, dotted_vars)

        prefix = f"s{si}_"

        def _rename(nid: str, p: str = prefix) -> str:
            return p + nid if nid.startswith("__") else nid

        for n in sub.nodes:
            nid = n.id
            new_id = _rename(nid)
            cloned = n.model_copy(update={"id": new_id})
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                existing = merged_nodes[new_id]
                for field_name in type(n).model_fields:
                    if field_name == "id":
                        continue
                    new_val = getattr(cloned, field_name)
                    if new_val is not None and getattr(existing, field_name) is None:
                        setattr(existing, field_name, new_val)

        for e in sub.edges:
            merged_edges.append(SemanticGraphEdge(
                from_=_rename(e.from_),
                to=_rename(e.to),
            ))

        out_set = {e.from_ for e in sub.edges}
        root_candidates = [n.id for n in sub.nodes if n.id not in out_set]
        if root_candidates:
            roots.append(_rename(root_candidates[0]))
        else:
            roots.append(_rename(sub.nodes[0].id))

    equals_id = "__equals_1"
    merged_nodes[equals_id] = SemanticGraphNode(
        id=equals_id,
        type="operator",
        op="equals",
        subexpr=" = ".join(sides),
    )
    for r in roots:
        if r:
            merged_edges.append(SemanticGraphEdge(from_=r, to=equals_id))

    graph = SemanticGraph(
        nodes=list(merged_nodes.values()),
        edges=merged_edges,
        classification=Classification(kind="algebraic"),
    )
    _postprocessor.inject_annotations(graph, all_annotations)
    return graph
