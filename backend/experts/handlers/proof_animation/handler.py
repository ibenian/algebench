"""``proof_animation`` handler — derive a docked proof animation on the fly.

Wraps the ``proof_completion`` expert with the pre/post-processing the live app
needs (see ``../README.md``):

* **pre** — the client sends the clicked node's expression as ``target_latex``
  plus the proof's givens/goal; the START is either supplied (a proof's
  ``given`` step) or inferred from a prompt via :func:`endpoints_from_prompt`.
* **call** — run ``proof_completion`` through ``service.invoke`` (never by
  instantiating the expert directly).
* **post** — render the returned ``ProofTrajectory`` into FLIP animation data
  via :func:`build`.

Exposed at ``POST /api/expert/proof_animation``. Requires DSPy configured
(handled by the endpoint's ``_ensure_experts``).
"""

from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.context_id import build as build_context_id
from backend.experts.llm_config import is_configured
from backend.experts.modules.proof_completion.domain_rescue import RESCUE_ENABLED
from backend.experts.modules.proof_completion.judge import DomainStepJudge
from backend.experts.registry import register_handler
from backend.experts.service import invoke
from backend.semantic_graph.preprocessor import strip_math_delimiters
from backend.semantic_graph.service import SemanticGraphService

from .animation import build
from .prompt_endpoints import endpoints_from_prompt

log = logging.getLogger(__name__)

# One shared domain-step judge (issue #385), built lazily the first time an LM is
# configured. It rescues CAS-uncheckable steps into the DOMAIN tier at build time.
_DOMAIN_JUDGE: Optional[DomainStepJudge] = None


def _domain_judge() -> Optional[DomainStepJudge]:
    """The shared :class:`DomainStepJudge`, or None when the rescue is disabled.

    None (→ no rescue) when either the master flag ``ALGEBENCH_DOMAIN_RESCUE`` is
    off or no LM is configured. Returning None makes ``rescue_uncheckable`` a
    no-op, so confidence stays pure-CAS.
    """
    global _DOMAIN_JUDGE
    if not RESCUE_ENABLED or not is_configured():
        return None
    if _DOMAIN_JUDGE is None:
        _DOMAIN_JUDGE = DomainStepJudge()
    return _DOMAIN_JUDGE


class Given(BaseModel):
    """One proof given — its LaTeX plus an optional human label."""

    model_config = ConfigDict(extra="ignore")
    math: str
    label: Optional[str] = None


class PriorStep(BaseModel):
    """One earlier proof step in the lead-up to the target — its LaTeX, an
    optional 1-based step number, and an optional human label."""

    model_config = ConfigDict(extra="ignore")
    math: str
    step: Optional[int] = None
    label: Optional[str] = None


class DeriveProofRequest(BaseModel):
    """Request for ``POST /api/expert/proof_animation``."""

    model_config = ConfigDict(extra="forbid")

    target_latex: str = Field(min_length=1)
    domain: Optional[str] = None
    givens: list[Given] = Field(default_factory=list)
    # The proof goal, as authored for DISPLAY — may carry $…$/$$…$$ math-mode
    # delimiters (the proof card sends `proofGoal` verbatim). It is context, not
    # a parsed expression; `_givens_clause` strips the delimiters before folding
    # it into the start-inference prompt so the LM isn't nudged to echo them.
    goal: Optional[str] = None
    # A human-readable name for the derivation (e.g. the proof title). Used as
    # the animation title; falls back to the LM/goal/"Derivation".
    title: Optional[str] = None
    # Lesson/scene/proof context (same shape the enrichment endpoint receives) —
    # threaded to the expert's `lesson_context` so it derives in context.
    context: Optional[dict] = None
    # The proof's `given` step when available — skips start inference.
    start_latex: Optional[str] = None
    intent: Optional[str] = None
    # The proof steps leading up to the target (a proof-card "Derive" sends the
    # full lead-up: `proof.steps[:index]`). Threaded into `lesson_context` so the
    # expert derives with the prior steps in view.
    previous_steps: list[PriorStep] = Field(default_factory=list)


def _format_lesson_context(ctx: Optional[dict]) -> str:
    """Flatten the lesson/scene/proof context dict into the expert's
    ``lesson_context`` string (same fields the enrichment endpoint sends)."""
    if not ctx:
        return ""
    fields = [
        ("lessonTitle", "Lesson"),
        ("lessonDescription", None),
        ("sceneTitle", "Scene"),
        ("sceneDescription", None),
        ("proofTitle", "Proof"),
        ("proofGoal", "Goal"),
        ("proofTechnique", "Technique"),
    ]
    lines = []
    for key, label in fields:
        val = ctx.get(key)
        if not isinstance(val, str) or not val.strip():
            continue
        val = val.strip()
        lines.append(f"{label}: {val}" if label else val)
    return "\n".join(lines)


