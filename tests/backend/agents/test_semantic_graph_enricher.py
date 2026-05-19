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

from backend.model import SemanticGraph
from backend.agents.semantic_graph_enricher import SemanticGraphEnrichmentAgent


def _g(payload: dict) -> SemanticGraph:
    """Test helper — wrap a wire-format dict into a ``SemanticGraph``.

    The agent's public surface is now strictly typed (issue #195), so
    fixtures that read naturally as dict literals get explicitly validated
    before being passed in. Mirrors what the FastAPI handler does at the
    HTTP boundary in production.
    """
    return SemanticGraph.model_validate(payload)


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
    from backend.agents.semantic_graph_enricher import (
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

    out = enricher.enrich(_g(_INPUT_GRAPH))

    in_ids = {n["id"] for n in _INPUT_GRAPH["nodes"]}
    out_ids = {n.id for n in out.nodes}
    assert in_ids == out_ids

    # Edges round-trip through the wire format for deep-equality
    # comparison with the dict fixture (the model itself doesn't compare
    # equal to a list of dicts).
    out_edges = [e.model_dump(by_alias=True, exclude_none=True) for e in out.edges]
    assert out_edges == _INPUT_GRAPH["edges"]

    by_id = {n.id: n for n in out.nodes}
    for symbol in ("P", "V", "T"):
        assert by_id[symbol].description
        assert by_id[symbol].emoji
    # ``color`` is now in ``_STRUCTURAL_NODE_FIELDS`` (parser-owned), so
    # any color the agent invented for a node whose input had no color
    # gets stripped during the merge. The system prompt already forbade
    # the agent from setting color (rule #3); the merge layer now
    # enforces it. Test fixture's input has no color → output has no
    # color, regardless of what the agent returned.
    for symbol in ("P", "V", "T"):
        assert by_id[symbol].color is None


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
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )

    node = out.nodes[0]
    assert node.quantity == "velocity"
    assert node.unit == "m/s"
    assert node.emoji == "🚀"
    # The first-pass-inferred domain should be preserved on the retry's
    # output too — it's now part of the canonical enriched graph.
    assert out.domain == "classical_mechanics"


def test_critic_accepts_coherent_first_pass() -> None:
    # When the first pass is already correct, the critic returns ok and we
    # ship that result without burning a second enrichment call.
    enricher = _build_agent_with(
        test_output={"nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )

    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    assert out.nodes[0].quantity == "velocity"


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
    out = enricher.enrich(_g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}))
    # Voltage survives because there's no context to reject it against.
    assert out.nodes[0].quantity == "voltage"


def test_circuits_lesson_keeps_voltage() -> None:
    # Same voltage response, different context: critic returns ok and the
    # enrichment passes through unchanged.
    enricher = _build_agent_with(
        test_output={"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context={
            "lessonTitle": "RC Circuits",
            "stepExplanation": "The capacitor charges through the resistor; voltage rises.",
        },
    )
    assert out.nodes[0].quantity == "voltage"
    assert out.nodes[0].unit == "V"


