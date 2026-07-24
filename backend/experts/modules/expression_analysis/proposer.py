"""Pedagogical evaluation of CAS-detected features → visualization proposal.

The division of labor from the pedagogy proposal §6.1: the CAS
(``features.py``) detects *instances* mechanically; this module is the AI
layer that decides which of them are pedagogically load-bearing and
proposes the apparatus — viewports to build, features to mark, and
predict-before-reveal probes — for a human author (or the lesson-builder
pipeline) to review. It never invents mathematics: every feature it ranks
or marks must come from the CAS report it was given, and every probe's
correct answer is stated so a caller can numerically check it.

Follows the ``proof_edit.intent`` pattern: a plain lazy DSPy module (no
``@register_expert``), called directly by the handler, fully
caller-isolated — any LM failure degrades to an "abstain" proposal so the
CAS characteristics still reach the client.
"""
from __future__ import annotations

import os
from functools import cache
from typing import Optional

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import LM_MODEL

# Ceilings mirroring MAX_GLUE_STEPS's philosophy: a proposal that needs
# more than this isn't a proposal, it's an unreviewable dump.
MAX_VIEWS = 3
MAX_PROBES = 4
MAX_RANKED = 10


class RankedFeature(BaseModel):
    """One detected characteristic with its pedagogical assessment."""

    model_config = ConfigDict(extra="ignore")

    feature: str = Field(default="", max_length=200)
    usefulness: int = Field(default=0, ge=0, le=5)
    why: str = Field(default="", max_length=400)


class ProposedView(BaseModel):
    """One viewport the AI proposes building."""

    model_config = ConfigDict(extra="ignore")

    kind: str = Field(default="plane-2d", max_length=40)
    x_var: str = Field(default="", max_length=40)
    x_range: list[float] = Field(default_factory=list)
    pinned: dict[str, float] = Field(default_factory=dict)
    mark: list[str] = Field(default_factory=list)
    rationale: str = Field(default="", max_length=500)


class ProposedProbe(BaseModel):
    """One predict-before-reveal question grounded in a detected feature."""

    model_config = ConfigDict(extra="ignore")

    question: str = Field(default="", max_length=400)
    options: list[str] = Field(default_factory=list)
    correct_index: int = Field(default=0, ge=0)
    explanation: str = Field(default="", max_length=600)
    feature: str = Field(default="", max_length=200)


class VizProposal(BaseModel):
    """The AI's full pedagogical proposal for one analyzed expression."""

    model_config = ConfigDict(extra="ignore")

    abstain: bool = False
    story: str = Field(default="", max_length=500)
    ranked: list[RankedFeature] = Field(default_factory=list)
    views: list[ProposedView] = Field(default_factory=list)
    probes: list[ProposedProbe] = Field(default_factory=list)


class VizProposalSig(dspy.Signature):
    r"""Evaluate an expression's CAS-detected behavior features pedagogically
    and propose interactive visualizations for learners.

    You are a mathematics-pedagogy expert designing apparatus for an
    interactive lesson. A computer algebra system has already analyzed the
    expression and detected its behavioral features (zeros, extrema,
    singularities, asymptotes, end behavior, periodicity, parity). Your
    job is judgment, not computation:

    1. RANK the detected features by pedagogical usefulness (5 = the one
       insight a learner must not miss; 1 = true but unremarkable). A
       singularity where a real quantity blows up usually outranks a
       generic zero; a symbolic location like $t = v_0/g$ that *explains
       itself* outranks an anonymous numeric root.
    2. PROPOSE 1–3 viewports (`views`). Pick x-ranges so the interesting
       features sit INSIDE the default sweep — the learner should stumble
       into them (implicit scaffolding), not hunt. Pin non-swept symbols
       to representative values. `mark` lists which detected features the
       viewport should annotate.
    3. WRITE 1–4 predict-before-reveal probes (`probes`): short questions
       a learner answers BEFORE seeing the curve, each grounded in one
       detected feature, with 2–4 options, the correct index, and a one-
       line explanation tied to the expression's structure.
    4. ABSTAIN (set `abstain` true, everything else empty) when there is
       nothing behaviorally interesting to visualize — e.g. a bare
       constant or a purely notational identity.

    Ground rules: reference ONLY features present in the CAS report —
    never invent locations or values. Keep prose in the learner's
    language; wrap math in $…$. If lesson context is given, prefer the
    features that matter for THAT step (a re-entry lesson cares about the
    blow-up, not the inflection).
    """

    expression: str = dspy.InputField(desc="the expression, LaTeX")
    characteristics: str = dspy.InputField(
        desc="JSON report of CAS-detected behavior features")
    context: str = dspy.InputField(
        desc="lesson/step context the expression appears in; may be empty")

    abstain: bool = dspy.OutputField(
        desc="true only if nothing here is worth visualizing")
    story: str = dspy.OutputField(
        desc="ONE sentence telling the expression's behavioral story in "
             "plain language, e.g. 'A steady rise fighting an accelerating "
             "fall — the fall always wins.'")
    ranked: list[dict] = dspy.OutputField(
        desc="[{feature, usefulness, why}] every notable detected feature, "
             "most pedagogically useful first; usefulness is 1-5")
    views: list[dict] = dspy.OutputField(
        desc="[{kind, x_var, x_range:[min,max], pinned:{symbol:value}, "
             "mark:[feature names], rationale}] 1-3 proposed viewports; "
             "kind is one of plane-2d | surface-3d | limiting-behavior. "
             "x_var and every pinned key MUST be names from the report's "
             "`variables` list, verbatim — no LaTeX, no renaming")
    probes: list[dict] = dspy.OutputField(
        desc="[{question, options, correct_index, explanation, feature}] "
             "1-4 predict-before-reveal questions grounded in detected "
             "features; empty if abstaining")


