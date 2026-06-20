"""LLM-as-judge for the refinement loop (issue #372 §B) — scores, never gates.

The hard gates (well-formedness, grounding) are deterministic. They cannot see
*pedagogy*: is the derivation clear, are the steps the right size, does the
justification actually explain the move? That is what this judge adds — a soft,
graded ``score`` in ``[0, 1]`` **plus** an ``issues`` critique string that is
threaded back into the next retry. It only nudges the blended reward and supplies
feedback text; it **never** decides pass/fail — the single threshold ``τ`` does
(see ``reward.py``). A bad judge score just lowers the number; it cannot, on its
own, push a well-formed grounded derivation below ``τ`` (the weights ensure it).

One extra LM call, and only when the hard gates pass (the reward short-circuits a
malformed prediction before calling the judge). Keep it cheap and optional: when
no LM is configured the reward simply omits the judge term.
"""

from __future__ import annotations

from dataclasses import dataclass

import dspy


class ProofJudgeSig(dspy.Signature):
    """Rate the pedagogical quality of a math derivation (you only SCORE it).

    You are given a start expression, a target expression, and a candidate
    step-by-step derivation between them. Judge it on **clarity** (is each move
    easy to follow?), **step size** (are steps small enough to be obvious, not
    giant leaps?), and **rigor** (does each justification actually explain why
    the move is valid?). You are NOT checking correctness — a separate symbolic
    checker already does that; assume the math is verified elsewhere.

    Return a single ``score`` in [0, 1] (1.0 = an exemplary teaching derivation,
    0.0 = confusing or unhelpful) and an ``issues`` string naming concrete,
    actionable problems (empty string if none). Be terse and specific — the
    issues are fed back to the author for a targeted retry.
    """

    start_latex: str = dspy.InputField(desc="the starting expression, as LaTeX")
    target_latex: str = dspy.InputField(desc="the target expression, as LaTeX")
    derivation: str = dspy.InputField(desc="the candidate derivation, step by step")
    score: float = dspy.OutputField(desc="pedagogical quality in [0, 1]")
    issues: str = dspy.OutputField(desc="concrete, actionable problems (empty if none)")


@dataclass(frozen=True)
class JudgeVerdict:
    score: float
    issues: str


def render_derivation(steps) -> str:
    """Flatten derivation steps into the compact text the judge reads."""
    lines = []
    for i, s in enumerate(steps or [], start=1):
        lines.append(f"{i}. [{s.change_type}] {s.operation}")
        lines.append(f"   => {s.expr_latex}")
        lines.append(f"   why: {s.justification}")
    return "\n".join(lines)


def _clamp01(x) -> float:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if v < 0 else 1.0 if v > 1 else v


class ProofJudge(dspy.Module):
    """An LM that scores a WHOLE derivation's PEDAGOGY for the refinement reward (#372).

    WHAT IT DOES
    ------------
    Given the start/target and the full candidate derivation, it rates how well
    the derivation *teaches* — clarity, step size, rigor of the justifications —
    and returns a :class:`JudgeVerdict` (a ``score`` in [0, 1] plus an ``issues``
    critique threaded back into the next retry). It is one term of the blended
    refinement reward (``reward.py``), weighted (``W_J``) so it can never override
    the CAS grounding: a wrong (Refuted) step can't be rescued by a perfect
    pedagogy score.

    WHERE IT RUNS
    -------------
    In the refinement loop (``module.py`` → ``refine``), which drives BOTH the
    live inference retries (when ``ALGEBENCH_PC_JUDGE`` is on and
    ``refine_attempts > 1``) AND the offline optimizer/eval metric. So it is an
    inference-time signal too — just gated off by default. The reward it feeds
    decides whether to *retry*; it never edits a step's displayed confidence.

    WHAT IT IS NOT
    --------------
    * NOT a correctness check — the signature tells it to *assume* the math is
      verified elsewhere; sympy (``step_grounding``) is the authority on validity.
    * NOT the per-step domain expert (:class:`DomainStepJudge`). The real split is
      SCOPE and EFFECT, not timing: this judge scores the WHOLE derivation and
      only nudges a reward (can't override the CAS); that one judges a SINGLE
      uncheckable step and can override its CAS tier into ``DOMAIN``.

    Exception-safe: any failure returns ``score=0`` with an "(judge unavailable)"
    note, so it can never break the refinement loop.
    """

    def __init__(self):
        super().__init__()
        self.rate = dspy.Predict(ProofJudgeSig)

    def __call__(self, *, start_latex: str, target_latex: str, steps) -> JudgeVerdict:
        try:
            pred = self.rate(
                start_latex=start_latex or "",
                target_latex=target_latex or "",
                derivation=render_derivation(steps),
            )
        except Exception as exc:  # the judge must never break the loop
            return JudgeVerdict(score=0.0, issues=f"(judge unavailable: {exc})")
        return JudgeVerdict(score=_clamp01(getattr(pred, "score", 0.0)),
                            issues=(getattr(pred, "issues", "") or "").strip())


# --------------------------------------------------------------------------- #
# domain-step judge (issue #385) — an INFERENCE-time expert, not a reward signal
# --------------------------------------------------------------------------- #


