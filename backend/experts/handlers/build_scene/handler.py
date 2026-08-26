"""``POST /api/expert/build_scene`` — author one scene from a natural-language ask.

Four outcomes, mutually exclusive, so the client never has to guess what it got:

======================  ============================================
``fallback_to_chat``    not a scene request — re-send to the tutor chat
``question``            a choice that changes the geometry is missing
``result``              a BuildOp the client can apply
``reason``              refused; what went wrong, lesson untouched
======================  ============================================

This endpoint **writes nothing**. It returns an operation; applying it is the
client's, through `applyBuildOps` in src/lesson-placement.ts, which is also what
makes it undoable.

It replaces the dormant `add_scene` chat tool, which is "intentionally NOT
exposed — scene-building is disabled (unreliable output)". So there is nothing
here to regress: the bar is not "as good as what shipped", it is "good enough to
turn back on".
"""
from __future__ import annotations

import logging

from backend.experts.modules.build_scene.intent import propose_scene
from backend.experts.modules.proof_edit.intent import clarifications_from_thread
from backend.experts.registry import register_handler

from .compose import ComposeError, compose
from .format import format_clarifications, render_inputs
from .models import BuildSceneRequest, Clarification

log = logging.getLogger(__name__)

LOG_TAG = "[build_scene]"

#: How many clarification rounds before the model must commit. Bounded so an
#: ambiguous request cannot turn into an interrogation.
MAX_CLARIFICATIONS = 2


def _clarifications(req: BuildSceneRequest) -> list:
    """Every answered round: the ones sent explicitly, plus the ones in the thread.

    This expert is stateless — each call is fresh — so a clarifying question it
    returned and the user's answer to it exist ONLY in the conversation. Without
    recovering them it re-parses the same intent and asks the identical question
    forever. That is not hypothetical: `clarifications_from_thread` was written
    for proof_edit after exactly that was observed in production, and its
    docstring names the question that repeated.

    UNION, not either/or, and deduplicated by question. Undercounting is the
    dangerous direction: the count is what engages MAX_CLARIFICATIONS, so a
    missed round re-opens the loop it exists to close.

    Reusing proof_edit's function rather than writing a second one — the rule it
    encodes (an assistant turn ending in `?`, paired with the next user turn) is
    a property of chat threads, not of proofs.
    """
    rounds = [c.model_dump() for c in req.clarifications]
    seen = {r["question"].strip() for r in rounds}
    for pair in clarifications_from_thread(req.messages):
        if pair["question"].strip() not in seen:
            seen.add(pair["question"].strip())
            rounds.append(pair)
    return rounds


def _already_answered(question: str, rounds: list) -> bool:
    """Has this thread answered this question before?

    Compared on letters and digits only: the model rarely repeats itself
    byte-for-byte, and "2D or 3D?" vs "2D or 3D?  " vs "Should it be 2D or 3D?"
    are the same question to the reader being asked it twice.
    """
    def key(text: str) -> str:
        return "".join(c for c in (text or "").lower() if c.isalnum())

    asked = key(question)
    return any(asked and (asked in key(r["question"]) or key(r["question"]) in asked)
               for r in rounds)


def _last_user_text(messages) -> str:
    """The reader's own last words, or "".

    `intent` is NOT what they typed when this is reached through a chat tool: it
    is the agent's paraphrase. Logging only that hides the input, and the gap
    between the two is exactly what you need when a scene comes back wrong.
    """
    for m in reversed(list(messages or [])):
        if str((m or {}).get("role") or "user") == "user":
            return str((m or {}).get("text") or "").strip()
    return ""


@register_handler("build_scene", request_model=BuildSceneRequest)
def build_scene(req: BuildSceneRequest) -> dict:
    """Propose one scene, composed and validated, as an insert or replace op."""
    try:
        req.require_consistent()
        inputs = render_inputs(req)
    except ValueError as e:
        # The request contradicts itself — a replace with no scene to replace.
        # That is the caller's bug, and saying so beats building the wrong thing.
        log.warning("%s inconsistent request: %s", LOG_TAG, e)
        return {"reason": str(e)}

    rounds = _clarifications(req)
    inputs["clarifications"] = format_clarifications(
        [Clarification.model_validate(r) for r in rounds])

    asked = _last_user_text(req.messages)
    log.info("%s %s at scene %d (%d clarification(s)): %r%s", LOG_TAG, req.op,
             req.sceneIndex, len(rounds), req.intent[:120],
             f"  ← user typed: {asked[:200]!r}" if asked and asked != req.intent else "")

    proposal = propose_scene(**inputs)

    # 1. Not a scene request — the tutor chat handles it.
    if not proposal.is_build:
        log.info("%s not a build → chat", LOG_TAG)
        return {"fallback_to_chat": True}

    # 2. A geometry-changing choice is missing. Bounded twice over: the budget
    #    caps how many rounds there can be, and `_already_answered` refuses a
    #    question this thread has ALREADY answered.
    #
    #    The second guard is the one that matters. The budget only bounds a
    #    repeat to MAX_CLARIFICATIONS of the identical question — the reader still
    #    answers twice and is asked twice, which is the bug as they experience it.
    #    Re-asking means the model ignored an answer already in its prompt, so the
    #    honest response is to make it commit rather than to relay it again.
    if proposal.question and _already_answered(proposal.question, rounds):
        log.info("%s suppressed a question already answered: %r",
                 LOG_TAG, proposal.question[:120])
    elif proposal.question and len(rounds) < MAX_CLARIFICATIONS:
        log.info("%s asking: %r", LOG_TAG, proposal.question[:120])
        return {"question": proposal.question, "focus": req.sceneIndex}

    # 3. Compose is where a confident proposal meets the schema.
    try:
        scene = compose(
            proposal.title, proposal.description, proposal.elements, proposal.steps,
            with_prompts=bool(req.conventions.elementsCarryPrompts),
        )
    except ComposeError as e:
        # 4. Refused. The message names the element and what was wrong with it,
        #    which is what a retry would need to hear — and what the reader needs
        #    instead of a scene that renders empty.
        log.info("%s refused: %s", LOG_TAG, e)
        return {"reason": str(e)}

    log.info("%s built %r: %d element(s), %d step(s)", LOG_TAG, scene.title,
             len(scene.elements or []), len(scene.steps or []))
    return {
        "result": {
            "ops": [{
                "op": req.op,
                "kind": "scene",
                # `index`, NOT `scene`. For a scene-kind op the container IS
                # `lesson.scenes`, so the position within it is `index`; `scene`
                # is how a STEP or PROOF op says which scene to look inside.
                # Both are Optional on `Placement`, so the contract model
                # validates either — but `requireIndex` refuses this one, and the
                # client cannot apply anything the expert returns. Caught by
                # review, not by tests: mine asserted the shape I had written.
                "at": {"index": req.sceneIndex},
                "node": scene.model_dump(mode="json", by_alias=True, exclude_none=True),
            }],
        },
        "focus": req.sceneIndex,
    }
