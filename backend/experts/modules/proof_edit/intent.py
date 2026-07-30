r"""Natural-language step operation → a structured, proposed edit.

The LM's job here is to *propose*: name the operation, write the resulting
expression, and optionally write glue steps that reconnect to the step that
followed. It does NOT get the last word — every proposal is graded by the CAS in
``validate.py``, and anything refuted is retried or dropped.

It is deliberately NOT asked how many following steps its edit makes redundant.
That was an unverifiable judgment — nothing could check it, and a wrong count
silently shortened someone's proof by an arbitrary amount. Truncating is now the
reader's decision, offered as a variant whenever anything follows.

The signature also routes. ``is_edit`` decides whether the message was an
operation at all (a question falls through to the tutor chat), and ``question``
lets the model ask instead of guessing when the request is genuinely
under-determined. Those two outputs are why the client's regex can stay a pure
latency shortcut rather than a gate.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import re
from functools import cache

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import scoped_lm
from backend.experts.modules.proof_completion.outputs import (
    _unmangle_json_escapes, unmangle_math)

# DSPy's ChatAdapter frames fields with `[[ ## name ## ]]` markers; some models
# echo a trailing `[[ ## completed ## ]]` into a free-text output. Strip them.
_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

# Hard ceiling on bridging steps. Small on purpose: a bridge that needs more than
# this is a different derivation, not a connector, and a long unreviewable list
# defeats the point of showing the user alternatives.
MAX_GLUE_STEPS = 3

# How many clarification rounds before the model must commit. Bounded so an
# ambiguous request cannot turn into an open-ended interrogation.
MAX_CLARIFICATIONS = 2




class ProposedStep(BaseModel):
    """One step the model proposes adding to the derivation."""

    model_config = ConfigDict(extra="ignore")

    operation: str = Field(default="", max_length=200)
    expr_latex: str = Field(default="", max_length=600)
    justification: str = Field(default="", max_length=600)


class ProofEditProposal(BaseModel):
    """The model's structured answer, before the CAS has had its say."""

    model_config = ConfigDict(extra="ignore")

    is_edit: bool = False
    question: str = ""
    steps: list[ProposedStep] = Field(default_factory=list)
    summary: str = ""
    # When the request maps onto an operation sympy can perform, these say WHICH
    # and with WHAT, and the CAS computes the result instead of trusting the
    # model's ``steps[0]``. See ops.py for why that matters.
    op: str = ""
    operand_latex: str = ""
    replacement_latex: str = ""
    variable: str = ""
    # Which side of an equation a structural rewrite (simplify/expand/factor)
    # applies to: "left", "right", or "both" (default).
    side: str = "both"


