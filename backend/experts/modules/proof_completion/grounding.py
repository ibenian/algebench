"""Grounding: turn a semantic graph back into a sympy expression and check it.

Two validation needs this supports:

* **Trajectory consistency** — ``apply(start, ops)`` structurally equals the
  target graph (``trajectory_consistent``). This is the structural check.

* **Accuracy / grounding** — does the graph actually represent the right math?
  We reconstruct a sympy expression from the graph *structurally* (not via the
  parser's ``subexpr`` string, which expert-produced nodes won't have) and check
  it is sympy-equivalent to the expected expression. This catches graphs that
  are mathematically wrong even if structurally plausible, and accepts graphs
  that are mathematically right even if shaped differently than the gold target.

The structural walk inverts the parser's encoding: power exponents live on the
``exponent`` attribute or an ``exp``-role edge; derivatives carry
``with_respect_to``; subtraction is ``negation``; division is ``power=-1``;
equations are ``relation``/``equals``.
"""

from __future__ import annotations

import re
from typing import Optional

import sympy as sp
from sympy.physics.quantum.state import Ket, Bra

from backend.model.semantic_graph import SemanticGraph

from .cas_guard import cas_register_safe_function
from .graph_ops import apply, canonical_equal

# op name -> sympy function (single-argument functions)
_FUNC = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "log": sp.log, "ln": sp.log, "exp": sp.exp, "sqrt": sp.sqrt,
    "abs": sp.Abs, "arg": sp.arg,
}

_CONSTANTS = {"pi": sp.pi, "e": sp.E, "E": sp.E, "infty": sp.oo, "oo": sp.oo}

# relation op -> sympy relational constructor
_RELATIONS = {
    "equals": sp.Eq, "not_equal": sp.Ne,
    "less_than": sp.Lt, "greater_than": sp.Gt,
    "less_equal": sp.Le, "greater_equal": sp.Ge,
}
# logical-connective operator op -> sympy boolean constructor (binary)
_LOGIC = {
    "implies": sp.Implies, "iff": sp.Equivalent,
    "conjunction": sp.And, "disjunction": sp.Or,
}


class UngroundableGraph(ValueError):
    """The graph uses a construct the structural walk does not model."""


# --------------------------------------------------------------------------- #
# trajectory consistency (structural)
# --------------------------------------------------------------------------- #

def trajectory_consistent(start: SemanticGraph, ops, target: SemanticGraph) -> bool:
    """True iff applying every op to ``start`` reproduces ``target`` (canonically)."""
    try:
        return canonical_equal(apply(start, ops), target)
    except Exception:
        return False


# --------------------------------------------------------------------------- #
# graph -> sympy (structural)
# --------------------------------------------------------------------------- #

def _symbol(node) -> sp.Expr:
    name = node.latex or node.id
    if name in _CONSTANTS:
        return _CONSTANTS[name]
    return sp.Symbol(name)


_KET_LATEX = re.compile(r"^\\left\|\s*(.*?)\s*\\right\\rangle$")
_BRA_LATEX = re.compile(r"^\\left\\langle\s*(.*?)\s*\\right\|$")


def _dirac(node, pattern, ctor, kind):
    """A Dirac ket/bra leaf as a sympy quantum ``Ket``/``Bra``, keyed by content.

    The key must come from the rendered content (``|0⟩`` → ``Ket('0')``,
    ``⟨0|`` → ``Bra('0')``), not the node id — ids are graph-local counters, and
    cross-state equivalence depends on the same ket/bra in two states mapping to
    the same atom.
    """
    latex = node.latex or ""
    m = pattern.match(latex)
    if not m or not m.group(1):
        raise UngroundableGraph(f"{kind} content {latex!r}")
    return ctor(m.group(1))


def _ket(node) -> sp.Expr:
    return _dirac(node, _KET_LATEX, Ket, "ket")


def _bra(node) -> sp.Expr:
    return _dirac(node, _BRA_LATEX, Bra, "bra")


