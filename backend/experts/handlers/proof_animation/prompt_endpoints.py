"""Prompt → derivation endpoints (reusable DSPy predict).

Names the canonical START and TARGET expressions a short request asks to derive.
Used by the proof-animation handler (to infer a START when the client doesn't
supply one) and by the offline ``scripts/proof_animation/derive.py`` CLI.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""

from __future__ import annotations

import dspy


class ProofPromptSig(dspy.Signature):
    """Name the exact start and target expressions a short request asks to derive.

    Given a brief topic/request (e.g. "derive Lorentz time dilation"), output the
    canonical STARTING expression and the canonical TARGET (result) expression of
    that derivation, both as plain LaTeX, plus a math domain and a short title.
    Both expressions must be complete, valid, parseable LaTeX — the actual
    endpoints a textbook would prove between (not the intermediate steps).
    """

    prompt: str = dspy.InputField(desc="the request, e.g. 'derive Lorentz time dilation'")
    start_latex: str = dspy.OutputField(desc="canonical starting expression, as LaTeX")
    target_latex: str = dspy.OutputField(desc="canonical target/result expression, as LaTeX")
    domain: str = dspy.OutputField(desc="math domain: algebra, calculus, etc.")
    title: str = dspy.OutputField(desc="short display title for the derivation")
    given_label: str = dspy.OutputField(
        desc="a short 'Given …' label NAMING the starting expression, e.g. "
             "'Given the quadratic equation', 'Given the energy–momentum relation'")
    start_note: str = dspy.OutputField(
        desc="one short line on the goal / what to do (e.g. 'solve for $x$'); "
             "may use inline $…$ LaTeX")


def endpoints_from_prompt(prompt: str) -> tuple[str, str, str, str, str, str]:
    """LM-propose (start, target, domain, title, given_label, start_note) for a request."""
    ep = dspy.Predict(ProofPromptSig)(prompt=prompt)
    return (ep.start_latex.strip(), ep.target_latex.strip(),
            (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.given_label or "").strip(), (ep.start_note or "").strip())
