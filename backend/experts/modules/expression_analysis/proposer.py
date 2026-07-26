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
# Per-view ceilings for companion curves and significance markers — a chart
# with more than this is crowded past the point of teaching anything.
MAX_PLOTS = 3
MAX_ANNOTATIONS = 4


class RankedFeature(BaseModel):
    """One detected characteristic with its pedagogical assessment."""

    model_config = ConfigDict(extra="ignore")

    feature: str = Field(default="", max_length=200)
    usefulness: int = Field(default=0, ge=0, le=5)
    why: str = Field(default="", max_length=400)


class ProposedPlot(BaseModel):
    """A companion curve on a view (envelope, limiting form, …).

    ``latex`` is the AI's proposed expression; the HANDLER converts it to an
    evaluable mathjs ``script`` via SymPy — LM-written code never runs.
    """

    model_config = ConfigDict(extra="ignore")

    latex: str = Field(default="", max_length=400)
    label: str = Field(default="", max_length=120)


class ProposedAnnotation(BaseModel):
    """A significance marker on a view: limit, threshold, critical value.

    ``at`` (and ``to`` for bands) are LaTeX expressions — the handler
    converts them to evaluable scripts so markers stay slider-reactive.
    """

    model_config = ConfigDict(extra="ignore")

    kind: str = Field(default="vline", max_length=10)   # vline | hline | band
    at: str = Field(default="", max_length=200)
    to: str = Field(default="", max_length=200)         # band upper bound only
    label: str = Field(default="", max_length=120)
    group: str = Field(default="", max_length=60)


class ProposedView(BaseModel):
    """One viewport the AI proposes building."""

    model_config = ConfigDict(extra="ignore")

    kind: str = Field(default="plane-2d", max_length=40)
    x_var: str = Field(default="", max_length=40)
    x_range: list[float] = Field(default_factory=list)
    pinned: dict[str, float] = Field(default_factory=dict)
    mark: list[str] = Field(default_factory=list)
    rationale: str = Field(default="", max_length=500)
    plots: list[ProposedPlot] = Field(default_factory=list)
    annotations: list[ProposedAnnotation] = Field(default_factory=list)


class ProposedProbe(BaseModel):
    """One predict-before-reveal question grounded in a detected feature."""

    model_config = ConfigDict(extra="ignore")

    question: str = Field(default="", max_length=400)
    options: list[str] = Field(default_factory=list)
    correct_index: int = Field(default=0, ge=0)
    explanation: str = Field(default="", max_length=600)
    feature: str = Field(default="", max_length=200)


def _usable_probes(probes: list["ProposedProbe"]) -> list["ProposedProbe"]:
    """Keep only probes a learner can actually answer.

    The signature *asks* the model to verify ``correct_index`` against the
    CAS report, but asking is not enforcing: an out-of-range index marks
    no option correct and makes the post-answer message tell the tutor
    "the correct answer is ''", and a probe with fewer than two options is
    not a question. Drop those rather than render broken quizzes.
    """
    out = []
    for p in probes:
        n = len(p.options)
        if 2 <= n <= 4 and 0 <= p.correct_index < n:
            out.append(p)
    return out


class VizProposal(BaseModel):
    """The AI's full pedagogical proposal for one analyzed expression."""

    model_config = ConfigDict(extra="ignore")

    abstain: bool = False
    # True when the LM call itself failed. `abstain` alone cannot say so,
    # and telling a learner "nothing interesting here" because a request
    # errored is a lie the UI must be able to avoid.
    failed: bool = False
    # Why the AI declined, in the learner's language. An abstention with
    # no reason is a shrug; this is what the page shows instead.
    abstain_reason: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=120)
    story: str = Field(default="", max_length=500)
    ranked: list[RankedFeature] = Field(default_factory=list)
    views: list[ProposedView] = Field(default_factory=list)
    probes: list[ProposedProbe] = Field(default_factory=list)
    # Variable name → one-line contextual description, for hover tooltips
    # wherever the symbol appears (sliders, axes, pins). AI-written; the
    # mechanical LaTeX forms live in characteristics.variables_latex.
    variable_glossary: dict[str, str] = Field(default_factory=dict)


