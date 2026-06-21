"""Proof-animation CONVERSION library — a ProofTrajectory → animation data.

Deterministic, no LM. Given the expert's output (a ``ProofTrajectory``: a start
state + ordered ``DerivationStep``s), this threads the states so a sub-expression
that persists keeps the SAME node id across states (GumTree-style rebase) and
renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with those
stable ids. The JS engine FLIP-morphs between states keyed on ``data-n``.

This module is the conversion core. The proof-animation *handler* (``handler.py``)
calls ``build`` after running the ProofCompletionExpert; the offline tooling
(``scripts/proof_animation/build.py``) re-imports ``build`` and wraps it with a
``ProofAnimation`` display model.
"""
from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.tree_match import rebase as _rebase
from backend.experts.modules.proof_completion.cas_guard import guard as _guard
from backend.experts.modules.proof_completion.grounding import graph_to_sympy
from backend.experts.modules.proof_completion.domain_rescue import rescue_uncheckable
from backend.experts.modules.proof_completion.metric import PLACEHOLDER_TOKENS
from backend.experts.modules.proof_completion.outputs import ProofTrajectory
from backend.experts.modules.proof_completion.step_grounding import (
    TIER_ICON, TIER_LABEL, TIER_MEANING, Tier, ground_steps,
)


def build(trajectory: ProofTrajectory, domain: str, title: str = "", *,
          start_operation: str = "Start",
          start_justification: str = "the starting expression",
          judge=None, lesson_context: str = "") -> dict:
    """Render a ProofCompletionExpert ``ProofTrajectory`` into animation data.

    The trajectory is the expert's output: ``start_latex`` plus ordered
    ``DerivationStep``s (each a complete ``expr_latex`` reached by one
    ``operation``). The animation chain is the start state followed by each step's
    expression; we parse each, rebase onto the previous so persisting parts keep
    stable ids, and emit id-annotated LaTeX for the FLIP engine. ``start_operation``
    / ``start_justification`` caption the initial state (step 0).

    ``judge`` is an optional :class:`DomainStepJudge`; when supplied (the live
    handler passes one if an LM is configured), the steps the CAS could not check
    are routed to it with ``domain`` + ``lesson_context`` and may be rescued into
    the ``DOMAIN`` tier (issue #385). Omitting it (offline tooling, tests) leaves
    confidence pure-CAS — the rescue is strictly additive.
    """
    # (operation, justification, latex) for every state, starting from the start.
    chain: list[tuple[str, str, str]] = []
    if trajectory.start_latex:
        chain.append((start_operation, start_justification, trajectory.start_latex))
    for s in trajectory.steps:
        chain.append((s.operation, s.justification, s.expr_latex))
    if not chain:
        raise ValueError("trajectory has no states (need start_latex or steps)")

    svc = SemanticGraphService()
    working = None
    out = []
    state_exprs = []   # per-state sympy expr (None: not convertible) for grounding
    for i, (operation, justification, ltx) in enumerate(chain):
        try:
            g = svc.latex_to_graph(ltx, domain=domain)
        except Exception:
            g = None
        # An ungroundable state — one that won't parse to a graph OR whose graph
        # can't be re-rendered (e.g. an operator the renderer doesn't know) — is
        # shown as raw LaTeX (no stable-id morphing) rather than failing the whole
        # derivation. ``working`` only advances on a fully-rendered state, so the
        # next good state rebases onto the last good one.
        annotated = plain = ltx
        expr = None
        if g is not None:
            # A placeholder token (\dots, or a \pm/\mp pseudo-symbol) still
            # renders and FLIP-morphs as a graph, but is not real math — gate
            # ONLY the sympy conversion so its grounding expr stays None (tier
            # "unchecked"), while the state still rebases/animates normally.
            if not any(tok in ltx for tok in PLACEHOLDER_TOKENS):
                # killable guard: graph_to_sympy builds (potentially large)
                # sympy trees; a pathological graph can't peg a core (#386).
                expr = _guard(graph_to_sympy, g, default=None)
            try:
                cand = g if working is None else _rebase(working, g)
                annotated = to_latex(cand, with_ids=True)   # annotated, stable ids
                plain = to_latex(cand)                       # for labels/fallback
                working = cand
            except Exception:
                annotated = plain = ltx
        state_exprs.append(expr)
        out.append({
            "index": i,
            "operation": operation,
            "justification": justification,
            "input_latex": ltx,
            "latex": annotated,
            "plain": plain,
        })

    overall = _attach_confidence(out, state_exprs, trajectory, svc, domain,
                                 judge=judge, lesson_context=lesson_context)
    return {"title": title, "domain": domain, "steps": out,
            "overall_confidence": overall}


def _confidence_payload(tier: Tier, relation=None, reason: str = "",
                        type_consistent: bool = True) -> dict:
    return {
        "tier": tier.value,
        "label": TIER_LABEL[tier],
        "icon": TIER_ICON[tier],
        "meaning": TIER_MEANING[tier],
        "relation": relation,
        "reason": reason,
        "type_consistent": type_consistent,
    }


def _attach_confidence(out, state_exprs, trajectory, svc, domain,
                       judge=None, lesson_context: str = "") -> dict:
    """Rank the chain with ``ground_steps`` and attach per-step + overall verdicts.

    Strictly additive and isolated: any failure degrades to a uniform GRAY —
    confidence ranking must never break the animation build. When ``judge`` is
    supplied, the CAS-undecided steps are routed through
    :func:`rescue_uncheckable` for a possible ``DOMAIN``-tier override (#385).
    """
    try:
        # change_types align to TRANSITIONS: when the chain leads with the start
        # state every step is a transition; otherwise the first step IS state 0.
        steps = trajectory.steps
        change_types = [s.change_type for s in
                        (steps if trajectory.start_latex else steps[1:])]
        target_expr = None
        if trajectory.target_latex:
            try:
                tg = svc.latex_to_graph(trajectory.target_latex, domain=domain)
                target_expr = (_guard(graph_to_sympy, tg, default=None)
                               if tg is not None else None)
            except Exception:
                target_expr = None
        report = ground_steps(state_exprs, change_types=change_types,
                              target=target_expr, domain=domain)
        if judge is not None:
            # Feed the judge each state's authored LaTeX + captions (index-aligned
            # to report.steps). Isolated: a judge failure leaves the CAS report.
            try:
                # ``parseable`` (state_exprs[i] is not None) gates the rescue: a
                # domain-justified step must still be a sympy-convertible
                # expression — we just couldn't connect it to the previous step.
                states = [{"latex": e.get("input_latex", ""),
                           "operation": e.get("operation", ""),
                           "justification": e.get("justification", ""),
                           "parseable": state_exprs[i] is not None}
                          for i, e in enumerate(out)]
                report = rescue_uncheckable(report, states, domain=domain,
                                            context=lesson_context, judge=judge)
            except Exception:
                pass
        for entry, sc in zip(out, report.steps):
            entry["confidence"] = _confidence_payload(
                sc.tier, sc.relation, sc.reason, sc.type_consistent)
        overall = _confidence_payload(report.overall, reason=report.reason)
        overall["counts"] = report.counts
        overall["endpoint_reached"] = report.endpoint_reached
        return overall
    except Exception:
        fallback = _confidence_payload(
            Tier.GRAY, reason="confidence ranking unavailable for this derivation")
        for entry in out:
            entry.setdefault("confidence", dict(fallback))
        overall = dict(fallback)
        overall["counts"] = {t.value: 0 for t in Tier}
        overall["endpoint_reached"] = None
        return overall
