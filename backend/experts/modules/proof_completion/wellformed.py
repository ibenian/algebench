"""Well-formedness: can every caption in a trajectory actually render?

The motivating defect (issue #372): the LM occasionally emits an ``operation`` /
``justification`` with an **unbalanced ``$``** — e.g. ``and $V = 7.8 \text{ km/s}``
with no closing dollar — which leaks raw LaTeX into the rendered caption. A
malformed caption can't render, so well-formedness is a *prerequisite* the
refinement reward weights to dominate (see ``reward.py``).

This is a pure, deterministic string check — no sympy, no LM, no network. It
delegates the delimiter/brace scanning to the reusable :mod:`backend.util.latex`
(so the same ``$…$`` logic backs the chat panel and caption renderer) and adds
the proof-step-specific rules on top:

* prose fields (``operation`` / ``justification``) must have **balanced
  ``$…$``** and balanced braces inside each math segment, with no empty ``$$``;
* ``expr_latex`` is **math only** — it must contain **no ``$``** (it is already
  inside a math context) and have balanced braces.

Two surfaces over one checker (see issue #372 §A):

* :func:`well_formed` — the **soft** surface, for the generation loop's reward:
  returns a graded factor + an ``issues`` critique string (never raises).
* :func:`assert_well_formed` — the **hard** surface, for non-generation data
  edges (stored animation JSON, direct construction in tests): raises
  :class:`MalformedCaption`. *Not* attached as a raising pydantic validator on
  the generated model — that would fire at parse time, before the reward, and
  rob the loop of its targeted feedback (issue #372 §A).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from backend.util.latex import braces_balanced, delimiters_balanced, math_segments


class MalformedCaption(ValueError):
    """A caption/expression is not well-formed (raised at hard data edges)."""


@dataclass(frozen=True)
class WellFormedness:
    """Verdict for a whole trajectory's captions."""

    ok: bool
    issues: List[str] = field(default_factory=list)

    @property
    def factor(self) -> float:
        """Near-binary prerequisite factor for the reward (1.0 ok, else 0.0)."""
        return 1.0 if self.ok else 0.0

    @property
    def issues_text(self) -> str:
        return "; ".join(self.issues)


def prose_issues(text: str, *, where: str) -> List[str]:
    """Well-formedness problems in a prose caption (``operation``/``justification``).

    ``where`` is a short label woven into the message so feedback is targeted
    (e.g. ``"step 2 operation"``).
    """
    issues: List[str] = []
    if not delimiters_balanced(text):
        issues.append(f"{where}: unbalanced '$' — every inline-math segment must "
                      f"open and close with a matching '$'")
        return issues  # segment-level checks are meaningless once delimiters slip
    for seg in math_segments(text):
        if not seg.content.strip():
            issues.append(f"{where}: empty math segment '{seg.delimiter}{seg.delimiter}'")
        elif not braces_balanced(seg.content):
            issues.append(f"{where}: unbalanced '{{'…'}}' inside ${seg.content}$")
    return issues


def expr_issues(expr_latex: str, *, where: str) -> List[str]:
    """Well-formedness problems in an ``expr_latex`` (raw math, no delimiters)."""
    issues: List[str] = []
    if "$" in expr_latex:
        issues.append(f"{where}: expr_latex is math-only and must not contain '$'")
    if not braces_balanced(expr_latex):
        issues.append(f"{where}: unbalanced '{{'…'}}' in expr_latex")
    return issues


def step_issues(step, *, index: int) -> List[str]:
    """Every well-formedness problem in one ``DerivationStep`` (1-based ``index``)."""
    issues: List[str] = []
    issues += prose_issues(step.operation or "", where=f"step {index} operation")
    issues += prose_issues(step.justification or "", where=f"step {index} justification")
    issues += expr_issues(step.expr_latex or "", where=f"step {index} expr_latex")
    return issues


def trajectory_issues(traj) -> List[str]:
    """Every well-formedness problem across a trajectory's steps (and title)."""
    issues: List[str] = []
    title = getattr(traj, "title", None)
    if title:
        issues += prose_issues(title, where="title")
    for i, step in enumerate(getattr(traj, "steps", []) or [], start=1):
        issues += step_issues(step, index=i)
    return issues


def well_formed(traj) -> WellFormedness:
    """Soft surface: the trajectory's well-formedness verdict (never raises)."""
    issues = trajectory_issues(traj)
    return WellFormedness(ok=not issues, issues=issues)


def assert_well_formed(traj) -> None:
    """Hard surface: raise :class:`MalformedCaption` if any caption is malformed.

    Use at non-generation data edges — loading stored animation JSON, or
    constructing a trajectory directly in tests/handlers — where there is no
    retry loop to catch a soft score. Do **not** attach this as a raising
    pydantic validator on the generated model (see module docstring).
    """
    verdict = well_formed(traj)
    if not verdict.ok:
        raise MalformedCaption(verdict.issues_text)