@cas_register_safe_function
def graph_to_sympy(graph: SemanticGraph) -> sp.Expr:
    """Reconstruct a sympy expression from the graph structure. Raise if unmodeled."""
    nodes = {n.id: n for n in graph.nodes}
    if not nodes:
        raise UngroundableGraph("empty graph")

    # incoming edges per node (operands): list of (role, child_id), stable order
    incoming: dict[str, list] = {nid: [] for nid in nodes}
    outdeg: dict[str, int] = {nid: 0 for nid in nodes}
    for e in graph.edges:
        if e.to not in nodes or e.from_ not in nodes:
            raise UngroundableGraph("dangling edge")
        incoming[e.to].append((e.role, e.from_))
        outdeg[e.from_] += 1

    roots = [nid for nid in nodes if outdeg[nid] == 0]
    if len(roots) != 1:
        raise UngroundableGraph(f"expected one root, found {len(roots)}")

    memo: dict[str, sp.Expr] = {}
    visiting: set[str] = set()

    def ev(nid: str) -> sp.Expr:
        if nid in memo:
            return memo[nid]
        if nid in visiting:
            raise UngroundableGraph("cycle")
        visiting.add(nid)
        n = nodes[nid]
        ins = incoming[nid]
        t, op = n.type, n.op

        if t in ("scalar", "vector", "constant"):
            res = _symbol(n)
        elif t == "ket":
            res = _ket(n)
        elif t == "bra":
            res = _bra(n)
        elif t == "number":
            res = sp.sympify(n.label if n.label is not None else n.value)
        elif t == "operator":
            res = _eval_operator(n, op, ins, ev, nodes)
        elif t == "function":
            # ``\log_b`` / ``\ln`` carry the logarithm base as a separate
            # ``base``-role operand (``e`` for ``\ln``); every other function has
            # just its single argument. Split it out so the base doesn't count as
            # an extra arg (which used to fail the len==1 check, #log-grounding).
            base_ins = [c for r, c in ins if r == "base"]
            arg_ins = [c for r, c in ins if r != "base"]
            args = [ev(c) for c in arg_ins]
            fn = _FUNC.get(op or "")
            if fn is None or len(args) != 1:
                # ``i(\arg\beta - \arg\alpha)`` in an exponent parses as a
                # function call on ``i`` — it is implicit multiplication by the
                # imaginary unit, so ground it as ``i * operand`` (the same
                # ``i`` symbol scalar nodes produce).
                if op != "i" or len(args) != 1 or base_ins:
                    raise UngroundableGraph(f"function {op!r}")
                fn = sp.Symbol("i").__mul__
            if base_ins:
                # Only logarithms carry a base, and exactly one — anything else is a
                # malformed graph; fail fast rather than silently mis-grounding.
                if op not in ("log", "ln") or len(base_ins) != 1:
                    raise UngroundableGraph(
                        f"unexpected base operand(s) on function {op!r}")
                # sp.log(x, e) auto-simplifies to log(x); sp.log(x, 2) → log base 2
                res = sp.log(args[0], ev(base_ins[0]))
            else:
                res = fn(args[0])
        elif t == "relation":
            res = _eval_relation(op, ins, ev)
        else:
            raise UngroundableGraph(f"node type {t!r}")

        visiting.discard(nid)
        memo[nid] = res
        return res

    return ev(roots[0])


def _sympify_exponent(raw) -> sp.Expr:
    """Ground a power node's stored ``exponent``.

    The exponent is stored in one of two formats: a plain number string from
    ``_fmt_number`` (e.g. ``"2"``, ``"-1"``, ``"1/2"``) or a LaTeX subexpr from
    ``_subexpr_ordered`` for the symbolic-negative case (e.g. ``-z^{2}`` for an
    ``e^{-z^2}`` term). Plain ``sp.sympify`` handles the former but chokes on the
    latter — the LaTeX braces ``{2}`` parse as a Python set, giving
    ``Symbol ** set``. Try sympify first (fast, covers the numeric case) and fall
    back to the LaTeX parser for the symbolic form.
    """
    try:
        return sp.sympify(raw)
    except Exception:
        # parse_latex can itself raise on malformed/unsupported LaTeX — funnel that
        # into UngroundableGraph like every other grounding failure, so one bad
        # exponent string is a clean "can't ground this" signal the caller already
        # handles, not an unhandled exception that aborts the whole grounding.
        from sympy.parsing.latex import parse_latex
        try:
            parsed = parse_latex(str(raw))
        except Exception as e:
            raise UngroundableGraph("power exponent") from e
        if parsed is None:
            raise UngroundableGraph("power exponent")
        return parsed


