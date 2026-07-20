r"""Deterministic sympy operations — the CAS *computes* the step, not just grades it.

Most of the edit path has the model author the resulting expression and
``classify_pair`` grade it afterwards. That grading asks one question: is the
solution set preserved? It is the right question for a rewrite and the wrong one
for an operation whose whole purpose is to change the solution set. Measured on
``x^2 = 4``:

===============================  ==================  ===================
operation                        graded verdict      outcome
===============================  ==================  ===================
multiply both sides by 3         equivalent          offered
substitute ``u = x^2``           unknown             offered w/ caveat
differentiate both sides         **refuted**         **refused**
===============================  ==================  ===================

``2x = 0`` really is the derivative of ``x^2 = 4``; it just has a different
solution set. Grading alone can never accept it.

So when a request maps onto an operation sympy can perform, we perform it. The
model supplies only the operand ("2", "u = x^2", "x") and the CAS produces the
result. That is strictly stronger than grading — the step is correct *by
construction* rather than by a check that might be inconclusive — and it also
closes the intent-drift gap, since the model can no longer return a different
expression that merely happens to be equivalent.

Every op is module-level and registered with ``cas_register_safe_function``:
``guard`` refuses unregistered callables, and process isolation pickles the
function, so neither lambdas nor closures are possible here.
"""
from __future__ import annotations

import sympy as sp

from backend.experts.modules.proof_completion.cas_guard import (
    cas_register_safe_function, guard,
)

# Requests that map onto a sympy operation. Anything not here keeps the
# model-authored + graded path.
OP_ADD = "add_both_sides"
OP_SUB = "subtract_both_sides"
OP_MUL = "multiply_both_sides"
OP_DIV = "divide_both_sides"
OP_DIFF = "differentiate_both_sides"
OP_INTEGRATE = "integrate_both_sides"
OP_SUBSTITUTE = "substitute"
OP_SIMPLIFY = "simplify"
OP_EXPAND = "expand"
OP_FACTOR = "factor"

# Ops that take an operand expression ("add 3x" needs the 3x).
NEEDS_OPERAND = {OP_ADD, OP_SUB, OP_MUL, OP_DIV, OP_SUBSTITUTE}
# Ops that take a variable ("differentiate with respect to x").
NEEDS_VARIABLE = {OP_DIFF, OP_INTEGRATE}


def _both(expr, fn):
    """Apply ``fn`` to both sides of a relation, or to a bare expression.

    ``evaluate=False`` on the rebuilt equality keeps the two sides as the reader
    would write them — ``2(x+1) = 2·3`` rather than sympy's auto-simplified
    ``2x+2 = 6``. Simplifying is a separate step the reader can ask for.
    """
    if isinstance(expr, sp.Equality):
        return sp.Eq(fn(expr.lhs), fn(expr.rhs), evaluate=False)
    if isinstance(expr, sp.core.relational.Relational):
        return expr.func(fn(expr.lhs), fn(expr.rhs))
    return fn(expr)


# --------------------------------------------------------------------------- #
# the ops
# --------------------------------------------------------------------------- #

@cas_register_safe_function
def _op_add_both_sides(expr, operand):
    return _both(expr, lambda side: side + operand)


@cas_register_safe_function
def _op_sub_both_sides(expr, operand):
    return _both(expr, lambda side: side - operand)


@cas_register_safe_function
def _op_mul_both_sides(expr, operand):
    return _both(expr, lambda side: sp.Mul(side, operand, evaluate=False))


@cas_register_safe_function
def _op_div_both_sides(expr, operand):
    return _both(expr, lambda side: sp.Mul(side, sp.Pow(operand, -1), evaluate=False))


@cas_register_safe_function
def _op_diff_both_sides(expr, var):
    """Differentiate both sides. Evaluated — an unevaluated ``Derivative`` reads
    as a restatement rather than a step."""
    return _both(expr, lambda side: sp.diff(side, var))


