"""Tier-graded grounding score for the refinement reward (issue #372 §B).

``step_grounding.py`` ranks each transition into one of five confidence tiers
but never reduces them to a number. The refinement loop needs exactly that
number: a graded score in ``[0, 1]`` so a ``Plausible`` derivation scores *mid*
(not floored) while a ``Refuted`` step drags the blend down on its own weight —
nothing short-circuits or rejects (that is the threshold's job, in ``reward.py``).

The map is the existing ordinal ``TIER_RANK / 4`` (issue #372 §B):

    Grounded 1.0 · Verified 0.75 · Plausible 0.5 · Unchecked 0.25 · Refuted 0.0

We score the **mean of per-transition tiers** (a finer gradient than the
weakest-link overall tier, as the issue notes). This module owns the
latex→state→tier bridge so the reward stays declarative; it reuses
``metric.states_to_graphs`` (the single source of truth for per-state
convertibility) and ``grounding.graph_to_sympy`` — no new parsing logic.
"""

from __future__ import annotations

from dataclasses import dataclass

from .grounding import graph_to_sympy
from .step_grounding import TIER_LABEL, TIER_RANK, Tier, ground_steps

# Denominator that turns an ordinal tier rank (0..4) into a [0,1] score.
_MAX_RANK = max(TIER_RANK.values())  # 4

# How many per-step problems to spell out in the feedback before truncating.
_MAX_FEEDBACK_STEPS = 8


def _detailed_reason(report) -> str:
    """Summary + the specific steps that aren't verified, so feedback is actionable.

    Lists the actually-actionable failures first — ``refuted`` (wrong) then
    ``unchecked`` (not a single convertible expression) — then ``plausible``
    (CAS couldn't decide; not necessarily wrong) to fill out the budget. Each
    entry is ``step N (tier): reason`` so a retry (and a human reading the log)
    knows *which* step and *why*, not just the counts.
    """
    order = {Tier.RED: 0, Tier.GRAY: 1, Tier.BLUE: 2}   # refuted, unchecked, plausible
    probs = sorted((p for p in report.pairs if p.tier in order),
                   key=lambda p: (order[p.tier], p.index))
    if not probs:
        return report.reason
    shown = probs[:_MAX_FEEDBACK_STEPS]
    detail = "; ".join(
        f"step {p.index} ({TIER_LABEL[p.tier].lower()}): {p.reason}" for p in shown)
    more = (f" (+{len(probs) - len(shown)} more)"
            if len(probs) > len(shown) else "")
    return f"{report.reason}. Issues — {detail}{more}"


@dataclass(frozen=True)
class GroundingScore:
    score: float          # mean per-transition tier, in [0, 1]
    reason: str           # the step-grounding report's one-liner (feedback text)
    overall: object       # the report's weakest-link Tier (diagnostics)
    report: object        # the full StepGroundingReport (diagnostics)


def _state_sympy(graph):
    if graph is None:
        return None
    try:
        return graph_to_sympy(graph)
    except Exception:
        return None


def grounding_score(start_graph, steps, target_graph, *, domain=None) -> GroundingScore:
    """Grade a trajectory's step-to-step grounding into a ``[0, 1]`` score.

    ``start_graph`` / ``target_graph`` are the (already parsed) endpoint graphs
    the expert derived between; ``steps`` is the list of ``DerivationStep`` the
    model produced. Pure and total — never raises (degrades to a low score).

    An empty derivation scores 0.0 (nothing established).
    """
    # local import avoids a module-load cycle (metric imports this is not the
    # case, but keep the dependency edge one-directional and lazy to be safe).
    from .metric import states_to_graphs

    graphs, _bad = states_to_graphs(start_graph, list(steps or []), domain)
    states = [_state_sympy(g) for g in graphs]            # graphs[0] is the start
    change_types = [getattr(s, "change_type", None) for s in (steps or [])]
    target_expr = _state_sympy(target_graph)

    report = ground_steps(states, change_types=change_types, target=target_expr)
    if not report.pairs:
        return GroundingScore(0.0, report.reason, report.overall, report)

    mean_rank = sum(TIER_RANK[p.tier] for p in report.pairs) / len(report.pairs)
    return GroundingScore(mean_rank / _MAX_RANK, _detailed_reason(report),
                          report.overall, report)
