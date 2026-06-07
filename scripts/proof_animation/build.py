#!/usr/bin/env python3
"""Proof-animation CONVERSION library — a ProofTrajectory → animation data.

Deterministic, no LM. Given the expert's output (a ``ProofTrajectory``: a start
state + ordered ``DerivationStep``s), this threads the states so a sub-expression
that persists keeps the SAME node id across states (GumTree-style rebase) and
renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with those
stable ids. The JS engine FLIP-morphs between states keyed on ``data-n``.

This module is the conversion only. The committed test cases live in
``tests/proof_animation/proof_animations.json``; rendering to HTML is ``report.py``;
deriving a proof from a prompt is ``derive.py``.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from backend.experts.modules.proof_completion.outputs import ProofTrajectory

# The conversion core now lives in the proof_animation handler package so the
# live server can render animations too. Re-imported here (and kept available
# under this module's name) so the offline tooling and the test suite keep
# working unchanged.
from backend.experts.handlers.proof_animation.animation import (  # noqa: F401
    _children, _rebase, _subtree_sigs, build,
)


class ProofAnimation(BaseModel):
    """One animation = a ProofCompletionExpert ``ProofTrajectory`` + display meta.

    The ``trajectory`` is the expert's output type **verbatim**, so a real expert
    result animates with zero conversion. ``title``/``domain`` are the only
    animation-side additions — a trajectory carries no display label and no parser
    domain of its own.
    """

    model_config = ConfigDict(extra="forbid")
    title: str
    domain: str = "algebra"
    # Caption for the initial state (step 0). The trajectory's start_latex carries
    # no operation/justification of its own, so the animation supplies them — both
    # may use inline $…$ LaTeX.
    start_operation: str = "Start"
    start_justification: str = "the starting expression"
    trajectory: ProofTrajectory


def build(trajectory: ProofTrajectory, domain: str, title: str = "", *,
          start_operation: str = "Start",
          start_justification: str = "the starting expression") -> dict:
    """Render a ProofCompletionExpert ``ProofTrajectory`` into animation data.

    The trajectory is the expert's output: ``start_latex`` plus ordered
    ``DerivationStep``s (each a complete ``expr_latex`` reached by one
    ``operation``). The animation chain is the start state followed by each step's
    expression; we parse each, rebase onto the previous so persisting parts keep
    stable ids, and emit id-annotated LaTeX for the FLIP engine. ``start_operation``
    / ``start_justification`` caption the initial state (step 0).
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
    for i, (operation, justification, ltx) in enumerate(chain):
        g = svc.latex_to_graph(ltx, domain=domain)
        if g is None:
            raise ValueError(f"could not parse state {i}: {ltx!r}")
        # rebase: keep g's authored structure, reuse stable ids for persisting parts
        working = g if working is None else _rebase(working, g)
        out.append({
            "index": i,
            "operation": operation,
            "justification": justification,
            "input_latex": ltx,                         # what was authored
            "latex": to_latex(working, with_ids=True),  # annotated, stable ids
            "plain": to_latex(working),                 # for labels/fallback
        })
    return {"title": title, "domain": domain, "steps": out}


def build_animation(anim: ProofAnimation) -> dict:
    """Build animation data from a ProofAnimation (carries the step-0 caption)."""
    return build(anim.trajectory, anim.domain, anim.title,
                 start_operation=anim.start_operation,
                 start_justification=anim.start_justification)