class VizProposalSig(dspy.Signature):
    r"""Evaluate an expression's CAS-detected behavior features pedagogically
    and propose interactive visualizations for learners.

    You are a mathematics-pedagogy expert designing apparatus for an
    interactive lesson. A computer algebra system has already analyzed the
    expression and detected its behavioral features (zeros, extrema,
    singularities, asymptotes, end behavior, periodicity, parity). Your
    job is judgment, not computation:

    1. TITLE the analysis (`title`): a short human name for this page,
       e.g. "Projectile Height vs Time".
    2. RANK the detected features by pedagogical usefulness (5 = the one
       insight a learner must not miss; 1 = true but unremarkable). A
       singularity where a real quantity blows up usually outranks a
       generic zero; a symbolic location like $t = v_0/g$ that *explains
       itself* outranks an anonymous numeric root.
    3. PROPOSE 1–3 viewports (`views`). Pick x-ranges so the interesting
       features sit INSIDE the default sweep — the learner should stumble
       into them (implicit scaffolding), not hunt. RESPECT the physical
       domain the context implies: a variable that cannot meaningfully be
       negative there (time since launch, mass, volume, a distance)
       starts its range at that physical bound (usually 0) — include the
       negative side only when it genuinely means something (a symmetric
       mathematical function, a signed velocity). Pin non-swept symbols
       to representative values. `mark` lists which detected features the
       viewport should annotate. EACH ADDITIONAL VIEW MUST REVEAL A
       DIFFERENT marked feature or qualitative regime than the previous
       ones — a rescaled duplicate of view 1 (same shape, different axis
       numbers) is worse than proposing no second view at all.
       Per view you may also add:
       - `plots`: 0–3 companion curves as LaTeX expressions with labels
         (an envelope $e^{-bt}$, a limiting form, a linear approximation).
         The analyzed expression itself is ALWAYS drawn — never restate
         it. Add a companion only when seeing both curves together
         teaches something a single curve cannot.
       - `annotations`: 0–4 significance markers — {kind: vline|hline|
         band, at: <LaTeX position>, to: <LaTeX, band upper bound only>,
         label, group}. Use them SPARINGLY, only where a limit,
         threshold, or critical value carries real pedagogical weight;
         give related markers the same `group` label so the UI can
         toggle them together; never duplicate what `mark` already
         annotates (detected zeros/extrema/asymptotes draw themselves).
    4. WRITE 1–4 predict-before-reveal probes (`probes`): short questions
       a learner answers BEFORE seeing the curve, each grounded in one
       detected feature, with 2–4 options, the correct index, and a one-
       line explanation tied to the expression's structure. VERIFY each
       `correct_index` against the CAS report before returning: the
       explanation must follow from the expression EXACTLY as given —
       watch signs and coefficients; never reason about a term the
       expression does not contain. A quiz that marks a right answer
       wrong is worse than no quiz.
    5. GLOSS every variable (`variable_glossary`): for EACH name in the
       report's `variables` list, one plain-language line saying what the
       quantity is in this context, with typical units when meaningful —
       e.g. "g": "gravitational acceleration (~9.8 m/s² on Earth)". Keys
       must be the report's variable names verbatim.
    6. ABSTAIN (set `abstain` true, everything else empty) when there is
       nothing behaviorally interesting to visualize — e.g. a bare
       constant or a purely notational identity. Always say WHY in
       `abstain_reason`: one plain sentence naming what this expression
       is and why plotting it teaches nothing ("This is a definition of
       notation — it has no independent variable to vary"). The learner
       asked a reasonable question and deserves an answer, not silence.

    Ground rules: reference ONLY features present in the CAS report —
    never invent locations or values. Keep prose in the learner's
    language; write EVERY mathematical symbol, variable, and expression
    in $…$ delimiters ($v_0$, $t^2$, $a$) — never in quotes ('a') or
    bare — in stories, rationales, probe questions, options, and
    explanations alike, so the UI can render them. If lesson context is
    given, prefer the features that matter for THAT step (a re-entry
    lesson cares about the blow-up, not the inflection).
    """

    expression: str = dspy.InputField(desc="the expression, LaTeX")
    characteristics: str = dspy.InputField(
        desc="JSON report of CAS-detected behavior features")
    context: str = dspy.InputField(
        desc="lesson/step context the expression appears in; may be empty")

    abstain: bool = dspy.OutputField(
        desc="true only if nothing here is worth visualizing")
    abstain_reason: str = dspy.OutputField(
        desc="when abstaining, ONE plain sentence saying what this "
             "expression is and why a plot would teach nothing; empty "
             "otherwise")
    title: str = dspy.OutputField(
        desc="short human title for this analysis page, e.g. 'Projectile "
             "Height vs Time'; plain text, no LaTeX")
    story: str = dspy.OutputField(
        desc="ONE sentence telling the expression's behavioral story in "
             "plain language, e.g. 'A steady rise fighting an accelerating "
             "fall — the fall always wins.'")
    ranked: list[dict] = dspy.OutputField(
        desc="[{feature, usefulness, why}] every notable detected feature, "
             "most pedagogically useful first; usefulness is 1-5")
    views: list[dict] = dspy.OutputField(
        desc="[{kind, x_var, x_range:[min,max], pinned:{symbol:value}, "
             "mark:[feature names], rationale, "
             "plots:[{latex, label}] (0-3 companion curves), "
             "annotations:[{kind: vline|hline|band, at, to, label, group}] "
             "(0-4 significance markers, positions as LaTeX)}] "
             "1-3 proposed viewports, each revealing something the others "
             "don't; kind is one of plane-2d | surface-3d | limiting-behavior. "
             "x_var and every pinned key MUST be names from the report's "
             "`variables` list, verbatim — no LaTeX, no renaming")
    probes: list[dict] = dspy.OutputField(
        desc="[{question, options, correct_index, explanation, feature}] "
             "1-4 predict-before-reveal questions grounded in detected "
             "features; empty if abstaining")
    variable_glossary: dict = dspy.OutputField(
        desc="{variable name: one-line contextual description with typical "
             "units}. One entry for EVERY name in the report's `variables` "
             "list, keys verbatim; empty if abstaining")


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

    glossary = {}
    if isinstance(getattr(out, "variable_glossary", None), dict):
        for k, v in out.variable_glossary.items():
            if isinstance(k, str) and isinstance(v, str) and v.strip():
                glossary[k] = v.strip()[:300]

    views = shape(ProposedView, out.views, MAX_VIEWS)
    for v in views:                       # per-view crowding ceilings
        v.plots = v.plots[:MAX_PLOTS]
        v.annotations = v.annotations[:MAX_ANNOTATIONS]

    return VizProposal(
        abstain=bool(out.abstain),
        abstain_reason=str(getattr(out, "abstain_reason", "") or "").strip(),
        title=str(getattr(out, "title", "") or "").strip(),
        story=str(out.story or "").strip(),
        ranked=shape(RankedFeature, out.ranked, MAX_RANKED),
        views=views,
        probes=_usable_probes(shape(ProposedProbe, out.probes, MAX_PROBES)),
        variable_glossary=glossary,
    )