class ProofEditSig(dspy.Signature):
    r"""Apply a requested math operation to one step of an existing derivation.

    You are a rigorous mathematician editing a proof. The user is looking at ONE
    step and has asked for an operation on it (e.g. "add $3x$ to both sides",
    "substitute $u = x^2$", "differentiate both sides", "solve for $x$").

    Decide which of three things the message is, and answer accordingly:

    1. NOT AN OPERATION — it is a question, a comment, or unrelated. Set
       `is_edit` false and leave everything else empty. Do not attempt an edit.
    2. UNDER-DETERMINED — it IS an operation, but a choice that CHANGES THE MATH
       is missing (definite vs indefinite integral; whether a divisor may be
       zero; which variable to solve for when several are plausible). Set
       `is_edit` true and put ONE short question in `question`. Ask only when the
       answer changes the result — never about notation or style, and never when
       a sensible reading is obvious. If earlier clarifications are supplied, they
       have already been answered: use them and do NOT ask again.
       In particular, "solve for $x$" on a BARE expression (no equals sign) is NOT
       under-determined — the standard reading is ``expression = 0``. Do NOT ask
       what it equals; set `op` to `solve_for` and let the CAS solve it as ``= 0``.
    3. AN OPERATION YOU CAN APPLY — set `is_edit` true, leave `question` empty,
       and fill `steps`.

    For case 3, ALWAYS try to name the move in `op` first. If it is one of the
    listed operations, set `op` and the operand/variable fields and the computer
    algebra system will perform it for you — that is more reliable than writing
    the result yourself, and it is the only way operations like differentiation
    are accepted.

    STATING A LINE VERBATIM — also a case of 3, and easy to get badly wrong.
    "add $x^2 - 4 = 0$ as the next step", "add this as a new step", "put
    $v = d/t$ next" mean: make that expression, EXACTLY as written, the new step.
    It is NOT `add_both_sides` — that would add the expression TO both sides of
    the previous one and produce something the reader never asked for. Leave `op`
    EMPTY and copy their expression into `steps[0].expr_latex` unchanged. The
    giveaway is "as a/the … step" or "next"; contrast "add $3x$ to both sides",
    which names a TARGET to add to and IS `add_both_sides`.

    NEVER SILENTLY CORRECT WHAT THEY WROTE. If the reader states an expression —
    as a first step or a next step — transcribe it EXACTLY, even when it is
    mathematically wrong. Asked to add $2 + 2 = 3$, write $2 + 2 = 3$. Do NOT
    write $2 + 2 = 4$, and above all do not then justify it as "the correct sum":
    that silently replaces the reader's own statement with a different one and
    tells them it is what they asked for.

    You are not the last line of defence and must not act like it. A false
    statement is REFUTED by the computer algebra system, which says so plainly and
    refuses the edit — so transcribing it faithfully costs nothing and the reader
    finds out. Substituting your own version costs them the truth about what their
    proof now says. If you believe an expression is wrong, write it as given and
    say so in `summary`; never fix it in `expr_latex`.

    BUT NOT WHEN THE LINE IS THE CURRENT STEP EVALUATED. If what they want added
    is the DECIMAL/NUMERIC form of the step in view — "add the decimal
    approximations as the next step", "add $x \approx 0.414$ and
    $x \approx -2.414$", "now give me the numbers" — set `op` to `evaluate`
    instead and let the CAS produce the decimals. Do NOT copy their numbers in.
    Two reasons, both fatal to the verbatim route: a rounded decimal does not
    exactly satisfy the previous step, so the CAS REFUTES it as introducing values
    that do not solve it; and `\approx` is not a relation the parser accepts, so
    the step cannot be checked at all. `evaluate` is computed by the CAS, so it is
    correct by construction and states `=` with evaluated roots.

    EMPTY DERIVATION — a special case of 3. When `current_step` says the
    derivation is EMPTY, there is no previous expression, so there is nothing to
    apply an operation TO. The reader is stating the FIRST line ("start with
    $E = mc^2$", "let $f(x) = x^2 + 1$", "begin from the ideal gas law"):

    * Set `is_edit` true and leave `op` EMPTY — every listed op transforms a
      previous expression, and there isn't one. The CAS cannot help here.
    * Write the opening expression in full as `steps[0].expr_latex`, and add NO
      glue (there is nothing after it to bridge back to).
    * If they name a known law or relation by name rather than writing it, write
      the standard form of it yourself.
    * Only ask a `question` if you cannot tell WHAT relation they mean — not
      because the derivation is empty. "Start with the quadratic equation" is
      clear enough to write down; treat it as an instruction, not a puzzle.
    * `steps[0].operation` is the CAPTION shown above the step, so write it in
      the reader's language — "Given", "Start from the mass-energy relation",
      "Let $f(x) = x^2 + 1$". Never a tool or function name, and never
      `add_step`: those are internal and read as a bug on the page.

    `steps` has TWO parts and you fill BOTH, whether or not you set `op`:

    * `steps[0]` — THE USER'S OWN STEP: the complete LaTeX of the expression
      after applying exactly what they asked, no more. Do not silently simplify,
      rearrange, or take extra moves — if they said "multiply both sides by 2",
      the result must visibly be the previous expression times 2 on each side.
      (When `op` is set the CAS computes this and your version is discarded, but
      write it anyway — it is the fallback if the operation cannot be applied.)

    * `steps[1:]` — up to three GLUE steps, whenever the derivation continues
      past the current step. These are the shortest chain that makes the ORIGINAL
      next step read as a logical consequence again. **`op` does NOT replace
      these.** The CAS can perform one operation; it cannot invent the bridge
      back into the rest of the proof, so glue is always yours to write. Omitting
      it costs the reader the "my step + bridge" option entirely. Add none only
      when no bridge is needed, or when you genuinely cannot build one in three
      steps.


    SCOPE — change ONLY what the reader asked to change. This matters a lot:

    * If they name a SIDE ("expand the left", "simplify the right, leave the
      left"), set `side` to "left"/"right" so the rewrite touches only that side.
    * If they name SPECIFIC TERMS ("expand only the $(b/2a)^2$ term", "factor
      just the numerator"), that is FINER than a whole side — do NOT set a
      structural `op` (simplify/expand/factor rewrite the entire side). Instead
      leave `op` empty and author `steps[0]` yourself: copy the previous
      expression EXACTLY and change only the named terms, character for
      character everywhere else. Reproduce every other term as it was written —
      do not re-order, re-bracket, or re-simplify anything the reader did not
      ask about.
    * When no scope is named, "both" / the whole expression is fine.

    Every expression must be complete, self-contained LaTeX for the whole state
    (both sides of an equation), consistent with the derivation's existing
    notation. Wrap math in `$…$` inside `operation` and `justification` prose.
    """

    derivation: str = dspy.InputField(
        desc="the derivation: title, goal, and its numbered steps")
    current_step: str = dspy.InputField(
        desc="the step the user is looking at: its index and complete LaTeX")
    request: str = dspy.InputField(desc="what the user asked for, verbatim")
    recent_thread: str = dspy.InputField(
        desc="the last few chat turns, for context; may be empty")
    clarifications: str = dspy.InputField(
        desc="questions you already asked and the user's answers; may be empty")

    is_edit: bool = dspy.OutputField(
        desc="true if the message asks for a math operation on the step")
    question: str = dspy.OutputField(
        desc="ONE short question if a math-changing choice is missing; else empty")
    steps: list[dict] = dspy.OutputField(
        desc="ordered [{operation, expr_latex, justification}]: the user's step "
             "first, THEN up to 3 glue steps bridging back to the original next "
             "step. Fill the glue even when `op` is set — the CAS performs the "
             "operation but cannot write the bridge. Empty only if is_edit is "
             "false or a question is being asked")
    op: str = dspy.OutputField(
        desc="if the request maps onto one of these, name it EXACTLY, else leave "
             "empty: add_both_sides, subtract_both_sides, multiply_both_sides, "
             "divide_both_sides, differentiate_both_sides, integrate_both_sides, "
             "substitute, simplify, expand, factor, solve_for, evaluate. For 'solve "
             "for x' use solve_for and put the variable in `variable` — the CAS "
             "solves it; do not write the solved expression yourself. For 'evaluate "
             "numerically', 'compute the value', or 'add the final numeric result' "
             "use evaluate — the CAS produces the decimal; do not write it yourself.")
    operand_latex: str = dspy.OutputField(
        desc="LaTeX of what the op is applied WITH — the amount added/multiplied, "
             "or for `substitute` the sub-expression being replaced; empty if n/a")
    replacement_latex: str = dspy.OutputField(
        desc="for `substitute` only: LaTeX of what replaces operand_latex "
             "(for 'let $u = x^2$' operand is $x^2$ and replacement is $u$)")
    variable: str = dspy.OutputField(
        desc="for differentiate/integrate/solve_for: the variable, e.g. 'x'; "
             "empty otherwise")
    side: str = dspy.OutputField(
        desc="for simplify/expand/factor ONLY: which side of an equation to "
             "rewrite — 'left', 'right', or 'both'. Honour phrases like 'expand "
             "the left side, leave the right' → 'left'. Default 'both'.")
    summary: str = dspy.OutputField(
        desc="one short PLAIN-LANGUAGE sentence naming the move, for the chat — "
             "e.g. 'Simplified the right-hand side.' or 'Multiplied both sides by "
             "2.'. Do NOT restate the resulting expression; it is already shown in "
             "the animation. You may wrap a SMALL quantity (an operand like $3x$) "
             "in $…$, but never a full equation.")


