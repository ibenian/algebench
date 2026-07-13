"""Tests for the ``proof_animation`` handler's request model and context
formatting — specifically the ``previous_steps`` lead-up threading (issue #382).

No LM: these exercise the pydantic model and the pure formatting helpers only.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

import backend.experts.handlers.proof_animation.handler as H
import types

import backend.experts.handlers.proof_animation.prompt_endpoints as PE
from backend.experts.handlers.proof_animation.handler import (
    DeriveProofRequest,
    Given,
    PriorStep,
    _derives_from_previous_step,
    _domain_judge,
    _format_lesson_context,
    _format_prior_steps,
    _givens_clause,
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


def test_givens_clause_strips_math_delimiters():
    # The goal/givens are folded into the start-INFERENCE prompt; $…$/$$…$$
    # delimiters here nudge the LM to echo them in start_latex (which then
    # fails to parse). They must be stripped before reaching the prompt.
    req = DeriveProofRequest(
        target_latex=r"a_{\text{max}} = \frac{V_E^2 \sin \gamma}{2e H}",
        goal=r"$$a_{\text{max}} = \frac{V_E^2 \sin \gamma}{2e H}$$",
        givens=[Given(math=r"$F_{\text{net}} = m a$", label="Newton")],
    )
    clause = _givens_clause(req)
    assert "$" not in clause
    assert r"a_{\text{max}}" in clause
    assert r"F_{\text{net}} = m a" in clause


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


# --------------------------------------------------------------------------- #
# start_given_target — infer ONLY the start from the KNOWN target (#396)
# --------------------------------------------------------------------------- #

def test_start_given_target_strips_delimiters_and_maps_fields(monkeypatch):
    # the LM wraps math in $…$; start_given_target must strip them so the start parses
    ns = types.SimpleNamespace(
        start_latex="$x^2 = 4$", domain=" algebra ", title=" Solve ",
        given_label=" Given the quadratic ", start_note=" solve for $x$ ")
    # predictors are built lazily via _predictor(sig); stub it to skip the LM
    monkeypatch.setattr(PE, "_predictor", lambda sig: (lambda **kw: ns))
    start, domain, title, given_label, start_note = PE.start_given_target("x = 2", context="")
    assert start == "x^2 = 4"           # delimiters stripped → parseable
    assert (domain, title, given_label, start_note) == (
        "algebra", "Solve", "Given the quadratic", "solve for $x$")


def test_start_given_target_does_not_infer_a_target(monkeypatch):
    # the signature has no target OUTPUT — we never invent a target to discard
    assert "target_latex" not in PE.StartGivenTargetSig.output_fields
    assert "target_latex" in PE.StartGivenTargetSig.input_fields
    assert set(PE.StartGivenTargetSig.output_fields) == {
        "start_latex", "domain", "title", "given_label", "start_note"}


# ── proof_from_prompt handler (prompt → endpoints → derive) ──────────────────
def test_proof_from_prompt_registered():
    from backend.experts.registry import HANDLER_REGISTRY
    assert "proof_from_prompt" in HANDLER_REGISTRY
    assert HANDLER_REGISTRY["proof_from_prompt"].request_model is H.PromptDeriveRequest


def test_proof_from_prompt_wires_endpoints_and_derive(monkeypatch):
    monkeypatch.setattr(H, "endpoints_from_prompt",
                        lambda p: ("a^2 - b^2", "(a-b)(a+b)", "algebra", "Diff of squares", "g", "n"))
    captured = {}
    monkeypatch.setattr(H, "derive_proof_animation",
                        lambda req: captured.update(req=req) or {"title": "Diff of squares",
                                                                 "steps": [{"index": 0, "latex": "x"}]})
    out = H.derive_proof_from_prompt(H.PromptDeriveRequest(prompt="factor a^2 - b^2"))
    assert out["title"] == "Diff of squares"
    req = captured["req"]
    assert req.target_latex == "(a-b)(a+b)"
    assert req.start_latex == "a^2 - b^2"
    assert req.domain == "algebra"
    assert req.title == "Diff of squares"
    assert req.intent == "Derive (a-b)(a+b)"


def test_proof_from_prompt_domain_hint_wins(monkeypatch):
    monkeypatch.setattr(H, "endpoints_from_prompt", lambda p: ("x=1", "y=2", "algebra", "T", "", ""))
    captured = {}
    monkeypatch.setattr(H, "derive_proof_animation", lambda req: captured.update(req=req) or {})
    H.derive_proof_from_prompt(H.PromptDeriveRequest(prompt="q", domain="calculus"))
    assert captured["req"].domain == "calculus"   # explicit hint overrides the LM domain


def test_proof_from_prompt_empty_target_errors(monkeypatch):
    monkeypatch.setattr(H, "endpoints_from_prompt", lambda p: ("", "  ", "", "", "", ""))
    out = H.derive_proof_from_prompt(H.PromptDeriveRequest(prompt="???"))
    assert "error" in out and "derive" in out["error"].lower()


def test_prompt_derive_request_validation():
    with pytest.raises(ValidationError):
        H.PromptDeriveRequest(prompt="")            # min_length=1
    with pytest.raises(ValidationError):
        H.PromptDeriveRequest(prompt="x", bogus=1)  # extra="forbid"