def test_critic_failure_falls_back_to_first_pass() -> None:
    # If the critic raises (network blip, bad output, whatever), we don't
    # block the user — fall back to the first-pass enrichment unchanged.
    enricher = _build_agent_with(
        test_output={"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
        critic_outputs=[RuntimeError("simulated critic outage")],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    # First-pass output passes through unchanged when the critic blows up.
    assert out.nodes[0].quantity == "voltage"


def test_user_payload_renders_context_as_prose() -> None:
    # The prompt input must surface lesson/scene context as a readable
    # preamble — burying it inside JSON is what let Gemini ignore it.
    from backend.agents.semantic_graph_enricher import _build_payload

    payload = _build_payload(
        SemanticGraph.model_validate({"nodes": [], "edges": []}),
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
    from backend.agents.semantic_graph_enricher import _build_payload, _context_with_feedback

    retry_ctx = _context_with_feedback(
        _ATMOSPHERIC_CONTEXT,
        "Lesson is atmospheric entry; V is velocity, not voltage.",
    )
    payload = _build_payload(
        SemanticGraph.model_validate({"nodes": [], "edges": []}),
        context=retry_ctx,
    )
    assert "Coherence feedback" in payload
    assert "V is velocity, not voltage" in payload


def test_graph_domain_surfaces_in_payload() -> None:
    # ``graph.domain`` (set by the parser, e.g. ``classical_mechanics``) is
    # the strongest signal we have — it must appear at the top of the
    # rendered context preamble, marked as authoritative, in BOTH the
    # enrichment and critic payloads.
    from backend.agents.semantic_graph_enricher import _build_payload, _build_critique_payload

    graph = SemanticGraph.model_validate(
        {"domain": "classical_mechanics", "nodes": [], "edges": []}
    )

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
    from backend.agents.semantic_graph_enricher import _build_payload

    graph = SemanticGraph.model_validate(
        {"domain": "quantum_mechanics", "nodes": [], "edges": []}
    )
    payload = _build_payload(graph, context=None)
    assert "Graph domain (authoritative, from parser): quantum_mechanics" in payload


def test_no_domain_no_authoritative_line() -> None:
    # A graph without a domain field should not emit a fake "Graph domain"
    # line — the model would treat it as authoritative if we did.
    from backend.agents.semantic_graph_enricher import _build_payload

    graph = SemanticGraph.model_validate({"nodes": [], "edges": []})
    payload = _build_payload(graph, context=_ATMOSPHERIC_CONTEXT)
    assert "Graph domain" not in payload


def test_enrichment_marker_stamped_on_first_pass_ok() -> None:
    # Every successful enrichment attaches an `enrichment` block so the
    # server and client can short-circuit on second invocations. Reasoning
    # supplied by the model is preserved through the stamping, and the
    # `fields` list authoritatively records what the enricher changed.
    enricher = _build_agent_with(
        test_output={
            "nodes": [_GOOD_VELOCITY_NODE], "edges": [],
            "domain": "classical_mechanics",
            "enrichment": {"reasoning": "Atmospheric entry → classical_mechanics; V is velocity."},
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    block = out.enrichment
    assert block is not None
    assert "velocity" in block.reasoning
    fields = block.fields
    assert isinstance(fields, list) and fields
    # The diff records both top-level (`domain`) and per-node changes, the
    # latter as `nodes.<id>.<field>` paths.
    assert "domain" in fields
    assert any(f.startswith("nodes.V.") for f in fields)
    assert "nodes.V.quantity" in fields
    assert "nodes.V.unit" in fields


def test_enrichment_marker_stamped_when_model_omits_block() -> None:
    # Even if the model forgets to include the `enrichment` block on its
    # output, the enricher backfills one (with the diff) so callers always
    # get the marker.
    enricher = _build_agent_with(
        test_output={"nodes": [_GOOD_VELOCITY_NODE], "edges": []},
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    block = out.enrichment
    assert block is not None
    assert isinstance(block.fields, list) and block.fields


def test_enrichment_marker_stamped_after_retry() -> None:
    # The marker also lands on the retry path. The diff is computed against
    # the ORIGINAL input graph (not the shallow-copied retry graph), so the
    # `fields` list reflects everything the agent did across both passes.
    enricher = _build_agent_with(
        test_output=[
            {"nodes": [_BAD_VOLTAGE_NODE], "edges": []},
            {"nodes": [_GOOD_VELOCITY_NODE], "edges": [],
             "domain": "classical_mechanics",
             "enrichment": {"reasoning": "Corrected: V is velocity, not voltage."}},
        ],
        critic_outputs=[
            {"ok": False, "mismatched_node_ids": ["V"], "feedback": "V is velocity."},
        ],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    block = out.enrichment
    assert block is not None
    assert block.reasoning == "Corrected: V is velocity, not voltage."
    assert out.nodes[0].quantity == "velocity"
    # Even though the inferred domain came from the first pass and was
    # re-asserted by the retry, the diff against the original input still
    # reports it.
    assert "domain" in block.fields
    assert "nodes.V.quantity" in block.fields


def test_diff_skips_fields_the_model_left_unchanged() -> None:
    # `fields` is computed by diffing input vs output — fields the model
    # echoed back unchanged should NOT appear in the list. Pins the
    # authoritative-diff behavior.
    from backend.agents.semantic_graph_enricher import _diff_enriched_fields

    inp = SemanticGraph.model_validate(
        {"nodes": [{"id": "V", "type": "scalar", "label": "V", "unit": "m/s"}], "edges": []}
    )
    out = SemanticGraph.model_validate({
        "nodes": [{"id": "V", "type": "scalar", "label": "V",
                   "unit": "m/s", "quantity": "velocity"}],
        "edges": [],
    })
    paths = _diff_enriched_fields(inp, out)
    assert paths == ["nodes.V.quantity"]  # label/unit unchanged → not listed


def test_phantom_nodes_added_by_model_are_dropped() -> None:
    # Gemini occasionally invents a stray node (e.g. an isolated box
    # labeled "gravitational acceleration emoji") even though the prompt
    # forbids it. The agent treats input ids as authoritative and drops
    # any output node whose id wasn't in the input. Edges that touch a
    # dropped id go with it.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "g", "type": "scalar", "label": "g",
                 "quantity": "acceleration", "unit": "m/s²"},
                {"id": "g_phantom", "type": "scalar",
                 "label": "gravitational acceleration emoji"},
            ],
            "edges": [
                {"from": "g_phantom", "to": "g"},  # phantom edge
            ],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "g", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    ids = [n.id for n in out.nodes]
    assert ids == ["g"]                       # phantom dropped
    assert out.edges == []                 # phantom edge dropped too
    # Real node still got its enrichment.
    assert out.nodes[0].quantity == "acceleration"


def test_validator_raises_modelretry_when_input_ids_dropped() -> None:
    # The dropped-node retry now rides on pydantic-ai's max_retries budget
    # via an output validator. When the model returns an output that omits
    # input ids, ``_validate_no_dropped_nodes`` raises ``ModelRetry`` with
    # the missing ids; pydantic-ai feeds that message back as a follow-up
    # turn. This test exercises the validator directly — the ``_StubAgent``
    # used elsewhere doesn't honour the decorator, so safety-net tests
    # below cover the post-hoc restoration path instead.
    from pydantic_ai import ModelRetry
    from backend.agents.semantic_graph_enricher import (
        _current_input_node_ids,
        _validate_no_dropped_nodes,
    )

    output = SemanticGraph.model_validate({
        "nodes": [
            {"id": "__deriv_5", "type": "operator", "op": "derivative",
             "with_respect_to": "t"},
            # ``q_{\text{LEO}}`` deliberately absent.
        ],
        "edges": [{"from": "q_{\\text{LEO}}", "to": "__deriv_5"}],
    })
    token = _current_input_node_ids.set(
        frozenset({"q_{\\text{LEO}}", "__deriv_5"})
    )
    try:
        with pytest.raises(ModelRetry) as excinfo:
            _validate_no_dropped_nodes(output)
    finally:
        _current_input_node_ids.reset(token)

    msg = str(excinfo.value)
    # The message names the missing id, asks for verbatim preservation,
    # and does NOT prescribe ``color`` (which the system prompt forbids
    # — calling it out in retry feedback would contradict the prompt).
    assert "q_{\\text{LEO}}" in msg
    assert "verbatim" in msg.lower()
    assert "color" not in msg.lower()


def test_validator_passes_through_when_output_complete() -> None:
    # Sanity: when the model returns every input id, the validator must
    # not raise — no extra retry, no extra Gemini call.
    from backend.agents.semantic_graph_enricher import (
        _current_input_node_ids,
        _validate_no_dropped_nodes,
    )

    output = SemanticGraph.model_validate({
        "nodes": [
            {"id": "x", "type": "scalar", "label": "x"},
            {"id": "y", "type": "scalar", "label": "y"},
        ],
        "edges": [],
    })
    token = _current_input_node_ids.set(frozenset({"x", "y"}))
    try:
        result = _validate_no_dropped_nodes(output)
    finally:
        _current_input_node_ids.reset(token)
    # Validator returns the output unchanged — pydantic-ai uses this
    # as the agent's success path.
    assert result is output


def test_validator_caps_escalations_so_safety_net_can_repair() -> None:
    # Critical (Codex review P1): if the model stubbornly drops the same
    # id every retry, the validator must NOT escalate forever. Otherwise
    # pydantic-ai exhausts ``max_retries`` and raises
    # ``UnexpectedModelBehavior`` — which propagates to the FastAPI
    # handler as a 502 and bypasses ``_stamp_enriched`` (and therefore
    # ``_restore_dropped_nodes``). The whole layered defense relies on
    # the *last* model output flowing through to the safety net.
    from pydantic_ai import ModelRetry
    from backend.agents.semantic_graph_enricher import (
        _VALIDATOR_MAX_ESCALATIONS,
        _current_input_node_ids,
        _validator_escalation_count,
        _validate_no_dropped_nodes,
    )

    output = SemanticGraph.model_validate({
        "nodes": [{"id": "__deriv_5", "type": "operator"}],
        "edges": [{"from": "q_{\\text{LEO}}", "to": "__deriv_5"}],
    })
    ids_token = _current_input_node_ids.set(
        frozenset({"q_{\\text{LEO}}", "__deriv_5"})
    )
    count_token = _validator_escalation_count.set(0)
    try:
        # First N escalations raise — model gets a chance to fix.
        for attempt in range(_VALIDATOR_MAX_ESCALATIONS):
            with pytest.raises(ModelRetry):
                _validate_no_dropped_nodes(output)
        # Counter should now be at the cap.
        assert _validator_escalation_count.get() == _VALIDATOR_MAX_ESCALATIONS
        # The next call (over the cap) must NOT raise — instead it
        # returns the dropped-node output unchanged so the safety net
        # downstream can repair it. This is the exact path that turned
        # 502s into restored graphs.
        result = _validate_no_dropped_nodes(output)
        assert result is output
    finally:
        _current_input_node_ids.reset(ids_token)
        _validator_escalation_count.reset(count_token)


def test_validator_is_noop_when_no_input_set_bound() -> None:
    # The ``_StubAgent`` and any direct callers that bypass the agent
    # don't set the ContextVar; the validator must degrade to a pass-
    # through in that case rather than failing every test that uses
    # the stub.
    from backend.agents.semantic_graph_enricher import (
        _current_input_node_ids,
        _validate_no_dropped_nodes,
    )

    output = SemanticGraph.model_validate({
        "nodes": [{"id": "z", "type": "scalar"}],
        "edges": [],
    })
    # Confirm no token has been set (default state).
    assert _current_input_node_ids.get() is None
    assert _validate_no_dropped_nodes(output) is output


def test_already_enriched_input_still_validates_at_boundary() -> None:
    # Codex review #1 on PR #196: schema validation must run BEFORE the
    # ``enrichment is not None`` short-circuit, otherwise a caller can
    # smuggle a schema-violating graph through by including any
    # ``"enrichment": {...}`` blob. Even though the agent runs through
    # ``aenrich`` (which checks ``enrichment is not None`` directly on the
    # validated model), this test pins the boundary order — the validated
    # input is what the short-circuit returns, not the raw dict.
    from backend.model.semantic_graph import Enrichment

    pre_with_extra = {
        "enrichment": {"reasoning": "previously enriched"},
        "nodes": [
            # Schema-violating extra property — must trip the boundary
            # even on the already-enriched fast path.
            {"id": "evil", "type": "scalar", "script": "<malicious>"},
        ],
        "edges": [],
    }
    # ``_g`` mirrors the FastAPI handler's call to ``SemanticGraph.model_validate``.
    # The boundary rejects the input regardless of the enrichment marker.
    with pytest.raises(ValidationError, match="extra_forbidden|script"):
        SemanticGraph.model_validate(pre_with_extra)


def test_input_with_unknown_node_fields_rejected_at_boundary() -> None:
    # Issue #195: with the typed pipeline, the API boundary (FastAPI handler
    # for ``/api/graph/enrich``, plus this very test helper ``_g``) calls
    # ``SemanticGraph.model_validate`` to convert wire-format dicts into
    # typed graphs. ``SemanticGraphNode`` carries ``extra="forbid"``, so
    # any node with a schema-violating extra property is rejected *before*
    # reaching the agent, the merge layer, or the cache. Pre-refactor,
    # ``GraphEnrichRequest.graph: dict`` accepted any shape and the merge
    # helpers had to re-validate individual nodes inside
    # ``_restore_dropped_nodes`` to preserve the ``extra="forbid"`` invariant
    # (see the surgical fix in PR #194). Now the boundary is the only place
    # validation happens.
    poisoned_input = {
        "nodes": [
            {"id": "good", "type": "scalar", "latex": "x"},
            # Schema-violating extra property — must trip the boundary.
            {"id": "evil", "type": "scalar", "latex": "y", "script": "<malicious>"},
        ],
        "edges": [],
    }
    with pytest.raises(ValidationError, match="extra_forbidden|script"):
        SemanticGraph.model_validate(poisoned_input)


def test_restore_dropped_nodes_excludes_none_fields() -> None:
    # Smoke test for the typed restore: nodes are ``SemanticGraphNode``
    # instances with ``Optional[...] = None`` fields. When we serialize
    # the post-enrichment graph at the API boundary via
    # ``model_dump(exclude_none=True)``, fields the parser left as ``None``
    # are dropped — matching how the agent's own output is normalised.
    from backend.agents.semantic_graph_enricher import _restore_dropped_nodes
    from backend.model.semantic_graph import SemanticGraphNode

    input_graph = SemanticGraph(
        nodes=[
            SemanticGraphNode(id="x", type="scalar", latex="x"),
        ],
        edges=[],
    )
    output_graph = SemanticGraph(nodes=[], edges=[])
    _restore_dropped_nodes(input_graph, output_graph)
    assert len(output_graph.nodes) == 1
    assert output_graph.nodes[0].id == "x"
    # ``label`` and ``description`` weren't set on the input — they stay
    # as ``None`` on the model and disappear from the wire-format dump.
    assert output_graph.nodes[0].label is None
    assert output_graph.nodes[0].description is None
    dumped = output_graph.nodes[0].model_dump(by_alias=True, exclude_none=True)
    assert "label" not in dumped
    assert "description" not in dumped


def test_parser_owned_color_and_highlight_are_restored_from_input() -> None:
    # Issue #195: ``color`` / ``highlight`` are author-set semantic markers
    # tied to ``htmlClass{hl-cube}``-style highlights — the parser emits
    # them and the renderer / theme resolves them. The system prompt tells
    # Gemini not to modify ``color`` (rule #3), but in production we've
    # seen it strip the field anyway. Adding both to ``_STRUCTURAL_NODE_FIELDS``
    # makes the merge layer enforce the parser's intent regardless of what
    # the agent returns.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                # Agent strips both color and highlight from the response.
                {"id": "__num_6", "type": "number", "label": "2.81",
                 "description": "Heating ratio."},
            ],
            "edges": [],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({
            "nodes": [
                {"id": "__num_6", "type": "number", "label": "2.81",
                 "color": "red", "highlight": "result"},
            ],
            "edges": [],
        }),
        context=_ATMOSPHERIC_CONTEXT,
    )
    by_id = {n.id: n for n in out.nodes}
    # Parser-set markers survive — the merge layer restored them from
    # the input even though Gemini's response omitted both.
    assert by_id["__num_6"].color == "red"
    assert by_id["__num_6"].highlight == "result"
    # The agent's enrichment fields still land on the same node.
    assert by_id["__num_6"].description == "Heating ratio."


def test_parser_owned_color_overwrites_agent_modifications() -> None:
    # Even if the agent *modifies* a parser-owned field rather than
    # stripping it, the merge layer reverts to the input value. Otherwise
    # a model that thinks it knows better could rewrite ``color: "red"``
    # as ``color: "#ff0000"`` (or worse, a hex that doesn't match the
    # theme's resolution).
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "__num_6", "type": "number", "label": "2.81",
                 "color": "blue", "highlight": "hijacked"},
            ],
            "edges": [],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({
            "nodes": [
                {"id": "__num_6", "type": "number", "label": "2.81",
                 "color": "red", "highlight": "result"},
            ],
            "edges": [],
        }),
        context=_ATMOSPHERIC_CONTEXT,
    )
    by_id = {n.id: n for n in out.nodes}
    assert by_id["__num_6"].color == "red"          # not "blue"
    assert by_id["__num_6"].highlight == "result"   # not "hijacked"


