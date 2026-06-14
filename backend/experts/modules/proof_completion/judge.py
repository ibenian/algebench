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
    """Thin ``Predict(ProofJudgeSig)`` wrapper returning a clamped verdict."""

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