class DomainStepJudgeSig(dspy.Signature):
    """As a domain EXPERT, decide if a step the CAS couldn't settle is valid.

    A symbolic checker (sympy) already graded this transition and could NOT
    confirm it — either the state isn't a single convertible expression
    (``uncheckable``), both states parse but it couldn't prove/refute the move
    (``undecided``), or it actively refuted it (``refuted``). That checker is
    blind to **domain-specific moves** that aren't algebraic identities:
    expanding ``∑F = 0`` into the named forces of a free-body diagram, applying a
    physical law (``F = ma``), introducing a standard definition, a units/
    dimensional argument, or a field-standard approximation (``sin θ ≈ θ``).

    Using the ``domain`` and the lesson/proof ``context``, decide whether the
    move from ``previous_step`` to ``current_step`` is a **valid, recognized
    move in this domain** — one an expert would accept as following from the
    previous step even though it is not a symbolic identity.

    Be STRICT and conservative. This verdict can *override* the symbolic
    checker, so only set ``follows=True`` when you can name the specific domain
    principle that licenses the move. If it is merely plausible, or you cannot
    identify the justifying principle, set ``follows=False``. For a ``refuted``
    step the bar is highest: the CAS found a concrete contradiction, so only
    accept it if the contradiction is an *expected* consequence of a modeling
    choice (a dropped negligible term, a redefinition) that you can name.

    Return ``follows`` (bool), a calibrated ``confidence`` in [0, 1], and a
    terse ``rationale`` naming the domain principle (shown to the learner).
    """

    domain: str = dspy.InputField(desc="the math/science domain, e.g. 'hydrostatics'")
    context: str = dspy.InputField(desc="lesson/scene/proof context (may be empty)")
    previous_step: str = dspy.InputField(desc="the previous state, as LaTeX")
    current_step: str = dspy.InputField(desc="the step to justify, as LaTeX")
    operation: str = dspy.InputField(desc="the move the author declared, in words")
    justification: str = dspy.InputField(desc="the author's stated justification")
    cas_status: str = dspy.InputField(
        desc="why the CAS couldn't confirm: 'uncheckable' | 'undecided' | 'refuted'")
    follows: bool = dspy.OutputField(
        desc="True only if a NAMED domain principle licenses this exact move")
    confidence: float = dspy.OutputField(desc="calibrated confidence in [0, 1]")
    rationale: str = dspy.OutputField(
        desc="terse: the domain principle that justifies it (or why it doesn't)")


@dataclass(frozen=True)
class DomainVerdict:
    """One domain-expert verdict on an otherwise-uncheckable step."""

    follows: bool
    confidence: float
    rationale: str


class DomainStepJudge(dspy.Module):
    """An LM domain EXPERT that vouches for a derivation step the CAS can't (#385).

    WHAT IT DOES
    ------------
    sympy grades every derivation step, but it is blind to **domain-specific
    moves** that aren't algebraic identities — expanding ``∑F = 0`` into a
    free-body diagram's named forces, applying a physical law, introducing a
    standard definition, a units argument, a field-standard approximation. For
    those, the CAS has *nothing to check* (GRAY) or *cannot decide* (BLUE), so
    the step looks unverified even though a domain expert would accept it.

    This judge IS that expert. Given the ``domain`` + lesson/proof ``context``
    and one transition (``previous_step`` → ``current_step`` with the author's
    operation/justification), it answers a single question: *is this a valid,
    recognized move in this domain?* It returns a :class:`DomainVerdict`
    (``follows`` / ``confidence`` / ``rationale``). When it says yes with enough
    confidence, the inference-time rescue (``domain_rescue.py``) overrides the
    step into the ``DOMAIN`` confidence tier — labeled "valid by domain
    knowledge, not a symbolic identity" so the learner is never misled.

    WHAT IT IS NOT
    --------------
    * NOT a correctness re-derivation — it recognizes a *named principle* that
      licenses the move; it does not recompute the algebra (sympy already did).
    * NOT the pedagogy judge (:class:`ProofJudge`). Both are LM judges that can
      run at inference; the difference is SCOPE and EFFECT. ProofJudge scores a
      WHOLE derivation's clarity as one term of the refinement *reward*, weighted
      so it can never override the CAS. THIS judge evaluates a SINGLE uncheckable
      step and *overrides* its CAS tier into ``DOMAIN`` (GRAY/BLUE; a RED/refuted
      step only behind a hard gate, at a stricter confidence bar).
    * NOT a gate — it only ever *upgrades* an unverified step; it never fails or
      downgrades one. It runs after the derivation is built (per-step confidence
      grading), not inside the refinement loop.

    SAFETY
    ------
    Exception- and type-safe: any failure (no LM, malformed output) returns a
    NON-rescuing verdict (``follows=False``), so a broken judge can never
    spuriously upgrade a step — it just leaves the CAS tier untouched.
    """

    def __init__(self):
        super().__init__()
        self.decide = dspy.Predict(DomainStepJudgeSig)

    def __call__(self, *, domain: str, context: str, previous_step: str,
                 current_step: str, operation: str = "", justification: str = "",
                 cas_status: str = "uncheckable") -> DomainVerdict:
        try:
            pred = self.decide(
                domain=domain or "",
                context=context or "",
                previous_step=previous_step or "",
                current_step=current_step or "",
                operation=operation or "",
                justification=justification or "",
                cas_status=cas_status or "uncheckable",
            )
        except Exception as exc:  # the judge must never break the build
            return DomainVerdict(False, 0.0, f"(domain judge unavailable: {exc})")
        return DomainVerdict(
            follows=bool(getattr(pred, "follows", False)),
            confidence=_clamp01(getattr(pred, "confidence", 0.0)),
            rationale=(getattr(pred, "rationale", "") or "").strip(),
        )
