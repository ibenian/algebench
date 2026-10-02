"""``POST /api/expert/learning_plan``: a path through existing lessons to a concept.

Four outcomes, mutually exclusive:

======================  ==================================================
``fallback_to_chat``    not a request to learn something; send it to chat
``question``            too vague to choose lessons for; one question back
``result``              ``{title, steps: [{kind, title, why, ref}]}``,
                        plus ``caveat`` when coverage is partial
``reason``              no plan: nothing covers it, or the planner failed
======================  ==================================================

The model picks catalog handles; code turns them into refs (``validate.py``)
and the client turns refs into views. This endpoint stores nothing: plans live
in the learner's browser.
"""
from __future__ import annotations

import logging

from backend.experts.modules.learning_plan.intent import propose_plan
from backend.experts.registry import register_handler

from .catalog import preselect
from .format import _flat, format_refused, render_inputs
from .models import LearningPlanRequest
from .validate import mostly_invalid, plan_steps

log = logging.getLogger(__name__)

LOG_TAG = "[learning_plan]"
#: Questions the planner may ask before it must commit.
MAX_CLARIFICATIONS = 1

NOT_COVERED = "AlgeBench doesn't have lessons on that yet."
NO_PLAN = "I couldn't put a plan together from the lessons for that. Try naming the idea differently."


@register_handler("learning_plan", request_model=LearningPlanRequest)
def learning_plan(req: LearningPlanRequest) -> dict:
    cats = preselect(req.target, req.where.lesson)
    if not cats:
        # Nothing published matches, so there is nothing for the model to choose.
        log.info("%s no lessons match %r", LOG_TAG, req.target[:120])
        return {"reason": NOT_COVERED}

    inputs, shown = render_inputs(req, cats)
    log.info("%s %r from %s: %d lesson(s), %d entries", LOG_TAG, req.target[:120],
             req.where.lesson or "-", len(cats), len(shown))

    proposal = propose_plan(**inputs)
    if proposal.error:
        return {"reason": proposal.error}
    if not proposal.is_plan:
        return {"fallback_to_chat": True}
    if proposal.question and len(req.clarifications) < MAX_CLARIFICATIONS:
        return {"question": proposal.question}

    steps, problems = plan_steps(proposal.steps, shown)
    if not proposal.steps and proposal.reason:
        # The planner says the catalog doesn't cover it. Believe it rather than
        # asking again for a plan it already declined to pad.
        return {"reason": proposal.reason}
    if mostly_invalid(steps, problems):
        log.info("%s %d kept, %d dropped (%s); asking again", LOG_TAG, len(steps),
                 len(problems), "; ".join(problems[:3]))
        retry = propose_plan(**{**inputs, "refused": format_refused(
            problems or ["the plan had no steps"])})
        if not retry.error and retry.is_plan:
            again, again_problems = plan_steps(retry.steps, shown)
            if len(again) > len(steps):
                proposal, steps, problems = retry, again, again_problems
    if not steps:
        return {"reason": proposal.reason or NO_PLAN}

    out: dict = {"result": {
        "title": _flat(proposal.title, 120) or _flat(req.target, 120),
        "steps": steps,
    }}
    if proposal.reason:
        out["caveat"] = proposal.reason
    log.info("%s planned %r: %d step(s)%s", LOG_TAG, out["result"]["title"], len(steps),
             f", {len(problems)} dropped" if problems else "")
    return out
