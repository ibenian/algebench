"""Tests for the ProofCompletionExpert metric (no LLM)."""

from __future__ import annotations

import pytest
import sympy as sp

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


def test_pm_states_are_convertible_and_multivalued():
    r"""``±`` is a real operator now, so its states are convertible (issue #369).

    This test previously asserted the OPPOSITE — that ``x = \pm 3`` must NOT
    convert. That was right at the time: ``±`` degraded to an opaque scalar
    symbol, so the state parsed to ``x = 3·±``, which is not math, and gating it
    was the only way to keep the step honestly UNCHECKED. Now the state carries
    a ``plus_minus`` operator and grounds to BOTH sign readings, so gating it
    would suppress a state the CAS can fully verify.
    """
    from backend.experts.modules.proof_completion.metric import _state_graph
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy

    for latex in (r"x = \pm 3", r"x = \mp 2", r"x = \pm\sqrt{9}"):
        g = _state_graph(latex, "algebra")
        assert g is not None, f"{latex} should convert"
        # multivalued: a disjunction over the two sign choices, and crucially no
        # stray ``\pm`` symbol left behind anywhere in it
        grounded = graph_to_sympy(g)
        assert isinstance(grounded, sp.Or), f"{latex} -> {grounded}"
        assert not any(str(s).lstrip("\\") in ("pm", "mp")
                       for s in grounded.free_symbols), grounded

    assert _state_graph(r"x = 3", "algebra") is not None            # control
    assert _state_graph(r"1 + 2 + \dots + n", "algebra") is None    # gate still on
