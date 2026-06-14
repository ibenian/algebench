"""The single graded reward for the refinement loop (issue #372 §B).

One function, one number, one threshold. Every signal contributes a score in
``[0, 1]``; they blend into one ``reward`` and a single threshold ``τ`` decides
whether to retry. Nothing "rejects" — a bad signal merely scores low.

    reward = wellformed_factor * (W_G * grounding_score + W_J * judge_score)
                                  ──────────────────────────────────────────
                                                 (W_G + W_J)

The blend is renormalised by ``(W_G + W_J)`` so the score stays in ``[0, 1]``
regardless of whether the weights sum to 1 (they are env-tunable, so they may
not). When the judge is absent the judge term drops and grounding alone takes the
full weight (``score = grounding_score``).

* **wellformed_factor** — a near-binary *prerequisite* (1.0 well-formed, else
  0.0): a malformed caption can't render, so it zeroes the reward and the loop
  retries with the caption issues as feedback (the judge is not even called).
* **grounding_score** — tier-graded (``TIER_RANK/4``), weighted to dominate so a
  ``Refuted`` step can't clear ``τ`` even with a perfect judge.
* **judge_score** — the LLM judge's pedagogy/clarity score; optional. With no LM
  configured the judge term is dropped and grounding is renormalised to the full
  weight, so the reward stays usable offline (and as the optimizer metric).

The reward returns the score **and** an ``issues`` feedback string regardless of
pass/fail, so the refinement engine can thread targeted feedback into the retry.
Weights and ``τ`` are tunable via environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from .grounding_score import grounding_score
from .judge import JudgeVerdict
from .step_grounding import Tier
from .wellformed import well_formed


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Grounding dominates the judge so a wrong (Refuted=0) step can't be rescued by a
# perfect judge score; both are renormalised when the judge is absent.
W_G = _envf("ALGEBENCH_PC_W_GROUNDING", 0.8)
W_J = _envf("ALGEBENCH_PC_W_JUDGE", 0.2)
# Retry while reward < TAU. Tuned so Plausible/Unchecked merely lower the score
# but a fully-grounded derivation clears it; malformed/Refuted cannot.
TAU = _envf("ALGEBENCH_PC_TAU", 0.7)


@dataclass(frozen=True)
class RewardResult:
    score: float
    issues: str
    passed: bool
    breakdown: dict


def reward(
    traj,
    *,
    start_graph,
    target_graph,
    domain: Optional[str] = None,
    judge=None,
    tau: float = TAU,
) -> RewardResult:
    """The graded reward for one predicted trajectory (never raises).

    ``judge`` is an optional callable ``(start_latex, target_latex, steps) ->
    JudgeVerdict``; when None the judge term is omitted and grounding takes the
    full weight. ``start_graph`` / ``target_graph`` are the parsed endpoint
    graphs the expert derived between (also used to render the judge's prompt).
    """
    wf = well_formed(traj)
    if not wf.ok:
        # Prerequisite failed: malformed can't render. Zero the reward and hand
        # back the caption issues — the judge is not worth calling on a caption
        # that won't display anyway.
        return RewardResult(0.0, wf.issues_text, False,
                            {"wellformed": 0.0, "grounding": None, "judge": None})

    gs = grounding_score(start_graph, list(getattr(traj, "steps", []) or []),
                         target_graph, domain=domain)

    jv: Optional[JudgeVerdict] = None
    if judge is not None:
        jv = judge(
            start_latex=getattr(traj, "start_latex", None) or "",
            target_latex=getattr(traj, "target_latex", None) or "",
            steps=list(getattr(traj, "steps", []) or []),
        )

    if jv is None:
        score = gs.score                              # grounding takes full weight
    else:
        denom = W_G + W_J or 1.0
        score = (W_G * gs.score + W_J * jv.score) / denom

    score = wf.factor * score
    issues = gs.reason
    if jv is not None and jv.issues:
        issues = f"{issues} | judge: {jv.issues}"

    # endpoint_reached / no_refuted are surfaced for observability only. (They
    # were briefly used for a "good enough" early-accept, but that suppressed the
    # gold upgrades a retry can find at temperature; the loop now retries while
    # below τ — chasing a cleaner derivation and fixing malformed captions — with
    # the time budget guarding the request timeout.)
    report = gs.report
    no_refuted = not any(p.tier is Tier.RED for p in getattr(report, "pairs", []))
    endpoint_reached = getattr(report, "endpoint_reached", None) is True

    breakdown = {
        "wellformed": wf.factor,
        "grounding": gs.score,
        "judge": None if jv is None else jv.score,
        "endpoint_reached": endpoint_reached,
        "no_refuted": no_refuted,
    }
    return RewardResult(score, issues, score >= tau, breakdown)