# Cap on how many prior steps we render into the context, and the per-step text,
# so a long proof can't bloat the expert's `lesson_context` unboundedly.
_PRIOR_STEPS_MAX = 20


def _format_prior_steps(steps: list[PriorStep]) -> str:
    """Render the lead-up steps as a compact, ordered block for `lesson_context`."""
    usable = [s for s in steps if s.math and s.math.strip()]
    if not usable:
        return ""
    if len(usable) > _PRIOR_STEPS_MAX:
        usable = usable[-_PRIOR_STEPS_MAX:]
    lines = ["Prior steps:"]
    for s in usable:
        num = f"{s.step}. " if s.step is not None else "- "
        label = f" ({s.label.strip()})" if s.label and s.label.strip() else ""
        lines.append(f"{num}${s.math.strip()}${label}")
    return "\n".join(lines)


# GraphTransition.intent is capped at 400 chars; keep the givens clause well
# under that so the assembled intent always validates (some scenes carry many
# givens). Real proofs have a handful; this just bounds pathological cases.
_GIVENS_CLAUSE_MAX = 240
_INTENT_MAX = 400
# Retries when the (stochastic) expert returns an empty trajectory for an
# otherwise-derivable pair. Total attempts, not extra retries.
_DERIVE_ATTEMPTS = 2


def _givens_clause(req: DeriveProofRequest) -> str:
    """A short 'given …' clause from the goal + given expressions (may be empty).

    Bounded to `_GIVENS_CLAUSE_MAX` chars so the assembled intent stays valid.
    """
    # Strip any $…$/$$…$$ delimiters the goal/givens were authored with: this
    # clause is fed to the start-inference LM, and leaving the delimiters in
    # nudges it to echo them in `start_latex` (which then fails to parse).
    parts: list[str] = []
    if req.goal:
        parts.append(strip_math_delimiters(req.goal))
    parts.extend(strip_math_delimiters(g.math) for g in req.givens if g.math.strip())
    clause = "; ".join(p for p in parts if p)
    if len(clause) > _GIVENS_CLAUSE_MAX:
        clause = clause[:_GIVENS_CLAUSE_MAX].rstrip(" ;,") + "…"
    return clause


def _prior_steps_clause(req: DeriveProofRequest) -> str:
    """The most recent prior-step expressions, bounded — so an INFERRED start
    follows on from the lead-up rather than being guessed from the target alone."""
    parts = [s.math.strip() for s in req.previous_steps if s.math and s.math.strip()]
    if not parts:
        return ""
    clause = "; ".join(parts)
    if len(clause) > _GIVENS_CLAUSE_MAX:
        clause = "…" + clause[-_GIVENS_CLAUSE_MAX:].lstrip(" ;,")   # keep the most recent (tail)
    return clause


# This handler powers a step-by-step LEARNING animation, so for an ADJACENT
# transition we explicitly ask the expert for the finest pedagogically-useful
# breakdown (the signature already prefers small steps; this reinforces it).
# Applied ONLY when deriving from the immediately-previous step (see
# ``_derives_from_previous_step``): that start→target span is a single logical
# move, so micro-stepping it is bounded and useful. For a from-given/goal or
# inferred start the span can be many steps, where micro-stepping explodes the
# derivation length — so the directive is withheld there.
_MICROSTEP_DIRECTIVE = (
    " — show every intermediate micro-step a learner needs to follow this, "
    "preferring many small, clearly-justified moves over one big jump"
)


def _derives_from_previous_step(req: DeriveProofRequest) -> bool:
    """True when the supplied start IS the immediately-preceding proof step.

    A per-step proof-card "Derive" anchors the start on the previous step
    (issue #382), making start→target a single adjacent transition. That is the
    only case where the micro-step directive is appropriate; other starts
    (given / goal / inferred) can span many steps.
    """
    start = (req.start_latex or "").strip()
    if not start or not req.previous_steps:
        return False
    last = (req.previous_steps[-1].math or "").strip()
    def _norm(s):                        # whitespace-insensitive compare
        return "".join(s.split())
    return bool(last) and _norm(start) == _norm(last)


