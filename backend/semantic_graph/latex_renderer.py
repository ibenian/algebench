"""Structural graph → LaTeX renderer (no sympy).

The inverse of the parser (``sympy_translator`` does LaTeX → graph; this does
graph → LaTeX). Unlike ``grounding.graph_to_latex`` (which routes through
``sympy.latex`` and therefore reorders/normalizes and drops node identity), this
walks the graph **structurally** — node-by-node, 1:1 — so the rendered LaTeX
mirrors the graph exactly. That structural fidelity is what the proof-animation
engine needs (each glyph traces back to a node).

``with_ids=True`` wraps every node's sub-expression — AND every operator glyph
(``+``, ``=``, ``\\cdot``, ``-``) and exponent — in its own id via ``wrap``
(default KaTeX ``\\htmlData{n=<id>}{...}`` → ``data-n``). Tagging operators too
lets the animator move them (not just variables). A non-shared node keeps its bare
id (the cross-state match key). A *shared* (DAG) node — referenced by multiple
parents — gets one id per occurrence, derived from its STABLE parent id
(``<id>__<parent_oid>``), so the same physical spot keeps the same ``data-n``
across states even when the structure reorders. The DOM thus never has duplicate
``data-n``.

Raises ``StructuralRenderError`` on an unmodeled construct / non-single-root graph.
"""

from __future__ import annotations

from typing import Callable, Optional

from backend.model.semantic_graph import SemanticGraph


class StructuralRenderError(ValueError):
    """The graph uses a construct the structural renderer does not model."""


_LOGIC, _REL, _ADD, _ADDSUB, _MUL, _FRAC, _POW, _ATOM = 5, 10, 20, 25, 30, 30, 40, 100

_FUNC_LATEX = {
    "sin": r"\sin", "cos": r"\cos", "tan": r"\tan",
    "asin": r"\arcsin", "acos": r"\arccos", "atan": r"\arctan",
    "sinh": r"\sinh", "cosh": r"\cosh", "tanh": r"\tanh",
    "log": r"\log", "ln": r"\ln", "exp": r"\exp",
}
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
    gw = (wrap or _htmldata) if with_ids else _identity   # glyph + node wrapper

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

    occ: dict[tuple[str, str], int] = {}
    visiting: set[str] = set()

    def emit(nid: str, parent_oid: str = "") -> tuple[str, int]:
        if nid in visiting:
            raise StructuralRenderError("cycle")
        visiting.add(nid)
        # A shared (DAG) node is emitted once per parent; disambiguate each
        # occurrence by its STABLE parent id (not a render-order counter) so the
        # same physical spot keeps the same id across states even when the
        # structure reorders (e.g. an RHS term becoming a fraction numerator).
        # Non-shared nodes keep their bare id (the cross-state match key). ("~"
        # is LaTeX-active, so the separator is "__".)
        if outdeg[nid] > 1 and parent_oid:
            key = (nid, parent_oid)
            j = occ.get(key, 0)
            occ[key] = j + 1
            oid = f"{nid}__{parent_oid}" if j == 0 else f"{nid}__{parent_oid}_{j}"
        else:
            oid = nid

        def child(cid: str, threshold: int) -> str:
            s, prec = emit(cid, oid)
            return f"\\left({s}\\right)" if prec < threshold else s

        body, prec = _emit_body(nodes[nid], incoming[nid], nodes, incoming, child, oid, gw)
        visiting.discard(nid)
        return (gw(oid, body), prec)

    return emit(roots[0])[0]


def _starts_negative(node) -> bool:
    if node.type == "operator" and node.op == "negation":
        return True
    if node.type == "number":
        val = node.label if node.label is not None else node.value
        return str(val).strip().startswith("-")
    return False


def _binary(ins) -> tuple[str, str]:
    if len(ins) != 2:
        raise StructuralRenderError(f"binary arity {len(ins)}")
    roles = {r: c for r, c in ins}
    if "lhs" in roles and "rhs" in roles:
        return roles["lhs"], roles["rhs"]
    return ins[0][1], ins[1][1]


