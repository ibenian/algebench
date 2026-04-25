"""Tests for SemanticGraphEnrichmentAgent.

Use Pydantic-AI's TestModel to feed deterministic enriched output and assert:
- ids and edges are preserved
- description / emoji / color are populated
- prompt-injection-style payloads (HTML brackets, non-hex colors, oversize
  labels) are rejected by Pydantic validation rather than reaching the caller.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from models import SemanticGraph
from agents.semantic_graph_enricher import SemanticGraphEnrichmentAgent


_INPUT_GRAPH = {
    "domain": "thermodynamics",
    "nodes": [
        {"id": "P", "type": "scalar", "label": "P"},
        {"id": "V", "type": "scalar", "label": "V"},
        {"id": "T", "type": "scalar", "label": "T"},
        {"id": "__multiply_1", "type": "operator", "op": "multiply"},
        {"id": "__equals_1", "type": "relation", "op": "equals"},
    ],
    "edges": [
        {"from": "P", "to": "__multiply_1"},
        {"from": "V", "to": "__multiply_1"},
        {"from": "__multiply_1", "to": "__equals_1"},
        {"from": "T", "to": "__equals_1"},
    ],
}


def _build_agent_with(test_output: dict) -> SemanticGraphEnrichmentAgent:
    from pydantic_ai import Agent
    from pydantic_ai.models.test import TestModel

    test_model = TestModel(custom_output_args=test_output)
    real_agent = Agent(
        test_model,
        output_type=SemanticGraph,
        system_prompt="enrich",
        retries=2,
    )
    enricher = SemanticGraphEnrichmentAgent.__new__(SemanticGraphEnrichmentAgent)
    enricher._agent = real_agent
    return enricher


def test_enrichment_preserves_ids_and_edges() -> None:
    enriched_payload = {
        "domain": "thermodynamics",
        "nodes": [
            {"id": "P", "type": "scalar", "label": "P", "description": "pressure",
             "emoji": "💨", "color": "#0d47a1", "quantity": "pressure",
             "dimension": "M·L⁻¹·T⁻²", "unit": "Pa"},
            {"id": "V", "type": "scalar", "label": "V", "description": "volume",
             "emoji": "🧊", "color": "#1b5e20", "quantity": "volume",
             "dimension": "L³", "unit": "m³"},
            {"id": "T", "type": "scalar", "label": "T", "description": "temperature",
             "emoji": "🌡", "color": "#b71c1c", "quantity": "temperature",
             "dimension": "Θ", "unit": "K"},
            {"id": "__multiply_1", "type": "operator", "op": "multiply"},
            {"id": "__equals_1", "type": "relation", "op": "equals"},
        ],
        "edges": [
            {"from": "P", "to": "__multiply_1"},
            {"from": "V", "to": "__multiply_1"},
            {"from": "__multiply_1", "to": "__equals_1"},
            {"from": "T", "to": "__equals_1"},
        ],
    }
    enricher = _build_agent_with(enriched_payload)

    out = enricher.enrich(_INPUT_GRAPH)

    in_ids = {n["id"] for n in _INPUT_GRAPH["nodes"]}
    out_ids = {n["id"] for n in out["nodes"]}
    assert in_ids == out_ids

    assert out["edges"] == _INPUT_GRAPH["edges"]

    by_id = {n["id"]: n for n in out["nodes"]}
    for symbol in ("P", "V", "T"):
        assert by_id[symbol].get("description")
        assert by_id[symbol].get("emoji")
        assert by_id[symbol].get("color", "").startswith("#")


@pytest.mark.parametrize(
    "node_overrides",
    [
        {"description": "<script>alert(1)</script>"},
        {"color": "javascript:alert(1)"},
        {"label": "x" * 200},
        {"color": "expression(alert(1))"},
    ],
)
def test_prompt_injection_rejected_by_schema(node_overrides) -> None:
    bad_node = {"id": "P", "type": "scalar", "label": "P", **node_overrides}
    payload = {
        "nodes": [bad_node],
        "edges": [],
    }
    with pytest.raises(ValidationError):
        SemanticGraph.model_validate(payload)


def test_unknown_role_rejected() -> None:
    payload = {
        "nodes": [{"id": "x", "type": "scalar", "role": "invented_role"}],
        "edges": [],
    }
    with pytest.raises(ValidationError):
        SemanticGraph.model_validate(payload)