@register_handler("proof_animation", request_model=DeriveProofRequest)
def derive_proof_animation(req: DeriveProofRequest) -> dict:
    """Infer the start (if needed), run ``proof_completion``, render animation data."""
    givens = _givens_clause(req)

    # --- pre: resolve the START (and display captions) --------------------------
    given_label = ""
    start_note = ""
    lm_domain = lm_title = ""
    start = (req.start_latex or "").strip()
    if not start:
        prompt = f"Derive this expression: {req.target_latex}"
        if givens:
            prompt += f" given {givens}"
        prior = _prior_steps_clause(req)
        if prior:                        # anchor the inferred start to the lead-up
            prompt += f", continuing on from the preceding steps: {prior}"
        start, _lm_target, lm_domain, lm_title, given_label, start_note = \
            endpoints_from_prompt(prompt)
        if not start:
            return {"error": "Couldn't infer a starting expression for this derivation."}

    domain = (req.domain or lm_domain or "algebra").strip()
    intent = req.intent or (
        f"Derive {req.target_latex}" + (f" given {givens}" if givens else "")
    )
    # Reinforce the micro-step request ONLY for an adjacent (from-previous-step)
    # derivation — micro-stepping a multi-step span explodes its length.
    if _derives_from_previous_step(req):
        intent = (intent + _MICROSTEP_DIRECTIVE)[:_INTENT_MAX].rstrip()

    # --- call: run the expert through the canonical invoke boundary -------------
    # `step_judge` reflects the gate WITHOUT constructing the judge: calling
    # _domain_judge() here would instantiate the LM judge as a side effect even
    # when DEBUG is off (args are evaluated before the level check) and even on
    # requests that fail before build(). RESCUE_ENABLED and is_configured() are
    # exactly the conditions under which _domain_judge() returns non-None.
    log.debug("proof_animation: start=%r target=%r domain=%s (start %s) step_judge=%s",
              start, req.target_latex, domain,
              "supplied" if req.start_latex else "inferred",
              RESCUE_ENABLED and is_configured())
    svc = SemanticGraphService()
    try:
        start_g = svc.latex_to_graph(start, domain=domain)
        target_g = svc.latex_to_graph(req.target_latex, domain=domain)
    except Exception:
        log.warning("proof_animation: latex_to_graph raised on "
                    "start=%r / target=%r (domain=%s)",
                    start, req.target_latex, domain, exc_info=True)
        start_g = target_g = None
    if start_g is None or target_g is None:
        which = "start" if start_g is None else "target"
        bad = start if start_g is None else req.target_latex
        log.warning("proof_animation: couldn't parse the %s expression: %r "
                    "(domain=%s, start %s)", which, bad, domain,
                    "supplied" if req.start_latex else "inferred")
        return {"error": f"Couldn't parse the {which} expression."}

    payload = {"start": start_g, "target": target_g, "domain": domain, "intent": intent}
    context_id = build_context_id(scene="adhoc", semantic_graph=True)
    # Why flatten the request's structured context (lesson/scene/proof + prior
    # steps) into ONE string instead of passing typed DSPy InputFields?
    #   * The expert's typed core is the GraphTransition (start/target graphs +
    #     domain + intent) — the math goes through structurally. Only this
    #     AUXILIARY prose context is flattened.
    #   * ``lesson_context`` / ``instruction`` are deliberately free-form ``str``
    #     side-channels on the signature, so the live app can enrich the prompt
    #     WITHOUT changing the expert's signature. That signature is optimized
    #     (MIPROv2/GEPA rewrites the docstring) and shared with the offline
    #     dataset/eval pipelines, which have no lesson context — adding typed
    #     fields would change the optimization surface and sit empty there.
    #   * DSPy serializes structured inputs to text anyway; flattening here just
    #     keeps explicit control over the wording the model sees.
    # Trade-off: less type-safety / manual formatting, for a stable, reusable
    # interface. Revisit (typed InputFields) if the model mis-reads this block.
    lesson_context = "\n".join(
        part for part in (
            _format_lesson_context(req.context),
            _format_prior_steps(req.previous_steps),
        ) if part
    )

    # The LM samples at temperature, so a derivable pair can occasionally come
    # back empty — retry a couple of times before giving up. (A genuinely
    # underivable pair, e.g. start == target, just costs the extra attempt.)
    traj = None
    for _attempt in range(_DERIVE_ATTEMPTS):
        traj = invoke(
            "proof_completion", context_id, payload,
            instruction=intent, lesson_context=lesson_context,
        ).single()
        if traj.steps:
            break
    if not traj or not traj.steps:
        return {"error": f"No derivation found — couldn't get from ${start}$ to ${req.target_latex}$."}

    # --- post: render the trajectory into FLIP animation data -------------------
    # Title states the derivation's endpoints — "Deriving $<target>$ from $<start>$"
    # — so the box header says WHERE it's derived from, not just the proof name.
    # Use the trajectory's OWN start (what step 0 actually renders) for the "from"
    # so the header matches the animation, falling back to the requested start.
    # Falls back to a caller/expert/goal title only if an endpoint is missing
    # (shouldn't happen: target has min_length=1 and start is resolved above).
    tgt = req.target_latex.strip()
    st = ((traj.start_latex or start) or "").strip()
    if tgt and st:
        title = f"Deriving ${tgt}$ from ${st}$"
    else:
        title = (req.title or traj.title or lm_title or req.goal or "Derivation").strip()
    start_operation = given_label or f"Given ${start}$"
    # A short caption for step 0 — never the goal formula (it renders as raw $…$).
    start_justification = start_note or "the starting expression"
    return build(traj, domain, title,
                 start_operation=start_operation,
                 start_justification=start_justification,
                 judge=_domain_judge(), lesson_context=lesson_context)
