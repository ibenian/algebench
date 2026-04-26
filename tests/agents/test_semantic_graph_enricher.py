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


class _StubResult:
    """Mimics ``pydantic_ai.RunResult`` enough for ``BaseAgent._unwrap``."""

    def __init__(self, output):
        self.output = output


class _StubAgent:
    """Stand-in for ``pydantic_ai.Agent`` that returns canned validated output.

    Each call burns one item off the queue; once exhausted, the last item is
    reused so simple "no retry expected" tests don't have to worry about
    cardinality.
    """

    def __init__(self, model_cls, outputs: list):
        self._model_cls = model_cls
        self._outputs = list(outputs)
        self._idx = 0

    def _next(self):
        idx = min(self._idx, len(self._outputs) - 1)
        self._idx += 1
        raw = self._outputs[idx]
        if isinstance(raw, Exception):
            raise raw
        return self._model_cls.model_validate(raw)

    async def run(self, _prompt):
        return _StubResult(self._next())


def _build_agent_with(
    test_output,
    *,
    critic_outputs: list | None = None,
) -> SemanticGraphEnrichmentAgent:
    """Build an enricher whose enrichment + critic agents return canned output.

    ``test_output`` may be a single dict (one enrichment pass) or a list of
    dicts (multi-pass — first call returns ``test_output[0]``, retry returns
    ``test_output[1]``). ``critic_outputs`` works the same way for the critic;
    pass ``None`` to skip the critic entirely (no critic attached). Items may
    also be ``Exception`` instances to simulate a failure on that call.
    """
    from agents.semantic_graph_enricher import (
        SemanticGraphCoherenceCritic,
        _CoherenceVerdict,
    )

    enrichment_outputs = (
        test_output if isinstance(test_output, list) else [test_output]
    )
    enricher = SemanticGraphEnrichmentAgent.__new__(SemanticGraphEnrichmentAgent)
    enricher._agent = _StubAgent(SemanticGraph, enrichment_outputs)

    if critic_outputs is None:
        enricher._critic = None
    else:
        critic = SemanticGraphCoherenceCritic.__new__(SemanticGraphCoherenceCritic)
        critic._agent = _StubAgent(_CoherenceVerdict, critic_outputs)
        enricher._critic = critic

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


# Coherence-critic regression tests
# ---------------------------------
# Pins the model-driven coherence flow: after the first enrichment, a critic
# audits the result against the lesson context. If the critic flags a cross-
# domain contradiction (e.g. ``voltage`` for ``V`` in an atmospheric-entry
# lesson), the enricher re-runs with the critic's feedback folded into the
# context. No hardcoded keyword lists — the critic is just another model call.


_ATMOSPHERIC_CONTEXT = {
    "lessonTitle": "Atmospheric Entry and Splashdown Physics",
    "sceneTitle": "Trajectory and the Entry Corridor",
    "stepLabel": "Allen-Eggers Velocity Solution",
    "stepMath": "V(h) = V_e \\exp(...)",
    "stepExplanation": (
        "As the capsule descends through the atmosphere, V drops from "
        "the entry velocity. This is the Allen-Eggers velocity solution."
    ),
}

_BAD_VOLTAGE_NODE = {
    "id": "V", "type": "scalar", "label": "V",
    "description": "Voltage, the electric potential difference.",
    "emoji": "⚡", "color": "#0d47a1",
    "quantity": "voltage", "dimension": "M·L²·T⁻³·I⁻¹", "unit": "V",
}

_GOOD_VELOCITY_NODE = {
    "id": "V", "type": "scalar", "label": "V",
    "description": "Velocity of the capsule during atmospheric entry.",
    "emoji": "🚀", "color": "#0d47a1",
    "quantity": "velocity", "dimension": "L·T⁻¹", "unit": "m/s",
}


