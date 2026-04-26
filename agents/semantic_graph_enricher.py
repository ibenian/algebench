"""Semantic graph enrichment agent.

Takes a structural semantic graph (produced by `scripts/latex_to_graph.py`) and
returns the same graph with descriptions, emojis, colors, and corrected
role/dimension/unit/quantity fields. Ids and edges are preserved verbatim.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .base import BaseAgent
from models import SemanticGraph


_SYSTEM_PROMPT = """\
You enrich a semantic graph that represents a math/physics expression.

The user message starts with a `## Context` prose block (lesson / scene /
proof / step text) followed by a `## Graph` JSON block.

YOU MUST READ THE CONTEXT BLOCK FIRST and use it to pick the physical
meaning of every ambiguous symbol. The lesson is almost always about ONE
physical domain (mechanics, electromagnetism, thermodynamics, quantum,
fluids, etc.); every quantity / unit / dimension you assign must belong
to that domain. Never mix domains — a response that pairs an atmospheric-
entry context with `voltage`, or a circuits context with `thrust`, is
invalid.

If the context starts with a `Graph domain` line (e.g.
`classical_mechanics`, `quantum_mechanics`, `special_relativity`,
`algebra`), treat that as the AUTHORITATIVE domain for the graph. It is
emitted by an upstream parser and should override any softer signal you
might infer from the lesson prose. In `classical_mechanics` the symbol
`V` is velocity, never voltage; in `quantum_mechanics` `H` is the
Hamiltonian, not enthalpy; etc.

If the input graph does NOT carry a `domain` field, infer one from the
lesson context and emit it on the output graph (lower-snake-case, short:
`classical_mechanics`, `electromagnetism`, `thermodynamics`,
`quantum_mechanics`, `fluid_dynamics`, `special_relativity`,
`general_relativity`, `optics`, `control_theory`, `algebra`,
`linear_algebra`, `calculus`, `statistics`, …). Use the same one
everywhere — every quantity / unit / dimension you assign must agree
with the domain you picked.

The `graph` JSON object has `nodes`, `edges`, and optionally `domain` and
`classification`. Each node has at least `id` and `type`; some have `label`,
`role`, `quantity`, `dimension`, `unit`, `value`.