class VizProposer(dspy.Module):
    """Single ``Predict`` over :class:`VizProposalSig`.

    Bare ``Predict``, not ``ChainOfThought``: the configured Gemini 2.5
    models already reason internally (thinking tokens), so an explicit
    reasoning output field roughly doubles the serial generation for no
    measured quality gain — the LM call dominates this endpoint's latency.
    Still a ``Module`` so it keeps a first-class optimizable home.
    """

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(VizProposalSig)

    def forward(self, *, expression: str, characteristics: str, context: str = ""):
        return self.predict(expression=expression,
                            characteristics=characteristics,
                            context=context)


# Lazily built on first use — imported before ``configure_dspy()`` runs.
@cache
def _proposer() -> VizProposer:
    return VizProposer()


# Measured A/B (2026-07, gemini-2.5-flash, 10 scenarios from projectile to
# relativistic gamma and a removable-singularity spectrum): disabling the
# model's internal thinking runs ~3.7s/call vs ~11s ("low") and 6–27s
# (default), with quality equal or better — full thinking showed WORSE
# contract adherence (duplicate rank entries, top-ranked features left
# unmarked) while no-thinking correctly demoted the removable singularity
# and produced dual-scale views. The CAS report carries the hard reasoning,
# so the proposal is mostly structured selection. Scoped HERE (not in
# llm_config) so every other expert keeps full reasoning. Override with
# ALGEBENCH_PROPOSER_REASONING; set it to "default" to fall back to the
# globally configured LM untouched.
_REASONING_ENV = "ALGEBENCH_PROPOSER_REASONING"


@cache
def _proposer_lm() -> Optional[dspy.LM]:
    effort = os.environ.get(_REASONING_ENV, "disable")
    if effort == "default":
        return None                    # use the globally configured LM
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    try:
        return dspy.LM(LM_MODEL, api_key=api_key, temperature=0.7,
                       max_tokens=32768, reasoning_effort=effort)
    except Exception:
        return None


def propose_views(expression: str, characteristics: str,
                  context: str = "") -> VizProposal:
    """Ask the LM for a pedagogical proposal; abstain on any failure."""
    try:
        lm = _proposer_lm()
        if lm is not None:
            with dspy.context(lm=lm):
                out = _proposer()(expression=expression,
                                  characteristics=characteristics,
                                  context=context)
        else:
            out = _proposer()(expression=expression,
                              characteristics=characteristics,
                              context=context)
    except Exception:
        return VizProposal(abstain=True)

    def shape(model, raws, limit):
        shaped = []
        for raw in (raws or [])[:limit]:
            if isinstance(raw, dict):
                try:
                    shaped.append(model(**raw))
                except Exception:
                    continue
        return shaped

    return VizProposal(
        abstain=bool(out.abstain),
        story=str(out.story or "").strip(),
        ranked=shape(RankedFeature, out.ranked, MAX_RANKED),
        views=shape(ProposedView, out.views, MAX_VIEWS),
        probes=shape(ProposedProbe, out.probes, MAX_PROBES),
    )


__all__ = [
    "MAX_PROBES", "MAX_RANKED", "MAX_VIEWS", "ProposedProbe", "ProposedView",
    "RankedFeature", "VizProposal", "VizProposalSig", "VizProposer",
    "propose_views",
]
