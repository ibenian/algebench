"""Semantic graph enrichment agent.

Takes a structural semantic graph (produced by `scripts/latex_to_graph.py`) and
returns the same graph with descriptions, emojis, colors, and corrected
role/dimension/unit/quantity fields. Ids and edges are preserved verbatim.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from .base import BaseAgent
from models import SemanticGraph


_SYSTEM_PROMPT = """\
You enrich a semantic graph that represents a math/physics expression.

The user message has two parts wrapped in JSON:
- `context`: optional lesson/scene/step metadata (title, goal, math LaTeX,
  justification, explanation). Use this to disambiguate symbols — e.g. in a
  rocket-thrust step, `T` is thrust, not temperature.
- `graph`: a JSON object with `nodes`, `edges`, and optionally `domain` and
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
4. Correct obviously wrong `role`, `dimension`, `unit`, `quantity`, and `value`
   when the symbol's identity is unambiguous in the given context. Only fill or
   change these — never invent values for unknown symbols.
5. Preserve every node `id` exactly. Preserve `edges` verbatim. Preserve
   `classification` and `domain` verbatim.
6. Do NOT add new nodes or remove existing nodes. Do NOT include any prose,
   commentary, or fields outside the schema.

Return a JSON object matching the SemanticGraph schema (the enriched `graph`
only — do not echo back the `context`). Keep all string fields short and free
of HTML brackets. Colors must be #RRGGBB hex.
"""


def _build_payload(graph: Dict[str, Any], context: Optional[Dict[str, Any]]) -> str:
    payload: Dict[str, Any] = {"graph": graph}
    if context:
        payload["context"] = context
    return json.dumps(payload, sort_keys=True)


class SemanticGraphEnrichmentAgent(BaseAgent):
    name = "semantic_graph_enricher"
    system_prompt = _SYSTEM_PROMPT
    result_type = SemanticGraph
    max_retries = 2

    def enrich(
        self,
        graph: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.run(_build_payload(graph, context))
        assert isinstance(result, SemanticGraph)
        return result.model_dump(by_alias=True, exclude_none=True)

    async def aenrich(
        self,
        graph: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = await self.arun(_build_payload(graph, context))
        assert isinstance(result, SemanticGraph)
        return result.model_dump(by_alias=True, exclude_none=True)
