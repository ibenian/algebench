"""Tests for the hand-rolled refinement engine (issue #372 §C, B2)."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from backend.experts.modules.proof_completion.outputs import DerivationStep
from backend.experts.modules.proof_completion.refine import (
    FEEDBACK_PREAMBLE,
    _EXPR_TOO_LONG_FEEDBACK,
    _PARSE_FAILURE_FEEDBACK,
    refine,
)
from pydantic import ValidationError


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


def _overlong_expr_error(expr: str = "x" * 700) -> ValidationError:
    """The real ValidationError an over-long expr_latex step raises (#445)."""
    try:
        DerivationStep(operation="o", expr_latex=expr, justification="j",
                       change_type="rewrite")
    except ValidationError as exc:
        return exc
    raise AssertionError("expected ValidationError")


def test_overlong_expr_latex_gets_specific_feedback_not_generic():
    # #445: an over-long expr_latex used to abort the whole trajectory. It is now a
    # recoverable retry carrying the specific "substitute + split" nudge, not the
    # generic "could not be parsed" text.
    seen = []
    outcomes = iter([_overlong_expr_error(), "good"])

    def attempt(k, feedback):
        seen.append(feedback)
        nxt = next(outcomes)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    out = refine(attempt, lambda p: _Res(1.0, True), max_attempts=3)
    assert out.prediction == "good" and out.passed        # recovered, no crash
    assert seen[0] == ""
    assert seen[1] == _EXPR_TOO_LONG_FEEDBACK              # specific, not generic
    assert "substitution" in seen[1] and "atomic" in seen[1]


def test_overlong_expr_latex_retry_is_logged_with_the_expression(caplog):
    # The retry must be VISIBLE in the logs — including the offending expression —
    # so an operator can see what the model emitted and that it's being retried.
    long_expr = r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}" + " + 0" * 200
    outcomes = iter([_overlong_expr_error(long_expr), "good"])

    def attempt(k, feedback):
        nxt = next(outcomes)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    with caplog.at_level("WARNING"):
        refine(attempt, lambda p: _Res(1.0, True), max_attempts=3)
    msg = "\n".join(r.getMessage() for r in caplog.records)
    assert "retrying" in msg                               # the retry is announced
    assert "expr_latex too long" in msg
    assert "frac{-b" in msg and "sqrt{b^2 - 4ac}" in msg   # the actual expression (repr-escaped)


def test_parse_failure_retries_then_succeeds():
    # first attempt is unparseable (raises); the retry produces a passing result,
    # so refine exits cleanly on attempt 1 — no reliance on the iterator running
    # out to stop the loop.
    seen = []
    outcomes = iter([RuntimeError("unparseable"), "good"])

    def attempt(k, feedback):
        seen.append(feedback)
        nxt = next(outcomes)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    out = refine(attempt, lambda p: _Res(1.0, True), max_attempts=3)
    assert out.prediction == "good" and out.passed     # recovered — no raise
    assert out.attempts == 1                            # one SUCCESSFUL attempt
    assert seen == ["", _PARSE_FAILURE_FEEDBACK]        # exactly two asks; clean exit


def test_time_budget_with_no_usable_attempt_raises():
    import time as _t

    # the first attempt both raises AND overruns the budget → no usable result,
    # so the loop must surface the real error, not return a None-prediction outcome.
    def attempt(k, fb):
        _t.sleep(0.02)
        raise RuntimeError("unparseable")

    with pytest.raises(RuntimeError, match="unparseable"):
        refine(attempt, lambda p: _Res(1.0, True), max_attempts=5, time_budget_s=0.01)


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
