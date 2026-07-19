"""The CAS *computes* mapped operations instead of grading a model-written result.

Why this path exists, measured on ``x^2 = 4`` before it did:

===============================  ==================  ===================
operation                        graded verdict      outcome
===============================  ==================  ===================
multiply both sides by 3         equivalent          offered
substitute ``u = x^2``           unknown             offered w/ caveat
differentiate both sides         **refuted**         **refused**
===============================  ==================  ===================

``2x = 0`` is the derivative of ``x^2 = 4``; it just has a different solution
set, which is the only thing ``classify_pair`` measures. Grading can never
accept it. Computing it can.
"""
from __future__ import annotations

import os

import pytest
import sympy as sp

from backend.experts.handlers.proof_edit import ops
from backend.experts.handlers.proof_edit.intent import (
    ProofEditProposal, ProposedStep,
)
from backend.experts.handlers.proof_edit.validate import (
    EditRefused, compute_step, resolve,
)

x, u, a, b, c = sp.symbols("x u a b c")


@pytest.fixture(scope="module", autouse=True)
def _process_isolated_cas():
    """Process isolation, like the sibling variant tests — thread mode never
    reclaims a wedged sympy call and eventually exhausts the shared executor."""
    from backend.experts.modules.proof_completion import cas_guard

    previous = os.environ.get("ALGEBENCH_CAS_ISOLATION")
    os.environ["ALGEBENCH_CAS_ISOLATION"] = "process"
    cas_guard._reset_for_tests()
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("ALGEBENCH_CAS_ISOLATION", None)
        else:
            os.environ["ALGEBENCH_CAS_ISOLATION"] = previous
        cas_guard._reset_for_tests()


PROOF = {
    "title": "probe", "domain": "algebra",
    "steps": [
        {"index": 0, "operation": "Given", "justification": "start",
         "input_latex": r"x^{2} = 4", "plain": r"x^{2} = 4", "latex": r"x^{2} = 4",
         "confidence": {"tier": "grounded", "relation": None}},
        {"index": 1, "operation": "take roots", "justification": "pm",
         "input_latex": r"x = 2", "plain": r"x = 2", "latex": r"x = 2",
         "confidence": {"tier": "verified", "relation": "narrows"}},
    ],
}


def _proposal(op, **kw):
    return ProofEditProposal(
        is_edit=True, summary="s", op=op, **kw,
        steps=[ProposedStep(operation=op, justification="because",
                            expr_latex=r"x = x")])


# --------------------------------------------------------------------------- #
# the ops themselves
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("op,kwargs,expected", [
    (ops.OP_MUL, dict(operand=sp.Integer(3)), sp.Eq(3 * x**2, 12)),
    (ops.OP_ADD, dict(operand=b), sp.Eq(x**2 + b, b + 4)),
    (ops.OP_DIV, dict(operand=sp.Integer(2)), sp.Eq(x**2 / 2, 2)),
    (ops.OP_DIFF, dict(variable=x), sp.Eq(2 * x, 0)),
    (ops.OP_SUBSTITUTE, dict(operand=x**2, replacement=u), sp.Eq(u, 4)),
])
def test_op_computes_the_expected_result(op, kwargs, expected):
    got = ops.apply_op(sp.Eq(x**2, 4), op, **kwargs)
    assert sp.simplify(got.lhs - expected.lhs) == 0
    assert sp.simplify(got.rhs - expected.rhs) == 0


def test_integration_stays_unevaluated():
    """Evaluating would silently drop the constant of integration.

    ``∫f dx = ∫g dx`` is always true; a pair of bare antiderivatives is not.
    """
    got = ops.apply_op(sp.Eq(x**2, 4), ops.OP_DIFF, variable=x)
    assert got == sp.Eq(2 * x, 0)
    integ = ops.apply_op(sp.Eq(x**2, 4), ops.OP_INTEGRATE, variable=x)
    assert isinstance(integ.lhs, sp.Integral) and isinstance(integ.rhs, sp.Integral)


