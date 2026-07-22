"""Tests for ProofCompletionExpert.forward single-pass behavior (issue #445).

The ``refine_attempts <= 1`` path is used by optimize.py/evaluate.py to measure
the raw predictor. It short-circuits the refine loop, so a parse/validation
failure there must degrade gracefully rather than escape as a fatal RuntimeError.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from backend.experts.modules.proof_completion.module import ProofCompletionExpert
from backend.experts.modules.proof_completion.model import GraphTransition
from backend.experts.modules.proof_completion.outputs import (
    EXPR_TOO_LONG_ERROR, DerivationStep, ProofTrajectory,
)
from backend.model.semantic_graph import SemanticGraph


def _ctx() -> GraphTransition:
    return GraphTransition(start=SemanticGraph(nodes=[], edges=[]),
                           target=SemanticGraph(nodes=[], edges=[]))


def _expert() -> ProofCompletionExpert:
    # baseline (no artifact/LM load) + single pass — the raw-predictor path.
    return ProofCompletionExpert(load_default=False, refine_attempts=1)


def test_single_pass_degrades_gracefully_on_validation_error():
    expert = _expert()

    def boom(**_kw):
        # emulate DSPy surfacing an over-long-expr ValidationError from parsing.
        DerivationStep(operation="o", expr_latex="x" * 700, justification="j",
                       change_type="rewrite")

    expert.predict = boom  # type: ignore[assignment]

    out = expert.forward(context=_ctx(), context_id="semanticGraph")
    assert len(out) == 1
    traj = out[0]
    assert isinstance(traj, ProofTrajectory)
    assert traj.steps == []          # empty, honest "unusable prediction"
    # ...but it CARRIES the reason so a caller isn't left guessing (#445 follow-up).
    # The user-facing text is human-friendly — NOT the model-directed retry feedback.
    assert traj.error == EXPR_TOO_LONG_ERROR
    assert "model" not in traj.error                   # no internal model-speak leaks
    # no exception escaped — the eval batch survives


def test_single_pass_generic_error_for_non_length_failure():
    expert = _expert()

    def boom(**_kw):
        raise RuntimeError("model returned garbage")

    expert.predict = boom  # type: ignore[assignment]

    out = expert.forward(context=_ctx(), context_id="semanticGraph")
    traj = out[0]
    assert traj.steps == []
    assert traj.error and traj.error.startswith(
        "proof generation failed to produce a valid derivation:")
    assert "model returned garbage" in traj.error


def test_single_pass_returns_trajectory_on_success():
    expert = _expert()
    good = ProofTrajectory(steps=[DerivationStep(
        operation="add 4", expr_latex="x^2 = 4", justification="j",
        change_type="rewrite")])
    pred = SimpleNamespace(trajectory=good, title="T", goal="g",
                           followups=[], prerequisites=[])

    expert.predict = lambda **_kw: pred  # type: ignore[assignment]

    out = expert.forward(context=_ctx(), context_id="semanticGraph")
    assert out == [good]
    assert [s.expr_latex for s in out[0].steps] == ["x^2 = 4"]
