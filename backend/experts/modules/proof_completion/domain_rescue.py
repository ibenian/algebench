"""Inference-time domain rescue (issue #385): the judge as a domain EXPERT.

``step_grounding.py`` ranks each transition with sympy alone. That is the right
ground truth for algebra, but blind to **domain-specific moves** that are not
symbolic identities — expanding ``∑F = 0`` into a free-body diagram's named
forces, applying a physical law, introducing a standard definition, a units
argument, or a field-standard approximation. sympy has *nothing to check* (GRAY)
or *cannot decide* (BLUE) such a step, so the deriver is forced to avoid it.

This module routes exactly those CAS-undecided steps to an LM domain judge
(:class:`DomainStepJudge`), fed the ``domain`` + lesson/proof context. When the
judge can name the domain principle that licenses the move, the step is
**overridden** into the :data:`Tier.DOMAIN` tier — ranked *between* ``BLUE``
(plausible) and ``SILVER`` (verified), and labeled "valid by domain knowledge,
not a symbolic identity" so a learner is never misled into thinking it was
CAS-proven.

Where the judge kicks in (the candidates), by CAS status:

* **GRAY → ``uncheckable``** *(primary)* — the state is not a single convertible
  expression, so domain justification is purely *additive*: the CAS had nothing
  to contradict.
* **BLUE → ``undecided``** — both states parse, but the CAS could neither prove
  nor refute the move (a physical law applied, a domain substitution).
* **RED → ``refuted``** *(off by default)* — the CAS found a concrete
  contradiction. Overriding it is far riskier, so it is gated behind
  ``rescue_red`` and the override is labeled "the CAS disagrees" explicitly.
  Even gated on, it demands a higher judge confidence (:data:`_RED_MIN_CONF`).

In every case the resulting step must still be **symbolically parseable** — we
could not *connect* it to the previous step (that is why the CAS couldn't check
it), but a domain-justified step must remain a well-formed expression, never
unrenderable/non-symbolic notation. A non-parseable step is left at its CAS tier
and never sent to the judge.

Safety: this runs ONLY at inference (animation build), never in the training
reward — so "a Refuted step can't be rescued by a perfect judge" still holds for
the optimizer (``reward.py`` stays pure-CAS). Total and isolated: any judge
failure leaves the original CAS tier untouched; ``report`` is never mutated.
"""

from __future__ import annotations

import logging
import os
from dataclasses import replace
from typing import Optional, Sequence

from .step_grounding import (
    StepGroundingReport,
    Tier,
    _count_tiers,
    _overall_reason,
    finalize_overall,
)

