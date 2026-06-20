"""Tests for ``DomainStepJudge`` (the wrapper) and the animation integration
seam that routes CAS-uncheckable steps through it (issue #385).

The wrapper tests stub the inner ``dspy.Predict`` so no LM is needed; the
integration tests drive ``_attach_confidence`` with a stub judge and a state
chain containing an unconvertible (GRAY) step.
"""

from __future__ import annotations

import sympy as sp

from backend.experts.modules.proof_completion.judge import (
    DomainStepJudge,
    DomainVerdict,
)
from backend.experts.handlers.proof_animation.animation import _attach_confidence


# --------------------------------------------------------------------------- #
# DomainStepJudge wrapper
# --------------------------------------------------------------------------- #


class _FakePred:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _judge_with(monkeypatch, **fields):
    judge = DomainStepJudge()
    monkeypatch.setattr(judge, "decide", lambda **_kw: _FakePred(**fields))
    return judge


def _call(judge):
    return judge(domain="hydrostatics", context="ctx",
                 previous_step="\\sum F = 0", current_step="F_1 + F_2 = 0",
                 operation="expand the sum", justification="free-body diagram",
                 cas_status="uncheckable")


def test_wrapper_returns_clamped_verdict(monkeypatch):
    judge = _judge_with(monkeypatch, follows=True, confidence=0.85,
                        rationale="  force balance  ")
    v = _call(judge)
    assert isinstance(v, DomainVerdict)
    assert v.follows is True
    assert v.confidence == 0.85
    assert v.rationale == "force balance"            # stripped


def test_wrapper_clamps_out_of_range_confidence(monkeypatch):
    assert _call(_judge_with(monkeypatch, follows=True, confidence=5.0)).confidence == 1.0
    assert _call(_judge_with(monkeypatch, follows=True, confidence=-2.0)).confidence == 0.0


def test_wrapper_non_numeric_confidence_is_zero(monkeypatch):
    v = _call(_judge_with(monkeypatch, follows=True, confidence="nope"))
    assert v.confidence == 0.0


def test_wrapper_coerces_truthy_follows(monkeypatch):
    assert _call(_judge_with(monkeypatch, follows=1, confidence=0.7)).follows is True
    assert _call(_judge_with(monkeypatch, follows=0, confidence=0.7)).follows is False


def test_wrapper_exception_is_non_rescuing(monkeypatch):
    judge = DomainStepJudge()

    def boom(**_kw):
        raise RuntimeError("no LM")

    monkeypatch.setattr(judge, "decide", boom)
    v = _call(judge)
    assert v.follows is False                          # never rescues on failure
    assert v.confidence == 0.0
    assert "unavailable" in v.rationale


def test_wrapper_missing_fields_default_safe(monkeypatch):
    v = _call(_judge_with(monkeypatch))                # no follows/confidence/rationale
    assert v.follows is False
    assert v.confidence == 0.0
    assert v.rationale == ""


# --------------------------------------------------------------------------- #
# animation integration seam (_attach_confidence)
# --------------------------------------------------------------------------- #


class _Step:
    def __init__(self, change_type):
        self.change_type = change_type


class _Traj:
    def __init__(self, steps, start_latex="x", target_latex=None):
        self.steps = steps
        self.start_latex = start_latex
        self.target_latex = target_latex


def _out(n):
    return [{"index": i, "operation": f"op{i}", "justification": f"why{i}",
             "input_latex": f"L{i}", "latex": f"L{i}", "plain": f"L{i}"}
            for i in range(n)]


class _StubJudge:
    def __init__(self, verdict):
        self.verdict = verdict
        self.calls = 0

    def __call__(self, **_kw):
        self.calls += 1
        return self.verdict


def test_attach_confidence_rescues_uncheckable_step():
    # state 1 is None → GRAY transition the judge can rescue.
    state_exprs = [sp.Symbol("x"), None]
    traj = _Traj([_Step("substitute")])
    out = _out(2)
    judge = _StubJudge(DomainVerdict(True, 0.9, "named-force expansion"))

    overall = _attach_confidence(out, state_exprs, traj, svc=None, domain="hydrostatics",
                                 judge=judge, lesson_context="lesson ctx")

    assert judge.calls == 1
    conf = out[1]["confidence"]
    assert conf["tier"] == "domain"
    assert conf["label"] == "Domain"
    assert conf["icon"]
    assert "domain knowledge" in conf["meaning"]
    assert "named-force expansion" in conf["reason"]
    assert overall["tier"] == "domain"
    assert overall["counts"]["domain"] == 1


def test_attach_confidence_without_judge_stays_cas_only():
    state_exprs = [sp.Symbol("x"), None]
    traj = _Traj([_Step("substitute")])
    out = _out(2)
    overall = _attach_confidence(out, state_exprs, traj, svc=None, domain="algebra")
    assert out[1]["confidence"]["tier"] == "unchecked"   # GRAY, not rescued
    assert overall["tier"] == "unchecked"


def test_attach_confidence_judge_failure_degrades_to_cas():
    # A judge that RAISES must not break the build — the CAS report survives.
    state_exprs = [sp.Symbol("x"), None]
    traj = _Traj([_Step("substitute")])
    out = _out(2)

    class _Boom:
        def __call__(self, **_kw):
            raise RuntimeError("kaboom")

    overall = _attach_confidence(out, state_exprs, traj, svc=None, domain="algebra",
                                 judge=_Boom(), lesson_context="")
    assert out[1]["confidence"]["tier"] == "unchecked"
    assert overall["tier"] == "unchecked"


def test_attach_confidence_does_not_judge_grounded_steps():
    # An all-convertible, equivalent chain has no GRAY/BLUE steps → judge unused.
    x = sp.Symbol("x")
    state_exprs = [(x + 1) ** 2, x ** 2 + 2 * x + 1]
    traj = _Traj([_Step("rewrite")])
    judge = _StubJudge(DomainVerdict(True, 1.0, "should not be called"))
    _attach_confidence(_out(2), state_exprs, traj, svc=None, domain="algebra",
                       judge=judge, lesson_context="")
    assert judge.calls == 0