class MoreProbesSig(dspy.Signature):
    r"""Write FRESH predict-before-reveal quiz questions for an expression
    whose behavior features a computer algebra system has already detected.

    The learner has answered the questions listed in `asked` and wants
    more. Write 1–4 NEW probes grounded in the detected characteristics —
    each with 2–4 options, the correct index, and a one-line explanation
    tied to the expression's structure. Ground rules: reference ONLY
    features present in the CAS report — never invent locations or
    values; VERIFY each `correct_index` against the report before
    returning (watch signs and coefficients — never reason about a term
    the expression does not contain); do NOT repeat or trivially
    rephrase anything in `asked` (approach untested features, or the
    same feature from a genuinely different angle, e.g. scaling behavior
    instead of location); keep prose in the learner's language and write
    EVERY mathematical symbol and expression in $…$ delimiters ($v_0$,
    $t^2$) — never in quotes or bare.
    """

    expression: str = dspy.InputField(desc="the expression, LaTeX")
    characteristics: str = dspy.InputField(
        desc="JSON report of CAS-detected behavior features")
    context: str = dspy.InputField(
        desc="lesson/step context the expression appears in; may be empty")
    asked: str = dspy.InputField(
        desc="questions the learner has already been asked, one per line")

    probes: list[dict] = dspy.OutputField(
        desc="[{question, options, correct_index, explanation, feature}] "
             "1-4 NEW predict-before-reveal questions; none may repeat or "
             "rephrase an `asked` question")


class MoreProbesGenerator(dspy.Module):
    """Single ``Predict`` over :class:`MoreProbesSig` (same no-thinking LM)."""

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(MoreProbesSig)

    def forward(self, *, expression: str, characteristics: str,
                context: str = "", asked: str = ""):
        return self.predict(expression=expression,
                            characteristics=characteristics,
                            context=context, asked=asked)


@cache
def _more_probes() -> MoreProbesGenerator:
    return MoreProbesGenerator()


def propose_more_probes(expression: str, characteristics: str,
                        context: str = "",
                        asked: Optional[list[str]] = None) -> list[ProposedProbe]:
    """Ask the LM for fresh probes; empty list on any failure."""
    try:
        lm = _proposer_lm()
        kwargs = dict(expression=expression, characteristics=characteristics,
                      context=context, asked="\n".join(asked or []))
        if lm is not None:
            with dspy.context(lm=lm):
                out = _more_probes()(**kwargs)
        else:
            out = _more_probes()(**kwargs)
    except Exception:
        return []

    shaped = []
    for raw in (out.probes or [])[:MAX_PROBES]:
        if isinstance(raw, dict):
            try:
                shaped.append(ProposedProbe(**raw))
            except Exception:
                continue
    return _usable_probes(shaped)


__all__ = [
    "MAX_ANNOTATIONS", "MAX_PLOTS", "MAX_PROBES", "MAX_RANKED", "MAX_VIEWS",
    "MoreProbesGenerator", "MoreProbesSig", "ProposedAnnotation",
    "ProposedPlot", "ProposedProbe", "ProposedView", "RankedFeature",
    "VizProposal", "VizProposalSig", "VizProposer", "propose_more_probes",
    "propose_views",
]
