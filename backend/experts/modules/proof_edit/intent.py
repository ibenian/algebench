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
from typing import Optional

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.proof_completion.outputs import _unmangle_json_escapes

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
    3. AN OPERATION YOU CAN APPLY — set `is_edit` true, leave `question` empty,
       and fill `steps`.

    For case 3, ALWAYS try to name the move in `op` first. If it is one of the
    listed operations, set `op` and the operand/variable fields and the computer
    algebra system will perform it for you — that is more reliable than writing
    the result yourself, and it is the only way operations like differentiation
    are accepted.

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
             "substitute, simplify, expand, factor")
    operand_latex: str = dspy.OutputField(
        desc="LaTeX of what the op is applied WITH — the amount added/multiplied, "
             "or for `substitute` the sub-expression being replaced; empty if n/a")
    replacement_latex: str = dspy.OutputField(
        desc="for `substitute` only: LaTeX of what replaces operand_latex "
             "(for 'let $u = x^2$' operand is $x^2$ and replacement is $u$)")
    variable: str = dspy.OutputField(
        desc="for differentiate/integrate: the variable, e.g. 'x'; empty otherwise")
    summary: str = dspy.OutputField(
        desc="one short sentence describing the move, for the chat; use $…$ for math")


class EditIntentParser(dspy.Module):
    """The intent parser: request → structured :class:`ProofEditProposal`.

    A single ``Predict`` today, wrapped as a ``Module`` so it has a first-class
    home in the expert package and — like ``ProofCompletionExpert`` — a compile
    target if we later optimize it against a labelled dataset. Its ``forward``
    returns the RAW DSPy prediction; field cleaning + shaping into the pydantic
    proposal stays in :func:`propose_edit`, so the Module is a thin, optimizable
    unit and the messy post-processing lives outside it.

    ``ChainOfThought`` (not bare ``Predict``): the routing decision — instruction
    vs question vs clarify, and which ``op`` a request maps to — benefits from an
    explicit reasoning step, and it matches ``ProofCompletionExpert``.
    """

    def __init__(self):
        super().__init__()
        self.predict = dspy.ChainOfThought(ProofEditSig)

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


def _clean(s) -> str:
    """Strip DSPy framing, then repair JSON-mangled LaTeX.

    ``_unmangle_json_escapes`` is not optional here. A JSON parser eats the first
    letter of a single-backslash LaTeX command, so ``\\frac{c}{\\sin(w)}`` arrives
    as ``fraccsin(w)`` — which renders as garbage in a caption and fails to parse
    as an operand. ``DerivationStep`` applies the same repair via a field
    validator; these fields bypass that model, so they need it explicitly.
    """
    return _unmangle_json_escapes(_DSPY_MARKER.sub("", str(s or "")).strip())


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
    try:
        out = _parser()(
            derivation=derivation,
            current_step=current_step,
            request=ask,
            recent_thread=recent_thread,
            clarifications=clarifications,
        )
    except Exception:
        return ProofEditProposal()

    steps: list[ProposedStep] = []
    for raw in (out.steps or [])[:MAX_GLUE_STEPS + 1]:
        if not isinstance(raw, dict):
            continue
        step = ProposedStep(
            operation=_clean(raw.get("operation")),
            expr_latex=_clean(raw.get("expr_latex")),
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
        operand_latex=_clean(getattr(out, "operand_latex", "")),
        replacement_latex=_clean(getattr(out, "replacement_latex", "")),
        variable=_clean(getattr(out, "variable", "")),
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
    """Render the step under the cursor for the prompt."""
    steps = (proof or {}).get("steps") or []
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


__all__ = [
    "EditIntentParser", "MAX_CLARIFICATIONS", "MAX_GLUE_STEPS", "ProofEditProposal",
    "ProofEditSig", "ProposedStep", "format_clarifications", "format_current_step",
    "last_turns", "propose_edit",
]
