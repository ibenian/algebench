"""Issue #542 — a stored proof must carry enough to be re-graded faithfully.

Stored proofs used to persist each step's *verdict* but not the ``change_type``
that produced it, nor any marker of which tiers came from the LM domain judge.
Re-grading such a file offline silently returned every pair to
``type_consistent=True`` and demoted every judged step — a data-corruption trap
that looks exactly like success.

These tests pin the three inputs a faithful re-grade needs: the claim is stored,
the judge's provenance is stored, and a claim-less re-grade says so out loud.
"""

from __future__ import annotations

import logging

import pytest
import sympy as sp

from backend.experts.handlers.proof_animation.animation import (
    _attach_confidence, build,
)
from backend.experts.modules.proof_completion.outputs import (
    DerivationStep, ProofTrajectory,
)
from backend.experts.modules.proof_completion.step_grounding import (
    ground_steps,
)
from backend.experts.modules.proof_completion.judge import DomainVerdict


def _step(expr_latex, change_type="rewrite", operation="op", justification="why"):
    return DerivationStep(operation=operation, expr_latex=expr_latex,
                          justification=justification, change_type=change_type)


# --------------------------------------------------------------------------- #
# 1. the claim is persisted
# --------------------------------------------------------------------------- #


def test_build_persists_change_type_per_step():
    traj = ProofTrajectory(
        start_latex="x^2 = 4",
        steps=[_step("x^2 - 4 = 0", "rewrite"), _step("x = 2", "solve")],
    )
    data = build(traj, domain="algebra")
    # State 0 is the given — no incoming transition, so no claim.
    assert "change_type" not in data["steps"][0]
    assert [s.get("change_type") for s in data["steps"][1:]] == ["rewrite", "solve"]


def test_build_without_start_latex_leaves_state_zero_claim_less():
    # With no start state the chain LEADS with steps[0], which is then the given:
    # its claim grades no transition, so persisting it would misalign a re-grade.
    traj = ProofTrajectory(steps=[_step("x^2 = 4", "given"), _step("x = 2", "solve")])
    data = build(traj, domain="algebra")
    assert "change_type" not in data["steps"][0]
    assert data["steps"][1]["change_type"] == "solve"


def test_stored_claim_reproduces_the_mislabel_downgrade():
    """The whole point: with the claim in hand, a re-grade recomputes the notch.

    ``x^2 = 4 -> x = 2`` narrows; declared ``rewrite``, it is a mislabel and gets
    downgraded. Dropping the claim (the pre-#542 stored shape) hands the same
    pair a clean bill of health.
    """
    x = sp.Symbol("x")
    states = [sp.Eq(x ** 2, 4), sp.Eq(x, 2)]
    kept = ground_steps(states, change_types=["rewrite"]).steps[1]
    lost = ground_steps(states, allow_missing_change_types=True).steps[1]
    assert kept.type_consistent is False
    assert lost.type_consistent is True
    assert kept.tier is not lost.tier          # exactly the downgrade that vanished


# --------------------------------------------------------------------------- #
# 2. the absence is loud
# --------------------------------------------------------------------------- #


class _Traj:
    def __init__(self, steps, start_latex="x"):
        self.steps = steps
        self.start_latex = start_latex
        self.target_latex = None


class _Step:
    def __init__(self, change_type):
        self.change_type = change_type


@pytest.mark.parametrize("claims", [None, [], [None], [None, None]])
def test_missing_change_types_warns(caplog, claims):
    """Every spelling of "I have no claims" warns — not just ``None``.

    ``[]`` and an all-``None`` list grade identically to ``None``, so keying the
    guard rail off the sentinel would let the two commonest ways of saying it
    through in silence.
    """
    x = sp.Symbol("x")
    with caplog.at_level(logging.WARNING):
        ground_steps([x + 1, x + 1], change_types=claims)
    assert any("change_types" in r.getMessage() for r in caplog.records)


def test_supplied_or_acknowledged_change_types_do_not_warn(caplog):
    x = sp.Symbol("x")
    with caplog.at_level(logging.WARNING):
        ground_steps([x + 1, x + 1], change_types=["rewrite"])
        ground_steps([x + 1, x + 1], allow_missing_change_types=True)
        ground_steps([x + 1])                  # no transitions, nothing to claim
        # PARTIAL claims are not a loss — this caller has real ones.
        ground_steps([x + 1, x + 1, x + 1], change_types=[None, "rewrite"])
    assert not caplog.records


# --------------------------------------------------------------------------- #
# 3. the judge's provenance is persisted
# --------------------------------------------------------------------------- #


def test_judged_step_is_marked_in_the_stored_confidence():
    # A GRAY transition into a parseable state, rescued into DOMAIN by the judge.
    state_exprs = [None, sp.Symbol("x")]
    out = [{"index": i, "operation": "op", "justification": "why",
            "input_latex": "L", "latex": "L", "plain": "L"} for i in range(2)]
    _attach_confidence(out, state_exprs, _Traj([_Step("substitute")]), svc=None,
                       domain="hydrostatics",
                       judge=lambda **_kw: DomainVerdict(True, 0.95, "standard move"),
                       lesson_context="")
    assert out[1]["confidence"]["tier"] == "domain"
    assert out[1]["confidence"]["judged"] is True
    # A CAS verdict keeps its pre-#542 shape — the marker is additive.
    assert "judged" not in out[0]["confidence"]


# --------------------------------------------------------------------------- #
# 4. the edit path uses the stored claim rather than guessing
# --------------------------------------------------------------------------- #


def test_edit_rebuild_prefers_the_stored_claim():
    from backend.experts.handlers.proof_edit.variants import _infer_change_type

    step = {"change_type": "rewrite", "confidence": {"relation": "narrows"}}
    # Inference would say "solve" here — a consistent label that erases the very
    # mislabel the stored verdict recorded.
    assert _infer_change_type(step) == "rewrite"
    assert _infer_change_type({"confidence": {"relation": "narrows"}}) == "solve"