def _eval_operator(n, op, ins, ev, nodes) -> sp.Expr:
    if op == "add":
        return sp.Add(*[ev(c) for _, c in ins])
    if op == "multiply":
        return sp.Mul(*[ev(c) for _, c in ins])
    if op == "negation":
        if len(ins) != 1:
            raise UngroundableGraph("negation arity")
        return -ev(ins[0][1])
    if op == "power":
        bases = [c for role, c in ins if role != "exp"]
        exps = [c for role, c in ins if role == "exp"]
        if len(bases) != 1:
            raise UngroundableGraph("power base")
        base = ev(bases[0])
        if n.exponent is not None:
            exp = _sympify_exponent(n.exponent)
        elif exps:
            exp = ev(exps[0])
        else:
            raise UngroundableGraph("power exponent")
        return sp.Pow(base, exp)
    if op == "derivative":
        operands = [c for role, c in ins if role != "wrt"]
        if len(operands) != 1:
            raise UngroundableGraph("derivative operand")
        f = ev(operands[0])
        if n.with_respect_to:
            wrt = [sp.Symbol(s.strip()) for s in n.with_respect_to.split(",") if s.strip()]
        else:
            wrt = [ev(c) for role, c in ins if role == "wrt"]
        if not wrt:
            raise UngroundableGraph("derivative wrt")
        return sp.Derivative(f, *wrt)
    if op == "integral":
        # The integrand is the unroled operand; each integration variable is read
        # off a first-class ``differential`` child (``wrt`` edge), keeping CAS
        # grounding fidelity — sympy needs the variable explicit or it can't
        # integrate. Optional ``lb``/``ub`` edges make it a definite integral.
        operands = [c for role, c in ins if role not in ("wrt", "lb", "ub")]
        if len(operands) != 1:
            raise UngroundableGraph("integral operand")
        f = ev(operands[0])
        diffs = [c for role, c in ins
                 if role == "wrt" and c in nodes and nodes[c].type == "differential"]
        syms = [sp.Symbol((nodes[c].with_respect_to or "").strip())
                for c in diffs if (nodes[c].with_respect_to or "").strip()]
        if not syms and n.with_respect_to:
            # Back-compat: older graphs carry the variable(s) on the integral's
            # ``with_respect_to`` (with a ``wrt`` edge from the bare variable)
            # rather than on a differential node.
            syms = [sp.Symbol(s.strip())
                    for s in n.with_respect_to.split(",") if s.strip()]
        if not syms:
            raise UngroundableGraph("integral differential")
        lb = [ev(c) for role, c in ins if role == "lb"]
        ub = [ev(c) for role, c in ins if role == "ub"]
        if lb and ub:
            # Definite integrals carry a single bound pair (multi-variable
            # definite integrals aren't modeled); bind it to the first variable.
            return sp.Integral(f, (syms[0], lb[0], ub[0]))
        return sp.Integral(f, *syms)
    if op in _LOGIC:
        left, right = _binary_operands(op, ins, ev)
        return _LOGIC[op](left, right)
    if op == "tuple":
        # Ordered component tuple ``(a, b, …)`` — see _eval_relation for how a
        # tuple = tuple equation grounds component-wise.
        if len(ins) < 2:
            raise UngroundableGraph("tuple arity")
        return sp.Tuple(*[ev(c) for _, c in ins])
    raise UngroundableGraph(f"operator {op!r}")


def _binary_operands(op, ins, ev):
    """Resolve (left, right) for a binary node, honoring lhs/rhs roles."""
    if len(ins) != 2:
        raise UngroundableGraph(f"{op!r} arity {len(ins)}")
    roles = {r: c for r, c in ins}
    if "lhs" in roles and "rhs" in roles:
        return ev(roles["lhs"]), ev(roles["rhs"])
    return ev(ins[0][1]), ev(ins[1][1])


def _eval_relation(op, ins, ev) -> sp.Expr:
    fn = _RELATIONS.get(op)
    if fn is None:
        raise UngroundableGraph(f"relation {op!r}")
    left, right = _binary_operands(op, ins, ev)
    # A component-wise tuple equation ``(x, y) = (a, b)`` means exactly the
    # conjunction of its component equations — sympy relationals don't accept
    # Tuple operands, so expand it here.
    if isinstance(left, sp.Tuple) or isinstance(right, sp.Tuple):
        if (op != "equals" or not isinstance(left, sp.Tuple)
                or not isinstance(right, sp.Tuple) or len(left) != len(right)):
            raise UngroundableGraph("tuple relation")
        return sp.And(*[sp.Eq(l, r) for l, r in zip(left, right)])
    # Chained comparison (``a <= g <= b`` parses as a relation whose operand is
    # itself a relation): read it as the standard conjunction sharing the
    # middle operand — ``And(a <= g, g <= b)``. sympy itself refuses to build
    # a Relational over a Relational.
    Rel = sp.core.relational.Relational
    if isinstance(left, Rel) and not isinstance(right, Rel):
        return sp.And(left, fn(left.rhs, right))
    if isinstance(right, Rel) and not isinstance(left, Rel):
        return sp.And(fn(left, right.lhs), right)
    return fn(left, right)