Your job:
1. EVERY node MUST have a non-empty `description` field in your output. No
   exceptions. Do not omit it. Do not return null. One short sentence
   (≤ 30 words) explaining what the node means in the given context.
   Prefer the context's domain over your own guesses.
   - Quantity nodes (scalar/vector/constant/number): describe the symbol
     (e.g. "Thrust, the force produced by the rocket engine.").
   - Operator nodes (multiply/divide/add/subtract/derivative/equals/power…):
     describe what the operation expresses for THIS specific subexpression
     (e.g. for `\dot{m} \cdot v_e \cdot t`: "Mass flow rate times exhaust
     velocity times burn time gives the total impulse."). Use the node's
     `subexpr` field as the source of truth for what's being combined.
   Before returning, scan your output: if any node lacks a `description`,
   add one. A response missing any `description` is invalid.
   Math notation inside a description MUST be wrapped in single-`$`
   delimiters using LaTeX (e.g. "Ballistic coefficient, $\\beta = m / (C_d A)$.").
   Never use ASCII math like `m/(C_d*A)` or `x^2` — always emit `$m / (C_d A)$`,
   `$x^{2}$`, `$\\dot{m}$`, etc.
2. Add or refine `emoji` — a single Unicode emoji character (e.g. "🚀",
   "⚡", "💨"). Must be a real emoji glyph, not a Font Awesome icon code,
   not a private-use codepoint. Skip `emoji` for operator nodes unless an
   intuitive symbol exists.
3. Add or refine `color` as a CSS hex string (e.g. "#0d47a1"). Use color to
   group related concepts; reserve red for energy/heat, blue for fluid/water,
   green for biology/growth, purple for quantum, etc. Hex only.
4. Fill missing `dimension`, `unit`, and `quantity` whenever they can be
   determined unambiguously — and correct obviously wrong values where
   they are present.
   - **Quantity / scalar / vector / constant / number nodes**: read the
     symbol's identity from the context (e.g. in a rocket-thrust step,
     `T` is thrust → unit `N`, dimension `M·L·T⁻²`, quantity `thrust`).
   - **Operator / expression / function nodes**: compose the dimension
     and unit from the operands when the operation makes that
     well-defined. Examples:
       - `m · a`         → unit `N`,    dimension `M·L·T⁻²`
       - `\\dot{m} · v_e · t` → unit `kg·m/s`, dimension `M·L·T⁻¹`
       - `d(m v) / dt`   → unit `N`,    dimension `M·L·T⁻²`
       - `\\sin(x)`, `\\log(x)`, `\\exp(x)` for dimensionless `x`
                         → unit `\"\"`, dimension `1`
     For sums/differences, only fill if all operands share the same
     dimension. Skip operator nodes whose operands are themselves
     missing units — don't guess.
   - **Relation nodes (`=`, `<`, `>`, `≈`)**: these are propositions, not
     physical quantities. Leave `dimension` / `unit` / `quantity` unset.
   - **Text nodes**: leave `dimension` / `unit` / `quantity` unset.

   Conventions (match the existing corpus):
   - Compact SI units: `m`, `s`, `kg`, `N`, `J`, `Pa`, `K`, `m/s`,
     `m/s²`, `kg·m/s`, `J·s`, etc. Use `·` for products and `⁻¹`, `⁻²`
     for negative exponents. Dimensionless quantities take `unit: \"\"`
     and `dimension: \"1\"`.
   - Dimensions use MLT-exponent form: `L`, `T`, `M`, `L·T⁻¹`,
     `M·L·T⁻²`, `M·L²·T⁻²`, etc.
   - Quantity is a short symbolic name (`mass`, `velocity`, `thrust`,
     `pressure`, `temperature`, `impulse`, `energy`).

   Also correct an obviously wrong `role` when context makes it
   unambiguous.

   Do NOT invent numeric `value`s for unknown symbols. Only fill `value`
   when the context literally states a number for that symbol (e.g.
   \"g = 9.81 m/s²\" → value 9.81).

   When the symbol or composition is ambiguous, leave the field unset
   rather than guessing.
5. Preserve every node `id` exactly. Preserve `edges` verbatim. Preserve
   `classification` and `domain` verbatim.
6. Set `enrichment.reasoning` to a short (one or two sentences, ≤ 30 words
   total) explanation of the domain choice and any notable per-symbol
   disambiguation, e.g. "Step talks about velocity and atmospheric drag,
   so domain is `classical_mechanics`; V is velocity, not voltage." This
   is logged server-side so we can audit the agent's decisions.
7. Do NOT add new nodes or remove existing nodes. Do NOT include any prose,
   commentary, or fields outside the schema.

Return a JSON object matching the SemanticGraph schema (the enriched `graph`
only — do not echo back the `context`). Keep all string fields short and free
of HTML brackets.
"""


# Lesson-context fields, broadest scope to narrowest. ``domain`` is NOT in
# this table — it lives on the graph itself (set by the lesson author or the
# parser, or empty otherwise). `_render_context` reads it directly from the
# graph parameter and surfaces it at the top of the preamble.
# ``coherenceFeedback`` goes last as a final corrective hint after the
# lesson text.
_CONTEXT_FIELDS = (
    ("lessonTitle", "Lesson"),
    ("lessonDescription", "Lesson description"),
    ("sceneTitle", "Scene"),
    ("sceneDescription", "Scene description"),
    ("proofTitle", "Proof"),
    ("proofGoal", "Proof goal"),
    ("proofTechnique", "Technique"),
    ("stepLabel", "Step"),
    ("stepMath", "Step math (LaTeX)"),
    ("stepJustification", "Step justification"),
    ("stepExplanation", "Step explanation"),
    ("coherenceFeedback", "Coherence feedback (from previous attempt)"),
)


def _graph_domain(graph: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(graph, dict):
        return None
    val = graph.get("domain")
    if isinstance(val, str) and val.strip():
        return val.strip()
    return None


def _render_context(
    context: Optional[Dict[str, Any]],
    graph: Optional[Dict[str, Any]] = None,
) -> str:
    """Render the prose preamble. ``graph.domain`` (if set) appears at the
    very top as the authoritative domain hint — strongest signal we have."""
    domain = _graph_domain(graph)
    if not context and not domain:
        return "## Context\n(no lesson context provided — infer domain from the graph alone)"
    lines = ["## Context"]
    if domain:
        lines.append(f"- Graph domain (authoritative, from parser): {domain}")
    if context:
        for key, label in _CONTEXT_FIELDS:
            val = context.get(key)
            if val:
                lines.append(f"- {label}: {val}")
        # Emit any extra context keys we don't have a label for, so callers
        # that add fields don't silently lose them.
        extras = sorted(k for k in context if k not in {f for f, _ in _CONTEXT_FIELDS})
        for key in extras:
            val = context.get(key)
            if val:
                lines.append(f"- {key}: {val}")
    if len(lines) == 1:
        lines.append("(empty)")
    return "\n".join(lines)


def _build_payload(graph: Dict[str, Any], context: Optional[Dict[str, Any]]) -> str:
    return (
        f"{_render_context(context, graph)}\n\n"
        f"## Graph\n{json.dumps(graph, sort_keys=True)}"
    )


# Model-driven coherence critic
# -----------------------------
# After enrichment, a second model call inspects the result against the lesson
# context and decides whether any node's claimed physical quantity belongs to
# a different physical domain than the lesson (e.g. ``voltage`` in an
# atmospheric-entry lesson). If yes, we re-enrich once with the critic's
# feedback folded into the context. We avoid hand-coded keyword tables so the
# check generalizes to any physical domain the model can reason about.


_CRITIC_PROMPT = """\
You audit an enriched semantic graph for physical-domain coherence.

The user message has:
- `## Context` : the lesson / scene / proof / step text.
- `## Enriched graph` : a candidate enrichment with quantity / unit /
  dimension / description fields on each node.

Steps:
1. Identify the lesson's primary physical domain. If the context contains
   a `Graph domain` line (e.g. `classical_mechanics`, `quantum_mechanics`,
   `special_relativity`, `algebra`), trust it as authoritative. Otherwise
   infer the domain from the lesson prose (mechanics, electromagnetism,
   thermodynamics, quantum, fluids, optics, relativity, control theory,
   …). The lesson is normally about ONE domain.
2. For every node, check whether its `quantity`, `unit`, `dimension`, and
   `description` belong to that domain. A node is mismatched when its
   claimed physical meaning sits in a clearly different physical domain
   (e.g. `voltage` in a kinematics lesson, `thrust` in a circuits lesson,
   `entropy` in a quantum-spin lesson).
3. Be conservative. Only flag clear cross-domain contradictions. Do NOT
   flag stylistic issues, emoji choice, missing fields, or a node that
   merely lacks a quantity. Cross-domain analogies that the lesson
   actually invokes are allowed.

Return:
- `ok = true`, empty `mismatched_node_ids`, no `feedback` if every node
  is consistent with the lesson's domain (or if the lesson's domain is
  genuinely ambiguous and you can't tell).
- `ok = false`, the offending node ids, and a one-sentence `feedback`
  pointing the next enrichment attempt at the right reading
  (e.g. "Lesson is atmospheric entry; symbol V is velocity, not voltage.")
  whenever you find a clear cross-domain contradiction.
"""


class _CoherenceVerdict(BaseModel):
    """Critic output: which nodes (if any) clash with the lesson domain."""

    model_config = ConfigDict(extra="forbid")

    ok: bool
    mismatched_node_ids: List[str] = Field(default_factory=list)
    feedback: Optional[str] = Field(default=None, max_length=400)


class SemanticGraphCoherenceCritic(BaseAgent):
    """Audits an enriched graph for cross-domain physics contradictions."""

    name = "semantic_graph_coherence_critic"
    system_prompt = _CRITIC_PROMPT
    result_type = _CoherenceVerdict
    max_retries = 1


def _build_critique_payload(
    context: Optional[Dict[str, Any]],
    enriched: Dict[str, Any],
) -> str:
    return (
        f"{_render_context(context, enriched)}\n\n"
        f"## Enriched graph\n{json.dumps(enriched, sort_keys=True)}"
    )


def _diff_enriched_fields(
    input_graph: Dict[str, Any],
    output_graph: Dict[str, Any],
) -> List[str]:
    """Authoritative list of dotted JSON-ish paths the enricher added or
    changed. Computed by diffing input vs output (the model would
    self-report unreliably). Graph-level fields appear as bare names like
    ``"domain"``; per-node fields use ``"nodes.<id>.<field>"`` form."""
    paths: List[str] = []
    # Top-level diff: domain is the only graph-level field the enricher
    # writes; classification is preserved verbatim per prompt.
    if (input_graph.get("domain") or "") != (output_graph.get("domain") or ""):
        paths.append("domain")
    in_nodes = {
        n.get("id"): n
        for n in (input_graph.get("nodes") or [])
        if isinstance(n, dict) and n.get("id")
    }
    for out_node in output_graph.get("nodes") or []:
        if not isinstance(out_node, dict):
            continue
        node_id = out_node.get("id")
        in_node = in_nodes.get(node_id) or {}
        for key, val in sorted(out_node.items()):
            # ``id`` and ``type`` are structural — never enriched. Skip.
            if key in ("id", "type"):
                continue
            if in_node.get(key) != val:
                paths.append(f"nodes.{node_id}.{key}")
    return paths


def _stamp_enriched(
    input_graph: Dict[str, Any],
    output_graph: Dict[str, Any],
) -> Dict[str, Any]:
    """Mark a graph as enriched and attach the authoritative diff. Used as
    the gate for skip-on-second-call deduplication on both server and
    client. Preserves any ``reasoning`` the model already filled in on the
    ``enrichment`` block. Mutates and returns ``output_graph``."""
    block = output_graph.get("enrichment")
    if not isinstance(block, dict):
        block = {}
        output_graph["enrichment"] = block
    block["fields"] = _diff_enriched_fields(input_graph, output_graph)
    return output_graph


def _enrichment_reasoning(graph: Dict[str, Any]) -> Optional[str]:
    """Pull the model's domain / disambiguation rationale off an enriched
    graph for logging. ``None`` if the model didn't supply one."""
    block = graph.get("enrichment") if isinstance(graph, dict) else None
    if not isinstance(block, dict):
        return None
    val = block.get("reasoning")
    return val.strip() if isinstance(val, str) and val.strip() else None


def _context_with_feedback(
    context: Optional[Dict[str, Any]],
    feedback: str,
) -> Dict[str, Any]:
    """Fold critic feedback into the context for a re-enrichment pass."""
    merged: Dict[str, Any] = dict(context) if context else {}
    existing = merged.get("coherenceFeedback")
    merged["coherenceFeedback"] = (
        f"{existing}\n{feedback}" if existing else feedback
    )
    return merged


class SemanticGraphEnrichmentAgent(BaseAgent):
    name = "semantic_graph_enricher"
    system_prompt = _SYSTEM_PROMPT
    result_type = SemanticGraph
    max_retries = 2

    def __init__(
        self,
        *,
        model: Optional[str] = None,
        agent: Any = None,
        critic: Optional[SemanticGraphCoherenceCritic] = None,
    ) -> None:
        super().__init__(model=model, agent=agent)
        # ``critic=None`` in production means "build one with the same env";
        # tests inject a pre-built critic via ``__new__`` to avoid the env
        # check. If critic creation fails (no key, etc.) we degrade to
        # single-pass enrichment rather than blowing up the whole agent.
        if critic is None and agent is None:
            try:
                critic = SemanticGraphCoherenceCritic(model=model)
            except Exception:
                critic = None
        self._critic = critic

    async def _first_pass(
        self,
        graph: Dict[str, Any],
        context: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        result = await self.arun(_build_payload(graph, context))
        assert isinstance(result, SemanticGraph)
        return result.model_dump(by_alias=True, exclude_none=True)

    async def _critique(
        self,
        context: Dict[str, Any],
        enriched: Dict[str, Any],
    ) -> Optional[_CoherenceVerdict]:
        if self._critic is None:
            return None
        try:
            verdict = await self._critic.arun(_build_critique_payload(context, enriched))
        except Exception as exc:
            print(f"[enrich] critic error (skipping): {exc}", flush=True)
            return None
        return verdict if isinstance(verdict, _CoherenceVerdict) else None

    async def aenrich(
        self,
        graph: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Idempotency: if the input graph is already enriched (carries the
        # ``enrichment`` block), return it unchanged — both Gemini calls
        # (enrichment + critic) are skipped. The server does the same
        # short-circuit higher up; this keeps direct callers (CLI / scripts
        # / tests) consistent.
        if isinstance(graph, dict) and isinstance(graph.get("enrichment"), dict):
            print(f"[enrich] input already enriched — returning unchanged", flush=True)
            return graph

        def _log_done(stage: str, g: Dict[str, Any]) -> None:
            reason = _enrichment_reasoning(g)
            field_count = len(_diff_enriched_fields(graph, g))
            tail = f"  reasoning={reason!r}" if reason else ""
            print(
                f"[enrich] {stage}  nodes={node_count} filled={field_count}{tail}",
                flush=True,
            )

        node_count = len(graph.get("nodes") or [])
        enriched = await self._first_pass(graph, context)
        if not context:
            _log_done("first-pass ok ctx=n (no critique)", enriched)
            return _stamp_enriched(graph, enriched)
        verdict = await self._critique(context, enriched)
        if verdict is None:
            _log_done("first-pass ok critic=unavailable", enriched)
            return _stamp_enriched(graph, enriched)
        if verdict.ok:
            _log_done("first-pass ok critic=ok", enriched)
            return _stamp_enriched(graph, enriched)
        if not verdict.feedback:
            print(
                f"[enrich] critic flagged {verdict.mismatched_node_ids!r} "
                f"but no feedback — keeping first pass",
                flush=True,
            )
            _log_done("kept first pass", enriched)
            return _stamp_enriched(graph, enriched)
        # If the first pass inferred a domain that the input graph didn't
        # carry, stamp that domain onto a shallow copy of the graph for the
        # retry — the graph is the source of truth for `domain`, and the
        # render path picks it up from there. Without it, the retry would
        # re-infer from prose alone and might land on the same wrong answer
        # the critic just rejected.
        retry_graph = graph
        inferred_domain = _graph_domain(enriched)
        if inferred_domain and not _graph_domain(graph):
            retry_graph = {**graph, "domain": inferred_domain}
            print(f"[enrich] using first-pass inferred domain={inferred_domain!r}", flush=True)
        retry_context = _context_with_feedback(context, verdict.feedback)
        print(
            f"[enrich] critic mismatch nodes={verdict.mismatched_node_ids!r} → retry  "
            f"feedback={verdict.feedback!r}",
            flush=True,
        )
        retried = await self._first_pass(retry_graph, retry_context)
        _log_done("retry ok", retried)
        # Diff against the ORIGINAL input graph, not ``retry_graph`` — we
        # want the user-visible list of fields the agent actually filled,
        # which includes the domain it inferred on the first pass.
        return _stamp_enriched(graph, retried)

    def enrich(
        self,
        graph: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Sync wrapper around :meth:`aenrich` for CLI / script / sync-test callers.

        Production goes through ``aenrich`` directly from the FastAPI handler.
        Don't call this from inside a running event loop — ``asyncio.run`` will
        raise. There's only one real implementation; this just bridges callers
        that can't ``await``.
        """
        return asyncio.run(self.aenrich(graph, context))
