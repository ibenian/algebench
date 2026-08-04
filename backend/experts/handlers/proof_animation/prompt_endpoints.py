r"""LM inference of derivation ENDPOINTS — the start and target a proof runs between.

"Endpoint" here is the end of a *derivation*, not an HTTP route. Before the
proof-completion expert can derive anything, something must name what it is
deriving *from* and *to*; that is this module. Which signature applies is decided
by which end is already known:

* :class:`BothEndpointsSig` / :func:`endpoints_from_prompt` — NEITHER end known:
  name both from a topic ("derive Lorentz time dilation"). Used by the offline
  ``scripts/proof_animation/derive.py --prompt`` CLI *and* by the live
  ``POST /api/expert/proof_from_prompt`` route when no start is supplied.
* :class:`StartGivenTargetSig` / :func:`start_given_target` — the TARGET is known:
  name only the start, with the givens/goal as context.
* :class:`TargetGivenStartSig` / :func:`target_given_start` — the START is known:
  the reader is CONTINUING an open derivation, so name where the instruction
  lands.

:class:`ProofQuestionSig` / :func:`answer_proof_question` also lives here but is
not an endpoint namer — it is the proof-scoped Q&A predict.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""

from __future__ import annotations

import re

import dspy

from backend.experts.llm_config import make_adapter, retry_on_parse_error
from backend.semantic_graph.preprocessor import strip_math_delimiters
from backend.util.latex import unmangle_latex

# DSPy's ChatAdapter frames fields with `[[ ## name ## ]]` markers; some models
# echo a trailing `[[ ## completed ## ]]` into a free-text output. Strip them.
_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

# The endpoint namer emits this exact token for BOTH endpoints when a request
# isn't a derivable math statement (see BothEndpointsSig). Normalized form —
# `is_invalid_sentinel` strips spacing/case so "INVALID PROMPT" also matches.
_INVALID_SENTINEL = "INVALIDPROMPT"


class InvalidPromptError(ValueError):
    """Raised by :func:`endpoints_from_prompt` when the namer flags a request as
    not a derivable math statement.

    Raising here — rather than returning the ``INVALID_PROMPT`` token — protects
    EVERY caller (the web handler and the offline CLI) by construction, and keeps
    the token from ever reaching the parser, where "INVALID PROMPT" would parse as
    a product of single-letter variables and fabricate a bogus proof.
    """


def is_invalid_sentinel(s: str) -> bool:
    """True if ``s`` is the namer's INVALID_PROMPT marker (any spacing/case)."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower()) == _INVALID_SENTINEL.lower()


#: Re-asks allowed when a response cannot be parsed. See
#: :func:`~backend.experts.llm_config.retry_on_parse_error` for why this exists
#: at all — it replaces ``ChatAdapter``'s silent JSONAdapter fallback, which is
#: refused globally because it re-decoded every field through JSON escaping.
_PARSE_ATTEMPTS = 2


def _ask(signature, **kwargs):
    """Run one of this module's predictors, re-asking on an unparseable response.

    Uses :class:`~backend.experts.adapters.LineAdapter` so the wire format has no
    JSON escape layer — backslashes in LaTeX survive verbatim (#517, #522).
    """
    return retry_on_parse_error(
        lambda: dspy.Predict(signature, adapter=make_adapter(line_oriented=True))(**kwargs),
        attempts=_PARSE_ATTEMPTS,
        label=signature.__name__)


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

    If the request is NOT a derivable mathematical statement (gibberish, a bare
    number, an off-topic or empty ask), output the exact token ``INVALID_PROMPT``
    for BOTH ``start_latex`` and ``target_latex`` (and leave the rest empty). Do
    NOT invent a plausible-looking derivation for a request that isn't one.
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


