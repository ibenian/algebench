"""``POST /api/expert/proof_edit`` — natural-language step operations on a proof.

Exactly four outcomes, mutually exclusive, so the client never has to guess what
it got back:

======================  ============================================
``fallback_to_chat``    not an operation — re-send to the tutor chat
``question``            a math-changing choice is missing; ask the user
``variants``            candidates the CAS did not refute
``reason``              refused; the CAS's objection, proof untouched
======================  ============================================

This endpoint **writes nothing**. It returns candidate step ops; persistence
happens only through the existing proof-submission flow.

Note that in the live app this handler is normally reached not by a direct call
but through the proof chat's ``edit_step`` tool (``call_proof_chat`` in
``backend/server.py``): the chat agent decides whether a turn is an instruction
or a question, because only something reading the whole conversation can tell
"move c to the right" from "why did they move c to the right?". The editing lock
lives there too — when it is off the tool is not declared, so no call is possible.
"""
from __future__ import annotations

import logging
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.proof_edit.intent import (
    MAX_CLARIFICATIONS, format_clarifications, format_current_step, last_turns,
    propose_edit,
)
from backend.experts.registry import register_handler

from .models import LOG_TAG
from .validate import EditRefused, resolve

log = logging.getLogger(__name__)

# Bounds on the inbound proof, mirroring the proof-chat limits: a derivation this
# long is not something a step edit can meaningfully reason about anyway.
_MAX_STEPS = 60
_MAX_FIELD = 600


class Clarification(BaseModel):
    """One question the expert asked and the answer it got back."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(default="", max_length=1000)
    answer: str = Field(default="", max_length=2000)


class ProofEditRequest(BaseModel):
    """Request for ``POST /api/expert/proof_edit``."""

    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    proof: dict
    current_step: int = 0
    messages: list[dict] = Field(default_factory=list)
    # Prior clarification rounds ride in the REQUEST rather than server-side
    # session state, so a resumed edit is stateless and the existing rate limits
    # and payload bounds apply unchanged.
    clarifications: list[Clarification] = Field(default_factory=list)


def _format_proof(proof: dict) -> str:
    """Flatten the derivation for the prompt (bounded).

    Prefers the human-readable ``plain``/``input_latex`` over the annotated
    ``latex``, which carries ``\\htmlData`` tooling noise the model should never
    see or imitate.
    """
    lines = []
    title = str(proof.get("title") or "").strip()
    goal = str(proof.get("goal") or "").strip()
    if title:
        lines.append(f"Title: {title}")
    if goal:
        lines.append(f"Goal: {goal}")
    steps = proof.get("steps")
    if isinstance(steps, list) and steps:
        lines.append("Steps:")
        for i, s in enumerate(steps[:_MAX_STEPS]):
            if not isinstance(s, dict):
                continue
            expr = str(s.get("plain") or s.get("input_latex") or "")[:_MAX_FIELD].strip()
            op = str(s.get("operation") or "")[:_MAX_FIELD].strip()
            head = f"  {s.get('index', i)}. " + (f"${expr}$" if expr else "(step)")
            lines.append(f"{head} — {op}" if op else head)
        if len(steps) > _MAX_STEPS:
            lines.append(f"  … (+{len(steps) - _MAX_STEPS} more steps)")
    return "\n".join(lines) if lines else "(empty derivation)"


def _last_user_text(messages) -> str:
    """The reader's own last words, or "" if the thread carries none.

    ``message`` is NOT what the reader typed when the expert is reached through
    the proof chat's ``edit_step`` tool: it is the agent's paraphrase of the turn
    ("factor the whole expression" for a typed "factor it"). Logging only that
    hides the input, and the gap between the two is exactly what you need when an
    edit does something the reader did not ask for.
    """
    for m in reversed(list(messages or [])):
        if str((m or {}).get("role") or "user") == "user":
            return str((m or {}).get("text") or "").strip()
    return ""


def _clamp_step(proof: dict, index: int) -> int:
    """Which step the edit is inserted AFTER.

    ``-1`` for an EMPTY derivation, and that is not a sentinel bolted on — it is
    what the existing arithmetic already means. ``_spliced`` takes
    ``steps[:at + 1]`` as the head, so ``at = -1`` is exactly "insert before
    everything", and ``_changed_slice``/``to_payload``/``assembleVariant`` all
    fall out correctly from it. See :func:`proof_edit`.
    """
    n = len(proof.get("steps") or [])
    return max(0, min(index, n - 1)) if n else -1


@register_handler("proof_edit", request_model=ProofEditRequest)
def proof_edit(req: ProofEditRequest) -> dict:
    """Propose CAS-verified step operations for one step of an open derivation.

    An EMPTY derivation is a legitimate starting point, not a reason to bail. In
    the Derive workspace the reader can unlock editing before deriving anything
    and simply state the first line ("start with $E = mc^2$"), so this must be
    able to author step 0 from nothing. ``at`` is ``-1`` there; the CAS cannot
    perform an ``op`` (there is no previous expression to operate ON), so the
    model authors the step and it is graded as a start state.
    """
    proof = req.proof or {}
    at = _clamp_step(proof, req.current_step)
    domain = str(proof.get("domain") or "algebra")
    derivation = _format_proof(proof)
    current_step = format_current_step(proof, at)
    thread = last_turns(req.messages)
    clarifications = format_clarifications(req.clarifications)
    # Log BOTH the instruction acted on and the reader's own words. Via the chat
    # tool the first is the agent's paraphrase, so logging it alone leaves no
    # record of what was actually typed — see :func:`_last_user_text`.
    asked = _last_user_text(req.messages)
    log.info("%s request at step %d/%d (%s, %d clarification(s)): %r%s",
             LOG_TAG, at, len(proof.get("steps") or []), domain,
             len(req.clarifications), req.message[:120],
             f"  ← user typed: {asked[:200]!r}" if asked and asked != req.message else "")

    proposal = propose_edit(derivation, current_step, req.message,
                            recent_thread=thread, clarifications=clarifications)

    # 1. Not an operation — the tutor chat handles it.
    if not proposal.is_edit:
        log.info("%s not an edit → chat", LOG_TAG)
        return {"fallback_to_chat": True}

    # 2. A math-changing choice is missing. Bounded: once the budget is spent the
    #    model must commit or be refused, so this can't become an interrogation.
    if proposal.question and len(req.clarifications) < MAX_CLARIFICATIONS:
        log.info("%s asking for clarification: %r", LOG_TAG, proposal.question[:120])
        return {"question": proposal.question, "focus_step": at}

    try:
        payload = resolve(
            proof, domain, at, proposal,
            derivation=derivation, current_step=current_step,
            request=req.message, recent_thread=thread,
            clarifications=clarifications,
        )
    except EditRefused as e:
        # 4. Nothing survived verification. Say why; offer nothing.
        return {"reason": e.reason, "focus_step": at}

    # 3. Candidates the CAS did not refute.
    payload.focus_step = at + 1
    return payload.model_dump()
