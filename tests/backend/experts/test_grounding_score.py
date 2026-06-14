"""Tests for the tier-graded grounding score (issue #372 §B)."""

from __future__ import annotations

from backend.experts.modules.proof_completion import dataset as D
from backend.experts.modules.proof_completion.grounding_score import grounding_score
from backend.experts.modules.proof_completion.outputs import DerivationStep
from backend.semantic_graph.service import SemanticGraphService

_SVC = SemanticGraphService()


def _example():
    exs = D.generate(n=1, seed=11, max_steps=2)
    assert exs
    return exs[0]


def test_gold_trajectory_scores_high():
    ex = _example()
    gs = grounding_score(ex.context.start, ex.gold_steps, ex.context.target,
                         domain=ex.context.domain)
    # a correct, gold derivation lands at the top of the tier scale
    assert gs.score >= 0.75
    assert 0.0 <= gs.score <= 1.0


def test_empty_trajectory_scores_zero():
    ex = _example()
    gs = grounding_score(ex.context.start, [], ex.context.target,
                         domain=ex.context.domain)
    assert gs.score == 0.0


def test_score_is_graded_not_binary():
    # A refuted middle step should pull the mean down without flooring a chain
    # that also has a grounded step — i.e. the score lands strictly between 0 and 1.
    start = _SVC.latex_to_graph("x^2 = 4")
    target = _SVC.latex_to_graph("x = 2")
    # step 1: equivalent rewrite (grounded); step 2: a wrong jump (refuted)
    steps = [
        DerivationStep(operation="rewrite", expr_latex="x^2 = 4",
                       justification="same equation", change_type="rewrite"),
        DerivationStep(operation="wrong", expr_latex="x = 7",
                       justification="not valid", change_type="solve"),
    ]
    gs = grounding_score(start, steps, target)
    assert 0.0 < gs.score < 1.0
