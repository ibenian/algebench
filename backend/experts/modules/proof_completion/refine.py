"""The refinement engine (issue #372 §C, option B2 — hand-rolled loop).

The pinned DSPy (2.6.5) ships **no** retry primitive (``dspy.Refine`` /
``BestOfN`` were added later; ``dspy.Assert`` / ``Suggest`` were removed), and a
validation failure there is *reject → one blind re-roll → raise* with the
``ValidationError`` text discarded. So the model is never told what was wrong.

This module supplies the missing engine, version-proof and dependency-free: ask,
evaluate, and — crucially — **thread the failure feedback back into the next
attempt** so retries are targeted, not blind. It early-exits the moment an
attempt passes; after ``N`` attempts it keeps the **best** one (honestly tiered
by the confidence badges, per issue #372 §D — refinement raises the ceiling, the
badges keep the floor honest).

The harness is deliberately decoupled from *how* an attempt is produced and
scored: it takes an ``attempt`` callable ``(k, feedback) -> prediction`` and an
``evaluate`` callable ``prediction -> RewardResult`` (anything with ``.score``,
``.passed``, ``.issues``). Swapping in ``dspy.Refine`` after a dependency bump
would replace only this loop — the checkers and reward are identical (#372 §C).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Optional

# Prepended to the failure issues when re-asking, so the model reads them as a
# correction directive rather than as part of the original task.
FEEDBACK_PREAMBLE = (
    "Your previous attempt had the problems below. Produce a NEW derivation that "
    "fixes them — keep what was correct, repair what was flagged:\n"
)


@dataclass
class RefineOutcome:
    prediction: object        # the best prediction seen (may still fall short)
    result: object            # its RewardResult
    attempts: int             # how many attempts were made
    passed: bool              # did any attempt clear the threshold?
    out_of_time: bool = False  # stopped early because the time budget was spent


def refine(
    attempt: Callable[[int, str], object],
    evaluate: Callable[[object], object],
    *,
    max_attempts: int = 2,
    time_budget_s: Optional[float] = None,
    on_attempt: Optional[Callable[[int, int, object, object], None]] = None,
) -> RefineOutcome:
    """Ask → evaluate → re-ask-with-feedback, keeping the best (never raises here).

    ``attempt(k, feedback)`` produces attempt ``k`` (0-based); ``feedback`` is
    ``""`` on the first call and the composed issues thereafter. ``evaluate``
    returns a ``RewardResult``. Early-exits on the first ``passed`` result.
    Exceptions inside ``attempt``/``evaluate`` end the loop early and return the
    best-so-far (or re-raise on the very first attempt, where there is nothing to
    fall back to).

    ``time_budget_s`` — optional wall-clock budget. A *new* attempt is only
    started while elapsed time is under it (the first attempt always runs, and a
    running attempt is never interrupted — scoring is synchronous). This keeps a
    slow, never-passing derivation (e.g. a long chain that re-scores under the CAS
    on every attempt) from blowing the caller's request timeout.

    ``on_attempt(k, n, pred, res)`` — optional observability hook fired after each
    evaluation (0-based ``k`` of ``n``), so callers can dump per-attempt state
    (``--debug``) without the loop knowing how to render a prediction.
    """
    n = max(1, int(max_attempts))
    best_pred: Optional[object] = None
    best_res: Optional[object] = None
    feedback = ""
    made = 0
    started = time.monotonic()

    for k in range(n):
        if (k > 0 and time_budget_s is not None
                and time.monotonic() - started >= time_budget_s):
            # out of time — keep the best so far rather than risk the caller's
            # request timeout on another full attempt.
            return RefineOutcome(best_pred, best_res, made, False, out_of_time=True)
        try:
            pred = attempt(k, feedback)
            res = evaluate(pred)
        except Exception:
            if best_pred is None:
                raise            # nothing to fall back to — let the caller see it
            break
        made += 1
        if on_attempt is not None:
            on_attempt(k, n, pred, res)
        if best_res is None or res.score > best_res.score:
            best_pred, best_res = pred, res
        if res.passed:
            return RefineOutcome(best_pred, best_res, made, True)
        feedback = FEEDBACK_PREAMBLE + (res.issues or "the derivation scored low")

    return RefineOutcome(best_pred, best_res, made, False)
