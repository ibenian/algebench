"""Inputs -> the comparison. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.experts.modules.code_assist.canvas import clean_marks
from backend.util.model_errors import model_error_message

from .signature import CodeCompareCanvasSig, CodeCompareSig, CompareAskCanvasSig, CompareAskSig, CompareCanvasStep, CompareMatch, CompareStep, Pointing

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")
MAX_STEPS = 5
MAX_DEBRIEF = 4
MAX_ANSWER_STEPS = 3
#: The left side is drawn on within its own column: words and shapes beside it would land on the learner's code.
_ORIGINAL_KINDS = {"circle", "underline", "box", "check", "cross", "arrow"}
VERDICTS = {"exact", "equivalent", "alternate", "incorrect", "missing", "extra"}

_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't compare them this time. Try again."


class CodeCompare(BaseModel):
    summary: str = ""
    same_behaviour: bool = False
    matches: list[CompareMatch] = Field(default_factory=list)
    steps: list[CompareCanvasStep] = Field(default_factory=list)
    #: What to take away, said after the walk.
    debrief: list[str] = Field(default_factory=list)
    closing: str = ""
    #: Set when the CALL failed, so a crash isn't played as a comparison.
    error: str = ""


class Comparer(dspy.Module):
    def __init__(self, signature=CodeCompareSig):
        super().__init__()
        self.predict = dspy.Predict(signature)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter(restore_first_header=True)):
            return self.predict(**inputs)


@cache
def _comparer(canvas: bool = False) -> Comparer:
    return Comparer(CodeCompareCanvasSig if canvas else CodeCompareSig)


@cache
def _answerer(canvas: bool = False) -> Comparer:
    return Comparer(CompareAskCanvasSig if canvas else CompareAskSig)


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def _run(start, end, taken: set[int], size: int) -> tuple[int, int]:
    """The run of lines a match names, cut to what is in range and not already in another match; (0, 0) for none."""
    try:
        a, b = int(start or 0), int(end or start or 0)
    except (TypeError, ValueError):
        return 0, 0
    if a < 1 or a > size:
        return 0, 0
    b = max(a, min(b, size))
    while a <= b and a in taken:
        a += 1
    if a > b:
        return 0, 0
    # A run stops at the next line another match holds: a run has no holes.
    for k in range(a, b + 1):
        if k in taken:
            b = k - 1
            break
    taken.update(range(a, b + 1))
    return a, b


def clean_matches(raw, original: list[str], typed: list[str]) -> list[CompareMatch]:
    """The model's matches made a diff that can be drawn: each line of both sides in one match, each match a run of lines
    on each side. What it judged is kept. A verdict that can't fit is put right, and a line it never placed goes in a
    match of its own ("missing" or "extra", or none to judge when blank)."""
    out: list[CompareMatch] = []
    left: set[int] = set()
    right: set[int] = set()
    for m in raw or []:
        if not isinstance(m, CompareMatch):
            continue
        a, b = _run(m.original_from, m.original_to, left, len(original))
        c, d = _run(m.yours_from, m.yours_to, right, len(typed))
        if not a and not c:
            continue
        verdict = m.verdict.strip().lower()
        verdict = verdict if verdict in VERDICTS else "incorrect"
        if a and c and verdict in ("missing", "extra"):
            verdict = "incorrect"
        out.append(CompareMatch(original_from=a, original_to=b, yours_from=c, yours_to=d, comment=_clean(m.comment),
                                verdict=verdict if a and c else "missing" if a else "extra"))
    def rest(lines: list[str], taken: set[int], make) -> None:
        k = 1
        while k <= len(lines):
            if k in taken:
                k += 1
                continue
            end, blank = k, not lines[k - 1].strip()
            while end < len(lines) and end + 1 not in taken and (not lines[end].strip()) == blank:
                end += 1
            out.append(make(k, end, "exact" if blank else None))
            k = end + 1
    rest(original, left, lambda a, b, v: CompareMatch(original_from=a, original_to=b, verdict=v or "missing"))
    rest(typed, right, lambda a, b, v: CompareMatch(yours_from=a, yours_to=b, verdict=v or "extra"))
    return out


def clean_steps(raw) -> list[CompareCanvasStep]:
    steps = []
    for s in raw or []:
        if not isinstance(s, CompareStep) or not _clean(s.say):
            continue
        point = s.point if isinstance(s.point, Pointing) else Pointing()
        steps.append(CompareCanvasStep(say=_clean(s.say), point=Pointing(side="original" if point.side == "original" else "yours", line=max(0, point.line), text=str(point.text or "").strip("\n")),
                                       draw=clean_marks(getattr(s, "draw", None)),
                                       draw_original=[m for m in clean_marks(getattr(s, "draw_original", None)) if m.kind in _ORIGINAL_KINDS]))
    return steps[:MAX_STEPS]


def compare_code(plain_original: str, plain_typed: str, /, canvas: bool = False, **inputs) -> CodeCompare:
    """The plain code, for placing the matches; ``inputs`` are what the model reads (numbered)."""
    try:
        out = retry_on_parse_error(lambda: _comparer(canvas)(**inputs), label="code_compare")
    except Exception as e:
        log.exception("code_compare: the model call failed")
        return CodeCompare(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return CodeCompare(summary=_clean(out.summary), same_behaviour=bool(getattr(out, "same_behaviour", False)), closing=_clean(out.closing), debrief=[p for p in map(_clean, getattr(out, "debrief", None) or []) if p][:MAX_DEBRIEF],
                       matches=clean_matches(out.matches, plain_original.split("\n"), plain_typed.split("\n")), steps=clean_steps(out.steps))


def answer_question(canvas: bool = False, **inputs) -> CodeCompare:
    """The learner's question about the comparison: the steps, and the answer as its ``closing``."""
    try:
        out = retry_on_parse_error(lambda: _answerer(canvas)(**inputs), label="code_compare")
    except Exception as e:
        log.exception("code_compare: the model call failed")
        return CodeCompare(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return CodeCompare(steps=clean_steps(out.steps)[:MAX_ANSWER_STEPS], closing=_clean(out.answer))
