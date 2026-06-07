"""Tests for the strongly-typed graph-op discriminated union."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.experts.modules.proof_completion.outputs import (
    GRAPH_OP_ADAPTER,
    AddNode,
    DerivationStep,
    ProofTrajectory,
    RemoveEdge,
    RemoveNode,
)
from backend.model.semantic_graph import SemanticGraphNode


def _step(_i=1, expr="x^2 = 4"):   # _i: positional index kept for call sites, unused now
    return DerivationStep(operation="rewrite", expr_latex=expr, justification="valid")


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


def test_trajectory_roundtrips_steps():
    traj = ProofTrajectory(
        steps=[_step(1, "x^2 - 4 = 0"), _step(2, "x^2 = 4")],
    )
    dumped = traj.model_dump(by_alias=True)
    back = ProofTrajectory.model_validate(dumped)
    assert [s.expr_latex for s in back.steps] == ["x^2 - 4 = 0", "x^2 = 4"]


def test_expert_result_preserves_subclass_fields_on_dump():
    # ExpertResult.outputs is list[SerializeAsAny[Output]] — dumping must keep
    # the concrete subclass fields (e.g. ProofTrajectory.steps), not just the base.
    from backend.experts.outputs import ExpertResult

    traj = ProofTrajectory(steps=[_step(1, "x = 2")])
    result = ExpertResult(expert="proof_completion", context_id="semanticGraph",
                          outputs=[traj])
    d = result.model_dump(by_alias=True)
    assert d["outputs"][0]["kind"] == "proof_trajectory"
    assert len(d["outputs"][0]["steps"]) == 1          # subclass field survived
    assert d["outputs"][0]["steps"][0]["expr_latex"] == "x = 2"
    # single() returns the one output for single-output experts
    assert result.single() is traj
    import pytest
    with pytest.raises(ValueError):
        ExpertResult(expert="e", context_id="c", outputs=[traj, traj]).single()
