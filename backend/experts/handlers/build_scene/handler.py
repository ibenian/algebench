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

It replaces `add_scene`, the chat tool that had the model emit scene JSON inline
as tool arguments and was disabled for unreliable output. So there was nothing
here to regress: the bar was not "as good as what shipped", it was "good enough
to turn back on". `src/build-scene-tool.ts` is the client half.
"""
from __future__ import annotations

import logging

from backend.experts.modules.build_scene.intent import propose_scene
from backend.experts.modules.proof_edit.intent import clarifications_from_thread
from backend.experts.registry import register_handler

from .compose import ComposeError, compose
from .format import format_clarifications, format_refused, render_inputs
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


def _compose(proposal, req: BuildSceneRequest):
    return compose(
        proposal.title, proposal.description, proposal.elements, proposal.steps,
        proposal.sliders,
        with_prompts=bool(req.conventions.elementsCarryPrompts),
    )


def _composed(proposal, req: BuildSceneRequest, inputs: dict):
    """Compose the proposal; on a refusal, ask ONCE more with the reason. Returns
    ``(scene, None)`` or ``(None, reason)``.

    The retry in `intent.py` does not cover this. That one fires on an
    `AdapterParseError` — the answer was malformed — and the model call here has
    already SUCCEEDED. What failed is downstream: a well-formed proposal that
    `compose` will not accept, for a reason it states precisely.

    Nothing carried that reason back to the builder before. The chat agent is
    told to adapt (see BUILD_SCENE_TOOL_DECL), but `render_inputs` is the whole
    of what the builder is told and the thread is not in it; `clarifications`
    only recovers assistant turns ending in `?`, and "I couldn't build that: …"
    does not. So every re-ask reached the model as the same prompt, and drew the
    same scene. Observed on a DNA double helix, refused for its base-pair rungs
    and refused again identically.

    ONE extra ask. The reason is specific enough that a model which ignores it
    twice is not going to be talked round, and this is on the reader's request
    path — the fallback is the same message they used to get, one call later.

    A retry that comes back with a QUESTION is composed anyway rather than
    relayed: the reader already committed at step 2, and the honest reading of
    "here is why your scene was rejected" is not an invitation to reopen scope.

    WHICH refusal comes back depends on how the retry failed, and the two cases
    want opposite answers:

      * it composed and was refused AGAIN — the second. It describes the scene
        that would have been built, and when the model repeats itself the two
        are identical anyway.
      * it produced nothing to compose — the first, because that one is about a
        real scene, where "the builder broke" on the second ask says nothing the
        reader or the chat agent can act on.
    """
    try:
        return _compose(proposal, req), None
    except ComposeError as e:
        # Bound to a plain name INSIDE the clause: Python deletes `e` at the end
        # of an `except` block, so reading it below would be a NameError.
        first = str(e)
        log.info("%s refused: %s — asking again with the reason", LOG_TAG, first)

    retry = propose_scene(**{**inputs, "refused": format_refused(first)})
    if retry.error or not retry.is_build or not retry.elements:
        # Nothing to compose. Report the ORIGINAL refusal: it is about a real
        # scene, where "the builder broke" on the second ask says nothing the
        # reader or the agent can use.
        log.warning("%s retry produced nothing to compose (error=%r, is_build=%s)",
                    LOG_TAG, retry.error, retry.is_build)
        return None, first

    try:
        return _compose(retry, req), None
    except ComposeError as second:
        log.info("%s refused again: %s", LOG_TAG, second)
        return None, str(second)


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

    # 0. The CALL failed — a parse error, a dead LM. Not the same as "not a scene
    #    request", and routing it there tells the reader they asked a question
    #    when they asked for a scene and the builder broke.
    if proposal.error:
        log.warning("%s call failed: %s", LOG_TAG, proposal.error)
        return {"reason": proposal.error}

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

    # 3. Compose is where a confident proposal meets the schema. A refusal here
    #    buys ONE more ask, with the reason in the prompt — see `_composed`.
    scene, reason = _composed(proposal, req, inputs)
    if scene is None:
        # 4. Refused twice. The message names the element and what was wrong with
        #    it, which is what the reader needs instead of a scene that renders
        #    empty — and what the CHAT agent needs to propose something else.
        return {"reason": reason}

    log.info("%s built %r: %d element(s), %d step(s), %d slider(s)", LOG_TAG,
             scene.title, len(scene.elements or []), len(scene.steps or []),
             sum(len(s.sliders or []) for s in (scene.steps or [])))
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