def test_dropped_node_safety_net_restores_when_validator_exhausts() -> None:
    # When pydantic-ai's retry budget is exhausted and the model still
    # omits input ids, the ``_restore_dropped_nodes`` safety net inside
    # ``_stamp_enriched`` re-inserts them verbatim. The integrity invariant
    # (every edge endpoint has a matching node) must hold even on a worst-
    # case-failure path. The stub here simulates that worst case by
    # returning the same dropped-node graph regardless of "retries".
    enricher = _build_agent_with(
        test_output={
            "nodes": [{"id": "__deriv_5", "type": "operator"}],
            "edges": [{"from": "q_{\\text{LEO}}", "to": "__deriv_5"}],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    input_graph = {
        "nodes": [
            {"id": "q_{\\text{LEO}}", "type": "scalar",
             "latex": "q_{\\text{LEO}}"},
            {"id": "__deriv_5", "type": "operator"},
        ],
        "edges": [{"from": "q_{\\text{LEO}}", "to": "__deriv_5"}],
    }
    out = enricher.enrich(_g(input_graph), context=_ATMOSPHERIC_CONTEXT)
    ids = {n.id for n in out.nodes}
    assert ids == {"q_{\\text{LEO}}", "__deriv_5"}
    by_id = {n.id: n for n in out.nodes}
    assert by_id["q_{\\text{LEO}}"].latex == "q_{\\text{LEO}}"


def test_dropped_input_nodes_are_restored_from_input() -> None:
    # Inverse of the phantom-node case (issue #192): Gemini sometimes
    # *omits* an input node (commonly variables with ``\text{...}``
    # subscripts) while leaving the edges that reference its id. Without
    # restoration, downstream Mermaid emits a dangling edge and renders
    # a placeholder node labelled with the *sanitized* id (``q__\text_LEO__``).
    # The agent must take the input ids as authoritative and re-insert any
    # missing ones with the parser-owned record verbatim.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                # Note: ``q_{\text{LEO}}`` is conspicuously absent; only the
                # __deriv_5 operator survives the model's response.
                {"id": "__deriv_5", "type": "operator", "op": "derivative",
                 "with_respect_to": "t",
                 "description": "Time derivative of the LEO heat-rate."},
            ],
            "edges": [
                {"from": "q_{\\text{LEO}}", "to": "__deriv_5"},
            ],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    input_graph = {
        "nodes": [
            {
                "id": "q_{\\text{LEO}}",
                "type": "scalar",
                "latex": "q_{\\text{LEO}}",
                "subexpr": "q_{\\text{LEO}}",
            },
            {
                "id": "__deriv_5",
                "type": "operator",
                "op": "derivative",
                "with_respect_to": "t",
            },
        ],
        "edges": [
            {"from": "q_{\\text{LEO}}", "to": "__deriv_5"},
        ],
    }
    out = enricher.enrich(_g(input_graph), context=_ATMOSPHERIC_CONTEXT)

    out_ids = [n.id for n in out.nodes]
    # Both input nodes survive — the dropped one was re-inserted.
    assert "q_{\\text{LEO}}" in out_ids
    assert "__deriv_5" in out_ids

    # Restored node carries the parser-owned fields verbatim.
    by_id = {n.id: n for n in out.nodes}
    restored = by_id["q_{\\text{LEO}}"]
    assert restored.latex == "q_{\\text{LEO}}"
    assert restored.subexpr == "q_{\\text{LEO}}"
    assert restored.type == "scalar"

    # Edge that previously dangled still resolves to a real node, and the
    # surviving node retained its enrichment.
    assert any(e.model_dump(by_alias=True, exclude_none=True) == {"from": "q_{\\text{LEO}}", "to": "__deriv_5"} for e in out.edges)
    assert by_id["__deriv_5"].description.startswith("Time derivative")


def test_dropped_node_restoration_is_independent_of_phantom_drop() -> None:
    # When the model both drops a real input node *and* invents a phantom,
    # the agent should restore the missing one and remove the phantom in
    # the same pass. This stresses the ordering inside ``_stamp_enriched``.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "g", "type": "scalar", "label": "g",
                 "quantity": "acceleration"},
                # Phantom: not in input.
                {"id": "g_phantom", "type": "scalar",
                 "label": "gravitational acceleration emoji"},
                # Note: input node ``\theta`` is deliberately absent.
            ],
            "edges": [
                # Phantom edge that touches the phantom node — should go.
                {"from": "g_phantom", "to": "g"},
                # Real edge involving the dropped input node — must survive.
                {"from": "\\theta", "to": "g"},
            ],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    input_graph = {
        "nodes": [
            {"id": "g", "type": "scalar"},
            {"id": "\\theta", "type": "scalar", "latex": "\\theta"},
        ],
        "edges": [
            {"from": "\\theta", "to": "g"},
        ],
    }
    out = enricher.enrich(_g(input_graph), context=_ATMOSPHERIC_CONTEXT)

    ids = sorted(n.id for n in out.nodes)
    assert ids == ["\\theta", "g"]                  # phantom dropped, theta restored
    assert any(e.model_dump(by_alias=True, exclude_none=True) == {"from": "\\theta", "to": "g"} for e in out.edges)
    assert not any(e.model_dump(by_alias=True, exclude_none=True) == {"from": "g_phantom", "to": "g"} for e in out.edges)