def test_critic_triggers_retry_with_corrected_output() -> None:
    # First enrichment confidently mislabels V as voltage; critic flags it;
    # second enrichment (reading the feedback + the first pass's inferred
    # domain) returns the right reading.
    enricher = _build_agent_with(
        test_output=[
            # First pass infers the domain even though the input graph
            # doesn't carry one — that domain must flow into the retry.
            {"domain": "classical_mechanics",
             "nodes": [_BAD_VOLTAGE_NODE], "edges": []},
            {"domain": "classical_mechanics",
             "nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        ],
        critic_outputs=[
            {
                "ok": False,
                "mismatched_node_ids": ["V"],
                "feedback": "Lesson is atmospheric entry; V is velocity, not voltage.",
            },
        ],
    )

    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )

    node = out["nodes"][0]
    assert node["quantity"] == "velocity"
    assert node["unit"] == "m/s"
    assert node["emoji"] == "🚀"
    # The first-pass-inferred domain should be preserved on the retry's
    # output too — it's now part of the canonical enriched graph.
    assert out.get("domain") == "classical_mechanics"


def test_critic_accepts_coherent_first_pass() -> None:
    # When the first pass is already correct, the critic returns ok and we
    # ship that result without burning a second enrichment call.
    enricher = _build_agent_with(
        test_output={"nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )

    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )
    assert out["nodes"][0]["quantity"] == "velocity"


def test_critic_skipped_when_no_context() -> None:
    # No lesson context means we have nothing to critique against — skip the
    # critic call entirely and ship the first pass verbatim.
    enricher = _build_agent_with(
        test_output={"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
        critic_outputs=[
            # If the critic ran, this would flag the node — but it shouldn't run.
            {"ok": False, "mismatched_node_ids": ["V"], "feedback": "x"},
        ],
    )
    out = enricher.enrich({"nodes": [{"id": "V", "type": "scalar"}], "edges": []})
    # Voltage survives because there's no context to reject it against.
    assert out["nodes"][0]["quantity"] == "voltage"


def test_circuits_lesson_keeps_voltage() -> None:
    # Same voltage response, different context: critic returns ok and the
    # enrichment passes through unchanged.
    enricher = _build_agent_with(
        test_output={"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context={
            "lessonTitle": "RC Circuits",
            "stepExplanation": "The capacitor charges through the resistor; voltage rises.",
        },
    )
    assert out["nodes"][0]["quantity"] == "voltage"
    assert out["nodes"][0]["unit"] == "V"


def test_critic_failure_falls_back_to_first_pass() -> None:
    # If the critic raises (network blip, bad output, whatever), we don't
    # block the user — fall back to the first-pass enrichment unchanged.
    enricher = _build_agent_with(
        test_output={"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
        critic_outputs=[RuntimeError("simulated critic outage")],
    )
    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )
    # First-pass output passes through unchanged when the critic blows up.
    assert out["nodes"][0]["quantity"] == "voltage"


def test_user_payload_renders_context_as_prose() -> None:
    # The prompt input must surface lesson/scene context as a readable
    # preamble — burying it inside JSON is what let Gemini ignore it.
    from agents.semantic_graph_enricher import _build_payload

    payload = _build_payload(
        {"nodes": [], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )
    assert payload.startswith("## Context")
    assert "Atmospheric Entry and Splashdown Physics" in payload
    assert "Allen-Eggers Velocity Solution" in payload
    assert "## Graph" in payload
    # Graph block still ships as JSON for the model to parse structurally.
    assert "\"nodes\": []" in payload


def test_feedback_renders_in_retry_payload() -> None:
    # When the critic fires, its feedback is folded into the context that
    # gets sent on the retry — visible in the rendered prose preamble.
    from agents.semantic_graph_enricher import _build_payload, _context_with_feedback

    retry_ctx = _context_with_feedback(
        _ATMOSPHERIC_CONTEXT,
        "Lesson is atmospheric entry; V is velocity, not voltage.",
    )
    payload = _build_payload({"nodes": [], "edges": []}, context=retry_ctx)
    assert "Coherence feedback" in payload
    assert "V is velocity, not voltage" in payload


def test_graph_domain_surfaces_in_payload() -> None:
    # ``graph.domain`` (set by the parser, e.g. ``classical_mechanics``) is
    # the strongest signal we have — it must appear at the top of the
    # rendered context preamble, marked as authoritative, in BOTH the
    # enrichment and critic payloads.
    from agents.semantic_graph_enricher import _build_payload, _build_critique_payload

    graph = {"domain": "classical_mechanics", "nodes": [], "edges": []}

    payload = _build_payload(graph, context=_ATMOSPHERIC_CONTEXT)
    domain_line = "- Graph domain (authoritative, from parser): classical_mechanics"
    assert domain_line in payload
    # Domain must appear before the lesson title — it's the strongest signal,
    # and the prompt tells the model to read top-down.
    assert payload.index(domain_line) < payload.index("Atmospheric Entry")

    critique_payload = _build_critique_payload(_ATMOSPHERIC_CONTEXT, graph)
    assert domain_line in critique_payload


def test_graph_domain_surfaces_without_context() -> None:
    # Even with no lesson context, a graph with a parser-asserted domain
    # should still surface that domain — it's all we have to go on.
    from agents.semantic_graph_enricher import _build_payload

    graph = {"domain": "quantum_mechanics", "nodes": [], "edges": []}
    payload = _build_payload(graph, context=None)
    assert "Graph domain (authoritative, from parser): quantum_mechanics" in payload


def test_no_domain_no_authoritative_line() -> None:
    # A graph without a domain field should not emit a fake "Graph domain"
    # line — the model would treat it as authoritative if we did.
    from agents.semantic_graph_enricher import _build_payload

    graph = {"nodes": [], "edges": []}
    payload = _build_payload(graph, context=_ATMOSPHERIC_CONTEXT)
    assert "Graph domain" not in payload


def test_enriched_marker_stamped_on_first_pass_ok() -> None:
    # Every successful enrichment marks the result `enriched: true` so the
    # server and client can short-circuit on second invocations.
    enricher = _build_agent_with(
        test_output={"nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )
    assert out.get("enriched") is True


def test_enriched_marker_stamped_after_retry() -> None:
    # The marker also lands on the retry path — otherwise a critic-driven
    # correction would ship without it and look "unenriched" to callers.
    enricher = _build_agent_with(
        test_output=[
            {"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
            {"nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        ],
        critic_outputs=[
            {"ok": False, "mismatched_node_ids": ["V"], "feedback": "V is velocity."},
        ],
    )
    out = enricher.enrich(
        {"nodes": [{"id": "V", "type": "scalar"}], "edges": []},
        context=_ATMOSPHERIC_CONTEXT,
    )
    assert out.get("enriched") is True
    assert out["nodes"][0]["quantity"] == "velocity"


def test_already_enriched_input_is_passthrough() -> None:
    # An input graph already marked enriched skips both Gemini calls.
    # The stub would raise StopIteration if either call ran (no canned
    # outputs given) — passing this test proves nothing was called.
    from agents.semantic_graph_enricher import SemanticGraphEnrichmentAgent

    pre = {
        "enriched": True,
        "nodes": [{"id": "V", "type": "scalar", "quantity": "velocity"}],
        "edges": [],
    }
    enricher = SemanticGraphEnrichmentAgent.__new__(SemanticGraphEnrichmentAgent)

    class _ExplodingAgent:
        async def run(self, _prompt):
            raise AssertionError("enrichment must not run on a marked graph")

    enricher._agent = _ExplodingAgent()
    enricher._critic = None

    out = enricher.enrich(pre, context=_ATMOSPHERIC_CONTEXT)
    assert out is pre  # unchanged, same object
    assert out["enriched"] is True


def test_override_domain_surfaces_in_payload() -> None:
    # When the first pass infers a domain that the input graph didn't
    # carry, the retry must still see that domain as authoritative —
    # otherwise the retry would re-infer from prose alone and might land
    # on the same wrong answer the critic just rejected.
    from agents.semantic_graph_enricher import _build_payload

    graph = {"nodes": [], "edges": []}  # no domain on input
    payload = _build_payload(
        graph, context=_ATMOSPHERIC_CONTEXT,
        override_domain="classical_mechanics",
    )
    assert "Graph domain (authoritative, from parser): classical_mechanics" in payload
