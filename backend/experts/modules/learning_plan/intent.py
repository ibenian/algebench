"""Inputs -> the planner's picks. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from dspy.utils.exceptions import AdapterParseError
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import make_adapter, scoped_lm

from .signature import LearningPlanSig, PlanPick

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

#: Picks read from one answer. More than the plan keeps, so dropping an
#: invalid pick can still leave a full plan.
MAX_PICKS = 16

#: Choosing from a list needs some thinking, not a lot.
_LM = scoped_lm(reasoning_effort="low")

#: What the learner is told when the call itself failed.
CALL_FAILED = "The planner couldn't finish this one. Try again, or put it a little differently."


class PlanProposal(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_plan: bool = False
    question: str = ""
    reason: str = ""
    title: str = ""
    steps: list[PlanPick] = Field(default_factory=list)
    #: Set when the CALL failed, so a crash isn't mistaken for "not a plan request".
    error: str = ""


class Planner(dspy.Module):
    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(LearningPlanSig)

    def forward(self, **inputs):
        # LineAdapter: titles and whys carry LaTeX, which JSON would escape.
        with _LM(), dspy.context(adapter=make_adapter(line_oriented=True)):
            return self.predict(**inputs)


@cache
def _planner() -> Planner:
    return Planner()


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def propose_plan(**inputs) -> PlanProposal:
    """Ask the model for a plan; one more ask if the answer was malformed."""
    try:
        try:
            out = _planner()(**inputs)
        except AdapterParseError as e:
            log.warning("learning_plan: malformed answer, retrying once: %s",
                        str(e).splitlines()[0][:160])
            out = _planner()(**inputs)
    except Exception as e:
        log.exception("learning_plan: the model call failed")
        return PlanProposal(error=f"{CALL_FAILED} ({type(e).__name__})")
    return PlanProposal(
        is_plan=bool(out.is_plan),
        question=_clean(out.question),
        reason=_clean(out.reason),
        title=_clean(out.title),
        steps=[s for s in (out.steps or []) if isinstance(s, PlanPick)][:MAX_PICKS],
    )