def test_no_dropped_nodes_means_no_changes_to_node_set() -> None:
    # Sanity: when the model returns every input id, the restoration
    # pass must not mutate the node list (no duplicates, ordering of the
    # model's response preserved). Guards against overshooting the fix.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "x", "type": "scalar", "label": "x",
                 "description": "position"},
                {"id": "y", "type": "scalar", "label": "y",
                 "description": "vertical position"},
            ],
            "edges": [],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "x", "type": "scalar"},
                   {"id": "y", "type": "scalar"}],
         "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    ids = [n.id for n in out.nodes]
    assert ids == ["x", "y"]                          # no duplicates, order kept


def test_structural_fields_restored_from_input() -> None:
    # Gemini in JSON mode occasionally double-escapes backslashes in
    # ``subexpr`` (``\frac`` → ``\\frac``), which breaks the rendered
    # tooltip and chat "Expression:" line — both feed the value to
    # KaTeX, where ``\\`` is a line break and the rest renders as raw
    # letters. Issue #182. Structural fields (``subexpr``, ``latex``,
    # ``type``, ``op``, ``exponent``, ``with_respect_to``) are
    # parser-derived and must be restored verbatim from the input.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {
                    "id": "__power_7",
                    "type": "operator",
                    "op": "power",
                    "exponent": "-1",
                    # Mangled by the model:
                    "subexpr": "\\\\frac{1}{\\\\rho A C_{d}}",
                    "description": "Inverse of the drag factors.",
                    "dimension": "M⁻¹·L",
                    "unit": "m/kg",
                },
            ],
            "edges": [],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    input_graph = {
        "nodes": [
            {
                "id": "__power_7",
                "type": "operator",
                "op": "power",
                "exponent": "-1",
                "subexpr": "\\frac{1}{\\rho A C_{d}}",
            },
        ],
        "edges": [],
    }
    out = enricher.enrich(_g(input_graph), context=_ATMOSPHERIC_CONTEXT)
    node = out.nodes[0]
    # Parser-owned fields are restored verbatim — no double backslashes.
    assert node.subexpr == "\\frac{1}{\\rho A C_{d}}"
    assert node.op == "power"
    assert node.exponent == "-1"
    # The semantic enrichment fields the model contributed survive.
    assert node.description == "Inverse of the drag factors."
    assert node.unit == "m/kg"


