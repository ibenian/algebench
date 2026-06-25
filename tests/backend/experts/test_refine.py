"""Tests for the hand-rolled refinement engine (issue #372 §C, B2)."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from backend.experts.modules.proof_completion.refine import (
    FEEDBACK_PREAMBLE,
    _PARSE_FAILURE_FEEDBACK,
    refine,
)


@dataclass
class _Res:
    score: float
    passed: bool
    issues: str = ""


def test_early_exit_on_first_pass():
    calls = []

    def attempt(k, feedback):
        calls.append((k, feedback))
        return "pred"

    out = refine(attempt, lambda p: _Res(1.0, True), max_attempts=3)
    assert out.passed and out.attempts == 1
    assert calls == [(0, "")]  # stopped immediately, no retry


def test_feedback_is_threaded_into_retry():
    seen = []

    def attempt(k, feedback):
        seen.append(feedback)
        return f"pred{k}"

    # first two attempts fail, third passes
    scores = iter([_Res(0.1, False, "fix the dollar"),
                   _Res(0.4, False, "still off"),
                   _Res(0.9, True)])
    out = refine(attempt, lambda p: next(scores), max_attempts=3)
    assert out.passed and out.attempts == 3
    assert seen[0] == ""                                  # first ask: no feedback
    assert seen[1].startswith(FEEDBACK_PREAMBLE)
    assert "fix the dollar" in seen[1]                    # prior issues delivered
    assert "still off" in seen[2]


def test_keeps_best_after_exhausting_attempts():
    preds = iter(["a", "b", "c"])
    scores = iter([_Res(0.3, False), _Res(0.6, False), _Res(0.2, False)])
    out = refine(lambda k, fb: next(preds), lambda p: next(scores), max_attempts=3)
    assert not out.passed
    assert out.prediction == "b"          # highest score, even though last
    assert out.result.score == 0.6
    assert out.attempts == 3


def test_raises_only_when_every_attempt_fails():
    # an unparseable response is retried; the error surfaces only if NO attempt
    # ever produces a usable result (and it's the real exception, not swallowed).
    calls = []

    def attempt(k, feedback):
        calls.append((k, feedback))
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        refine(attempt, lambda p: _Res(1.0, True), max_attempts=3)
    assert len(calls) == 3                              # retried, didn't bail on attempt 0
    assert calls[1][1] == _PARSE_FAILURE_FEEDBACK       # retry carried parse-failure feedback


def test_parse_failure_retries_then_succeeds():
    # first attempt is unparseable (raises); the retry produces a usable result
    seen = []
    outcomes = iter([RuntimeError("unparseable"), "good"])

    def attempt(k, feedback):
        seen.append(feedback)
        nxt = next(outcomes)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    out = refine(attempt, lambda p: _Res(0.5, False), max_attempts=3)
    assert out.prediction == "good"                    # recovered — no raise
    assert out.attempts == 1                           # one SUCCESSFUL attempt
    assert seen[0] == ""                               # first ask: no feedback
    assert seen[1] == _PARSE_FAILURE_FEEDBACK          # retry told it the parse failed


def test_later_exception_falls_back_to_best():
    preds = iter(["good", "boom"])

    def attempt(k, feedback):
        return next(preds)

    def evaluate(p):
        if p == "boom":
            raise RuntimeError("scoring failed")
        return _Res(0.5, False)

    out = refine(attempt, evaluate, max_attempts=3)
    assert out.prediction == "good" and out.attempts == 1


def test_single_attempt_is_a_no_op_loop():
    out = refine(lambda k, fb: "only", lambda p: _Res(0.2, False), max_attempts=1)
    assert out.attempts == 1 and not out.passed and out.prediction == "only"


def test_time_budget_skips_retry():
    import time as _t
    seen = []

    def attempt(k, fb):
        seen.append(k)
        return f"p{k}"

    def evaluate(p):
        _t.sleep(0.02)            # push elapsed past the tiny budget
        return _Res(0.1, False)   # below threshold → would retry if time allowed

    out = refine(attempt, evaluate, max_attempts=5, time_budget_s=0.01)
    assert seen == [0]            # first attempt runs; no retry started
    assert out.attempts == 1
    assert out.out_of_time is True
    assert out.prediction == "p0"   # best-so-far returned