def _neg_power(node, node_ins):
    if node.type == "operator" and node.op == "power" and node.exponent is not None:
        e = str(node.exponent)
        if e.startswith("-"):
            base = [c for role, c in node_ins if role != "exp"]
            if len(base) == 1:
                mag = e[1:]
                return base[0], ("" if mag == "1" else mag)
    return None


def _emit_body(n, ins, nodes, incoming, child, oid, gw) -> tuple[str, int]:
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
        return (f"{child(l, _REL)} {gw(oid + '__op', sym)} {child(r, _REL)}", _REL)
    if t == "operator":
        return _emit_operator(n, op, ins, nodes, incoming, child, oid, gw)
    raise StructuralRenderError(f"node type {t!r}")


def _emit_operator(n, op, ins, nodes, incoming, child, oid, gw) -> tuple[str, int]:
    if op == "add":
        parts = []
        for i, (_role, c) in enumerate(ins):
            cs = child(c, _ADD)
            if i == 0:
                parts.append(cs)
            elif _starts_negative(nodes[c]):
                parts.append(" " + cs)                    # cs already begins with a (tagged) "-"
            else:
                parts.append(f" {gw(oid + '__op' + str(i), '+')} {cs}")
        return ("".join(parts), _ADD)

    if op == "multiply":
        num, den_specs = [], []
        for _r, c in ins:
            neg = _neg_power(nodes[c], incoming.get(c, []))
            if neg:
                den_specs.append(neg)             # (base_id, mag)
            else:
                num.append(child(c, _MUL))

        def joinmul(items, tag):
            if not items:
                return gw(oid + "__one", "1")   # tagged so the animator tracks it
            out = items[0]
            for i, it in enumerate(items[1:], start=1):
                out += f" {gw(oid + '__' + tag + str(i), chr(92) + 'cdot')} {it}"
            return out

        num_s = joinmul(num, "m")
        if den_specs:
            # {} already groups the denominator, so a single factor needs no parens
            thr = _LOGIC if len(den_specs) == 1 else _MUL
            den = [(child(b, _POW + 1) + f"^{{{m}}}") if m else child(b, thr)
                   for b, m in den_specs]
            den_s = den[0] if len(den) == 1 else joinmul(den, "d")
            return (f"\\frac{{{num_s}}}{{{den_s}}}", _FRAC)
        return (num_s, _MUL)

    if op == "negation":
        if len(ins) != 1:
            raise StructuralRenderError("negation arity")
        return (f"{gw(oid + '__op', '-')} {child(ins[0][1], _ADDSUB)}", _ADDSUB)

    if op == "power":
        bases = [c for role, c in ins if role != "exp"]
        exps = [c for role, c in ins if role == "exp"]
        if len(bases) != 1:
            raise StructuralRenderError("power base")
        if n.exponent is not None:
            exp_s = str(n.exponent)
            exp_tagged = gw(oid + "__exp", exp_s)
        elif exps:
            exp_s = child(exps[0], _LOGIC)
            exp_tagged = exp_s
        else:
            raise StructuralRenderError("power exponent")
        if exp_s in ("1/2", "0.5"):
            return (f"\\sqrt{{{child(bases[0], _LOGIC)}}}", _ATOM)
        if exp_s.startswith("-"):
            mag = exp_s[1:]
            inner = (child(bases[0], _LOGIC) if mag == "1"   # {} groups → no parens
                     else child(bases[0], _POW + 1) + f"^{{{mag}}}")
            return (f"\\frac{{{gw(oid + '__one', '1')}}}{{{inner}}}", _FRAC)
        return (f"{child(bases[0], _POW + 1)}^{{{exp_tagged}}}", _POW)

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
        return (f"{child(l, _LOGIC)} {gw(oid + '__op', _LOGIC_LATEX[op])} {child(r, _LOGIC)}", _LOGIC)

    raise StructuralRenderError(f"operator {op!r}")