# --------------------------------------------------------------------------- #
# refusals — cases where applying the op blindly would be wrong
# --------------------------------------------------------------------------- #

def test_both_sides_on_a_bare_expression_is_refused():
    """"Add 3 to both sides" of a non-equation changes its value."""
    with pytest.raises(ops.OpRefused, match="not an equation"):
        ops.apply_op(x**2 + 1, ops.OP_ADD, operand=sp.Integer(3))


def test_division_by_a_possibly_zero_operand_is_refused():
    with pytest.raises(ops.OpRefused, match="zero"):
        ops.apply_op(sp.Eq(x**2, 4), ops.OP_DIV, operand=c)


def test_scaling_an_inequality_by_an_unknown_sign_is_refused():
    """A negative factor flips the direction; the sign of a symbol is unknown."""
    with pytest.raises(ops.OpRefused, match="flip"):
        ops.apply_op(sp.Lt(x, 3), ops.OP_MUL, operand=a)


def test_scaling_an_inequality_by_a_positive_is_allowed():
    got = ops.apply_op(sp.Lt(x, 3), ops.OP_MUL, operand=sp.Integer(2))
    assert isinstance(got, sp.core.relational.Relational)


# --------------------------------------------------------------------------- #
# wiring: compute_step / resolve
# --------------------------------------------------------------------------- #

def test_unmapped_request_falls_back_to_the_graded_path():
    assert compute_step(PROOF, "algebra", 0, _proposal("")) is None
    assert compute_step(PROOF, "algebra", 0, _proposal("rotate_the_axes")) is None


def test_mapped_request_is_computed_not_taken_from_the_model():
    """The model's own expr_latex (``x = x``) must not survive."""
    step = compute_step(PROOF, "algebra", 0, _proposal(ops.OP_DIFF, variable="x"))
    assert step is not None
    assert "x = x" not in step["input_latex"]
    assert step["input_latex"] == r"2 \cdot x = 0"


def test_differentiation_is_offered_not_refused():
    """The regression this whole path exists for.

    Graded, ``x^2 = 4 -> 2x = 0`` comes back ``refuted`` and resolve() turns
    that into a flat refusal for correct math.
    """
    payload = resolve(PROOF, "algebra", 0, _proposal(ops.OP_DIFF, variable="x"),
                      derivation="", current_step="", request="differentiate")
    assert payload.new_steps[0].input_latex == r"2 \cdot x = 0"
    assert payload.new_steps[0].confidence["relation"] == "computed"
    assert payload.new_steps[0].confidence["tier"] == "grounded"


def test_substitution_is_offered_without_a_caveat():
    """Graded, a substitution can never be confirmed — it introduces a new symbol
    with no relation to the old one — so it used to ship caveated after burning
    the full retry budget."""
    payload = resolve(PROOF, "algebra", 0,
                      _proposal(ops.OP_SUBSTITUTE, operand_latex="x^{2}",
                                replacement_latex="u"),
                      derivation="", current_step="", request="substitute")
    assert payload.new_steps[0].input_latex == "u = 4"
    assert not payload.caveat


def test_an_invalid_mapped_op_refuses_rather_than_falling_back():
    """Dividing by something that may be zero is a real answer, not a reason to
    retry the same operation a less reliable way."""
    with pytest.raises(EditRefused, match="zero"):
        resolve(PROOF, "algebra", 0,
                _proposal(ops.OP_DIV, operand_latex="c"),
                derivation="", current_step="", request="divide by c")


def test_computed_steps_are_registered_with_the_cas_guard():
    """``guard`` refuses unregistered callables, so an unregistered op would
    silently return the default and be reported as a CAS failure."""
    from backend.experts.modules.proof_completion import cas_guard

    for op in ops.SUPPORTED_OPS:
        assert ops._DISPATCH[op] in cas_guard._ALLOWED, op
