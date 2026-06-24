"""LM inference of derivation endpoints (reusable DSPy predicts).

Two distinct situations, one per signature:

* :class:`BothEndpointsSig` / :func:`endpoints_from_prompt` — NEITHER endpoint is
  known: name BOTH the start and the target from a topic ("derive Lorentz time
  dilation"). Used only by the offline ``scripts/proof_animation/derive.py`` CLI
  in ``--prompt`` mode.
* :class:`StartGivenTargetSig` / :func:`start_given_target` — the TARGET is known:
  name only the start, with the givens/goal as context. Used by the
  proof-animation handler (the live app always sends the target).

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""

from __future__ import annotations

import dspy

from backend.semantic_graph.preprocessor import strip_math_delimiters


class BothEndpointsSig(dspy.Signature):
    r"""Name the exact start and target expressions a short request asks to derive.

    Given a brief topic/request (e.g. "derive Lorentz time dilation"), output the
    canonical STARTING expression and the canonical TARGET (result) expression of
    that derivation, both as plain LaTeX, plus a math domain and a short title.
    Both expressions must be complete, valid, parseable LaTeX — the actual
    endpoints a textbook would prove between (not the intermediate steps).

    Emit the math as BARE LaTeX only: do NOT wrap ``start_latex`` / ``target_latex``
    in math-mode delimiters (no ``$…$``, ``$$…$$``, ``\(…\)`` or ``\[…\]``). The
    expressions are parsed directly, so a stray delimiter makes them unparseable.
    """

    prompt: str = dspy.InputField(desc="the request, e.g. 'derive Lorentz time dilation'")
    start_latex: str = dspy.OutputField(
        desc="canonical starting expression, as bare LaTeX (NO $…$ / $$…$$ delimiters)")
    target_latex: str = dspy.OutputField(
        desc="canonical target/result expression, as bare LaTeX (NO $…$ / $$…$$ delimiters)")
    domain: str = dspy.OutputField(desc="math domain: algebra, calculus, etc.")
    title: str = dspy.OutputField(desc="short display title for the derivation")
    given_label: str = dspy.OutputField(
        desc="a short 'Given …' label NAMING the starting expression, e.g. "
             "'Given the quadratic equation', 'Given the energy–momentum relation'")
    start_note: str = dspy.OutputField(
        desc="one short line on the goal / what to do (e.g. 'solve for $x$'); "
             "may use inline $…$ LaTeX")


# Predictors are built once and reused (DSPy resolves the configured LM at call
# time, so module-level construction is safe and matches module.py / judge.py).
_both_endpoints_predict = dspy.Predict(BothEndpointsSig)


def endpoints_from_prompt(prompt: str) -> tuple[str, str, str, str, str, str]:
    """LM-propose (start, target, domain, title, given_label, start_note) for a request."""
    ep = _both_endpoints_predict(prompt=prompt)
    # The LM frequently wraps its endpoint LaTeX in $…$ math delimiters; strip
    # them so the start/target both PARSE and render cleanly (titles re-wrap in
    # $…$, so a leftover $ would yield a doubled $$…$$).
    return (strip_math_delimiters(ep.start_latex), strip_math_delimiters(ep.target_latex),
            (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.given_label or "").strip(), (ep.start_note or "").strip())


class StartGivenTargetSig(dspy.Signature):
    r"""Name the canonical STARTING expression for deriving a KNOWN target.

    Unlike :class:`BothEndpointsSig` (which invents both endpoints from a topic),
    here the TARGET is already given — only the start is unknown. Use the context
    (givens / goal / preceding steps) as BACKGROUND to pick the natural starting
    expression a textbook would derive the target from; do NOT echo the context
    verbatim, and do NOT re-state the target.

    ``start_latex`` must be exactly ONE complete, valid, parseable LaTeX relation:
    a single statement (one ``=``/``\leq``/…), with NO ``;`` or comma-joined extra
    relations, and NO math-mode delimiters (no ``$…$``/``$$…$$``). It is parsed
    directly, so any of those makes it unusable. (A multi-relation goal must be
    distilled to the single relation the derivation actually starts from.)
    """

    target_latex: str = dspy.InputField(desc="the target/result expression being derived")
    context: str = dspy.InputField(
        desc="background — givens/goal and preceding steps (may be empty); not to echo")
    start_latex: str = dspy.OutputField(
        desc="ONE starting relation, bare LaTeX, a single statement (no ';', no $…$)")
    domain: str = dspy.OutputField(desc="math domain: algebra, calculus, etc.")
    title: str = dspy.OutputField(desc="short display title for the derivation")
    given_label: str = dspy.OutputField(
        desc="a short 'Given …' label NAMING the starting expression")
    start_note: str = dspy.OutputField(
        desc="one short line on the goal / what to do; may use inline $…$ LaTeX")


_start_given_target_predict = dspy.Predict(StartGivenTargetSig)


def start_given_target(target_latex: str, context: str) -> tuple[str, str, str, str, str]:
    """LM-name (start, domain, title, given_label, start_note) for a KNOWN target.

    The handler always has the target, so it infers only the start — avoiding the
    both-endpoints namer (which wasted an inferred target and nudged the LM to
    echo a multi-relation goal as an unparseable compound start; see #396).
    """
    ep = _start_given_target_predict(target_latex=target_latex, context=context)
    return (strip_math_delimiters(ep.start_latex),
            (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.given_label or "").strip(), (ep.start_note or "").strip())
