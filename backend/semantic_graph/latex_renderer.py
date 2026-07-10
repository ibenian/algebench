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
    "arg": r"\arg",
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
    # Structural fan-out, EXCLUDING ``wrt`` metadata edges. Used only to decide
    # whether a node is a shared (DAG) occurrence needing a per-occurrence id.
    # A derivative's variable is the SAME node as a variable inside its operand
    # (``d/dx (x^2)``): the derivative renders ``\frac{d}{dx}`` from the
    # ``with_respect_to`` string (it does NOT re-emit the wrt node), so counting
    # the wrt edge would wrongly push the operand's ``x`` to a shared
    # ``x__power_…`` id that no longer matches the bare ``x`` elsewhere — breaking
    # the morph. Hence wrt edges don't count toward ``dag_deg``. (An integral's
    # variable is a first-class ``differential`` node on a ``wrt`` edge too; it
    # has out-degree 1 anyway, so it stays bare either way.)
    dag_deg: dict[str, int] = {nid: 0 for nid in nodes}
    for e in graph.edges:
        if e.to not in nodes or e.from_ not in nodes:
            raise StructuralRenderError("dangling edge")
        incoming[e.to].append((e.role, e.from_))
        outdeg[e.from_] += 1            # all edges → root detection (a wrt-only
                                        # variable is still not a root)
        if e.role != "wrt":
            dag_deg[e.from_] += 1

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
        if dag_deg[nid] > 1 and parent_oid:
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
    if t == "differential":
        # An integral's differential (``dv``) — a leaf rendered from its own
        # latex, like any symbol. It carries a ``data-n`` (its id, e.g. ``dv``)
        # so it morphs to/from a loose ``dv`` symbol across the ∫ boundary. The
        # id already includes the ``d`` (``dv``/``dx``), so it is the right
        # fallback when ``latex`` is absent.
        return (n.latex or n.id, _ATOM)
    if t in ("ket", "bra"):
        # A Dirac ket/bra leaf — the parser stores its full rendered form
        # (``\left|0\right\rangle``) on the node, like any other symbol leaf.
        if not n.latex:
            raise StructuralRenderError(f"{t} without latex")
        return (n.latex, _ATOM)
    if t == "constant":
        name = n.latex or n.id
        return (_CONSTANT_LATEX.get(name, name), _ATOM)
    if t == "number":
        val = n.label if n.label is not None else n.value
        return (str(val), _ATOM)
    if t == "function":
        # log/ln carry an optional ``base``-role operand (the parser splits the
        # base out as its own node — natural log gets base ``e``, ``log_b`` an
        # explicit base). That makes the node arity-2, so without this branch it
        # hit the arity gate below and raised — dropping the id-annotated LaTeX
        # (and thus term highlighting) on every log step. Render base-aware: an
        # ``e`` base (or ``ln``) stays implicit; any other base becomes a subscript.
        if op in ("log", "ln"):
            arg_ins = [c for role, c in ins if role != "base"]
            base_ins = [c for role, c in ins if role == "base"]
            if len(arg_ins) == 1 and len(base_ins) <= 1:
                arg = child(arg_ins[0], _LOGIC)
                # Preserve the glyph: the parser gives ``\log`` ``latex="\log"``
                # but ``\ln`` ``latex=None`` (both op ``log``), so a missing latex
                # uniquely means ``\ln`` — deriving from ``op`` would flip it.
                fn = getattr(n, "latex", None) or r"\ln"
                if base_ins:
                    bnode = nodes.get(base_ins[0])
                    # Natural base ``e`` stays implicit; any other base (a number
                    # like 10/2, or a symbol) becomes a subscript rendered via
                    # child() so numeric bases show their value, not a blank latex.
                    natural = (bnode is not None and bnode.type == "constant"
                               and getattr(bnode, "latex", None) == "e")
                    if not natural:
                        base = child(base_ins[0], _LOGIC)
                        return (rf"{fn}_{{{base}}}\left({arg}\right)", _ATOM)
                return (f"{fn}\\left({arg}\\right)", _ATOM)   # natural / implicit base
        if len(ins) != 1:
            raise StructuralRenderError(f"function {op!r} arity {len(ins)}")
        arg = child(ins[0][1], _LOGIC)
        if op == "sqrt":
            return (f"\\sqrt{{{arg}}}", _ATOM)
        if op == "abs":
            return (f"\\left|{arg}\\right|", _ATOM)
        fn = _FUNC_LATEX.get(op or "")
        if fn is None:
            # ``i(\arg\beta - \arg\alpha)`` parses as a function call on ``i``
            # (implicit multiplication by the imaginary unit); render it back
            # the way it was written rather than dropping the whole state's
            # id-annotated LaTeX. Mirrors the grounding-side special case.
            if op == "i":
                return (f"i\\left({arg}\\right)", _ATOM)
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
        # Tag the ``\frac{d}{d<var>}`` glyphs so the FLIP morph can key off them —
        # without ids a persisting derivative SNAPS while the operand around it
        # glides (e.g. the chain-rule step where ``d/dt`` splits into
        # ``d/dh · dh/dt``). Two kinds of glyph, two id sources:
        #
        #   • the two ``d`` operator glyphs are pure NOTATION (no graph node), so
        #     they get a synthetic id scoped to this derivative — ``__d``
        #     (numerator) and ``__dd`` (differential denominator).
        #   • the wrt VARIABLE ``t`` IS a real graph node (a ``wrt`` edge), so its
        #     glyph links to that node's id. But the same node can also be the
        #     operand's variable (``d/dx x²`` — one ``x`` node, two roles) or the
        #     wrt of another derivative (chain rule), so a bare ``n=x`` would DUP.
        #     We occurrence-scope it to THIS derivative (``<var>__<deriv_oid>``,
        #     e.g. ``t____deriv_2``) — the same convention the operand uses
        #     (``v____deriv_2``): unique per occurrence, still resolves back to the
        #     variable term (id splits on ``__``), and threads across states so the
        #     derivative's own ``d/d<var>`` morphs. wrt edges stay OUT of
        #     ``dag_deg`` (see top) so this scoping never perturbs the operand id.
        num = gw(oid + "__d", "d")
        dd = gw(oid + "__dd", "d")
        wrt_nodes = [c for role, c in ins if role == "wrt"]
        if wrt_nodes:
            wrt = ",".join(
                gw(f"{c}__{oid}",
                   _emit_body(nodes[c], incoming[c], nodes, incoming, child, c, gw)[0])
                for c in wrt_nodes)
        elif n.with_respect_to:                              # no node — bare string fallback
            parts = [s.strip() for s in n.with_respect_to.split(",") if s.strip()]
            if not parts:
                raise StructuralRenderError("derivative wrt")
            wrt = ",".join(gw(oid + "__wrt" + (str(k) if k else ""), p)
                           for k, p in enumerate(parts))
        else:
            raise StructuralRenderError("derivative wrt")
        return (f"\\frac{{{num}}}{{{dd} {wrt}}} {child(operands[0], _MUL)}", _MUL)

    if op in ("integral", "closed_integral"):
        # ``\int integrand d<var>``. The integrand is the unroled operand; each
        # integration variable is a first-class ``differential`` child (``wrt``
        # edge) rendered like any node — it carries its own ``data-n`` and morphs
        # to/from a loose ``dv`` symbol for free. ``lb``/``ub`` edges make it a
        # definite integral. Mirrors graph_to_sympy (see grounding.py).
        operands = [c for role, c in ins if role not in ("wrt", "lb", "ub")]
        if len(operands) != 1:
            raise StructuralRenderError("integral operand")
        diffs = [c for role, c in ins if role == "wrt"]
        if not diffs:
            raise StructuralRenderError("integral differential")
        base = "\\oint" if op == "closed_integral" else "\\int"
        lb = [c for role, c in ins if role == "lb"]
        ub = [c for role, c in ins if role == "ub"]
        # One integral sign per integration variable (∫∫ for a double integral).
        # Definite bounds attach to the first sign (the model carries a single
        # lower/upper bound per node — multi-variable definite integrals aren't
        # modeled, and fail the single-root check earlier rather than here).
        #
        # Each ∫ glyph carries its OWN stable id (``<oid>__int``, ``__int2``, …).
        # Without it the sign is an untagged decoration: the FLIP morph can't key
        # off it, so a persisting ∫ snaps to its new spot while the id'd content
        # around it glides — the "sudden jump" on integration steps. Tagging it
        # makes the sign a first-class glyph that slides / fades / ghosts like any
        # other. The bounds stay tagged children (bare ``\int`` in the no-id path,
        # so definite-integral rendering and round-trips are unchanged).
        first = gw(oid + "__int", base) + (
            f"_{{{child(lb[0], _LOGIC)}}}^{{{child(ub[0], _LOGIC)}}}"
            if lb and ub else "")
        extra = "".join(gw(oid + f"__int{k}", base)
                        for k in range(2, len(diffs) + 1))
        sign = first + extra
        diff = "".join(f"\\,{child(c, _MUL)}" for c in diffs)
        return (f"{sign} {child(operands[0], _MUL)}{diff}", _MUL)

    if op in _LOGIC_LATEX:
        l, r = _binary(ins)
        return (f"{child(l, _LOGIC)} {gw(oid + '__op', _LOGIC_LATEX[op])} {child(r, _LOGIC)}", _LOGIC)

    if op == "tuple":
        # Component-wise tuple ``(a, b, …)`` — the parens self-delimit, so
        # components render at the loosest precedence and the node is atomic.
        if len(ins) < 2:
            raise StructuralRenderError("tuple arity")
        parts = [child(c, _LOGIC) for _r, c in ins]
        joined = parts[0]
        for i, p in enumerate(parts[1:], start=1):
            joined += f"{gw(oid + '__sep' + str(i), ',')}\\; {p}"
        return (f"\\left( {joined} \\right)", _ATOM)

    raise StructuralRenderError(f"operator {op!r}")
