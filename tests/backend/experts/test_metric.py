"""Tests for the ProofCompletionExpert metric (no LLM)."""

from __future__ import annotations

import pytest

from backend.experts.modules.proof_completion.outputs import ProofTrajectory
from backend.experts.modules.proof_completion import dataset as D
from backend.experts.modules.proof_completion.metric import (
    proof_completion_metric,
    score_components,
)


def _example():
    exs = D.generate(n=1, seed=11, max_steps=1)
    assert exs
    return exs[0]


def test_gold_trajectory_scores_perfect():
    ex = _example()
    pred = ProofTrajectory(steps=ex.gold_steps)
    c = score_components(ex, pred)
    assert c["exact"] == 1.0
    assert c["coverage"] == 1.0
    assert proof_completion_metric(ex, pred) == pytest.approx(1.0)


def test_empty_prediction_scores_low():
    ex = _example()
    pred = ProofTrajectory(steps=[])
    c = score_components(ex, pred)
    assert c["exact"] == 0.0
    assert proof_completion_metric(ex, pred) < 0.5


def test_metric_accepts_list_and_prediction_shapes():
    ex = _example()
    traj = ProofTrajectory(steps=ex.gold_steps)
    # bare object, list, and a Prediction-like object all extract the ops
    assert proof_completion_metric(ex, traj) == pytest.approx(1.0)
    assert proof_completion_metric(ex, [traj]) == pytest.approx(1.0)

    class _Pred:
        outputs = [traj]

    assert proof_completion_metric(ex, _Pred()) == pytest.approx(1.0)


def test_bootstrap_mode_returns_pass_fail():
    ex = _example()
    good = ProofTrajectory(steps=ex.gold_steps)
    bad = ProofTrajectory(steps=[])
    # trace set => hard 1.0/0.0
    assert proof_completion_metric(ex, good, trace=[]) == 1.0
    assert proof_completion_metric(ex, bad, trace=[]) == 0.0


def test_pm_pseudo_symbol_is_not_convertible():
    # "x = \pm 3" parses to a graph where ± is an opaque scalar symbol
    # ("x = 3·±") — not real math. It must not count as a convertible state.
    from backend.experts.modules.proof_completion.metric import _state_graph

    assert _state_graph(r"x = \pm 3", "algebra") is None
    assert _state_graph(r"x = \mp 2", "algebra") is None
    assert _state_graph(r"x = \pm\sqrt{9}", "algebra") is None
    assert _state_graph(r"x = 3", "algebra") is not None   # control
