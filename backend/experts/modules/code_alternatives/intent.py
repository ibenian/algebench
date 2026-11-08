"""Inputs -> two alternatives compared, or a question about them answered. The one place an LM is called.

The diff is drawn in the same split view as ``code_compare``, so its parts are made drawable the same way
(``place_parts``); everything said about them is this expert's own.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.experts.modules.code_assist.canvas import clean_marks
from backend.experts.modules.code_compare.intent import _clean, place_parts
from backend.util.model_errors import model_error_message

from .signature import AltAskCanvasSig, AltAskSig, AltCanvasStep, AltMatch, AltPointing, AltStep, CompareAlternativesCanvasSig, CompareAlternativesSig

log = logging.getLogger(__name__)

MAX_STEPS = 4
MAX_TAKEAWAYS = 3
MAX_ANSWER_STEPS = 3
VERDICTS = {"same", "equivalent", "different", "only_left", "only_right"}
#: The left side is drawn on within its own column: words and shapes beside it would land on the right side.
_LEFT_KINDS = {"circle", "underline", "box", "check", "cross", "arrow"}

_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't compare them this time. Try again."


class AltComparison(BaseModel):
    summary: str = ""
    matches: list[AltMatch] = Field(default_factory=list)
    steps: list[AltCanvasStep] = Field(default_factory=list)
    takeaways: list[str] = Field(default_factory=list)
    closing: str = ""
    #: Set when the CALL failed, so a crash isn't played as a comparison.
    error: str = ""


class _Call(dspy.Module):
    def __init__(self, signature):
        super().__init__()
        self.predict = dspy.Predict(signature)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter(restore_first_header=True)):
            return self.predict(**inputs)


@cache
def _comparer(canvas: bool = False) -> _Call:
    return _Call(CompareAlternativesCanvasSig if canvas else CompareAlternativesSig)


@cache
def _answerer(canvas: bool = False) -> _Call:
    return _Call(AltAskCanvasSig if canvas else AltAskSig)


def clean_matches(raw, left: list[str], right: list[str]) -> list[AltMatch]:
    """Every line of both sides in one part, each a run of lines (see ``place_parts``)."""
    parts = place_parts([(m.left_from, m.left_to, m.right_from, m.right_to, m.verdict, m.comment) for m in raw or [] if isinstance(m, AltMatch)],
                        left, right, verdicts=VERDICTS, mismatch="different", only_left="only_left", only_right="only_right", same="same")
    # Identical code needs no words, and a comment that only repeats a verdict ("same") says nothing the chip doesn't.
    said = lambda v, t: "" if v == "same" or t.strip(" .").lower() in VERDICTS else t
    return [AltMatch(left_from=a, left_to=b, right_from=c, right_to=d, verdict=v, comment=said(v, t)) for a, b, c, d, v, t in parts]


def clean_steps(raw, cap: int = MAX_STEPS) -> list[AltCanvasStep]:
    steps = []
    for s in raw or []:
        if not isinstance(s, AltStep) or not _clean(s.say):
            continue
        point = s.point if isinstance(s.point, AltPointing) else AltPointing()
        steps.append(AltCanvasStep(say=_clean(s.say), point=AltPointing(side="left" if point.side == "left" else "right", line=max(0, point.line), text=str(point.text or "").strip("\n")),
                                   draw=clean_marks(getattr(s, "draw", None)),
                                   draw_left=[m for m in clean_marks(getattr(s, "draw_left", None)) if m.kind in _LEFT_KINDS]))
    return steps[:cap]


def compare_alternatives(plain_left: str, plain_right: str, /, canvas: bool = False, **inputs) -> AltComparison:
    """The plain code, for placing the parts; ``inputs`` are what the model reads (numbered)."""
    try:
        out = retry_on_parse_error(lambda: _comparer(canvas)(**inputs), label="code_alternatives")
    except Exception as e:
        log.exception("code_alternatives: the compare call failed")
        return AltComparison(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return AltComparison(summary=_clean(out.summary), closing=_clean(out.closing),
                         takeaways=[p for p in map(_clean, getattr(out, "takeaways", None) or []) if p][:MAX_TAKEAWAYS],
                         matches=clean_matches(out.matches, plain_left.split("\n"), plain_right.split("\n")), steps=clean_steps(out.steps))


def answer_question(canvas: bool = False, **inputs) -> AltComparison:
    """The learner's question about the two on screen: the steps, and the answer as its ``closing``."""
    try:
        out = retry_on_parse_error(lambda: _answerer(canvas)(**inputs), label="code_alternatives")
    except Exception as e:
        log.exception("code_alternatives: the ask call failed")
        return AltComparison(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return AltComparison(steps=clean_steps(out.steps, MAX_ANSWER_STEPS), closing=_clean(out.answer))
