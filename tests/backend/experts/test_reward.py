"""Tests for the graded refinement reward and threshold (issue #372 §B)."""

from __future__ import annotations

import pytest

from backend.experts.modules.proof_completion import dataset as D
from backend.experts.modules.proof_completion.judge import JudgeVerdict
from backend.experts.modules.proof_completion.outputs import (
    DerivationStep,
    ProofTrajectory,
)
from backend.experts.modules.proof_completion import reward as R
from backend.experts.modules.proof_completion.reward import reward
from backend.experts.modules.proof_completion.step_grounding import Tier

# reward()'s weights/τ are env-tunable at import time (ALGEBENCH_PC_*). Pin them to
# the documented defaults here and pass ``tau=`` explicitly so these unit tests are
# independent of whatever a developer has exported.
TAU = 0.7


@pytest.fixture(autouse=True)
def _pin_reward_weights(monkeypatch):
    monkeypatch.setattr(R, "W_G", 0.8)
    monkeypatch.setattr(R, "W_J", 0.2)


def _example():
    exs = D.generate(n=1, seed=11, max_steps=2)
    assert exs
    return exs[0]


def _gold_traj(ex):
    traj = ProofTrajectory(steps=ex.gold_steps)
    traj.start_latex = "start"
    traj.target_latex = "target"
    return traj


def test_gold_passes_threshold_without_judge():
    ex = _example()
    r = reward(_gold_traj(ex), start_graph=ex.context.start,
               target_graph=ex.context.target, domain=ex.context.domain, tau=TAU)
    assert r.score >= TAU and r.passed
    assert r.breakdown["wellformed"] == 1.0
    assert r.breakdown["judge"] is None


def test_malformed_caption_zeroes_reward_and_skips_judge():
    ex = _example()
    traj = _gold_traj(ex)
    traj.steps[0].operation = "and $V = 7.8 km/s"  # unbalanced $
    calls = []

    def spy_judge(**kw):
        calls.append(kw)
        return JudgeVerdict(score=1.0, issues="")

    r = reward(traj, start_graph=ex.context.start, target_graph=ex.context.target,
               domain=ex.context.domain, judge=spy_judge, tau=TAU)
    assert r.score == 0.0 and not r.passed
    assert "unbalanced '$'" in r.issues
    assert calls == []  # judge not called once the prerequisite fails


def test_judge_alone_cannot_gate_a_grounded_derivation():
    # grounding ~1.0, judge 0.0 -> 0.8*1 + 0.2*0 = 0.8 >= TAU: judge never rejects
    ex = _example()
    r = reward(_gold_traj(ex), start_graph=ex.context.start,
               target_graph=ex.context.target, domain=ex.context.domain, tau=TAU,
               judge=lambda **kw: JudgeVerdict(score=0.0, issues="too terse"))
    assert r.passed
    assert "too terse" in r.issues  # but its feedback still flows back


class _Pair:
    def __init__(self, tier):
        self.tier = tier


class _FakeReport:
    def __init__(self, endpoint_reached, tiers):
        self.endpoint_reached = endpoint_reached
        self.pairs = [_Pair(t) for t in tiers]


class _FakeGS:
    def __init__(self, score, report):
        self.score = score
        self.reason = "fake"
        self.overall = None
        self.report = report


def _wf_traj():
    t = ProofTrajectory(steps=[DerivationStep(
        operation="op", expr_latex="x = 2", justification="ok", change_type="solve")])
    t.start_latex, t.target_latex = "s", "t"
    return t


def test_below_tau_retries_and_surfaces_endpoint_refuted(monkeypatch):
    # The loop retries while below τ (chasing a cleaner derivation / fixing
    # captions) — there is NO good-enough early-accept. endpoint_reached and
    # no_refuted are still exposed in the breakdown for observability.
    rep = _FakeReport(True, [Tier.BLUE, Tier.GRAY, Tier.GOLD])
    monkeypatch.setattr(R, "grounding_score", lambda *a, **k: _FakeGS(0.5, rep))
    r = reward(_wf_traj(), start_graph=None, target_graph=None, tau=TAU)
    assert r.score < TAU and not r.passed
    assert r.breakdown["endpoint_reached"] is True
    assert r.breakdown["no_refuted"] is True


def test_breakdown_flags_a_refuted_step(monkeypatch):
    rep = _FakeReport(True, [Tier.BLUE, Tier.RED, Tier.GOLD])
    monkeypatch.setattr(R, "grounding_score", lambda *a, **k: _FakeGS(0.5, rep))
    r = reward(_wf_traj(), start_graph=None, target_graph=None, tau=TAU)
    assert r.breakdown["no_refuted"] is False and not r.passed


def test_low_grounding_with_low_judge_fails():
    # a provably wrong step -> grounding floors (refuted); low judge -> below TAU
    from backend.semantic_graph.service import SemanticGraphService
    svc = SemanticGraphService()
    start = svc.latex_to_graph("x^2 = 4")
    target = svc.latex_to_graph("x = 2")
    bad = ProofTrajectory(steps=[
        DerivationStep(operation="wrong", expr_latex="x = 7",
                       justification="introduces a non-solution", change_type="solve"),
    ])
    bad.start_latex, bad.target_latex = "x^2 = 4", "x = 2"
    r = reward(bad, start_graph=start, target_graph=target, tau=TAU,
               judge=lambda **kw: JudgeVerdict(score=0.0, issues="bad"))
    assert not r.passed