class EditIntentParser(dspy.Module):
    """The intent parser: request → structured :class:`ProofEditProposal`.

    A single ``Predict``, wrapped as a ``Module`` so it has a first-class home in
    the expert package and — like ``ProofCompletionExpert`` — a compile target if
    we later optimize it against a labelled dataset. Its ``forward`` returns the
    RAW DSPy prediction; field cleaning + shaping into the pydantic proposal stays
    in :func:`propose_edit`, so the Module is a thin, optimizable unit and the
    messy post-processing lives outside it.

    Bare ``Predict``, not ``ChainOfThought`` — measured, see ``_LM``.
    """

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ProofEditSig)

    def forward(self, *, derivation: str, current_step: str, request: str,
                recent_thread: str = "", clarifications: str = ""):
        return self.predict(
            derivation=derivation,
            current_step=current_step,
            request=request,
            recent_thread=recent_thread,
            clarifications=clarifications,
        )


# Built once, LAZILY on first use — this file is imported before
# ``configure_dspy()`` runs, so constructing the Module (which binds an LM) is
# deferred to first call. Matches the lazy-predictor timing in
# prompt_endpoints.py / term_descriptions.py, now behind a Module.
@cache
def _parser() -> EditIntentParser:
    return EditIntentParser()


# Measured A/B (2026-07-25, gemini-2.5-flash, 10 scenarios x 5 configurations,
# cache off, then 3 repeat passes over the finalists — see
# docs/proposals/proof-edit/predict-nothink-report.md).
#
# The shipped configuration paid for deliberation TWICE: a ``ChainOfThought``
# reasoning field on top of Gemini's own internal thinking. Every figure below is
# from the report's combined table (n = 40 calls per configuration) — do not mix
# in the single-pass or 3-pass-only numbers, which differ.
#
# Dropping both runs 4.14 s/call against 11.65 s, and — the number that actually
# matters to someone watching a spinner — collapses the spread from sd 12.31 s
# (worst case 60.4 s) to sd 2.58 s (worst case 11.3 s).
#
# Accuracy did not pay for it: this configuration scored 164/164 mechanical
# checks against the old one's 160/164; on the single scenario where the model
# must author the LaTeX unaided rather than name an op for the CAS, all five
# configurations emitted byte-identical, correct LaTeX. Most of this call is
# ROUTING (edit vs question vs clarify) and NAMING an op — the CAS performs the
# mathematics in ops.py and refutes anything it cannot verify, so extra
# deliberation had nothing to buy.
#
# ``ChainOfThought`` + thinking-disabled was the other finalist and is
# DELIBERATELY NOT ADOPTED: same speed (3.95 s), but it scored 156/164,
# repeatably mis-routing "simplify the right-hand side" as not-an-edit and
# bouncing a plain operation to the tutor chat.
#
# Scoped to THIS call, not llm_config, so every other expert keeps full
# reasoning — the global ALGEBENCH_LM_REASONING knob would also silence the
# proof-completion expert and domain rescue, which were not measured here.
#
# ``reasoning_effort="disable"`` is litellm's Gemini mapping for thinkingBudget
# 0 with includeThoughts off (see its vertex_and_google_ai_studio_gemini.py).
_LM = scoped_lm(reasoning_effort="disable")