def test_non_emoji_text_in_emoji_field_is_stripped() -> None:
    # Gemini sometimes returns a word in the `emoji` field by mistake
    # (e.g. "ускорение" / "acceleration"). The schema cap is generous so
    # this doesn't blow up the whole enrichment via retry exhaustion, but
    # we strip the bad value server-side so the user never sees the junk.
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "a", "type": "vector", "label": "a",
                 "emoji": "ускорение"},  # not an emoji
                {"id": "V", "type": "scalar", "label": "V",
                 "emoji": "💨"},          # legit
            ],
            "edges": [],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    out = enricher.enrich(
        _g({"nodes": [{"id": "a", "type": "vector"}, {"id": "V", "type": "scalar"}], "edges": []}),
        context=_ATMOSPHERIC_CONTEXT,
    )
    by_id = {n.id: n for n in out.nodes}
    # ``by_id["a"]`` is a ``SemanticGraphNode``, not a dict — ``"emoji"
    # in model`` checks against the field-tuple iterator, never matches
    # the bare string, and would always pass even if ``_strip_bad_emojis``
    # did nothing. Use attribute access instead so the assertion actually
    # exercises the helper. (Codex review on PR #196.)
    assert by_id["a"].emoji is None     # word stripped
    assert by_id["V"].emoji == "💨"     # real emoji survives


