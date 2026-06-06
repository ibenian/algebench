"""Structural graph → LaTeX renderer (no sympy).

The inverse of the parser (``sympy_translator`` does LaTeX → graph; this does
graph → LaTeX). Unlike ``grounding.graph_to_latex`` (which routes through
``sympy.latex`` and therefore reorders/normalizes and drops node identity), this
walks the graph **structurally** — node-by-node, 1:1 — so the rendered LaTeX
mirrors the graph exactly. That structural fidelity is what the proof-animation
engine needs (each glyph traces back to a node).

``with_ids=True`` wraps every node's sub-expression in its id via ``wrap`` —
default KaTeX ``\\htmlData{n=<id>}{...}``, so the rendered DOM carries
``data-n="<id>"`` per node. ``with_ids=False`` emits the identical LaTeX without
the wrappers (byte-identical apart from transparent spans).

Mirrors ``graph_to_sympy``'s node/operator/role coverage; raises
``StructuralRenderError`` on an unmodeled construct or a non-single-root graph.
"""

from __future__ import annotations

from typing import Callable, Optional

from backend.model.semantic_graph import SemanticGraph


class StructuralRenderError(ValueError):
    """The graph uses a construct the structural renderer does not model."""


# Operator precedence (higher binds tighter). A child is parenthesized when its
# precedence is below the threshold the parent requires for that slot.
_LOGIC, _REL, _ADD, _ADDSUB, _MUL, _POW, _ATOM = 5, 10, 20, 25, 30, 40, 100

_FUNC_LATEX = {
    "sin": r"\sin", "cos": r"\cos", "tan": r"\tan",
    "asin": r"\arcsin", "acos": r"\arccos", "atan": r"\arctan",
    "sinh": r"\sinh", "cosh": r"\cosh", "tanh": r"\tanh",
    "log": r"\log", "ln": r"\ln", "exp": r"\exp",
}  # sqrt / abs handled specially
_REL_LATEX = {
    "equals": "=", "not_equal": r"\neq",
    "less_than": "<", "greater_than": ">",
    "less_equal": r"\leq", "greater_equal": r"\geq",
}
_LOGIC_LATEX = {
    "implies": r"\implies", "iff": r"\iff",
    "conjunction": r"\land", "disjunction": r"\lor",
}
_CONSTANT_LATEX = {"pi": r"\pi", "e": "e", "E": "e", "infty": r"\infty", "oo": r"\infty"}


def _identity(node_id: str, body: str) -> str:
    return body


def _htmldata(node_id: str, body: str) -> str:
    return f"\\htmlData{{n={node_id}}}{{{body}}}"


def to_latex(
    graph: SemanticGraph,
    *,
    with_ids: bool = False,
    wrap: Optional[Callable[[str, str], str]] = None,
) -> str:
    """Render ``graph`` to LaTeX by a structural walk.

    ``with_ids=True`` wraps each node via ``wrap(node_id, body)`` (default
    ``\\htmlData{n=id}{...}``). Raises ``StructuralRenderError`` for an unmodeled
    node/operator or a graph without exactly one root.
    """
    wrapper = (wrap or _htmldata) if with_ids else _identity

    nodes = {n.id: n for n in graph.nodes}
    if not nodes:
        raise StructuralRenderError("empty graph")

    incoming: dict[str, list] = {nid: [] for nid in nodes}
    outdeg: dict[str, int] = {nid: 0 for nid in nodes}
    for e in graph.edges:
        if e.to not in nodes or e.from_ not in nodes:
            raise StructuralRenderError("dangling edge")
        incoming[e.to].append((e.role, e.from_))
        outdeg[e.from_] += 1

    roots = [nid for nid in nodes if outdeg[nid] == 0]
    if len(roots) != 1:
        raise StructuralRenderError(f"expected one root, found {len(roots)}")

    memo: dict[str, tuple] = {}
    visiting: set[str] = set()

    def emit(nid: str) -> tuple[str, int]:
        if nid in memo:
            return memo[nid]
        if nid in visiting:
            raise StructuralRenderError("cycle")
        visiting.add(nid)
        body, prec = _emit_body(nodes[nid], incoming[nid], nodes, child)
        res = (wrapper(nid, body), prec)
        visiting.discard(nid)
        memo[nid] = res
        return res

    def child(nid: str, threshold: int) -> str:
        """Render a child, parenthesizing if it binds looser than ``threshold``."""
        s, prec = emit(nid)
        return f"\\left({s}\\right)" if prec < threshold else s

    return emit(roots[0])[0]