def endpoints_from_prompt(prompt: str) -> tuple[str, str, str, str, str, str]:
    """LM-propose (start, target, domain, title, given_label, start_note) for a request.

    Raises :class:`InvalidPromptError` if the namer flags the request as non-math
    (emits the ``INVALID_PROMPT`` sentinel for the endpoints), so no caller ever
    derives from a request that isn't one.
    """
    ep = _ask(BothEndpointsSig, prompt=prompt)
    # The LM frequently wraps its endpoint LaTeX in $…$ math delimiters; strip
    # them so the start/target both PARSE and render cleanly (titles re-wrap in
    # $…$, so a leftover $ would yield a doubled $$…$$).
    start = unmangle_latex(strip_math_delimiters(ep.start_latex))
    target = unmangle_latex(strip_math_delimiters(ep.target_latex))
    if is_invalid_sentinel(start) or is_invalid_sentinel(target):
        raise InvalidPromptError(prompt)
    return (start, target,
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


def start_given_target(target_latex: str, context: str) -> tuple[str, str, str, str, str]:
    """LM-name (start, domain, title, given_label, start_note) for a KNOWN target.

    The handler always has the target, so it infers only the start — avoiding the
    both-endpoints namer (which wasted an inferred target and nudged the LM to
    echo a multi-relation goal as an unparseable compound start; see #396).
    """
    ep = _ask(StartGivenTargetSig, target_latex=target_latex, context=context)
    return (unmangle_latex(strip_math_delimiters(ep.start_latex)),
            (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.given_label or "").strip(), (ep.start_note or "").strip())


class TargetGivenStartSig(dspy.Signature):
    r"""Name the TARGET expression an instruction reaches from a KNOWN start.

    The mirror of :class:`StartGivenTargetSig`. Here the START is already known —
    the reader is CONTINUING an open derivation — and the instruction says where
    to go from it: "solve for $y$", "factor it", "isolate $t$", "now simplify".

    :class:`BothEndpointsSig` cannot do this job. Handed "solve for y" with no
    expression attached it has nothing to solve, so it emits the INVALID_PROMPT
    sentinel and the request is rejected as non-math — even though the start was
    supplied and the pair is perfectly derivable.

    ``target_latex`` must be exactly ONE complete, valid, parseable LaTeX
    relation: a single statement (one ``=``/``\leq``/…), with NO ``;`` or
    comma-joined extra relations, and NO math-mode delimiters. It is parsed
    directly, so any of those makes it unusable. Work the instruction out on the
    START and state the RESULT — do not restate the start, and do not describe
    the operation in words.
    """

    start_latex: str = dspy.InputField(
        desc="the expression the derivation continues FROM")
    instruction: str = dspy.InputField(
        desc="what to do to it, in the reader's own words")
    target_latex: str = dspy.OutputField(
        desc="ONE resulting relation, bare LaTeX, a single statement "
             "(no ';', no $…$); INVALID_PROMPT if the instruction is not math")
    domain: str = dspy.OutputField(desc="math domain: algebra, calculus, etc.")
    title: str = dspy.OutputField(desc="short display title for the derivation")
    given_label: str = dspy.OutputField(
        desc="a short 'Given …' label NAMING the starting expression")
    start_note: str = dspy.OutputField(
        desc="one short line on the goal / what to do; may use inline $…$ LaTeX")


def target_given_start(start_latex: str, instruction: str) -> tuple[str, str, str, str, str]:
    """LM-name (target, domain, title, given_label, start_note) for a KNOWN start.

    Raises :class:`InvalidPromptError` when the instruction is not math, matching
    :func:`endpoints_from_prompt` so the caller's guard is unchanged.
    """
    ep = _ask(TargetGivenStartSig, start_latex=start_latex,
              instruction=instruction)
    target = unmangle_latex(strip_math_delimiters(ep.target_latex))
    if is_invalid_sentinel(target):
        raise InvalidPromptError(instruction)
    return (target, (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.given_label or "").strip(), (ep.start_note or "").strip())


class ProofQuestionSig(dspy.Signature):
    r"""Answer a question about ONE specific, self-contained math derivation.

    You are a concise, rigorous math tutor. Ground every answer ONLY in the given
    derivation and standard mathematics. This is a STANDALONE proof — do NOT
    mention lessons, scenes, courses, an app, or any UI; do not offer to
    navigate, open, or animate anything. If the question is unrelated to the
    derivation or to math, say so briefly. Use inline LaTeX ($…$) for all math.
    """

    derivation: str = dspy.InputField(desc="the derivation: title, goal, and its steps")
    question: str = dspy.InputField(desc="the user's question about that derivation")
    answer: str = dspy.OutputField(desc="a concise, correct answer; use $…$ LaTeX for math")


def answer_proof_question(derivation: str, question: str) -> str:
    """Answer a question grounded ONLY in the given derivation (proof-scoped chat)."""
    ans = _ask(ProofQuestionSig, derivation=derivation, question=question).answer or ""
    return _DSPY_MARKER.sub("", ans).strip()
