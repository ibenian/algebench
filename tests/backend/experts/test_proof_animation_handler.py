"""Tests for the ``proof_animation`` handler's request model and context
formatting — specifically the ``previous_steps`` lead-up threading (issue #382).

No LM: these exercise the pydantic model and the pure formatting helpers only.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

import backend.experts.handlers.proof_animation.handler as H
from backend.experts.handlers.proof_animation.handler import (
    DeriveProofRequest,
    PriorStep,
    _derives_from_previous_step,
    _domain_judge,
    _format_lesson_context,
    _format_prior_steps,
    _PRIOR_STEPS_MAX,
)
from backend.experts.modules.proof_completion.judge import DomainStepJudge


def test_request_accepts_previous_steps():
    req = DeriveProofRequest(
        target_latex="a = c - b",
        previous_steps=[
            {"step": 1, "label": "given", "math": "a + b = c"},
            {"step": 2, "math": "a = c - b"},
        ],
    )
    assert len(req.previous_steps) == 2
    assert isinstance(req.previous_steps[0], PriorStep)
    assert req.previous_steps[0].label == "given"
    assert req.previous_steps[1].label is None


def test_request_defaults_previous_steps_empty():
    req = DeriveProofRequest(target_latex="x = 2")
    assert req.previous_steps == []


def test_microstep_gate_true_when_start_is_previous_step():
    # start == the last previous step → adjacent transition → micro-step ON
    req = DeriveProofRequest(
        target_latex="a = c - b",
        start_latex="a + b = c",
        previous_steps=[PriorStep(step=1, math="a + b = c")],
    )
    assert _derives_from_previous_step(req) is True


def test_microstep_gate_whitespace_insensitive():
    req = DeriveProofRequest(
        target_latex="a = c - b",
        start_latex="a+b = c",
        previous_steps=[PriorStep(step=1, math="a + b  =  c")],
    )
    assert _derives_from_previous_step(req) is True


def test_microstep_gate_false_when_start_is_a_given_not_previous():
    # start supplied but differs from the last step (e.g. a proof given) → OFF
    req = DeriveProofRequest(
        target_latex="a = c - b",
        start_latex="a + b = c",
        previous_steps=[PriorStep(step=1, math="x = y"),
                        PriorStep(step=2, math="p = q")],
    )
    assert _derives_from_previous_step(req) is False


def test_microstep_gate_false_when_no_previous_steps():
    req = DeriveProofRequest(target_latex="a = c - b", start_latex="a + b = c")
    assert _derives_from_previous_step(req) is False


def test_microstep_gate_false_when_start_inferred():
    req = DeriveProofRequest(
        target_latex="a = c - b",
        previous_steps=[PriorStep(step=1, math="a + b = c")],
    )
    assert _derives_from_previous_step(req) is False


def test_request_still_forbids_unknown_fields():
    with pytest.raises(ValidationError):
        DeriveProofRequest(target_latex="x = 2", bogus_field=True)


def test_format_prior_steps_numbers_and_labels():
    out = _format_prior_steps([
        PriorStep(step=1, label="given", math="a + b = c"),
        PriorStep(step=2, math="a = c - b"),
    ])
    assert out.splitlines()[0] == "Prior steps:"
    assert "1. $a + b = c$ (given)" in out
    assert "2. $a = c - b$" in out


def test_format_prior_steps_skips_blank_math():
    out = _format_prior_steps([
        PriorStep(step=1, math="   "),
        PriorStep(step=2, math="a = c - b"),
    ])
    # Only the non-blank step survives.
    assert "a = c - b" in out
    assert out.count("$") == 2


def test_format_prior_steps_empty_is_empty_string():
    assert _format_prior_steps([]) == ""
    assert _format_prior_steps([PriorStep(math="")]) == ""


def test_format_prior_steps_caps_to_last_n():
    steps = [PriorStep(step=i, math=f"x_{{{i}}} = {i}") for i in range(1, _PRIOR_STEPS_MAX + 6)]
    out = _format_prior_steps(steps)
    body = [ln for ln in out.splitlines() if ln != "Prior steps:"]
    assert len(body) == _PRIOR_STEPS_MAX
    # Keeps the most recent steps (the tail), dropping the earliest.
    assert f"x_{{{steps[-1].step}}}" in out
    assert f"x_{{{steps[0].step}}}" not in out


def test_format_lesson_context_unchanged_by_previous_steps():
    # The lesson-context formatter is independent of previous_steps.
    ctx = {"lessonTitle": "Kinematics", "proofGoal": "v = u + at"}
    out = _format_lesson_context(ctx)
    assert "Lesson: Kinematics" in out
    assert "Goal: v = u + at" in out


# --- domain-step judge wiring (issue #385) ---------------------------------- #


def test_domain_judge_none_without_lm(monkeypatch):
    monkeypatch.setattr(H, "is_configured", lambda: False)
    monkeypatch.setattr(H, "RESCUE_ENABLED", True)
    monkeypatch.setattr(H, "_DOMAIN_JUDGE", None)
    assert _domain_judge() is None


def test_domain_judge_built_and_cached_when_configured(monkeypatch):
    monkeypatch.setattr(H, "is_configured", lambda: True)
    monkeypatch.setattr(H, "RESCUE_ENABLED", True)
    monkeypatch.setattr(H, "_DOMAIN_JUDGE", None)
    j1 = _domain_judge()
    j2 = _domain_judge()
    assert isinstance(j1, DomainStepJudge)
    assert j1 is j2                                    # shared singleton


def test_domain_judge_none_when_rescue_disabled(monkeypatch):
    # Master flag off → no judge even with an LM configured (rescue is a no-op).
    monkeypatch.setattr(H, "is_configured", lambda: True)
    monkeypatch.setattr(H, "RESCUE_ENABLED", False)
    monkeypatch.setattr(H, "_DOMAIN_JUDGE", None)
    assert _domain_judge() is None
