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
from backend.experts.modules.proof_edit.intent import (
    ProofEditProposal, ProposedStep,
)
from backend.experts.handlers.proof_edit.validate import (
    EditRefused, compute_step, recovery_bridge, resolve,
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
# side-scoped structural rewrites — "expand the left, leave the right"
# --------------------------------------------------------------------------- #

_SQ = sp.Eq((x + 1)**2, (u + 3)**2)


def test_expand_left_leaves_the_right_side_verbatim():
    got = ops.apply_op(_SQ, ops.OP_EXPAND, side="left")
    assert got.lhs == x**2 + 2 * x + 1
    assert got.rhs == (u + 3)**2          # untouched, exactly as written


def test_expand_right_leaves_the_left_side_verbatim():
    got = ops.apply_op(_SQ, ops.OP_EXPAND, side="right")
    assert got.lhs == (x + 1)**2
    assert got.rhs == u**2 + 6 * u + 9


def test_expand_both_is_the_default():
    both = ops.apply_op(_SQ, ops.OP_EXPAND, side="both")
    default = ops.apply_op(_SQ, ops.OP_EXPAND)
    assert both == default
    assert both.lhs == x**2 + 2 * x + 1 and both.rhs == u**2 + 6 * u + 9


def test_side_is_ignored_on_a_bare_expression():
    """A bare expression has no sides — side applies to the whole thing."""
    assert ops.apply_op((x + 1)**2, ops.OP_EXPAND, side="left") == x**2 + 2 * x + 1


def test_side_scoped_expand_does_not_collapse_the_other_side():
    """The exact bug: expanding the left collapsed 4ac/4a^2 -> c/a on the right.

    Parsing the whole equation to sympy auto-normalises the untouched side. The
    side-scoped path keeps that side's LaTeX verbatim, so the fraction survives.
    """
    step = r"\left(x + 1\right)^{2} = \frac{4 \cdot a \cdot c}{4 \cdot a^{2}}"
    proof = {
        "title": "p", "domain": "algebra",
        "steps": [
            {"index": 0, "operation": "g", "justification": "s",
             "input_latex": step, "plain": step, "latex": step,
             "confidence": {"tier": "grounded", "relation": None}},
            {"index": 1, "operation": "n", "justification": "n",
             "input_latex": r"x = 1", "plain": "x=1", "latex": "x=1",
             "confidence": {"tier": "verified", "relation": "narrows"}},
        ],
    }
    prop = ProofEditProposal(is_edit=True, summary="s", op=ops.OP_EXPAND, side="left",
        steps=[ProposedStep(operation="expand left", justification="b", expr_latex="x")])
    out = compute_step(proof, "algebra", 0, prop)
    assert out is not None
    rhs = out["input_latex"].split("=", 1)[1]
    assert "4 \\cdot a \\cdot c" in rhs      # kept verbatim
    assert "\\frac{c}{a}" not in rhs         # NOT collapsed


def test_compute_step_honours_the_requested_side():
    """The user's "expand the left, don't touch the right" reaches the CAS."""
    proof = {
        "title": "p", "domain": "algebra",
        "steps": [
            {"index": 0, "operation": "g", "justification": "s",
             "input_latex": r"\left(x + 1\right)^{2} = \left(u + 3\right)^{2}",
             "plain": r"(x+1)^2 = (u+3)^2",
             "latex": r"(x+1)^2 = (u+3)^2",
             "confidence": {"tier": "grounded", "relation": None}},
            {"index": 1, "operation": "n", "justification": "n",
             "input_latex": r"x = u + 2", "plain": r"x = u + 2", "latex": r"x = u + 2",
             "confidence": {"tier": "verified", "relation": "narrows"}},
        ],
    }
    prop = ProofEditProposal(is_edit=True, summary="s", op=ops.OP_EXPAND, side="left",
        steps=[ProposedStep(operation="expand left", justification="b", expr_latex="x")])
    step = compute_step(proof, "algebra", 0, prop)
    assert step is not None
    # left expanded, right still the unexpanded square
    assert "x^{2} + 2" in step["input_latex"]
    assert r"\left(u + 3\right)^{2}" in step["input_latex"]


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


def test_unmapped_op_uses_model_glue_for_the_bridge():
    """When the request maps to NO computed op, the model's glue is the bridge.

    The compute/recovery path only runs for mapped operations. An unmapped
    request (empty ``op``) goes through the graded path, where the "my step +
    bridge" option is built from the glue the model wrote — not a deterministic
    undo. (Regression: the compute path once told the model glue was pointless,
    and the bridge variant vanished.)
    """
    prop = ProofEditProposal(
        is_edit=True, summary="s", op="",   # unmapped → model-authored path
        steps=[
            ProposedStep(operation="rotate the frame", expr_latex=r"x^{2} = 4",
                         justification="the user's own step"),
            ProposedStep(operation="bridge", expr_latex=r"x = 2",
                         justification="back to the original next step"),
        ])
    payload = resolve(PROOF, "algebra", 0, prop, derivation="", current_step="",
                      request="rotate the frame")

    assert "glue" in {v.kind for v in payload.variants}
    assert "recovery" not in {v.kind for v in payload.variants}
    # The bridge is the model's second step, not a return to the original.
    assert payload.new_steps[1].input_latex == r"x = 2"


def test_recovery_bridge_supersedes_model_glue_when_available():
    """For an invertible op, the deterministic undo is preferred over model glue.

    The undo lands on an expression the proof already contains, so the following
    step's verdict is restored exactly rather than re-earned — strictly better
    than anything the model can author.
    """
    prop = ProofEditProposal(
        is_edit=True, summary="s", op=ops.OP_MUL, operand_latex="3",
        steps=[
            ProposedStep(operation="multiply by 3", expr_latex=r"x = x",
                         justification="discarded"),
            ProposedStep(operation="model bridge", expr_latex=r"9 = 9",
                         justification="should NOT be used"),
        ])
    payload = resolve(PROOF, "algebra", 0, prop, derivation="", current_step="",
                      request="multiply both sides by 3")
    assert payload.new_steps[0].input_latex == r"3 \cdot x^{2} = 12"
    # The recovery (back to step 0), not the model's "9 = 9".
    assert payload.new_steps[1].input_latex == PROOF["steps"][0]["input_latex"]
    assert "recovery" in {v.kind for v in payload.variants}


def test_substitution_offers_a_propagate_variant():
    """A substitution must come with a way to make the rest consistent.

    Applied to one step only, "substitute all $a$ with $\\sin(w)$" leaves every
    following step still written in $a$ and the CAS downgrades the next one. The
    chain really is worse, and neither glue (bridge back to the step that itself
    needs rewriting) nor supersede (delete what follows) repairs it — so the
    repair has to be its own option.
    """
    prop = _proposal(ops.OP_SUBSTITUTE, operand_latex="x^{2}",
                     replacement_latex="u")
    payload = resolve(PROOF, "algebra", 0, prop, derivation="", current_step="",
                      request="substitute all x^2 with u")

    by_kind = {v.kind: v for v in payload.variants}
    assert "propagate" in by_kind, f"no repair offered; got {list(by_kind)}"

    prop_v = by_kind["propagate"]
    # Takes every new step and drops the originals it replaces.
    assert prop_v.delete_count == len(PROOF["steps"]) - 1
    assert prop_v.take == len(payload.new_steps)
    # The rewritten tail really carries the substitution: `x = 2` has no x^2 to
    # replace, so it survives unchanged — what matters is that it was rebuilt
    # through the CAS rather than left behind.
    assert payload.new_steps[0].input_latex == "u = 4"


def test_propagate_is_not_offered_for_local_operations():
    """Multiplying every subsequent step by 3 is not a coherent edit."""
    payload = resolve(PROOF, "algebra", 0,
                      _proposal(ops.OP_MUL, operand_latex="3"),
                      derivation="", current_step="", request="multiply by 3")
    assert all(v.kind != "propagate" for v in payload.variants)


def test_propagate_is_not_offered_at_the_end_of_a_proof():
    """Nothing follows, so there is nothing to make consistent."""
    last = len(PROOF["steps"]) - 1
    payload = resolve(PROOF, "algebra", last,
                      _proposal(ops.OP_SUBSTITUTE, operand_latex="x",
                                replacement_latex="u"),
                      derivation="", current_step="", request="substitute")
    assert all(v.kind != "propagate" for v in payload.variants)


def test_recovery_bridge_returns_to_the_previous_expression():
    """The bridge undoes the edit, so the original next step follows again.

    ``n → X → n → n+1``: that last transition is literally the one the proof
    always had, so its verdict is restored exactly rather than re-earned. Built
    from the stored LaTeX, not by applying an inverse, so it cannot drift.
    """
    bridge = recovery_bridge(PROOF, 0, _proposal(ops.OP_MUL, operand_latex="3"))
    assert bridge is not None
    assert bridge[0]["input_latex"] == PROOF["steps"][0]["input_latex"]
    assert "divide" in bridge[0]["operation"].lower()


def test_recovery_is_offered_as_the_bridge_variant():
    payload = resolve(PROOF, "algebra", 0,
                      _proposal(ops.OP_MUL, operand_latex="3"),
                      derivation="", current_step="", request="multiply by 3")
    by_kind = {v.kind for v in payload.variants}
    assert "recovery" in by_kind, f"no recovery offered; got {by_kind}"
    assert "glue" not in by_kind, "an invertible op should not be labelled generic glue"
    assert payload.new_steps[1].input_latex == PROOF["steps"][0]["input_latex"]
    # The recovery caption says HOW it recovers, and that it undoes the step.
    assert "undo" in payload.new_steps[1].operation.lower()


@pytest.mark.parametrize("op,kw", [
    (ops.OP_ADD, dict(operand_latex="3")),
    (ops.OP_MUL, dict(operand_latex="3")),
    (ops.OP_SUBSTITUTE, dict(operand_latex="x", replacement_latex="u")),
    (ops.OP_DIFF, dict(variable="x")),
    (ops.OP_INTEGRATE, dict(variable="x")),
    (ops.OP_SIMPLIFY, {}),
    (ops.OP_EXPAND, {}),
    (ops.OP_FACTOR, {}),
])
def test_every_computed_op_offers_a_recovery(op, kw):
    """Recovery is universal — the recovered expression is always the original,
    so it can always be built. Whether the undo grounds is the badge's job, not a
    gate on offering it.
    """
    bridge = recovery_bridge(PROOF, 0, _proposal(op, **kw))
    assert bridge is not None, f"no recovery offered for {op}"
    assert bridge[0]["input_latex"] == PROOF["steps"][0]["input_latex"]  # exact return
    assert bridge[0]["operation"], "recovery step must have a caption"
    assert "both sides" not in bridge[0]["operation"].lower() or op in (
        ops.OP_ADD, ops.OP_SUB, ops.OP_MUL, ops.OP_DIV)  # only equation ops say it


@pytest.mark.parametrize("op,inverse_word", [
    (ops.OP_INTEGRATE, "differentiate"),
    (ops.OP_DIFF, "integrate"),
])
def test_calculus_recovery_caption_names_the_inverse(op, inverse_word):
    """The calculus undo caption names the inverse op + variable, no "both sides"
    (these apply to bare expressions too)."""
    bridge = recovery_bridge(PROOF, 0, _proposal(op, variable="x"))
    caption = bridge[0]["operation"].lower()
    assert inverse_word in caption and "undoing" in caption
    assert "both sides" not in caption


def test_calculus_recovery_undo_is_offerable_not_refuted():
    """The undo step must never come back REFUTED — we never offer refuted steps.

    The CAS can't verify differentiation, so it grades the undo ``plausible``
    (measured), which is offerable. This pins that: a refuted undo would mean a
    known-wrong step in an offered variant.
    """
    payload = resolve(PROOF, "algebra", 0, _proposal(ops.OP_INTEGRATE, variable="x"),
                      derivation="", current_step="", request="integrate")
    assert "recovery" in {v.kind for v in payload.variants}
    undo = payload.new_steps[1]
    assert undo.input_latex == PROOF["steps"][0]["input_latex"]     # exact return
    assert (undo.confidence or {}).get("tier") != "refuted"


def test_no_recovery_at_the_final_step():
    """Nothing follows, so there is nothing to get back to."""
    last = len(PROOF["steps"]) - 1
    assert recovery_bridge(PROOF, last,
                           _proposal(ops.OP_MUL, operand_latex="3")) is None


def test_computed_steps_are_registered_with_the_cas_guard():
    """``guard`` refuses unregistered callables, so an unregistered op would
    silently return the default and be reported as a CAS failure."""
    from backend.experts.modules.proof_completion import cas_guard

    for op in ops.SUPPORTED_OPS:
        assert ops._DISPATCH[op] in cas_guard._ALLOWED, op
