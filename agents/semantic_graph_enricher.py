"""Semantic graph enrichment agent.

Takes a structural semantic graph (produced by `scripts/latex_to_graph.py`) and
returns the same graph with descriptions, emojis, colors, and corrected
role/dimension/unit/quantity fields. Ids and edges are preserved verbatim.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import unicodedata
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from .base import BaseAgent
from models import SemanticGraph, SemanticGraphNode
from models.semantic_graph import Enrichment


# Per-task input-node id set, threaded into the pydantic-ai output validator
# (registered in ``SemanticGraphEnrichmentAgent.__init__``). Set right before
# each ``_first_pass`` call and reset on exit. ``contextvars`` semantics make
# this safe under FastAPI's per-request task model even though the enricher
# itself is a process-wide singleton in ``server.py``.
_current_input_node_ids: contextvars.ContextVar[Optional[frozenset[str]]] = (
    contextvars.ContextVar("_current_input_node_ids", default=None)
)

# Per-task counter for how many times ``_validate_no_dropped_nodes`` has
# escalated via ``ModelRetry`` on the current ``_first_pass`` call. Caps
# escalations so the *last* model output flows through to the safety-net
# restore in ``_stamp_enriched`` instead of pydantic-ai raising
# ``UnexpectedModelBehavior`` on retry exhaustion (which would skip the
# safety net entirely and surface as a 502 to the client). See the
# validator's docstring for the full rationale.
_VALIDATOR_MAX_ESCALATIONS = 1
_validator_escalation_count: contextvars.ContextVar[int] = (
    contextvars.ContextVar("_validator_escalation_count", default=0)
)


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
3. Do NOT set or modify `color`. The renderer paints node colors from
   the active theme (keyed by node type / role), so any per-node `color`
   the agent writes is orphaned. Leave the field unset.
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
   `classification` verbatim. Preserve `domain` if it was already set on
   the input — only infer and emit a new `domain` value when the input
   graph didn't carry one (per the rule above).
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


def _graph_domain(graph: Optional[SemanticGraph]) -> Optional[str]:
    """Extract the (stripped, non-empty) ``domain`` field from a graph, or ``None``."""
    if graph is None:
        return None
    val = graph.domain
    if isinstance(val, str) and val.strip():
        return val.strip()
    return None


def _render_context(
    context: Optional[Dict[str, Any]],
    graph: Optional[SemanticGraph] = None,
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


def _build_payload(graph: SemanticGraph, context: Optional[Dict[str, Any]]) -> str:
    """Serialize the typed graph for the agent prompt.

    ``model_dump_json(by_alias=True, exclude_none=True)`` round-trips through
    the wire-format keys (``"from"`` not ``"from_"``) and drops nulls — same
    shape we'd hand-build via ``json.dumps``, but validated. ``sort_keys`` is
    applied via parse-then-redump because pydantic doesn't expose a sort
    option directly; deterministic ordering matters for cache stability.
    """
    raw = graph.model_dump_json(by_alias=True, exclude_none=True)
    # Sort keys for deterministic output (matches pre-refactor json.dumps).
    sorted_json = json.dumps(json.loads(raw), sort_keys=True)
    return (
        f"{_render_context(context, graph)}\n\n"
        f"## Graph\n{sorted_json}"
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
    # Pin the highest-tier Gemini model — domain disambiguation is a
    # judgment call (e.g. is V velocity or voltage in this lesson?) and
    # the smaller flash models leak training-data junk under uncertainty
    # (Russian words in emoji fields, phantom nodes, etc.). ``BaseAgent``
    # precedence is ``__init__(model=)`` arg → this class attr → env var,
    # so a per-call override still wins; prod overrides need the kwarg
    # rather than the env var.
    model = "gemini-2.5-pro"


def _build_critique_payload(
    context: Optional[Dict[str, Any]],
    enriched: SemanticGraph,
) -> str:
    raw = enriched.model_dump_json(by_alias=True, exclude_none=True)
    sorted_json = json.dumps(json.loads(raw), sort_keys=True)
    return (
        f"{_render_context(context, enriched)}\n\n"
        f"## Enriched graph\n{sorted_json}"
    )


_MISSING = object()


def _node_field_dict(node: SemanticGraphNode) -> Dict[str, Any]:
    """Project a node to its set fields (excludes None, uses wire-format
    keys). Used by diff/restore helpers that compare input vs output
    fields without re-validating the whole node."""
    return node.model_dump(by_alias=True, exclude_none=True)


def _diff_enriched_fields(
    input_graph: SemanticGraph,
    output_graph: SemanticGraph,
) -> List[str]:
    """Authoritative list of dotted JSON-ish paths the enricher added,
    changed, or removed. Computed by diffing input vs output (the model
    would self-report unreliably). Graph-level fields appear as bare names
    like ``"domain"``; per-node fields use ``"nodes.<id>.<field>"`` form.

    Walks the UNION of input/output keys per node so deletions show up too
    — important now that the prompt forbids enriching some fields (e.g.
    ``color``) that may have been present on the input."""
    paths: List[str] = []
    # Top-level diff: domain is the only graph-level field the enricher
    # writes; classification is preserved verbatim per prompt.
    if (input_graph.domain or "") != (output_graph.domain or ""):
        paths.append("domain")
    in_nodes: Dict[str, Dict[str, Any]] = {
        n.id: _node_field_dict(n) for n in input_graph.nodes
    }
    for out_node in output_graph.nodes:
        node_id = out_node.id
        in_dict = in_nodes.get(node_id) or {}
        out_dict = _node_field_dict(out_node)
        # Union of keys: catches additions, modifications, AND removals.
        # ``id`` / ``type`` are structural — never enriched.
        keys = (set(in_dict.keys()) | set(out_dict.keys())) - {"id", "type"}
        for key in sorted(keys):
            if in_dict.get(key, _MISSING) != out_dict.get(key, _MISSING):
                paths.append(f"nodes.{node_id}.{key}")
    return paths


def _looks_like_emoji(s: str) -> bool:
    """True iff ``s`` plausibly is a single emoji glyph (one or two
    pictographic codepoints + optional modifiers). Any letter character
    from any alphabet — Latin, Cyrillic, Greek, CJK, etc. — disqualifies.
    Gemini sometimes puts a translated word ("ускорение", "加速度") into
    the emoji field; we want to catch all of those, not just ASCII text."""
    if not s:
        return False
    for ch in s:
        cat = unicodedata.category(ch)
        # ``L*`` = letters of any script; ``Z*`` = whitespace separators.
        # Real emojis sit in ``So`` (other symbol) plus joiners (``Cf``)
        # and a handful of variation selectors (``Mn``).
        if cat[0] == "L" or cat[0] == "Z":
            return False
    return True


def _drop_phantom_nodes_and_edges(
    input_graph: SemanticGraph,
    output_graph: SemanticGraph,
) -> None:
    """Drop nodes the model invented, plus any edges that reference them.

    The prompt tells the model to preserve the node set verbatim, but Gemini
    occasionally hallucinates a stray node (e.g. a "gravitational acceleration
    emoji" box with no connections). Treat the input ids as authoritative —
    any output node whose id wasn't in the input gets removed, and any edge
    that touches a removed id goes with it."""
    in_ids = {n.id for n in input_graph.nodes}
    kept_nodes: List[SemanticGraphNode] = []
    for n in output_graph.nodes:
        if n.id in in_ids:
            kept_nodes.append(n)
        else:
            print(
                f"[enrich] dropping phantom node {n.id!r} "
                f"(label={n.label!r})",
                flush=True,
            )
    output_graph.nodes = kept_nodes

    kept_edges = []
    for e in output_graph.edges:
        if e.from_ in in_ids and e.to in in_ids:
            kept_edges.append(e)
        else:
            print(
                f"[enrich] dropping phantom edge {e.from_!r}→{e.to!r}",
                flush=True,
            )
    output_graph.edges = kept_edges


def _validate_no_dropped_nodes(output: SemanticGraph) -> SemanticGraph:
    """pydantic-ai output validator — retry when the model omits input ids.

    Issue #192: Gemini occasionally drops input nodes (commonly variables
    with ``\\text{...}`` subscripts) while leaving edges that reference
    them, which leaves the renderer with dangling edge endpoints. This
    validator runs *inside* pydantic-ai's retry loop: when drops are
    detected on the *first* model output it raises ``ModelRetry`` with
    the missing ids, and the framework feeds that message back to the
    model as a follow-up turn, consuming a slot of
    ``BaseAgent.max_retries``. The model then sees its own previous
    (incomplete) response in context plus our error, which is a stronger
    correction signal than re-prompting from scratch.

    Critical: the validator caps its escalations at
    ``_VALIDATOR_MAX_ESCALATIONS`` (default 1). On any subsequent model
    output that *still* drops ids, the validator returns the output as-is
    rather than raising. This is intentional — without the cap, a model
    that stubbornly drops the same id every retry would exhaust
    ``max_retries``, and pydantic-ai would raise
    ``UnexpectedModelBehavior``. That exception escapes ``_first_pass``
    and propagates to the FastAPI handler, which returns a 502 — bypassing
    ``_stamp_enriched`` and therefore the ``_restore_dropped_nodes``
    safety net. The whole point of the layered defense is that the
    integrity invariant (every edge endpoint exists in nodes) holds even
    in the worst case; falling through here lets the safety net repair
    the response instead of failing the request.

    No-op when no input set is bound (test stubs that bypass the agent
    don't set the ContextVar) or when the output is complete.

    Note: the feedback intentionally avoids prescribing fields that the
    system prompt forbids (e.g. ``color``, which is theme-driven, not
    per-node). We tell the model to preserve the node set; the existing
    system-prompt rules still apply to *which* fields are populated.
    """
    expected = _current_input_node_ids.get()
    if not expected:
        return output
    out_ids: set[str] = set()
    for node in output.nodes:
        nid = getattr(node, "id", None)
        if isinstance(nid, str):
            out_ids.add(nid)
    missing = sorted(i for i in expected if i not in out_ids)
    if not missing:
        return output
    # Cap escalations so the safety net in ``_stamp_enriched`` always gets
    # a chance to repair the response. Without this, exhausted retries
    # would surface as a 502 instead of a verbatim-restored graph.
    escalations = _validator_escalation_count.get()
    if escalations >= _VALIDATOR_MAX_ESCALATIONS:
        print(
            f"[enrich] validator: {len(missing)} dropped id(s) after "
            f"{escalations} escalation(s); returning output for safety-net "
            f"repair (missing={missing!r})",
            flush=True,
        )
        return output
    _validator_escalation_count.set(escalations + 1)
    quoted = ", ".join(f"`{i}`" for i in missing)
    # Lazy import — pydantic_ai may be unavailable in some test environments.
    from pydantic_ai import ModelRetry
    raise ModelRetry(
        f"Your previous response omitted these node id(s) from `nodes`: "
        f"{quoted}. The node set must be preserved verbatim — every input "
        f"id must appear in `nodes` exactly once. Edges are fine; just "
        f"include the missing entries with the appropriate enrichment "
        f"fields per the original instructions."
    )


def _restore_dropped_nodes(
    input_graph: SemanticGraph,
    output_graph: SemanticGraph,
) -> None:
    """Re-insert input nodes the model omitted from its response.

    Mirror of :func:`_drop_phantom_nodes_and_edges` for the *inverse* failure
    mode: the prompt tells Gemini to preserve the node set verbatim, but it
    occasionally drops a label node (commonly variables with ``\\text{...}``
    subscripts like ``q_{\\text{LEO}}``) while leaving the edges that
    reference them intact. Downstream, ``scripts/graph_to_mermaid.py`` then
    emits an edge to an undeclared id, and Mermaid implicitly creates a
    placeholder node whose label is the *sanitized* id (e.g.
    ``q__\\text_LEO__``). The graph also fails the
    ``every-edge-endpoint-must-exist`` integrity invariant — see issue #192.

    Treat the input ids as authoritative. Any input id missing from the
    output gets re-added with the parser-owned record verbatim so that
    ``_restore_structural_fields`` (which only patches *existing* output
    nodes) and the renderer both find a real entry under the id.

    With the typed pipeline the input nodes are already validated
    ``SemanticGraphNode`` instances — ``extra="forbid"`` was enforced at
    ``aenrich``'s entry boundary, so a node that would smuggle an
    unknown property would have been rejected before this helper ran.
    No per-node revalidation needed here.
    """
    out_ids = {n.id for n in output_graph.nodes}
    for src in input_graph.nodes:
        if src.id in out_ids:
            continue
        # Deep copy so later passes (e.g. ``_restore_structural_fields``)
        # mutating the output node don't bleed back into the input graph,
        # which the FastAPI handler may still reference for cache hashing.
        output_graph.nodes.append(src.model_copy(deep=True))
        print(
            f"[enrich] restoring dropped input node {src.id!r} "
            f"(label={src.label!r})",
            flush=True,
        )


# Fields the parser owns and the enricher must not modify. Anything here
# is restored verbatim from the input node during ``_stamp_enriched``,
# regardless of what the model returned. The system prompt already tells
# the agent to leave most of these alone (``color`` rule #3, structural
# fields by default), but we enforce it here so the rendered graph
# matches the parser's intent even when Gemini gets distracted.
#
# Subscripts:
# - ``subexpr`` / ``latex``: deterministic LaTeX strings — issue #182
#   (Gemini sometimes double-escapes backslashes).
# - ``type`` / ``op`` / ``exponent`` / ``with_respect_to``: structural
#   parser output, never a semantic enrichment target.
# - ``color`` / ``highlight``: author-set semantic markers tied to
#   ``htmlClass{hl-cube}``-style highlights. The parser emits CSS named
#   colors (``"red"``/``"yellow"``); the renderer / theme resolves them
#   alongside the agent's enrichment fields.
_STRUCTURAL_NODE_FIELDS = (
    "subexpr",
    "latex",
    "type",
    "op",
    "exponent",
    "with_respect_to",
    "color",
    "highlight",
)


def _restore_structural_fields(
    input_graph: SemanticGraph,
    output_graph: SemanticGraph,
) -> None:
    """Copy structural / parser-derived fields from input nodes to output.

    ``subexpr`` and ``latex`` are deterministic LaTeX strings produced by
    ``scripts/latex_to_graph.py`` — the enricher should never rewrite them.
    Gemini in JSON mode occasionally double-escapes backslashes (e.g.
    ``\\frac`` → ``\\\\frac``), which mangles the rendered tooltip and chat
    expression display (issue #182). Other structural fields (``type``,
    ``op``, ``exponent``, ``with_respect_to``) are also parser-owned, not
    semantic enrichment, so we restore them verbatim too.
    """
    in_by_id: Dict[str, SemanticGraphNode] = {n.id: n for n in input_graph.nodes}
    for node in output_graph.nodes:
        src = in_by_id.get(node.id)
        if src is None:
            continue
        for field in _STRUCTURAL_NODE_FIELDS:
            # Mirror the input value exactly: assign present fields, clear
            # absent ones. Both sides have these declared with
            # ``Optional[...] = None`` defaults, so attribute access is safe.
            setattr(node, field, getattr(src, field, None))


def _strip_bad_emojis(graph: SemanticGraph) -> None:
    """Remove ``emoji`` fields that are clearly not a single emoji glyph.

    Gemini occasionally fills ``emoji`` with a word in some language
    (Russian "ускорение", Chinese "加速度", English "acceleration") instead
    of a glyph. The schema cap is intentionally generous so a bad value
    doesn't blow up the whole enrichment via pydantic-ai retry
    exhaustion — but we shouldn't ship the junk to the user."""
    for node in graph.nodes:
        emoji = node.emoji
        if isinstance(emoji, str) and not _looks_like_emoji(emoji):
            print(f"[enrich] dropping non-emoji value on {node.id!r}: {emoji!r}", flush=True)
            node.emoji = None


def _stamp_enriched(
    input_graph: SemanticGraph,
    output_graph: SemanticGraph,
) -> SemanticGraph:
    """Mark a graph as enriched and attach the authoritative diff. Used as
    the gate for skip-on-second-call deduplication on both server and
    client. Preserves any ``reasoning`` the model already filled in on the
    ``enrichment`` block. Mutates and returns ``output_graph``."""
    # Order matters:
    #   1. Restore input nodes the model dropped (issue #192) so the
    #      structural-field pass sees them.
    #   2. Drop nodes the model invented and any edges touching them.
    #   3. Patch parser-owned structural fields back onto every surviving
    #      node (no-op for the ones we just restored — they already carry
    #      the parser values verbatim).
    _restore_dropped_nodes(input_graph, output_graph)
    _drop_phantom_nodes_and_edges(input_graph, output_graph)
    _restore_structural_fields(input_graph, output_graph)
    _strip_bad_emojis(output_graph)
    fields = _diff_enriched_fields(input_graph, output_graph)
    if output_graph.enrichment is None:
        output_graph.enrichment = Enrichment(fields=fields)
    else:
        # Preserve any ``reasoning`` the model filled in; just refresh the
        # authoritative field list.
        output_graph.enrichment = output_graph.enrichment.model_copy(
            update={"fields": fields}
        )
    return output_graph


def _enrichment_reasoning(graph: SemanticGraph) -> Optional[str]:
    """Pull the model's domain / disambiguation rationale off an enriched
    graph for logging. ``None`` if the model didn't supply one."""
    block = graph.enrichment
    if block is None:
        return None
    val = block.reasoning
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
    # See ``SemanticGraphCoherenceCritic.model`` for the rationale —
    # enrichment quality matters more than per-call latency.
    model = "gemini-2.5-pro"

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

        # Register the dropped-node validator on the underlying pydantic-ai
        # agent so retries ride on the existing ``max_retries`` budget. Skip
        # for test stubs (``agent`` injected) — they don't honour the
        # validator decorator anyway, and tests for the safety-net behaviour
        # exercise ``_restore_dropped_nodes`` directly.
        if agent is None and hasattr(self._agent, "output_validator"):
            self._agent.output_validator(_validate_no_dropped_nodes)

    async def _first_pass(
        self,
        graph: SemanticGraph,
        context: Optional[Dict[str, Any]],
    ) -> SemanticGraph:
        # Bind the input node ids for ``_validate_no_dropped_nodes`` and
        # reset its escalation counter for this call. Reset both on exit
        # so a later call with a different input doesn't see stale state.
        expected = frozenset(n.id for n in graph.nodes)
        ids_token = _current_input_node_ids.set(expected)
        count_token = _validator_escalation_count.set(0)
        try:
            result = await self.arun(_build_payload(graph, context))
        finally:
            _current_input_node_ids.reset(ids_token)
            _validator_escalation_count.reset(count_token)
        assert isinstance(result, SemanticGraph)
        return result

    async def _critique(
        self,
        context: Dict[str, Any],
        enriched: SemanticGraph,
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
        graph: SemanticGraph,
        context: Optional[Dict[str, Any]] = None,
    ) -> SemanticGraph:
        """Enrich a parser-produced ``SemanticGraph`` with descriptions,
        emoji, dimensions, etc. via Gemini. Returns the enriched graph as
        a typed model.

        Caller (FastAPI handler / CLI / tests) is responsible for the
        wire-format dict ↔ ``SemanticGraph`` conversion at its own
        boundary. Keeping this signature typed means every internal
        pass — the dropped-node validator, the merge helpers, the diff
        computation — operates on validated models throughout.
        """
        # Idempotency: if the input graph is already enriched (carries the
        # ``enrichment`` block), return it unchanged — both Gemini calls
        # (enrichment + critic) are skipped. The server does the same
        # short-circuit higher up; this keeps direct callers (CLI / scripts
        # / tests) consistent.
        if graph.enrichment is not None:
            print(f"[enrich] input already enriched — returning unchanged", flush=True)
            return graph

        input_model = graph

        def _log_done(stage: str, g: SemanticGraph) -> None:
            reason = _enrichment_reasoning(g)
            field_count = len(_diff_enriched_fields(input_model, g))
            tail = f"  reasoning={reason!r}" if reason else ""
            print(
                f"[enrich] {stage}  nodes={node_count} filled={field_count}{tail}",
                flush=True,
            )

        def _finalize(stage: str, candidate: SemanticGraph) -> SemanticGraph:
            """Log + stamp. Dropped-node retries happen *inside* pydantic-ai's
            loop via ``_validate_no_dropped_nodes``; ``_stamp_enriched``
            runs the safety-net merge passes (restore-dropped /
            drop-phantoms / restore-structural-fields) and attaches the
            ``enrichment`` block. The caller serializes for the cache /
            wire format.
            """
            _log_done(stage, candidate)
            return _stamp_enriched(input_model, candidate)

        node_count = len(input_model.nodes)
        enriched = await self._first_pass(input_model, context)
        if not context:
            return _finalize("first-pass ok ctx=n (no critique)", enriched)
        verdict = await self._critique(context, enriched)
        if verdict is None:
            return _finalize("first-pass ok critic=unavailable", enriched)
        if verdict.ok:
            return _finalize("first-pass ok critic=ok", enriched)
        if not verdict.feedback:
            print(
                f"[enrich] critic flagged {verdict.mismatched_node_ids!r} "
                f"but no feedback — keeping first pass",
                flush=True,
            )
            return _finalize("kept first pass", enriched)
        # If the first pass inferred a domain that the input graph didn't
        # carry, stamp that domain onto a shallow copy of the graph for the
        # retry — the graph is the source of truth for `domain`, and the
        # render path picks it up from there. Without it, the retry would
        # re-infer from prose alone and might land on the same wrong answer
        # the critic just rejected.
        retry_graph = input_model
        inferred_domain = _graph_domain(enriched)
        if inferred_domain and not _graph_domain(input_model):
            retry_graph = input_model.model_copy(update={"domain": inferred_domain})
            print(f"[enrich] using first-pass inferred domain={inferred_domain!r}", flush=True)
        retry_context = _context_with_feedback(context, verdict.feedback)
        print(
            f"[enrich] critic mismatch nodes={verdict.mismatched_node_ids!r} → retry  "
            f"feedback={verdict.feedback!r}",
            flush=True,
        )
        retried = await self._first_pass(retry_graph, retry_context)
        # Diff against the ORIGINAL input graph, not ``retry_graph`` — we
        # want the user-visible list of fields the agent actually filled,
        # which includes the domain it inferred on the first pass.
        return _finalize("retry ok", retried)

    def enrich(
        self,
        graph: SemanticGraph,
        context: Optional[Dict[str, Any]] = None,
    ) -> SemanticGraph:
        """Sync wrapper around :meth:`aenrich` for CLI / script / sync-test callers.

        Production goes through ``aenrich`` directly from the FastAPI handler.
        Don't call this from inside a running event loop — ``asyncio.run`` will
        raise. There's only one real implementation; this just bridges callers
        that can't ``await``.
        """
        return asyncio.run(self.aenrich(graph, context))