log = logging.getLogger(__name__)


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _envi(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Master on/off for the whole per-step rescue (mirrors how ALGEBENCH_PC_JUDGE
# gates ProofJudge). Default ON: the rescue runs whenever an LM is configured,
# but this lets it be disabled without unconfiguring the LM. The handler honors
# it by NOT passing a judge when off, so ``rescue_uncheckable`` is a no-op.
RESCUE_ENABLED = os.environ.get("ALGEBENCH_DOMAIN_RESCUE", "1").lower() in ("1", "true", "yes")

# Minimum judge confidence to override a GRAY/BLUE step into DOMAIN — high by
# default, so only a confident domain verdict overrides the CAS's "couldn't
# check". The RED override (when enabled) is stricter still — the CAS actively
# disagrees there.
_MIN_CONF = _envf("ALGEBENCH_DOMAIN_MIN_CONF", 0.9)
_RED_MIN_CONF = _envf("ALGEBENCH_DOMAIN_RED_MIN_CONF", 0.95)
# Cap the number of judge calls per derivation (latency/cost guard). Real
# derivations have a handful of uncheckable steps; this bounds pathological ones.
_MAX_CALLS = _envi("ALGEBENCH_DOMAIN_MAX_CALLS", 8)
# Override a Refuted (RED) step only when explicitly enabled (hard gate).
_RESCUE_RED = os.environ.get("ALGEBENCH_DOMAIN_RESCUE_RED", "").lower() in ("1", "true", "yes")

# CAS tier -> the cas_status string the judge reads.
_CAS_STATUS = {
    Tier.GRAY: "uncheckable",
    Tier.BLUE: "undecided",
    Tier.RED: "refuted",
}


def _truncate(s, n: int = 120) -> str:
    """Clip a rationale for a single-line log (keeps DEBUG output readable)."""
    s = (s or "").strip()
    return s if len(s) <= n else s[:n - 1] + "…"


def _clamp_conf(x) -> float:
    """Coerce a verdict confidence to a float in [0, 1].

    rescue_uncheckable accepts arbitrary judge callables, so we both guard
    against a non-numeric confidence (-> 0.0, no rescue) AND clamp to the unit
    interval so a misbehaving judge can't clear the threshold with conf > 1 or
    surface a misleading percentage (e.g. 500%) in the user-facing reason.
    """
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def _candidate(tier: Tier, rescue_red: bool) -> bool:
    """Should this CAS verdict be routed to the domain judge?

    Only the tiers the CAS could NOT establish are candidates — judging a
    GOLD/SILVER step would waste an LM call and risk *downgrading* a proven move.

    * GRAY (uncheckable) / BLUE (undecided) — always: the CAS had nothing to
      contradict, so a domain override is additive.
    * RED (refuted) — only when ``rescue_red`` is explicitly enabled: the CAS
      found a concrete contradiction, so overriding it is gated (and held to a
      stricter confidence bar by the caller).
    """
    if tier in (Tier.GRAY, Tier.BLUE):
        return True
    return tier is Tier.RED and rescue_red


def rescue_uncheckable(
    report: StepGroundingReport,
    states: Sequence,
    *,
    domain: str,
    context: str,
    judge,
    min_confidence: float = _MIN_CONF,
    red_min_confidence: float = _RED_MIN_CONF,
    rescue_red: Optional[bool] = None,
    max_calls: int = _MAX_CALLS,
) -> StepGroundingReport:
    """Override CAS-undecided steps the domain judge vouches for into ``DOMAIN``.

    ``states``: per-STATE captions, index-aligned to ``report.steps`` (index 0
    is the start). Each is a mapping with ``latex`` / ``operation`` /
    ``justification`` and an optional ``parseable`` flag (missing keys
    tolerated; ``parseable`` defaults to True). ``judge`` is a callable matching
    :class:`DomainStepJudge` (``domain, context, previous_step, current_step,
    operation, justification, cas_status -> DomainVerdict``); when ``None`` the
    report is returned unchanged.

    A step is only eligible for a DOMAIN override if its OWN resulting expression
    is still **symbolically parseable** (``states[i]["parseable"]``). We may not
    be able to *connect* it to the previous step symbolically (that is exactly
    why the CAS couldn't check it), but a domain-justified step must still be a
    well-formed expression — never unrenderable/non-symbolic notation. A
    non-parseable step stays at its CAS tier and is not even sent to the judge.

    Returns a NEW report (never mutates ``report``). Total: a judge that raises
    or declines simply leaves that step's CAS tier in place.
    """
    if judge is None or not report.pairs:
        return report
    if rescue_red is None:
        rescue_red = _RESCUE_RED

    def _latex(i: int) -> str:
        if 0 <= i < len(states):
            return str((states[i] or {}).get("latex", "") or "")
        return ""

    def _field(i: int, key: str) -> str:
        if 0 <= i < len(states):
            return str((states[i] or {}).get(key, "") or "")
        return ""

    def _parseable(i: int) -> bool:
        # The resulting step's own expression must be symbolically parseable.
        # FAIL CLOSED on an out-of-sync ``states`` list: an index with no state
        # metadata is NOT eligible (we'd otherwise judge/override a step using
        # empty latex/captions). In-range with the flag absent defaults to True,
        # so callers that don't supply it (e.g. unit tests) still work.
        if not (0 <= i < len(states)):
            return False
        return bool((states[i] or {}).get("parseable", True))

    new_pairs = list(report.pairs)
    overrides: dict[int, object] = {}   # pair.index -> new PairVerdict
    n_candidates = sum(1 for pv in report.pairs
                       if _candidate(pv.tier, rescue_red) and _parseable(pv.index))
    calls = 0
    for j, pv in enumerate(report.pairs):
        if not _candidate(pv.tier, rescue_red):
            continue
        i = pv.index                      # transition state[i-1] -> state[i]
        # Gate: a domain-justified step must itself be symbolically parseable.
        if not _parseable(i):
            log.debug("domain_rescue: step %d NOT eligible — its own expression is "
                      "not symbolically parseable (stays %s)", i, pv.tier.value)
            continue
        if calls >= max_calls:
            log.debug("domain_rescue: hit max_calls=%d, leaving step %d at %s",
                      max_calls, pv.index, pv.tier.value)
            break
        calls += 1
        cas_status = _CAS_STATUS.get(pv.tier, "uncheckable")
        log.debug("domain_rescue: judging step %d (%s/%s): %s -> %s [%s]",
                  i, pv.tier.value, cas_status, _latex(i - 1), _latex(i),
                  _field(i, "operation"))
        # Per-step isolation: a judge that raises (or returns a malformed
        # verdict) is a no-op for THIS step, not a rescue-aborting error — this
        # is what the module/docstring's "total" guarantee means. The supplied
        # DomainStepJudge is already exception-safe, but rescue_uncheckable
        # accepts any callable, so we defend here too.
        try:
            verdict = judge(
                domain=domain,
                context=context,
                previous_step=_latex(i - 1),
                current_step=_latex(i),
                operation=_field(i, "operation"),
                justification=_field(i, "justification"),
                cas_status=cas_status,
            )
        except Exception:
            log.debug("domain_rescue: judge raised on step %d — leaving %s",
                      i, pv.tier.value, exc_info=True)
            continue
        follows = bool(getattr(verdict, "follows", False))
        conf = _clamp_conf(getattr(verdict, "confidence", 0.0))
        threshold = red_min_confidence if pv.tier is Tier.RED else min_confidence
        log.debug("domain_rescue: step %d verdict follows=%s conf=%.2f (need >=%.2f) "
                  "rationale=%r", i, follows, conf, threshold,
                  _truncate(getattr(verdict, "rationale", "")))
        if not follows or conf < threshold:
            log.debug("domain_rescue: step %d NOT rescued (stays %s)", i, pv.tier.value)
            continue
        new_pv = replace(
            pv,
            tier=Tier.DOMAIN,
            type_consistent=True,
            reason=_rescue_reason(pv.tier, verdict),
        )
        new_pairs[j] = new_pv
        overrides[pv.index] = new_pv
        log.debug("domain_rescue: step %d RESCUED %s -> domain", i, pv.tier.value)

    # One summary line per derivation: how many steps the CAS couldn't settle,
    # how many we actually judged (bounded by max_calls), and how many the judge
    # rescued into DOMAIN. The mirror of module.py's refinement-loop log, but for
    # THIS subsystem (per-step confidence), where the step judge actually lives.
    log.debug("domain_rescue: candidates=%d judged=%d rescued=%d (rescue_red=%s)",
              n_candidates, calls, len(overrides), rescue_red)

    if not overrides:
        return report

    # Rebuild the per-state confidences for the overridden transitions, then
    # re-roll counts / overall / reason from the patched pairs.
    new_steps = [
        replace(sc, tier=overrides[sc.index].tier, reason=overrides[sc.index].reason,
                type_consistent=True)
        if sc.index in overrides else sc
        for sc in report.steps
    ]
    counts = _count_tiers(new_pairs)
    overall = finalize_overall(new_pairs, report.endpoint_reached)
    reason = _overall_reason(new_pairs, counts, report.endpoint_reached)
    return StepGroundingReport(
        steps=new_steps, pairs=new_pairs, overall=overall, counts=counts,
        endpoint_reached=report.endpoint_reached, reason=reason,
    )


def _rescue_reason(prev_tier: Tier, verdict) -> str:
    """User-facing reason for a domain override, honest about what happened.

    A GRAY/BLUE rescue is additive ("the CAS couldn't check this"); a RED
    rescue is a genuine disagreement and says so up front, so the learner /
    reviewer sees the CAS still objects.
    """
    why = (getattr(verdict, "rationale", "") or "").strip() or "a standard move in this domain"
    conf = _clamp_conf(getattr(verdict, "confidence", 0.0))   # bound the displayed %
    if prev_tier is Tier.RED:
        return (f"the CAS REFUTES this symbolically, but a domain expert accepts it "
                f"(confidence {conf:.0%}): {why}")
    return (f"valid by domain knowledge — the CAS could not check this symbolically; "
            f"a domain expert accepts it (confidence {conf:.0%}): {why}")