@cas_register_safe_function
def _op_integrate_both_sides(expr, var):
    """Integrate both sides, UNEVALUATED.

    Deliberate: evaluating turns ``∫f dx = ∫g dx`` into a pair of antiderivatives
    that silently drop the constant of integration, which is exactly the mistake
    a reader is trying to learn not to make. The unevaluated form is always
    correct, and "evaluate that integral" is a separate request.
    """
    return _both(expr, lambda side: sp.Integral(side, var))


@cas_register_safe_function
def _op_substitute(expr, old, new):
    return expr.subs(old, new)


@cas_register_safe_function
def _op_simplify(expr):
    return sp.simplify(expr)


@cas_register_safe_function
def _op_expand(expr):
    return sp.expand(expr)


@cas_register_safe_function
def _op_factor(expr):
    return sp.factor(expr)


_DISPATCH = {
    OP_ADD: _op_add_both_sides,
    OP_SUB: _op_sub_both_sides,
    OP_MUL: _op_mul_both_sides,
    OP_DIV: _op_div_both_sides,
    OP_DIFF: _op_diff_both_sides,
    OP_INTEGRATE: _op_integrate_both_sides,
    OP_SUBSTITUTE: _op_substitute,
    OP_SIMPLIFY: _op_simplify,
    OP_EXPAND: _op_expand,
    OP_FACTOR: _op_factor,
}

SUPPORTED_OPS = tuple(_DISPATCH)

# A RECOVERY step returns to the expression the edit started from, so the step
# that originally followed it follows again. It is ALWAYS constructible — the
# recovered expression IS the original, which we already have — so it is offered
# for every operation, and the badge tells the truth about how well it holds up:
#
# * add/sub, mul/div, substitute, simplify/expand/factor — the undo is
#   EQUIVALENCE-PRESERVING, so the CAS grounds it. Recovery is a strict win: the
#   undo step is grounded and the following step's verdict is fully restored.
# * differentiate/integrate — the undo (integrate / differentiate) is NOT
#   equivalence-preserving in the CAS's eyes: it has no FTC/derivative method and
#   ``∫f dx`` is not equal to ``f`` as an expression, so it grades the undo
#   ``plausible``, not grounded (measured, not assumed). Recovery still returns to
#   the exact original expression — keeping the REST of the proof grounded — with
#   only the undo step itself carrying a plausible badge.
#
# Whether the undo grounds is not a gate; it is only what the badge reports. The
# reader decides if the recovery is worth taking.

# Named inverse used in the undo CAPTION, where one exists. ``simplify`` has no
# named inverse — its recovery is captioned generically ("return to the previous
# form") — so it is absent here but still recovery-eligible.
INVERSE_OPS = {
    OP_ADD: OP_SUB,
    OP_SUB: OP_ADD,
    OP_MUL: OP_DIV,
    OP_DIV: OP_MUL,
    OP_SUBSTITUTE: OP_SUBSTITUTE,   # invertible by swapping the two sides
    OP_DIFF: OP_INTEGRATE,          # undo a derivative by integrating (plausible)
    OP_INTEGRATE: OP_DIFF,          # undo an integral by differentiating (plausible)
    OP_FACTOR: OP_EXPAND,           # undo factoring by expanding
    OP_EXPAND: OP_FACTOR,           # undo expanding by factoring
}

# How the inverse reads, and WHY — the caption must make clear this step exists
# to undo the one before it, not to do the same thing twice. "…by 4 again" would
# read as a second division that never happened; "…to undo the multiplication"
# says what the step is actually for.
_UNDO_PHRASE = {
    OP_ADD: "subtract {operand} from both sides, undoing the addition",
    OP_SUB: "add {operand} back to both sides, undoing the subtraction",
    OP_MUL: "divide both sides by {operand}, undoing the multiplication",
    OP_DIV: "multiply both sides by {operand}, undoing the division",
}