def _starts_negative(node) -> bool:
    """True if this term renders with a leading minus (negation op / negative number)."""
    if node.type == "operator" and node.op == "negation":
        return True
    if node.type == "number":
        val = node.label if node.label is not None else node.value
        return str(val).strip().startswith("-")
    return False


def _binary(ins, nodes) -> tuple[str, str]:
    """(lhs_id, rhs_id) for a binary node, honoring lhs/rhs roles."""
    if len(ins) != 2:
        raise StructuralRenderError(f"binary arity {len(ins)}")
    roles = {r: c for r, c in ins}
    if "lhs" in roles and "rhs" in roles:
        return roles["lhs"], roles["rhs"]
    return ins[0][1], ins[1][1]


def _emit_body(n, ins, nodes, child) -> tuple[str, int]:
    t, op = n.type, n.op

    if t in ("scalar", "vector"):
        return (n.latex or n.id, _ATOM)
    if t == "constant":
        name = n.latex or n.id
        return (_CONSTANT_LATEX.get(name, name), _ATOM)
    if t == "number":
        val = n.label if n.label is not None else n.value
        return (str(val), _ATOM)
    if t == "function":
        if len(ins) != 1:
            raise StructuralRenderError(f"function {op!r} arity {len(ins)}")
        arg = child(ins[0][1], _LOGIC)  # full sub-expr inside the call
        if op == "sqrt":
            return (f"\\sqrt{{{arg}}}", _ATOM)
        if op == "abs":
            return (f"\\left|{arg}\\right|", _ATOM)
        fn = _FUNC_LATEX.get(op or "")
        if fn is None:
            raise StructuralRenderError(f"function {op!r}")
        return (f"{fn}\\left({arg}\\right)", _ATOM)
    if t == "relation":
        sym = _REL_LATEX.get(op)
        if sym is None:
            raise StructuralRenderError(f"relation {op!r}")
        l, r = _binary(ins, nodes)
        return (f"{child(l, _REL)} {sym} {child(r, _REL)}", _REL)
    if t == "operator":
        return _emit_operator(n, op, ins, nodes, child)
    raise StructuralRenderError(f"node type {t!r}")


def _emit_operator(n, op, ins, nodes, child) -> tuple[str, int]:
    if op == "add":
        parts = []
        for i, (_role, c) in enumerate(ins):
            cs = child(c, _ADD)
            # a term whose rendering already starts with "-" (a negation operator
            # or a negative number) joins with a space, not " + ", so we get
            # "x^2 - 4" rather than "x^2 + -4".
            if i == 0:
                parts.append(cs)
            elif _starts_negative(nodes[c]):
                parts.append(" " + cs)
            else:
                parts.append(" + " + cs)
        return ("".join(parts), _ADD)

    if op == "multiply":
        return (" \\cdot ".join(child(c, _MUL) for _r, c in ins), _MUL)

    if op == "negation":
        if len(ins) != 1:
            raise StructuralRenderError("negation arity")
        return ("- " + child(ins[0][1], _ADDSUB), _ADDSUB)

    if op == "power":
        bases = [c for role, c in ins if role != "exp"]
        exps = [c for role, c in ins if role == "exp"]
        if len(bases) != 1:
            raise StructuralRenderError("power base")
        base_s = child(bases[0], _POW + 1)   # base parenthesized unless it's an atom
        if n.exponent is not None:
            exp_s = str(n.exponent)
        elif exps:
            exp_s = child(exps[0], _LOGIC)
        else:
            raise StructuralRenderError("power exponent")
        return (f"{base_s}^{{{exp_s}}}", _POW)

    if op == "derivative":
        operands = [c for role, c in ins if role != "wrt"]
        if len(operands) != 1:
            raise StructuralRenderError("derivative operand")
        if n.with_respect_to:
            wrt = ",".join(s.strip() for s in n.with_respect_to.split(",") if s.strip())
        else:
            wrt = ",".join(child(c, _LOGIC) for role, c in ins if role == "wrt")
        if not wrt:
            raise StructuralRenderError("derivative wrt")
        return (f"\\frac{{d}}{{d {wrt}}} {child(operands[0], _MUL)}", _MUL)

    if op in _LOGIC_LATEX:
        l, r = _binary(ins, nodes)
        return (f"{child(l, _LOGIC)} {_LOGIC_LATEX[op]} {child(r, _LOGIC)}", _LOGIC)

    raise StructuralRenderError(f"operator {op!r}")
