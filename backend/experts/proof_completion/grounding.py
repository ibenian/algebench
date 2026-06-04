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

from typing import Optional

import sympy as sp

from backend.model.semantic_graph import SemanticGraph

from .graph_ops import apply, canonical_equal

# op name -> sympy function (single-argument functions)
_FUNC = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "log": sp.log, "ln": sp.log, "exp": sp.exp, "sqrt": sp.sqrt,
    "abs": sp.Abs,
}

_CONSTANTS = {"pi": sp.pi, "e": sp.E, "E": sp.E, "infty": sp.oo, "oo": sp.oo}


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
        elif t == "number":
            res = sp.sympify(n.label if n.label is not None else n.value)
        elif t == "operator":
            res = _eval_operator(n, op, ins, ev)
        elif t == "function":
            args = [ev(c) for _, c in ins]
            fn = _FUNC.get(op or "")
            if fn is None or len(args) != 1:
                raise UngroundableGraph(f"function {op!r}")
            res = fn(args[0])
        elif t == "relation":
            res = _eval_relation(op, ins, ev)
        else:
            raise UngroundableGraph(f"node type {t!r}")

        visiting.discard(nid)
        memo[nid] = res
        return res

    return ev(roots[0])


def _eval_operator(n, op, ins, ev) -> sp.Expr:
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
            exp = sp.sympify(n.exponent)
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
    raise UngroundableGraph(f"operator {op!r}")


def _eval_relation(op, ins, ev) -> sp.Expr:
    if op == "equals" and len(ins) == 2:
        return sp.Eq(ev(ins[0][1]), ev(ins[1][1]))
    raise UngroundableGraph(f"relation {op!r}")


def graph_to_latex(graph: SemanticGraph) -> Optional[str]:
    """Best-effort latex: structural sympy if possible, else the root's subexpr."""
    try:
        return sp.latex(graph_to_sympy(graph))
    except Exception:
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


def sympy_equiv(a, b) -> bool:
    """True iff ``a`` and ``b`` are mathematically equal (equations up to sign)."""
    try:
        ra, rb = _as_residual(a), _as_residual(b)
        if sp.simplify(ra - rb) == 0:
            return True
        # equations: a == b is the same relation as b - a == 0
        if isinstance(a, sp.Equality) or isinstance(b, sp.Equality):
            return sp.simplify(ra + rb) == 0
        return False
    except Exception:
        try:
            return bool(sp.simplify(a - b) == 0)
        except Exception:
            return False


def is_grounded(graph: SemanticGraph, expected) -> Optional[bool]:
    """True/False if the graph grounds to ``expected``; None if not groundable."""
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