def test_diff_reports_field_removals() -> None:
    # Now that the prompt forbids enriching `color`, the model may strip
    # a color the input had. The diff must walk the union of input/output
    # keys per node so removals show up too.
    from backend.agents.semantic_graph_enricher import _diff_enriched_fields

    inp = SemanticGraph.model_validate({
        "nodes": [{"id": "V", "type": "scalar", "label": "V", "color": "#cccccc"}],
        "edges": [],
    })
    out = SemanticGraph.model_validate({
        "nodes": [{"id": "V", "type": "scalar", "label": "V",
                   "quantity": "velocity"}],  # color is gone
        "edges": [],
    })
    paths = _diff_enriched_fields(inp, out)
    assert "nodes.V.color" in paths       # removal listed
    assert "nodes.V.quantity" in paths    # addition listed
    assert "nodes.V.label" not in paths   # unchanged stays out


def test_already_enriched_input_is_passthrough() -> None:
    # An input graph that already carries an `enrichment` block skips both
    # Gemini calls. The exploding agent would raise if either call ran.
    from backend.agents.semantic_graph_enricher import SemanticGraphEnrichmentAgent

    pre = {
        "enrichment": {"reasoning": "previous run"},
        "nodes": [{"id": "V", "type": "scalar", "quantity": "velocity"}],
        "edges": [],
    }
    enricher = SemanticGraphEnrichmentAgent.__new__(SemanticGraphEnrichmentAgent)

    class _ExplodingAgent:
        async def run(self, _prompt):
            raise AssertionError("enrichment must not run on a marked graph")

    enricher._agent = _ExplodingAgent()
    enricher._critic = None

    pre_model = _g(pre)
    out = enricher.enrich(pre_model, context=_ATMOSPHERIC_CONTEXT)
    # The validated input model is returned unchanged — same object,
    # no copy / re-stamp on the already-enriched fast path.
    assert out is pre_model
    assert out.enrichment is not None
    assert out.enrichment.reasoning == "previous run"


