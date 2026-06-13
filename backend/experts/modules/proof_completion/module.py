"""ProofCompletionExpert — start graph + target graph → edit trajectory.

A thin ``dspy.Module`` wrapping ``ChainOfThought(ProofCompletionSig)``, wrapped
in turn by a **refinement loop** (issue #372): each prediction is scored by the
graded ``reward`` (well-formedness · grounding · optional judge) and, if it falls
below the threshold, re-asked with the failure issues as targeted feedback. The
optimizer (MIPROv2/GEPA) compiles *this* module; the compiled state is saved to
an artifact and loaded back here.
"""

from __future__ import annotations

import logging
import os

import dspy

from backend.experts.registry import register_expert
from .signature import ProofCompletionSig
from .model import GraphTransition
from .grounding import graph_to_latex
from .judge import ProofJudge
from .refine import refine
from .reward import reward

log = logging.getLogger(__name__)

# The "blessed" compiled program. If this file exists it is loaded by default —
# so service.invoke and the CLI use the optimized expert without --program.
# (gitignored; produced by proof_completion/optimize.py --out <this path>.)
DEFAULT_ARTIFACT = os.path.join(os.path.dirname(__file__), "artifacts",
                                "proof_completion.json")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_flag(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


# Refinement defaults. Attempts==1 makes the loop a no-op single pass (extra LM
# calls happen *only* on a sub-threshold attempt — the happy path costs nothing
# beyond the one prediction when the judge is off). The judge is opt-in: it adds
# one LM call per generation, so it stays off unless explicitly enabled.
_REFINE_ATTEMPTS = _env_int("ALGEBENCH_PC_REFINE_ATTEMPTS", 2)
_JUDGE_ENABLED = _env_flag("ALGEBENCH_PC_JUDGE", default=False)


def _log_attempt(k: int, n: int, pred, res) -> None:
    """Per-attempt dump for the refinement loop (fires at DEBUG; see ``--debug``).

    Shows the score + breakdown, every step's expression, and the ``issues``
    string — which is exactly what gets threaded back as feedback if we retry.
    """
    if not log.isEnabledFor(logging.DEBUG):
        return
    b = res.breakdown
    log.debug("── refine attempt %d/%d ──  score=%.3f  %s",
              k + 1, n, res.score, "PASS" if res.passed else "below τ")
    log.debug("   breakdown: wellformed=%s grounding=%s judge=%s",
              b.get("wellformed"), b.get("grounding"), b.get("judge"))
    steps = list(getattr(pred.trajectory, "steps", []) or [])
    for i, s in enumerate(steps, start=1):
        log.debug("   step %d [%s]: %s", i, s.change_type, s.expr_latex)
    if res.issues:
        verb = "feedback for next attempt" if not res.passed else "notes"
        log.debug("   %s: %s", verb, res.issues)


@register_expert(
    "proof_completion",
    context_scope="semanticGraph",
    context_model=GraphTransition,
)
class ProofCompletionExpert(dspy.Module):
    """Produce the step-by-step derivation transforming start into target.

    Returns a single ``ProofTrajectory`` of derivation *states* (each a complete
    ``expr_latex`` + operation + justification). The model emits math, not graph
    edits; the per-state graphs and the atomic edits between them are recovered
    deterministically in code (``latex_to_graph`` + ``diff``).
    """

    def __init__(self, artifact: str | None = None, load_default: bool = True,
                 *, refine_attempts: int | None = None,
                 use_judge: bool | None = None):
        super().__init__()
        self.predict = dspy.ChainOfThought(ProofCompletionSig)
        # explicit artifact wins; else the blessed default if present and allowed;
        # else uncompiled (baseline). load_default=False forces baseline.
        path = artifact or (DEFAULT_ARTIFACT if load_default else None)
        if path and os.path.exists(path):
            self.load(path)
            self.loaded_artifact = path
        else:
            self.loaded_artifact = None
        # Refinement config (constructor args override env; env overrides defaults).
        self.refine_attempts = (refine_attempts if refine_attempts is not None
                                else _REFINE_ATTEMPTS)
        use_judge = _JUDGE_ENABLED if use_judge is None else use_judge
        # The judge is the only extra-LM signal; build it lazily once, here.
        self.judge = ProofJudge() if use_judge else None

    def _finalize(self, pred, start_latex: str, target_latex: str):
        """Bind the (code-side) endpoints + model title onto the trajectory.

        The trajectory must carry its endpoints for it to be self-contained and
        for the reward's judge to see the start/target — so finalize *before*
        scoring, not just before returning.
        """
        traj = pred.trajectory
        traj.start_latex = start_latex or None
        traj.target_latex = target_latex or None
        # normalise an empty/whitespace title to None so callers can fall back
        traj.title = (pred.title or "").strip() or None
        return traj

    def forward(self, *, context: GraphTransition, context_id: str,
                lesson_context: str = "", instruction: str = ""):
        # The model reasons in math, not graphs: translate the context graphs to
        # proper LaTeX here and feed *that* to the LM. The graphs never enter the
        # prompt — they stay code-side for verification + animation.
        start_latex = graph_to_latex(context.start) or ""
        target_latex = graph_to_latex(context.target) or ""

        def attempt(_k: int, feedback: str):
            # Thread the previous attempt's failure issues back into the prompt as
            # an extra instruction — targeted retry, not a blind re-roll.
            instr = instruction if not feedback else (
                f"{instruction}\n\n{feedback}" if instruction else feedback)
            pred = self.predict(
                start_latex=start_latex,
                target_latex=target_latex,
                domain=context.domain or "",
                intent=context.intent or "",
                lesson_context=lesson_context,
                instruction=instr,
            )
            self._finalize(pred, start_latex, target_latex)
            return pred

        def evaluate(pred):
            return reward(pred.trajectory, start_graph=context.start,
                          target_graph=context.target, domain=context.domain,
                          judge=self.judge)

        outcome = refine(attempt, evaluate, max_attempts=self.refine_attempts,
                         on_attempt=_log_attempt)
        log.debug("refine done: %d attempt(s), %s (best score %.3f)",
                  outcome.attempts, "PASSED" if outcome.passed else "kept best",
                  getattr(outcome.result, "score", float("nan")))
        return [outcome.prediction.trajectory]  # canonical list[Output]
