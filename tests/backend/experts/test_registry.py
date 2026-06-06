"""Tests for framework discovery via decorator self-registration (no LLM)."""

from __future__ import annotations

import pytest

from backend.experts import discover
from backend.experts.context_id import build, parse
from backend.experts.registry import (
    EXPERT_REGISTRY,
    METRIC_REGISTRY,
    resolve_context_model,
)


@pytest.fixture(scope="module", autouse=True)
def _discovered():
    discover()  # imports self-registering modules; no LM configuration


def test_proof_completion_is_registered():
    assert "proof_completion" in EXPERT_REGISTRY
    spec = EXPERT_REGISTRY["proof_completion"]
    assert spec.context_scope == "semanticGraph"
    assert spec.context_model is not None
    assert "proof_completion" in METRIC_REGISTRY


def test_registries_are_internally_consistent():
    # every registered expert resolves a context model and has a metric
    # (no central config needed — decorators are the source of truth)
    for name, spec in EXPERT_REGISTRY.items():
        assert resolve_context_model(spec) is not None
        assert name in METRIC_REGISTRY, f"{name} has no metric"


def test_resolve_context_model_uses_override():
    from backend.experts.modules.proof_completion.model import GraphTransition

    spec = EXPERT_REGISTRY["proof_completion"]
    assert resolve_context_model(spec) is GraphTransition


def test_context_id_roundtrip():
    cid = build(scene="sc1", proof="p1", proof_step="ps2", semantic_graph=True)
    p = parse(cid)
    assert p.terminal == "semanticGraph"
    assert p.id_for("scene") == "sc1"
    assert p.id_for("proofStep") == "ps2"
    assert parse("root").terminal == "root"


def test_context_id_rejects_unknown_segment():
    with pytest.raises(ValueError):
        parse("bogus-1")
