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

import re

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

# Node types that name a quantity/object a learner would want described (the
# symbols), as opposed to operators / relations / structural nodes. Used to
# collect the derivation's terms for per-term descriptions (the handler then
# fills in the prose via an LM; see term_descriptions.py).
# Leaf symbol nodes (a named quantity/object) worth describing.
_TERM_TYPES = {"scalar", "vector", "constant", "ket", "bra", "braket", "differential"}
# UNARY composite operators worth describing as a single term — hovering V² →
# "the square of the velocity". Their LaTeX is None, so we describe their
# ``subexpr`` (the full applied form, e.g. "V^{2}", "\frac{d}{dt}V"). Deliberately
# NOT multiply/add/equals/relations: those span the whole sub-expression/equation,
# so describing them as one "term" is meaningless. Functions are caught by type.
_TERM_OPS = {"power", "derivative", "integral"}
# Structural LaTeX (a fraction bar, a product dot, a root) — NOT a symbol. Stripping
# these reveals whether what's left is purely numeric; symbol commands (\rho, \Delta)
# are kept so e.g. "\rho_0" / "\Delta t" aren't misread as numbers.
_STRUCTURAL_CMD = re.compile(r"\\(?:[dtc]?frac|cdot|times|div|sqrt|left|right)\b")


def _is_numeric(sym: str) -> bool:
    """True for a purely NUMERIC term — a bare literal ("2", "1.5") OR a numeric
    fraction/power ("\\frac{1}{2}", "2^{3}"). Such terms are meaningless to
    describe ("the number 2") and collide with same-looking exponents/denominators.
    Strip LaTeX structure (commands, braces) and check nothing but digits/operators
    remain — a NAMED symbol or sub-expression keeps a letter (V, \\rho, V^{2})."""
    s = _STRUCTURAL_CMD.sub("", sym)           # drop STRUCTURAL LaTeX (\frac, \cdot, \sqrt)
    s = re.sub(r"\\[a-zA-Z]+", "x", s)         # any REMAINING command is a SYMBOL (\rho, \Delta) → a letter
    s = re.sub(r"[{}()\\\s_^]", "", s)         # drop braces/parens/backslash/space/sub-sup markers
    return bool(s) and re.fullmatch(r"[\d.,/+\-]+", s) is not None


def _is_term_node(n) -> bool:
    """A leaf symbol, a function application, or a unary composite (power /
    derivative / integral) — the things a learner would hover to ask "what is
    this?". Excludes n-ary/relational operators (their subexpr is everything)."""
    t = getattr(n, "type", None)
    if t in _TERM_TYPES or t == "function":
        return True
    return t == "operator" and getattr(n, "op", None) in _TERM_OPS


def _collect_terms(graph, terms: dict) -> None:
    """Add this state's describable terms to ``terms``, keyed by node id (the same
    id threaded into the annotated LaTeX). Union across states, so a term that
    appears only in an intermediate step — and therefore has NO node in the
    on-screen scene graph — is still captured. First occurrence wins.

    Uses ``subexpr`` (the full form) as the identity, falling back to latex/label —
    a composite node's latex is None, so subexpr is what carries its meaning."""
    for n in (getattr(graph, "nodes", None) or []):
        if not _is_term_node(n):
            continue
        sym = (getattr(n, "subexpr", None) or getattr(n, "latex", None)
               or getattr(n, "label", None) or "").strip()
        if sym and not _is_numeric(sym) and n.id not in terms:
            terms[n.id] = {"latex": sym, "name": (getattr(n, "label", None) or sym)}


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
    # Derivation-wide stable-id history (signature -> canonical id). Threaded
    # through every rebase so ids stay consistent across ALL states — a
    # sub-expression that vanishes and reappears regains its id, and non-adjacent
    # states (a scrub/jump) morph instead of delete+insert.
    registry: dict = {}
    out = []
    terms: dict = {}   # node id -> {latex, name}: the derivation's named symbols
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
                # rebase onto the previous good state (onto itself for state 0)
                # so every state — including the first — registers its ids.
                cand = _rebase(g if working is None else working, g, registry)
                annotated = to_latex(cand, with_ids=True)   # annotated, stable ids
                plain = to_latex(cand)                       # for labels/fallback
                working = cand
                _collect_terms(cand, terms)                  # named symbols, by id
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
    # ``terms`` carries the derivation's symbols (id -> {latex, name}); the handler
    # fills in per-term descriptions via an LM (build() itself stays LM-free, so
    # offline tooling/tests get the symbols without prose).
    return {"title": title, "domain": domain, "steps": out,
            "overall_confidence": overall, "terms": terms}


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
