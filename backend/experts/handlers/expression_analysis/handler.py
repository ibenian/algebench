"""``POST /api/expert/expression_analysis`` — characteristics + viz proposal.

Two layers, separable by design (pedagogy proposal §6.1):

1. **CAS characteristics** (always) — the behavior-feature catalog detected
   symbolically: zeros, extrema, singularities/vertical asymptotes,
   inflections, end behavior, periodicity, parity, domain. Mechanical,
   killable-guarded, no LM.
2. **Pedagogical proposal** (unless ``propose`` is false) — the LM ranks
   the detected features by usefulness and proposes viewports + predict-
   before-reveal probes. LM failure degrades to ``proposal.abstain`` with
   the characteristics intact, so the endpoint is useful even with no LM
   configured.

This endpoint **writes nothing** — it returns a report for an authoring
tool (or the lesson-builder pipeline) to review and persist.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.expression_analysis.features import analyze
from backend.experts.modules.expression_analysis.proposer import propose_views
from backend.experts.registry import register_handler

log = logging.getLogger(__name__)

LOG_TAG = "[expr-analysis]"


class ExpressionAnalysisRequest(BaseModel):
    """Request for ``POST /api/expert/expression_analysis``."""

    model_config = ConfigDict(extra="forbid")

    # Same ceiling as a semantic-graph node's ``subexpr`` (its usual source).
    latex: str = Field(min_length=1, max_length=600)
    # Sweep variable; inferred (x, t, … then alphabetical) when omitted.
    variable: Optional[str] = Field(default=None, max_length=40)
    # Lesson/step context steering the pedagogical ranking; optional.
    context: str = Field(default="", max_length=2000)
    # False = CAS characteristics only (no LM call).
    propose: bool = True


@register_handler("expression_analysis", request_model=ExpressionAnalysisRequest)
def expression_analysis(req: ExpressionAnalysisRequest) -> dict:
    """Detect an expression's behavior features; optionally propose apparatus."""
    characteristics = analyze(req.latex, req.variable)
    if characteristics.get("error"):
        log.info("%s parse failed for %r", LOG_TAG, req.latex[:120])
        return {"characteristics": characteristics, "proposal": None}

    log.info("%s analyzed %r (var=%s)%s", LOG_TAG, req.latex[:120],
             characteristics.get("variable"),
             "" if req.propose else " [CAS only]")

    if not req.propose:
        return {"characteristics": characteristics, "proposal": None}

    proposal = propose_views(
        expression=characteristics.get("expression") or req.latex,
        characteristics=json.dumps(characteristics, ensure_ascii=False),
        context=req.context,
    )
    out = proposal.model_dump()
    known = characteristics.get("variables") or []
    _flag_unknown_symbols(out, known)
    # Glossary entries for names the CAS report doesn't know are dropped
    # outright — a tooltip on a nonexistent symbol can never render.
    out["variable_glossary"] = {
        k: v for k, v in (out.get("variable_glossary") or {}).items()
        if k in set(known)
    }
    return {"characteristics": characteristics, "proposal": out}


def _flag_unknown_symbols(proposal: dict, variables: list[str]) -> None:
    """Mark view symbols the CAS report doesn't know (LM never gets the last word).

    The proposer is instructed to use the report's variable names verbatim,
    but it can still emit display-form names — notably when the parser has
    fractured a compound symbol (``\\Delta t`` parses as ``Delta·t``, so no
    single report variable *can* name it). Consumers must not silently bind
    such a view, so flag it instead of dropping it: the rationale text is
    still useful to a reviewing author.
    """
    known = set(variables)
    for view in proposal.get("views") or []:
        unknown = [s for s in [view.get("x_var"), *(view.get("pinned") or {})]
                   if s and s not in known]
        if unknown:
            view["unknown_symbols"] = unknown
