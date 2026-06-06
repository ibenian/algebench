"""Tests for the pure semantic-graph edit engine."""

from __future__ import annotations

import pytest

from backend.semantic_graph.service import SemanticGraphService
from backend.experts.modules.proof_completion.outputs import AddEdge, AddNode, GraphOpError, RemoveNode
from backend.experts.modules.proof_completion.graph_ops import (
    apply,
    canonical_equal,
    diff,
)

SVC = SemanticGraphService()

PAIRS = [
    (r"(x+1)^2", r"x^2 + 2 x + 1"),
    (r"a^2 - b^2", r"(a-b)(a+b)"),
    (r"\frac{d}{dx} x^2", r"2 x"),
    (r"x + x", r"2 x"),
    (r"(x+1)(x+2)", r"x^2 + 3 x + 2"),
]


@pytest.mark.parametrize("start_latex,target_latex", PAIRS)
def test_diff_then_apply_reaches_target(start_latex, target_latex):
    gs, gt = SVC.latex_to_graph(start_latex), SVC.latex_to_graph(target_latex)
    ops = diff(gs, gt)
    result = apply(gs, ops)
    assert canonical_equal(result, gt)


def test_identical_graphs_have_empty_diff():
    g = SVC.latex_to_graph(r"F = m a")
    assert diff(g, g) == []
    assert canonical_equal(g, apply(g, []))


def test_canonical_equal_is_synthetic_id_invariant():
    # Renaming a synthetic (operator) id must not change canonical identity.
    g = SVC.latex_to_graph(r"x^2 + 2 x + 1")
    renamed = g.model_copy(deep=True)
    syn = next(n.id for n in renamed.nodes if n.id.startswith("__"))
    new_id = "OP_RENAMED"
    for n in renamed.nodes:
        if n.id == syn:
            n.id = new_id
    for e in renamed.edges:
        if e.from_ == syn:
            e.from_ = new_id
        if e.to == syn:
            e.to = new_id
    assert canonical_equal(g, renamed)


def test_canonical_equal_distinguishes_variable_names():
    # The variable name (a leaf id) is meaningful: x+y != x+x structurally.
    assert not canonical_equal(SVC.latex_to_graph(r"x + y"), SVC.latex_to_graph(r"x + x"))


def test_apply_raises_on_duplicate_node():
    g = SVC.latex_to_graph(r"x + 1")
    op = AddNode(node=g.nodes[0], explanation="dup", justification="dup")
    with pytest.raises(GraphOpError):
        apply(g, [op])


def test_apply_raises_on_missing_remove():
    g = SVC.latex_to_graph(r"x + 1")
    op = RemoveNode(node_id="does_not_exist", explanation="x", justification="x")
    with pytest.raises(GraphOpError):
        apply(g, [op])


def test_apply_raises_on_dangling_edge():
    from backend.model.semantic_graph import SemanticGraphEdge

    g = SVC.latex_to_graph(r"x + 1")
    edge = SemanticGraphEdge(**{"from": "ghost", "to": g.nodes[0].id})
    op = AddEdge(edge=edge, explanation="x", justification="x")
    with pytest.raises(GraphOpError):
        apply(g, [op])
