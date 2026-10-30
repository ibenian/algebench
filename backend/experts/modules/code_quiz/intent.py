"""Inputs -> a question set up, or an answer judged. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.experts.modules.code_assist.intent import _clean, clean_steps
from backend.experts.modules.code_assist.signature import AssistStep
from backend.util.model_errors import model_error_message

from .signature import QuizAskSig, QuizGradeSig

log = logging.getLogger(__name__)

KINDS = ("type", "answer")
VERDICTS = ("correct", "partly", "incorrect")
MAX_SETUP, MAX_POINTS = 4, 4
#: The longest question or answer key returned: the grade request sends them back, and its model accepts this much.
MAX_TEXT = 6000

#: The learner waits for the question, and for its verdict: answer quickly.
_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't come up with a question this time. Try again."
GRADE_FAILED = "I couldn't judge that answer this time. Try again."


class QuizQuestion(BaseModel):
    plan: str = ""
    steps: list[AssistStep] = Field(default_factory=list)
    question: str = ""
    kind: str = "answer"
    answer_key: str = ""
    error: str = ""


class QuizVerdict(BaseModel):
    verdict: str = "incorrect"
    steps: list[AssistStep] = Field(default_factory=list)
    feedback: str = ""
    error: str = ""


class _Predict(dspy.Module):
    def __init__(self, sig):
        super().__init__()
        self.predict = dspy.Predict(sig)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter()):
            return self.predict(**inputs)


@cache
def _asker() -> _Predict:
    return _Predict(QuizAskSig)


@cache
def _grader() -> _Predict:
    return _Predict(QuizGradeSig)


def ask_question(**inputs) -> QuizQuestion:
    """A question and the moves that set it up; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _asker()(**inputs), label="code_quiz")
    except Exception as e:
        log.exception("code_quiz: the model call failed")
        return QuizQuestion(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    kind = _clean(out.kind).lower().strip('"')
    return QuizQuestion(plan=_clean(out.plan), steps=clean_steps(out.steps, drafts=False)[:MAX_SETUP],
                        question=_clean(out.question)[:MAX_TEXT], kind=kind if kind in KINDS else "answer",
                        answer_key=_clean(out.answer_key)[:MAX_TEXT])


def grade_answer(**inputs) -> QuizVerdict:
    """The verdict on an answer, and what to point at (and comment or type) while explaining it."""
    try:
        out = retry_on_parse_error(lambda: _grader()(**inputs), label="code_quiz")
    except Exception as e:
        log.exception("code_quiz: the grading call failed")
        return QuizVerdict(error=model_error_message(e) or f"{GRADE_FAILED} ({type(e).__name__})")
    verdict = _clean(out.verdict).lower().strip('"')
    return QuizVerdict(verdict=verdict if verdict in VERDICTS else "partly",
                       steps=clean_steps(out.steps, drafts=False)[:MAX_POINTS], feedback=_clean(out.feedback))
