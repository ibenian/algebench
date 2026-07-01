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
from pathlib import Path

import dspy

from backend.experts.registry import register_expert
from backend.util.pathutil import sanitize_path
from .signature import ProofCompletionSig
from .model import GraphTransition
from .grounding import graph_to_latex
from .judge import ProofJudge
from .refine import refine
from .reward import reward

log = logging.getLogger(__name__)

# The conventional location optimize.py writes the compiled ("blessed") program
# to. NOTE: this is NOT auto-loaded just by existing — auto-load is opt-in via
# ALGEBENCH_PC_LOAD_ARTIFACT (see below); point that env var here to use it.
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


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Refinement defaults. Attempts==1 makes the loop a no-op single pass (extra LM
# calls happen *only* on a sub-threshold attempt — the happy path costs nothing
# beyond the one prediction when the judge is off). The judge is opt-in: it adds
# one LM call per generation, so it stays off unless explicitly enabled.
_REFINE_ATTEMPTS = _env_int("ALGEBENCH_PC_REFINE_ATTEMPTS", 2)
_JUDGE_ENABLED = _env_flag("ALGEBENCH_PC_JUDGE", default=False)
# Wall-clock budget for the whole loop: don't START a retry once this many
# seconds have elapsed (the first attempt always runs, and a running attempt is
# never interrupted). Keeps a long, slow, never-passing derivation from blowing
# the client's request timeout (the proof-animation UI aborts at 360s) — set
# comfortably below it to leave room for an in-flight attempt + animation build.
# 0 disables the budget.
_TIME_BUDGET = _env_float("ALGEBENCH_PC_TIME_BUDGET", 240.0)
# Compiled-artifact auto-load. ALGEBENCH_PC_LOAD_ARTIFACT holds a *repo-root-
# relative* path to the compiled program to load; empty (the default) disables it
# (uncompiled baseline). The path is resolved through ``sanitize_path``, which
# confines it under the repo root and rejects absolute paths, ``~`` and ``..``
# escapes. An explicit ``artifact=`` / ``--program`` always wins. The conventional
# location ``optimize.py`` writes to is ``DEFAULT_ARTIFACT`` (above) — e.g.
# ALGEBENCH_PC_LOAD_ARTIFACT=backend/experts/modules/proof_completion/artifacts/proof_completion.json
_ARTIFACT_ENV = os.environ.get("ALGEBENCH_PC_LOAD_ARTIFACT", "").strip()
_REPO_ROOT = Path(__file__).resolve().parents[4]   # …/proof_completion → repo root


def _configured_artifact() -> str | None:
    """Repo-confined artifact path from the env var, or None (unset or rejected).

    ``sanitize_path`` confines the value under the repo root and rejects
    absolute paths, ``~``, ``..`` traversal, and unsafe characters.
    """
    if not _ARTIFACT_ENV:
        return None
    safe = sanitize_path(_REPO_ROOT, _ARTIFACT_ENV)
    return str(safe) if safe is not None else None


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
        # An explicit ``artifact`` wins; otherwise the env-configured path is used
        # (only when load_default). Empty env → no auto-load (baseline).
        env_path = _configured_artifact()
        path = artifact or (env_path if load_default else None)
        if path and os.path.exists(path):
            self.load(path)
            self.loaded_artifact = path
            log.info("proof_completion: loaded compiled artifact %s", path)
        else:
            self.loaded_artifact = None
            if artifact and not os.path.exists(artifact):
                # the caller asked for a specific artifact that isn't there —
                # surface loudly; it's almost certainly a misconfiguration.
                log.warning("proof_completion: requested artifact %s not found — "
                            "running UNCOMPILED baseline", artifact)
            elif load_default and _ARTIFACT_ENV and env_path is None:
                # env set but sanitize_path refused it (absolute / ~ / .. / unsafe)
                log.warning("proof_completion: ALGEBENCH_PC_LOAD_ARTIFACT=%r rejected "
                            "(must be a safe repo-relative path) — UNCOMPILED baseline",
                            _ARTIFACT_ENV)
            elif load_default and env_path:
                # env resolved to a safe path, but the file isn't there.
                log.warning("proof_completion: ALGEBENCH_PC_LOAD_ARTIFACT=%r not found "
                            "(resolved %s) — running UNCOMPILED baseline",
                            _ARTIFACT_ENV, env_path)
            elif load_default:
                log.debug("proof_completion: no artifact configured "
                          "(ALGEBENCH_PC_LOAD_ARTIFACT empty) — uncompiled baseline")
            else:
                log.debug("proof_completion: uncompiled baseline (load_default=False)")
        # Refinement config (constructor args override env; env overrides defaults).
        self.refine_attempts = (refine_attempts if refine_attempts is not None
                                else _REFINE_ATTEMPTS)
        use_judge = _JUDGE_ENABLED if use_judge is None else use_judge
        # The judge is the only extra-LM signal; build it lazily once, here.
        self.judge = ProofJudge() if use_judge else None
        log.debug("proof_completion: refine_attempts=%d judge=%s",
                  self.refine_attempts, bool(self.judge))

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
        # goal (framing) + followups (agentic continuation prompts) ride along too;
        # tolerate a model that omits them (older/compiled programs) — getattr default.
        traj.goal = (getattr(pred, "goal", "") or "").strip() or None
        traj.followups = [f.strip() for f in (getattr(pred, "followups", None) or [])
                          if isinstance(f, str) and f.strip()]
        traj.prerequisites = [p.strip() for p in (getattr(pred, "prerequisites", None) or [])
                              if isinstance(p, str) and p.strip()]
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

        # A single attempt cannot retry, so scoring it would be pure overhead (CAS
        # grounding + an LM call when the judge is on). Short-circuit to the raw
        # prediction. optimize.py / evaluate.py set refine_attempts=1 precisely to
        # compile/measure the raw predictor — this keeps that path free of it.
        if self.refine_attempts <= 1:
            pred = attempt(0, "")
            log.debug("refine skipped: single pass (refine_attempts<=1)")
            return [pred.trajectory]

        outcome = refine(attempt, evaluate, max_attempts=self.refine_attempts,
                         time_budget_s=(_TIME_BUDGET or None),
                         on_attempt=_log_attempt)
        status = ("PASSED" if outcome.passed
                  else "out of time, kept best" if outcome.out_of_time
                  else "kept best")
        log.debug("refine done: %d attempt(s), %s (best score %.3f)",
                  outcome.attempts, status,
                  getattr(outcome.result, "score", float("nan")))
        return [outcome.prediction.trajectory]  # canonical list[Output]
