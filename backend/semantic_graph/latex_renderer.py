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
the wrappers.

A shared node (a DAG — e.g. ``a`` in ``(a-b)(a+b)``) is emitted once per
occurrence with a **distinct** id (``a``, ``a~1``, …) so the DOM never has
duplicate ``data-n`` (which the animator would collapse). The first occurrence
keeps the bare id, so cross-state correspondence still holds.

Mirrors ``graph_to_sympy``'s coverage; raises ``StructuralRenderError`` on an
unmodeled construct or a non-single-root graph.
"""

from __future__ import annotations

from typing import Callable, Optional

from backend.model.semantic_graph import SemanticGraph


class StructuralRenderError(ValueError):
    """The graph uses a construct the structural renderer does not model."""


# Operator precedence (higher binds tighter). A child is parenthesized when its
# precedence is below the threshold the parent requires for that slot.
_LOGIC, _REL, _ADD, _ADDSUB, _MUL, _FRAC, _POW, _ATOM = 5, 10, 20, 25, 30, 30, 40, 100

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
_CONSTANT_LATEX = {"pi": r"\pi", "infty": r"\infty", "oo": r"\infty"}


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
    """Render ``graph`` to LaTeX by a structural walk (see module docstring)."""
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

    counts: dict[str, int] = {}   # emissions per node id → unique occurrence ids
    visiting: set[str] = set()

    def emit(nid: str) -> tuple[str, int]:
        if nid in visiting:
            raise StructuralRenderError("cycle")
        visiting.add(nid)
        body, prec = _emit_body(nodes[nid], incoming[nid], nodes, incoming, child)
        visiting.discard(nid)
        k = counts.get(nid, 0)
        counts[nid] = k + 1
        # "~" is a LaTeX active char (KaTeX turns it into \nobreakspace inside the
        # data value); "__" survives intact, like the parser's own ids.
        out_id = nid if k == 0 else f"{nid}__{k}"
        return (wrapper(out_id, body), prec)

    def child(nid: str, threshold: int) -> str:
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


def _binary(ins) -> tuple[str, str]:
    """(lhs_id, rhs_id) for a binary node, honoring lhs/rhs roles."""
    if len(ins) != 2:
        raise StructuralRenderError(f"binary arity {len(ins)}")
    roles = {r: c for r, c in ins}
    if "lhs" in roles and "rhs" in roles:
        return roles["lhs"], roles["rhs"]
    return ins[0][1], ins[1][1]


def _neg_power(node, node_ins):
    """If ``node`` is a power with a negative exponent, return (base_id, mag) where
    mag is the magnitude exponent ("" for 1). Else None. Used to build fractions."""
    if node.type == "operator" and node.op == "power" and node.exponent is not None:
        e = str(node.exponent)
        if e.startswith("-"):
            base = [c for role, c in node_ins if role != "exp"]
            if len(base) == 1:
                mag = e[1:]
                return base[0], ("" if mag == "1" else mag)
    return None


def _emit_body(n, ins, nodes, incoming, child) -> tuple[str, int]:
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
        arg = child(ins[0][1], _LOGIC)
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
        l, r = _binary(ins)
        return (f"{child(l, _REL)} {sym} {child(r, _REL)}", _REL)
    if t == "operator":
        return _emit_operator(n, op, ins, nodes, incoming, child)
    raise StructuralRenderError(f"node type {t!r}")


def _emit_operator(n, op, ins, nodes, incoming, child) -> tuple[str, int]:
    if op == "add":
        parts = []
        for i, (_role, c) in enumerate(ins):
            cs = child(c, _ADD)
            if i == 0:
                parts.append(cs)
            elif _starts_negative(nodes[c]):
                parts.append(" " + cs)       # cs already begins with "-"
            else:
                parts.append(" + " + cs)
        return ("".join(parts), _ADD)

    if op == "multiply":
        num, den = [], []
        for _r, c in ins:
            neg = _neg_power(nodes[c], incoming.get(c, []))
            if neg:
                base_id, mag = neg
                den.append((child(base_id, _POW + 1) + f"^{{{mag}}}") if mag
                           else child(base_id, _MUL))   # {} already groups → no parens
            else:
                num.append(child(c, _MUL))
        num_s = " \\cdot ".join(num) if num else "1"
        if den:
            return (f"\\frac{{{num_s}}}{{{' \\cdot '.join(den)}}}", _FRAC)
        return (num_s, _MUL)

    if op == "negation":
        if len(ins) != 1:
            raise StructuralRenderError("negation arity")
        return ("- " + child(ins[0][1], _ADDSUB), _ADDSUB)

    if op == "power":
        bases = [c for role, c in ins if role != "exp"]
        exps = [c for role, c in ins if role == "exp"]
        if len(bases) != 1:
            raise StructuralRenderError("power base")
        if n.exponent is not None:
            exp_s = str(n.exponent)
        elif exps:
            exp_s = child(exps[0], _LOGIC)
        else:
            raise StructuralRenderError("power exponent")
        if exp_s in ("1/2", "0.5"):                       # square root
            return (f"\\sqrt{{{child(bases[0], _LOGIC)}}}", _ATOM)
        if exp_s.startswith("-"):                          # reciprocal → fraction
            mag = exp_s[1:]
            inner = (child(bases[0], _MUL) if mag == "1"
                     else child(bases[0], _POW + 1) + f"^{{{mag}}}")
            return (f"\\frac{{1}}{{{inner}}}", _FRAC)
        return (f"{child(bases[0], _POW + 1)}^{{{exp_s}}}", _POW)

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
        l, r = _binary(ins)
        return (f"{child(l, _LOGIC)} {_LOGIC_LATEX[op]} {child(r, _LOGIC)}", _LOGIC)

    raise StructuralRenderError(f"operator {op!r}")