def _clean(s) -> str:
    """Strip DSPy framing, then repair JSON-mangled LaTeX in a PROSE field.

    ``_unmangle_json_escapes`` is not optional here. A JSON parser eats the first
    letter of a single-backslash LaTeX command, so ``\\frac{c}{\\sin(w)}`` arrives
    as ``fraccsin(w)`` — which renders as garbage in a caption and fails to parse
    as an operand. ``DerivationStep`` applies the same repair via a field
    validator; these fields bypass that model, so they need it explicitly.

    Use :func:`_clean_math` for a field that is ENTIRELY LaTeX — this variant
    leaves ``\\r``/``\\n``/``\\t`` mangling in place outside ``$…$``.
    """
    return _unmangle_json_escapes(_DSPY_MARKER.sub("", str(s or "")).strip())


def _clean_math(s) -> str:
    r"""``_clean`` for a field that is entirely LaTeX (no prose to protect).

    ``\right`` written with one backslash decodes to a carriage return plus
    ``ight``, which parses as the product ``i·g·h·t`` rather than failing — so
    the edit is applied to a silently different expression. The prose variant
    cannot repair it because it only touches whitespace control chars inside
    ``$…$``, and these fields carry no delimiters.
    """
    return unmangle_math(_DSPY_MARKER.sub("", str(s or "")).strip())


def propose_edit(derivation: str, current_step: str, request: str,
                 recent_thread: str = "",
                 clarifications: str = "",
                 feedback: str = "") -> ProofEditProposal:
    """Ask the model for a structured edit proposal.

    ``feedback`` carries the CAS's objections from a previous attempt; it is
    appended to the request so the retry sees exactly why it was rejected.

    Fully caller-isolated: any failure returns a "not an edit" proposal, so the
    caller falls through to the tutor chat rather than surfacing a stack trace.
    """
    ask = request if not feedback else (
        f"{request}\n\nYour previous attempt was rejected by the computer algebra "
        f"system:\n{feedback}\nFix the math and try again.")
    kwargs = dict(
        derivation=derivation,
        current_step=current_step,
        request=ask,
        recent_thread=recent_thread,
        clarifications=clarifications,
    )
    try:
        with _LM():
            out = _parser()(**kwargs)
    except Exception:
        return ProofEditProposal()

    steps: list[ProposedStep] = []
    for raw in (out.steps or [])[:MAX_GLUE_STEPS + 1]:
        if not isinstance(raw, dict):
            continue
        step = ProposedStep(
            operation=_clean(raw.get("operation")),
            expr_latex=_clean_math(raw.get("expr_latex")),
            justification=_clean(raw.get("justification")),
        )
        if step.expr_latex:            # an expressionless step cannot be built
            steps.append(step)


    return ProofEditProposal(
        is_edit=bool(out.is_edit),
        question=_clean(out.question),
        steps=steps,
        summary=_clean(out.summary),
        op=_clean(getattr(out, "op", "")),
        operand_latex=_clean_math(getattr(out, "operand_latex", "")),
        replacement_latex=_clean_math(getattr(out, "replacement_latex", "")),
        variable=_clean(getattr(out, "variable", "")),
        side=(_clean(getattr(out, "side", "")).lower() or "both"),
    )