def describe_undo(op: str, operand_latex: str = "", replacement_latex: str = "",
                  variable: str = "") -> str:
    """A reader-facing caption for the step that undoes ``op``.

    Note the phrasing describes the RECOVERY: the operation applied *and* that it
    reverses the inserted step, since the whole point of this step is to get back
    to the expression the rest of the proof was built on.
    """
    if op == OP_SUBSTITUTE:
        return (f"substitute ${operand_latex}$ back for ${replacement_latex}$, "
                f"undoing the substitution"
                if operand_latex and replacement_latex else "undo the substitution")
    # Calculus undos read "differentiate/integrate with respect to x" — NOT "both
    # sides", since these apply to bare expressions too (the integrand in the
    # screenshot was `d/dx sin(x^2)`, not an equation).
    if op == OP_INTEGRATE:
        v = f"${variable}$" if variable else "the variable"
        return f"differentiate with respect to {v}, undoing the integration"
    if op == OP_DIFF:
        v = f"${variable}$" if variable else "the variable"
        return f"integrate with respect to {v}, undoing the differentiation"
    # Structural inverses that take no operand.
    if op == OP_FACTOR:
        return "expand, undoing the factoring"
    if op == OP_EXPAND:
        return "factor, undoing the expansion"
    phrase = _UNDO_PHRASE.get(op)
    if phrase:
        return phrase.format(operand=f"${operand_latex}$" if operand_latex else "it")
    # No named inverse (e.g. simplify) — the recovery still returns to the exact
    # previous expression; caption it for what it is.
    return "return to the previous form"


class OpRefused(Exception):
    """The operation is not valid on this step; carries a reader-facing reason."""


def _guarded(fn, *args):
    """Run through the killable guard — a pathological expression can't peg a core."""
    out = guard(fn, *args, default=None)
    if out is None:
        raise OpRefused("the computer algebra system could not complete that operation")
    return out


def _check_operand(op: str, expr, operand):
    """Refuse the cases where blindly applying the op would be wrong."""
    if isinstance(expr, sp.core.relational.Relational) and not isinstance(expr, sp.Equality):
        # Multiplying or dividing an inequality by a negative flips it. Rather
        # than guess the sign of a symbolic factor, decline.
        if op in (OP_MUL, OP_DIV) and operand.is_positive is not True:
            raise OpRefused(
                "that would multiply an inequality by a factor whose sign isn't "
                "known — the direction could flip")
    if op == OP_DIV and operand.is_zero is not False:
        raise OpRefused("that divisor could be zero")


def apply_op(expr, op: str, *, operand=None, variable=None, replacement=None):
    """Perform ``op`` on ``expr`` with sympy. Raises :class:`OpRefused` if invalid.

    Both-sides arithmetic on a BARE expression is refused: "add 3 to both sides"
    of something that is not an equation silently changes its value rather than
    rearranging it.
    """
    fn = _DISPATCH.get(op)
    if fn is None:
        raise OpRefused(f"unsupported operation {op!r}")

    if op in NEEDS_OPERAND and op != OP_SUBSTITUTE:
        if operand is None:
            raise OpRefused("that operation needs something to apply")
        if not isinstance(expr, sp.core.relational.Relational):
            raise OpRefused(
                "this step is an expression, not an equation — there are no "
                "'both sides' to apply that to")
        _check_operand(op, expr, operand)
        return _guarded(fn, expr, operand)

    if op == OP_SUBSTITUTE:
        if operand is None or replacement is None:
            raise OpRefused("a substitution needs both what to replace and what to put in its place")
        return _guarded(fn, expr, operand, replacement)

    if op in NEEDS_VARIABLE:
        if variable is None:
            raise OpRefused("that operation needs a variable to work with respect to")
        return _guarded(fn, expr, variable)

    return _guarded(fn, expr)


__all__ = [
    "INVERSE_OPS", "NEEDS_OPERAND", "NEEDS_VARIABLE", "OP_ADD", "OP_DIFF",
    "OP_DIV", "OP_EXPAND", "OP_FACTOR", "OP_INTEGRATE", "OP_MUL", "OP_SIMPLIFY",
    "OP_SUB", "OP_SUBSTITUTE", "OpRefused", "SUPPORTED_OPS", "apply_op",
    "describe_undo",
]
