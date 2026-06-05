"""Tests for the strongly-typed graph-op discriminated union."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.experts.modules.proof_completion.outputs import (
    GRAPH_OP_ADAPTER,
    AddNode,
    GraphTrajectory,
    RemoveEdge,
    RemoveNode,
)
from backend.model.semantic_graph import SemanticGraphNode


def _node(nid="x"):
    return SemanticGraphNode(id=nid, type="scalar")


def test_each_op_has_only_its_own_fields():
    # RemoveNode has no `node` field; extra='forbid' rejects it.
    with pytest.raises(ValidationError):
        RemoveNode(node_id="x", node=_node(), explanation="e", justification="j")


def test_adapter_dispatches_on_discriminator():
    op = GRAPH_OP_ADAPTER.validate_python(
        {"op": "remove_edge", "edge_from": "a", "edge_to": "b",
         "explanation": "e", "justification": "j"}
    )
    assert isinstance(op, RemoveEdge)
    assert op.edge_from == "a" and op.edge_to == "b"


def test_unknown_discriminator_is_rejected():
    with pytest.raises(ValidationError):
        GRAPH_OP_ADAPTER.validate_python(
            {"op": "frobnicate", "explanation": "e", "justification": "j"}
        )


def test_trajectory_roundtrips_mixed_ops():
    traj = GraphTrajectory(
        context_id="semanticGraph",
        ops=[
            AddNode(node=_node("y"), explanation="add y", justification="j"),
            RemoveNode(node_id="x", explanation="drop x", justification="j"),
        ],
    )
    dumped = traj.model_dump(by_alias=True)
    back = GraphTrajectory.model_validate(dumped)
    assert isinstance(back.ops[0], AddNode)
    assert isinstance(back.ops[1], RemoveNode)
    assert back.ops[0].node.id == "y"
