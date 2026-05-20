"""Equation-chain handler — splits chained equalities and merges sub-graphs."""

from __future__ import annotations

from .preprocessor import LaTeXPreprocessor
from .postprocessor import GraphPostprocessor
from .sympy_translator import latex_to_semantic_graph as _translate

_LOGICAL_CONNECTIVE_COMMANDS = (
    "\\implies", "\\impliedby", "\\iff",
    "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow",
)

_CHAIN_RELATION_COMMANDS = ("\\approx", "\\simeq", "\\equiv")

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


def _derive_single_expression(latex: str) -> dict | None:
    """Full pipeline for a single expression: preprocess -> translate -> postprocess."""
    if not isinstance(latex, str) or not latex:
        return None
    result = _preprocessor.preprocess(latex)
    try:
        graph = _translate(result.cleaned_latex)
    except Exception:
        return None
    return _postprocessor.postprocess(graph, result)


def derive_equation_chain_graph(latex: str) -> dict | None:
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
    merged_nodes: dict[str, dict] = {}
    merged_edges: list[dict] = []
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
        if not isinstance(sub, dict) or not sub.get("nodes"):
            return None

        _postprocessor.restore_subscripts(sub, mapping)
        _postprocessor.restore_accents(sub, accent_map)
        _postprocessor.restore_dot_notation(sub, dotted_vars)

        prefix = f"s{si}_"

        def _rename(nid: str, p: str = prefix) -> str:
            return p + nid if nid.startswith("__") else nid

        for n in sub.get("nodes") or []:
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if not isinstance(nid, str):
                continue
            new_id = _rename(nid)
            cloned = dict(n)
            cloned["id"] = new_id
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                existing = merged_nodes[new_id]
                for k, v in cloned.items():
                    existing.setdefault(k, v)

        for e in sub.get("edges") or []:
            merged_edges.append({
                "from": _rename(e.get("from", "")),
                "to": _rename(e.get("to", "")),
            })

        out_set = {e.get("from") for e in sub.get("edges") or []}
        root_candidates = [
            n.get("id") for n in sub.get("nodes") or []
            if isinstance(n, dict) and n.get("id") not in out_set
        ]
        if root_candidates:
            roots.append(_rename(root_candidates[0]))
        else:
            roots.append(_rename(sub["nodes"][0].get("id", "")))

    equals_id = "__equals_1"
    merged_nodes[equals_id] = {
        "id": equals_id,
        "type": "operator",
        "op": "equals",
        "subexpr": " = ".join(sides),
    }
    for r in roots:
        if r:
            merged_edges.append({"from": r, "to": equals_id})

    graph = {
        "nodes": list(merged_nodes.values()),
        "edges": merged_edges,
        "classification": {"kind": "algebraic"},
    }
    _postprocessor.inject_annotations(graph, all_annotations)
    return graph
