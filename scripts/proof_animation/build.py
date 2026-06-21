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
# working unchanged. The stable-id matcher was extracted to its own module
# (``tree_match``) for isolated testing; re-exported here under the old names.
from backend.experts.handlers.proof_animation.animation import build  # noqa: F401
from backend.experts.modules.proof_completion.tree_match import (  # noqa: F401
    _children, _subtree_sigs, rebase as _rebase,
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


def build_animation(anim: ProofAnimation) -> dict:
    """Build animation data from a ProofAnimation (carries the step-0 caption)."""
    return build(anim.trajectory, anim.domain, anim.title,
                 start_operation=anim.start_operation,
                 start_justification=anim.start_justification)