def _field(obj, name: str) -> str:
    """Read ``name`` off a pydantic model OR a plain dict.

    Note the explicit hasattr check rather than ``getattr(...) or obj.get(...)``:
    an EMPTY attribute is falsy, and a pydantic model has no ``.get``, so the
    short-circuit form raises instead of falling through.
    """
    if hasattr(obj, name):
        return _clean(getattr(obj, name))
    if isinstance(obj, dict):
        return _clean(obj.get(name))
    return ""


def format_clarifications(pairs) -> str:
    """Render prior clarification rounds for the prompt.

    A question with no answer yet is dropped — it is not context, and echoing it
    back would invite the model to ask it a second time.
    """
    lines = []
    for p in pairs or []:
        q, a = _field(p, "question"), _field(p, "answer")
        if q and a:
            lines.append(f"Q: {q}\nA: {a}")
    return "\n".join(lines)


def format_current_step(proof: dict, index: int) -> str:
    """Render the step under the cursor for the prompt.

    An empty derivation says so explicitly rather than "(no step selected)".
    The two are different situations and the model must tell them apart: nothing
    exists yet, so the request describes the FIRST line rather than an operation
    on a previous one.
    """
    steps = (proof or {}).get("steps") or []
    if not steps:
        return ("(the derivation is EMPTY — there are no steps yet. The reader's "
                "request describes the FIRST step, which you must write out in "
                "full as `steps[0]`.)")
    if not 0 <= index < len(steps):
        return "(no step selected)"
    s = steps[index] or {}
    expr = str(s.get("plain") or s.get("input_latex") or "").strip()
    op = str(s.get("operation") or "").strip()
    out = f"Step {index}: ${expr}$"
    return f"{out} — {op}" if op else out


def last_turns(messages, limit: int = 6) -> str:
    """Flatten the tail of the chat thread for context."""
    out = []
    for m in (messages or [])[-limit:]:
        role = str((m or {}).get("role") or "user")
        text = _clean((m or {}).get("text"))
        if text:
            out.append(f"{role}: {text}")
    return "\n".join(out)


_ASSISTANT_ROLES = {"bot", "assistant", "model"}


def clarifications_from_thread(messages, limit: int = 6):
    """Recover answered clarification rounds from the chat thread.

    In the proof-chat flow the expert is stateless — each ``edit_step`` call is
    fresh — so a clarifying question it returned, and the user's answer to it,
    live only in the conversation. Without recovering them the expert re-parses
    the same instruction and asks the SAME question again, forever (observed:
    "Should 'a' be a constant or a function of 'b'?" repeating after the user
    answered). Here each assistant turn that ENDS IN A QUESTION is paired with the
    user's next turn as its answer, yielding the ``[{question, answer}]`` the
    handler already knows how to honour — which also engages ``MAX_CLARIFICATIONS``
    so a stubborn re-ask cannot loop.
    """
    msgs = list(messages or [])[-limit:]
    pairs = []
    for i in range(len(msgs) - 1):
        cur, nxt = msgs[i] or {}, msgs[i + 1] or {}
        q = _clean(cur.get("text"))
        a = _clean(nxt.get("text"))
        if (str(cur.get("role")) in _ASSISTANT_ROLES and q.rstrip().endswith("?")
                and str(nxt.get("role") or "user") == "user" and a):
            pairs.append({"question": q, "answer": a})
    return pairs


__all__ = [
    "EditIntentParser", "MAX_CLARIFICATIONS", "MAX_GLUE_STEPS", "ProofEditProposal",
    "ProofEditSig", "ProposedStep", "clarifications_from_thread",
    "format_clarifications", "format_current_step", "last_turns", "propose_edit",
]