def graph_to_latex(graph: SemanticGraph) -> Optional[str]:
    """Faithful LaTeX for a *well-formed* graph.

    1. **structural** — reconstruct via ``graph_to_sympy`` and render (faithful).
    2. **single-root subexpr** — if the graph has exactly one root (no outgoing
       edge) carrying a ``subexpr``, use it.

    Returns ``None`` for a malformed graph (no single root / ungroundable). We do
    *not* guess from stale subexprs — a wrong-but-confident expression is worse
    than honestly flagging an un-renderable intermediate.
    """
    try:
        # mul_symbol="dot": explicit \cdot so start_latex/target_latex round-trip
        # through latex_to_graph (a symbol before "(" would parse as a function
        # call, not a product).
        return sp.latex(graph_to_sympy(graph), mul_symbol="dot")
    except Exception:
        pass

    outdeg = {n.id: 0 for n in graph.nodes}
    for e in graph.edges:
        outdeg[e.from_] = outdeg.get(e.from_, 0) + 1
    roots = [n for n in graph.nodes if outdeg.get(n.id, 0) == 0]
    if len(roots) == 1 and roots[0].subexpr:
        return roots[0].subexpr
    return None


# --------------------------------------------------------------------------- #
# sympy equivalence
# --------------------------------------------------------------------------- #

def _as_residual(expr):
    """Map an expression (or equation) to a residual that is 0 when it holds."""
    if isinstance(expr, sp.Equality):
        return sp.expand(expr.lhs - expr.rhs)
    return sp.expand(expr)


@cas_register_safe_function
def sympy_equiv(a, b) -> bool:
    """True iff ``a`` and ``b`` denote the same statement.

    - Plain expressions / equations: mathematically equal (equations up to sign).
    - Inequalities (``<``, ``>``, ``<=``, ``>=``, ``!=``): same relation, compared
      by canonical form (so ``3 > x`` matches ``x < 3``; direction is respected).
    - Boolean connectives (``=>``, ``<=>``, ``and``, ``or``): logically equivalent.
    """
    from sympy.logic.boolalg import BooleanFunction

    try:
        Rel = sp.core.relational.Relational
        a_eq, b_eq = isinstance(a, sp.Equality), isinstance(b, sp.Equality)

        # inequalities / not-equal: relational but not an equality
        a_ineq = isinstance(a, Rel) and not a_eq
        b_ineq = isinstance(b, Rel) and not b_eq
        if a_ineq or b_ineq:
            return bool(a_ineq and b_ineq and a.canonical == b.canonical)

        # boolean connectives (And / Or / Implies / Equivalent)
        if isinstance(a, BooleanFunction) or isinstance(b, BooleanFunction):
            if not (isinstance(a, BooleanFunction) and isinstance(b, BooleanFunction)):
                return False
            try:
                return bool(sp.simplify_logic(sp.Equivalent(a, b)) == sp.true)
            except Exception:
                return a == b

        # expressions / equalities: residual comparison (equations up to sign)
        ra, rb = _as_residual(a), _as_residual(b)
        if sp.simplify(ra - rb) == 0:
            return True
        if a_eq or b_eq:
            return sp.simplify(ra + rb) == 0
        return False
    except Exception:
        try:
            return bool(sp.simplify(a - b) == 0)
        except Exception:
            return False


def _coerce_expr(expr):
    """Accept a sympy expression or a sympify-able string."""
    if isinstance(expr, str):
        return sp.sympify(expr)
    return expr


def is_grounded(graph: SemanticGraph, expected) -> Optional[bool]:
    """True/False if the graph grounds to ``expected``; None if not groundable.

    ``expected`` may be a sympy expression or a sympify-able string.
    """
    try:
        expected = _coerce_expr(expected)
    except Exception:
        return None
    try:
        got = graph_to_sympy(graph)
    except UngroundableGraph:
        return None
    return sympy_equiv(got, expected)


# --------------------------------------------------------------------------- #
# per-step grounding (multi-step derivations)
# --------------------------------------------------------------------------- #

def _cumulative_at_step(start: SemanticGraph, ops, k: int) -> SemanticGraph:
    """Apply, in order, every op belonging to step <= k."""
    return apply(start, [op for op in ops if getattr(op, "step", 1) <= k])


def step_groundings(start: SemanticGraph, ops, step_exprs: list) -> list:
    """Gold check: does each step boundary ground to its expected expression?

    Returns one entry per derivation step: True / False / None (ungroundable).
    """
    out = []
    for k, expr in enumerate(step_exprs, start=1):
        try:
            g = _cumulative_at_step(start, ops, k)
        except Exception:
            out.append(False)
            continue
        out.append(is_grounded(g, expr))
    return out


def per_step_groundable(start: SemanticGraph, ops) -> tuple[int, int]:
    """Prediction check: how many step boundaries are valid math waypoints?

    A boundary is "valid" if the cumulative graph applies legally and grounds to
    *some* expression (independent of what it should be). Returns (ok, total).
    """
    steps = sorted({getattr(op, "step", 1) for op in ops})
    ok = 0
    for k in steps:
        try:
            g = _cumulative_at_step(start, ops, k)
            graph_to_sympy(g)
            ok += 1
        except Exception:
            pass
    return ok, len(steps)
