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
from backend.experts.registry import register_handler

from .compose import ComposeError, compose
from .format import render_inputs
from .models import BuildSceneRequest

log = logging.getLogger(__name__)

LOG_TAG = "[build_scene]"

#: How many clarification rounds before the model must commit. Bounded so an
#: ambiguous request cannot turn into an interrogation.
MAX_CLARIFICATIONS = 2


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

    log.info("%s %s at scene %d (%d clarification(s)): %r", LOG_TAG, req.op,
             req.sceneIndex, len(req.clarifications), req.intent[:120])

    proposal = propose_scene(**inputs)

    # 1. Not a scene request — the tutor chat handles it.
    if not proposal.is_build:
        log.info("%s not a build → chat", LOG_TAG)
        return {"fallback_to_chat": True}

    # 2. A geometry-changing choice is missing. Bounded: once the budget is
    #    spent the model must commit or be refused.
    if proposal.question and len(req.clarifications) < MAX_CLARIFICATIONS:
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
                "at": {"scene": req.sceneIndex},
                "node": scene.model_dump(mode="json", by_alias=True, exclude_none=True),
            }],
        },
        "focus": req.sceneIndex,
    }
