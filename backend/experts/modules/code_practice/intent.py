"""Inputs -> the coach's review. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm

from .signature import CodePracticeSig, LineNote

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

VERDICTS = ("correct", "close", "partial", "off_track", "empty")
MAX_NOTES = 12

#: A review runs while the learner types: it must come back fast.
_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "The coach couldn't review this one. Keep typing and try again."


class CodeReview(BaseModel):
    model_config = ConfigDict(extra="ignore")

    score: int = 0
    verdict: str = "empty"
    commentary: str = ""
    direction: str = ""
    reply: str = ""
    reminder: str = ""
    line_notes: list[LineNote] = Field(default_factory=list)
    #: Set when the CALL failed, so a crash isn't shown as a review.
    error: str = ""


class Coach(dspy.Module):
    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(CodePracticeSig)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter()):
            return self.predict(**inputs)


@cache
def _coach() -> Coach:
    return Coach()


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def review_code(**inputs) -> CodeReview:
    """Ask the model for a review; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _coach()(**inputs), label="code_practice")
    except Exception as e:
        log.exception("code_practice: the model call failed")
        return CodeReview(error=f"{CALL_FAILED} ({type(e).__name__})")
    verdict = _clean(out.verdict).lower().replace(" ", "_")
    try:
        score = int(out.score)
    except (TypeError, ValueError):
        score = 0
    return CodeReview(
        score=max(0, min(100, score)),
        verdict=verdict if verdict in VERDICTS else "partial",
        commentary=_clean(out.commentary),
        direction=_clean(out.direction),
        reply=_clean(out.reply),
        reminder=_clean(out.reminder),
        line_notes=[n for n in (out.line_notes or []) if isinstance(n, LineNote)][:MAX_NOTES],
    )
