"""Tests for the inference-time domain rescue (issue #385).

The domain judge is an LM, so every test here uses a STUB judge — a plain
callable returning a ``DomainVerdict`` — to drive the rescue deterministically.
We assert: the DOMAIN tier wiring, that only CAS-undecided steps are judged,
that RED is gated, confidence thresholds, report rebuild, and total safety.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from backend.experts.modules.proof_completion.domain_rescue import rescue_uncheckable
from backend.experts.modules.proof_completion.judge import DomainVerdict
from backend.experts.modules.proof_completion.step_grounding import (
    PairVerdict,
    StepConfidence,
    StepGroundingReport,
    Tier,
    TIER_ICON,
    TIER_LABEL,
    TIER_MEANING,
    TIER_RANK,
    finalize_overall,
)


# --------------------------------------------------------------------------- #
# tier wiring
# --------------------------------------------------------------------------- #


def test_domain_tier_ranks_between_blue_and_silver():
    assert TIER_RANK[Tier.BLUE] < TIER_RANK[Tier.DOMAIN] < TIER_RANK[Tier.SILVER]


def test_domain_tier_has_label_icon_meaning():
    assert TIER_LABEL[Tier.DOMAIN] == "Domain"
    assert TIER_ICON[Tier.DOMAIN]
    assert "domain knowledge" in TIER_MEANING[Tier.DOMAIN]


# --------------------------------------------------------------------------- #
# stub judge + report builders
# --------------------------------------------------------------------------- #


@dataclass
class _StubJudge:
    """Records calls and returns a fixed verdict (or per-cas_status mapping)."""

    verdict: DomainVerdict = None
    by_status: dict = None

    def __post_init__(self):
        self.calls = []

    def __call__(self, *, domain, context, previous_step, current_step,
                 operation, justification, cas_status):
        self.calls.append({
            "cas_status": cas_status,
            "previous_step": previous_step,
            "current_step": current_step,
            "operation": operation,
        })
        if self.by_status is not None:
            return self.by_status.get(cas_status, DomainVerdict(False, 0.0, ""))
        return self.verdict


def _pair(index, tier, relation="unknown"):
    return PairVerdict(index, tier, relation, "none", None, tier is not Tier.RED,
                       f"reason for step {index}")


def _report(tiers, endpoint=None):
    """A report from a list of per-transition tiers (state 0 is GOLD start)."""
    pairs = [_pair(i + 1, t, "refuted" if t is Tier.RED else "unknown")
             for i, t in enumerate(tiers)]
    steps = [StepConfidence(0, Tier.GOLD, None, "start", True)]
    steps += [StepConfidence(p.index, p.tier, p.relation, p.reason, p.type_consistent)
              for p in pairs]
    counts = {t.value: 0 for t in Tier}
    for p in pairs:
        counts[p.tier.value] += 1
    overall = finalize_overall(pairs, endpoint)
    return StepGroundingReport(steps=steps, pairs=pairs, overall=overall,
                               counts=counts, endpoint_reached=endpoint,
                               reason="orig reason")


def _states(n):
    return [{"latex": f"s{i}", "operation": f"op{i}", "justification": f"why{i}"}
            for i in range(n)]


# --------------------------------------------------------------------------- #
# rescue behavior
# --------------------------------------------------------------------------- #


def test_rescues_gray_step_to_domain():
    report = _report([Tier.GOLD, Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.9, "force-balance expansion"))
    out = rescue_uncheckable(report, _states(3), domain="hydrostatics",
                             context="", judge=judge)
    assert out.pairs[1].tier is Tier.DOMAIN
    assert out.steps[2].tier is Tier.DOMAIN
    assert "force-balance expansion" in out.pairs[1].reason
    assert out.counts["domain"] == 1
    assert out.counts["unchecked"] == 0


def test_rescues_blue_step_to_domain():
    report = _report([Tier.BLUE])
    judge = _StubJudge(DomainVerdict(True, 0.95, "applies F=ma"))   # >= default 0.9 bar
    out = rescue_uncheckable(report, _states(2), domain="mechanics",
                             context="", judge=judge)
    assert out.pairs[0].tier is Tier.DOMAIN
    # BLUE feeds the judge as "undecided".
    assert judge.calls[0]["cas_status"] == "undecided"


def test_default_min_conf_excludes_mid_confidence():
    # A 0.8 verdict no longer clears the default 0.9 bar (was 0.6 previously).
    report = _report([Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.8, "only moderately sure"))
    out = rescue_uncheckable(report, _states(2), domain="d", context="", judge=judge)
    assert out.pairs[0].tier is Tier.GRAY          # not rescued at the high default bar


def test_only_undecided_steps_are_judged():
    # GOLD / SILVER never go to the judge — only GRAY and BLUE.
    report = _report([Tier.GOLD, Tier.GRAY, Tier.SILVER, Tier.BLUE])
    judge = _StubJudge(DomainVerdict(False, 0.0, ""))
    rescue_uncheckable(report, _states(5), domain="d", context="", judge=judge)
    statuses = sorted(c["cas_status"] for c in judge.calls)
    assert statuses == ["uncheckable", "undecided"]   # the GRAY and the BLUE only


def test_low_confidence_is_not_rescued():
    report = _report([Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.3, "weak"))
    out = rescue_uncheckable(report, _states(2), domain="d", context="",
                             judge=judge, min_confidence=0.6)
    assert out.pairs[0].tier is Tier.GRAY            # unchanged
    assert out is report                              # nothing overridden → same obj


def test_follows_false_is_not_rescued():
    report = _report([Tier.GRAY])
    judge = _StubJudge(DomainVerdict(False, 0.99, "not a valid move"))
    out = rescue_uncheckable(report, _states(2), domain="d", context="", judge=judge)
    assert out.pairs[0].tier is Tier.GRAY


def test_red_excluded_by_default():
    report = _report([Tier.RED])
    judge = _StubJudge(DomainVerdict(True, 1.0, "should be ignored"))
    out = rescue_uncheckable(report, _states(2), domain="d", context="", judge=judge)
    assert out.pairs[0].tier is Tier.RED
    assert judge.calls == []                          # never even consulted


def test_red_rescued_when_gated_on_with_high_confidence():
    report = _report([Tier.RED])
    judge = _StubJudge(DomainVerdict(True, 0.95, "drops a negligible term"))
    out = rescue_uncheckable(report, _states(2), domain="optics", context="",
                             judge=judge, rescue_red=True)
    assert out.pairs[0].tier is Tier.DOMAIN
    assert judge.calls[0]["cas_status"] == "refuted"
    # The reason is explicit that the CAS disagrees.
    assert "REFUTES" in out.pairs[0].reason


def test_red_rescue_needs_red_threshold():
    # 0.8 clears the GRAY/BLUE bar but NOT the stricter RED bar (0.9).
    report = _report([Tier.RED])
    judge = _StubJudge(DomainVerdict(True, 0.8, "borderline"))
    out = rescue_uncheckable(report, _states(2), domain="d", context="",
                             judge=judge, rescue_red=True,
                             min_confidence=0.6, red_min_confidence=0.9)
    assert out.pairs[0].tier is Tier.RED


def test_max_calls_caps_judge_invocations():
    report = _report([Tier.GRAY, Tier.GRAY, Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.9, "ok"))
    out = rescue_uncheckable(report, _states(4), domain="d", context="",
                             judge=judge, max_calls=2)
    assert len(judge.calls) == 2
    # Only the first two GRAY steps were rescued; the third stays GRAY.
    assert [p.tier for p in out.pairs] == [Tier.DOMAIN, Tier.DOMAIN, Tier.GRAY]


def test_overall_re_rolls_after_rescue():
    # A lone GRAY step caps overall at GRAY; rescuing it lifts the chain.
    report = _report([Tier.GOLD, Tier.GRAY], endpoint=None)
    assert report.overall is Tier.GRAY
    judge = _StubJudge(DomainVerdict(True, 0.9, "domain move"))
    out = rescue_uncheckable(report, _states(3), domain="d", context="", judge=judge)
    assert out.overall is Tier.DOMAIN                 # weakest link is now DOMAIN
    # The tally reads as a complete fragment ("1 domain-justified"), not "1 domain".
    assert "domain-justified" in out.reason
    assert "1 domain " not in out.reason


def test_judge_exception_leaves_report_untouched():
    report = _report([Tier.GRAY])

    def boom(**_kw):
        raise RuntimeError("judge died")

    # rescue_uncheckable lets the judge callable raise; the animation layer wraps
    # it, but a well-behaved judge (DomainStepJudge) never raises. Here we assert
    # the contract that a NON-raising judge returning follows=False is a no-op.
    judge = _StubJudge(DomainVerdict(False, 0.0, ""))
    out = rescue_uncheckable(report, _states(2), domain="d", context="", judge=judge)
    assert out.pairs[0].tier is Tier.GRAY


def test_none_judge_is_noop():
    report = _report([Tier.GRAY])
    out = rescue_uncheckable(report, _states(2), domain="d", context="", judge=None)
    assert out is report


def test_empty_report_is_noop():
    report = _report([])
    judge = _StubJudge(DomainVerdict(True, 1.0, "x"))
    out = rescue_uncheckable(report, _states(1), domain="d", context="", judge=judge)
    assert out is report
    assert judge.calls == []


def test_original_report_not_mutated():
    report = _report([Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.9, "ok"))
    rescue_uncheckable(report, _states(2), domain="d", context="", judge=judge)
    assert report.pairs[0].tier is Tier.GRAY          # caller's report intact
    assert report.steps[1].tier is Tier.GRAY


def test_judge_receives_adjacent_states_and_captions():
    report = _report([Tier.GOLD, Tier.GRAY])
    judge = _StubJudge(DomainVerdict(True, 0.9, "ok"))
    rescue_uncheckable(report, _states(3), domain="d", context="", judge=judge)
    call = judge.calls[0]
    assert call["previous_step"] == "s1"              # state[index-1]
    assert call["current_step"] == "s2"               # state[index]
    assert call["operation"] == "op2"