def test_inferred_domain_threads_into_retry_payload() -> None:
    # When the first pass infers a domain that the input graph didn't carry,
    # the retry must see it as authoritative — done by stamping the inferred
    # domain onto a shallow copy of the graph and surfacing it via the
    # standard render path. Verifies the mechanism by simulating the retry
    # graph directly.
    from backend.agents.semantic_graph_enricher import _build_payload

    input_graph = SemanticGraph.model_validate(
        {"nodes": [], "edges": []}  # no domain
    )
    retry_graph = input_graph.model_copy(update={"domain": "classical_mechanics"})
    payload = _build_payload(retry_graph, context=_ATMOSPHERIC_CONTEXT)
    assert "Graph domain (authoritative, from parser): classical_mechanics" in payload
    # The original input graph is not mutated — ``model_copy`` returns
    # a fresh instance.
    assert input_graph.domain is None


def test_restore_edge_roles_after_enrichment() -> None:
    """Edge role tags (lhs/rhs) survive Gemini enrichment round-trip.

    Gemini doesn't know about the ``role`` field and strips it.
    ``_restore_edge_roles`` re-applies roles from the input graph by
    matching on (from, to) pairs."""
    enricher = _build_agent_with(
        test_output={
            "nodes": [
                {"id": "x", "type": "scalar", "label": "x",
                 "description": "variable"},
                {"id": "0", "type": "number", "label": "0"},
                {"id": "__gt_1", "type": "operator", "op": "greater_than"},
            ],
            "edges": [
                {"from": "x", "to": "__gt_1"},
                {"from": "0", "to": "__gt_1"},
            ],
        },
        critic_outputs=[{"ok": True, "mismatched_node_ids": []}],
    )
    input_graph = _g({
        "nodes": [
            {"id": "x", "type": "scalar"},
            {"id": "0", "type": "number"},
            {"id": "__gt_1", "type": "operator", "op": "greater_than"},
        ],
        "edges": [
            {"from": "x", "to": "__gt_1", "role": "lhs"},
            {"from": "0", "to": "__gt_1", "role": "rhs"},
        ],
    })
    out = enricher.enrich(input_graph, context=_ATMOSPHERIC_CONTEXT)
    edge_roles = {(e.from_, e.to): e.role for e in out.edges}
    assert edge_roles[("x", "__gt_1")] == "lhs"
    assert edge_roles[("0", "__gt_1")] == "rhs"
