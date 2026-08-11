"""``POST /api/expert/expression_analysis`` — function-analysis artifacts.

Two verbs:

``analyze`` (default) — two layers, separable by design (pedagogy
proposal §6.1):

1. **CAS characteristics** (always) — the behavior-feature catalog detected
   symbolically: zeros, extrema, singularities/vertical asymptotes,
   inflections, limits at infinity, periodicity, parity, domain, plus the
   evaluable ``chartScript`` and ``variables_latex``. Mechanical,
   killable-guarded, no LM.
2. **Pedagogical proposal** (unless ``propose`` is false) — the LM titles
   the analysis, proposes viewports (with companion plots and significance
   annotations, both as LaTeX the CAS converts to scripts), probes, and a
   variable glossary. LM failure degrades to ``proposal.abstain`` with the
   characteristics intact.

Response root: ``{id, title, characteristics, proposal}`` — ``id`` is the
caller's if supplied, else a slug of the title (collision-suffixed), so an
artifact is addressable wherever it's attached.

``more_probes`` — fresh quiz questions for an existing analysis: the
request carries the original ``characteristics`` JSON plus the questions
already ``asked``; response is ``{probes: [...]}``.

Every plot/annotation script is SymPy-generated server-side
(`latex_to_mathjs`) — LM-proposed *expressions* become CAS-generated
*code*; LM-written code never reaches a client.

This endpoint **writes nothing** — it returns a report for the client (or
the lesson-builder pipeline) to attach and persist as it sees fit.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.expression_analysis.features import analyze
from backend.experts.modules.expression_analysis.view_ranges import repair_view_ranges
from backend.experts.modules.expression_analysis.proposer import (
    propose_more_probes, propose_views,
)
from backend.experts.registry import register_handler
from backend.semantic_graph.id_utils import _slug_id
from backend.semantic_graph.mathjs_converter import latex_to_mathjs

log = logging.getLogger(__name__)

LOG_TAG = "[expr-analysis]"

_MAX_ASKED = 20          # questions carried for exclusion in more_probes


class ExpressionAnalysisRequest(BaseModel):
    """Request for ``POST /api/expert/expression_analysis``."""

    model_config = ConfigDict(extra="forbid")

    # "analyze" (default) or "more_probes".
    verb: str = Field(default="analyze", max_length=20)
    # Same ceiling as a semantic-graph node's ``subexpr`` (its usual source).
    latex: str = Field(min_length=1, max_length=600)
    # Sweep variable; inferred (x, t, … then alphabetical) when omitted.
    variable: Optional[str] = Field(default=None, max_length=40)
    # Lesson/step context steering the pedagogical ranking; optional.
    context: str = Field(default="", max_length=2000)
    # False = CAS characteristics only (no LM call). analyze verb only.
    propose: bool = True
    # Artifact id; generated from the title when omitted. analyze verb only.
    id: Optional[str] = Field(default=None, max_length=80)
    # more_probes verb: the original analysis' characteristics report and
    # the probe questions the learner has already seen.
    characteristics: Optional[dict] = None
    asked: list[str] = Field(default_factory=list)


@register_handler("expression_analysis", request_model=ExpressionAnalysisRequest)
def expression_analysis(req: ExpressionAnalysisRequest) -> dict:
    """Dispatch on verb: full analysis, or fresh probes for an existing one."""
    if req.verb == "more_probes":
        return _more_probes(req)
    if req.verb != "analyze":
        return {"error": f"unknown verb: {req.verb!r}"}
    return _analyze(req)


def _analyze(req: ExpressionAnalysisRequest) -> dict:
    characteristics = analyze(req.latex, req.variable)
    if characteristics.get("error"):
        log.info("%s parse failed for %r", LOG_TAG, req.latex[:120])
        # Still carries an id: the response root shape is a contract, and a
        # client attaching the failure to a step needs to address it.
        return {"id": req.id or _make_id(""), "title": "",
                "characteristics": characteristics, "proposal": None}

    log.info("%s analyzed %r (var=%s)%s", LOG_TAG, req.latex[:120],
             characteristics.get("variable"),
             "" if req.propose else " [CAS only]")

    if not req.propose:
        return {"id": req.id or _make_id(""), "title": "",
                "characteristics": characteristics, "proposal": None}

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
    _compile_view_extras(out, known)
    # The proposer picks each sweep against the report's numbers, which are all
    # computed with every parameter pinned to 1 — while the view renders at its
    # OWN pinned values. Reconcile the two before the range reaches a chart.
    repair_view_ranges(characteristics.get("expression") or req.latex,
                       out.get("views") or [])

    title = out.get("title") or ""
    return {"id": req.id or _make_id(title), "title": title,
            "characteristics": characteristics, "proposal": out}


def _more_probes(req: ExpressionAnalysisRequest) -> dict:
    """Fresh quiz questions, excluding the ones already asked."""
    chars = req.characteristics
    if not isinstance(chars, dict) or not chars.get("expression"):
        return {"error": "more_probes requires the original analysis' "
                         "characteristics"}
    asked = [str(q)[:400] for q in (req.asked or [])[:_MAX_ASKED]]
    log.info("%s more_probes for %r (%d asked)", LOG_TAG,
             str(chars.get("expression"))[:120], len(asked))
    probes = propose_more_probes(
        expression=str(chars.get("expression")),
        characteristics=json.dumps(chars, ensure_ascii=False),
        context=req.context,
        asked=asked,
    )
    return {"probes": [p.model_dump() for p in probes]}


def _make_id(title: str) -> str:
    """Artifact id: slug of the title + short suffix so repeats never collide."""
    slug = _slug_id(title.strip().lower().replace(" ", "_")) if title.strip() else "analysis"
    return f"{slug[:48]}-{uuid.uuid4().hex[:6]}"


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


def _compile_view_extras(proposal: dict, variables: list[str]) -> None:
    """Turn LM-proposed plot/annotation LaTeX into CAS-generated scripts.

    Each companion plot and each annotation position gets ``{script,
    variables}`` via ``latex_to_mathjs`` — the ONLY code path to the
    client. Entries whose LaTeX fails to convert, or whose scripts need
    symbols the CAS report doesn't know (the LM invented a quantity), are
    dropped and counted in ``dropped_plots`` / ``dropped_annotations`` on
    the view so a reviewing author can see the pruning.
    """
    known = set(variables)

    def compile_ok(latex: str):
        try:
            script, script_vars = latex_to_mathjs(latex)
        except Exception:
            return None
        if any(v not in known for v in script_vars):
            return None
        return {"script": script, "variables": script_vars}

    for view in proposal.get("views") or []:
        kept_plots = []
        dropped = 0
        for plot in view.get("plots") or []:
            compiled = compile_ok(plot.get("latex") or "")
            if compiled is None:
                dropped += 1
                continue
            kept_plots.append({**plot, **compiled})
        view["plots"] = kept_plots
        if dropped:
            view["dropped_plots"] = dropped

        kept_anns = []
        dropped = 0
        for ann in view.get("annotations") or []:
            kind = str(ann.get("kind") or "vline")
            at = compile_ok(ann.get("at") or "")
            if at is None or kind not in ("vline", "hline", "band"):
                dropped += 1
                continue
            entry = {**ann, "at": {**at, "latex": ann.get("at") or ""}}
            if kind == "band":
                to = compile_ok(ann.get("to") or "")
                if to is None:
                    dropped += 1
                    continue
                entry["to"] = {**to, "latex": ann.get("to") or ""}
            else:
                entry.pop("to", None)
            kept_anns.append(entry)
        view["annotations"] = kept_anns
        if dropped:
            view["dropped_annotations"] = dropped
