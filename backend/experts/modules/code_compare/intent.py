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


def place_parts(raw, left: list[str], right: list[str], *, verdicts: set[str], mismatch: str, only_left: str, only_right: str, same: str):
    """Parts of a two-sided diff made drawable, for any comparison of two pieces of code: each line of both sides in one
    part, each part a run of lines on each side. ``raw`` holds ``(left_from, left_to, right_from, right_to, verdict,
    comment)``. A verdict outside ``verdicts`` becomes ``mismatch``; a part with one side only takes that side's verdict
    (``only_left`` or ``only_right``), and one with both can't. A line never placed goes in a part of its own: one-sided,
    or ``same`` when blank. Returns the same tuples, cleaned."""
    out: list[tuple[int, int, int, int, str, str]] = []
    taken_left: set[int] = set()
    taken_right: set[int] = set()
    for a0, b0, c0, d0, verdict, comment in raw:
        a, b = _run(a0, b0, taken_left, len(left))
        c, d = _run(c0, d0, taken_right, len(right))
        if not a and not c:
            continue
        verdict = str(verdict or "").strip().lower()
        verdict = verdict if verdict in verdicts else mismatch
        if a and c and verdict in (only_left, only_right):
            verdict = mismatch
        out.append((a, b, c, d, verdict if a and c else only_left if a else only_right, _clean(comment)))

    def rest(lines: list[str], taken: set[int], make) -> None:
        k = 1
        while k <= len(lines):
            if k in taken:
                k += 1
                continue
            end, blank = k, not lines[k - 1].strip()
            while end < len(lines) and end + 1 not in taken and (not lines[end].strip()) == blank:
                end += 1
            out.append(make(k, end, same if blank else None))
            k = end + 1
    rest(left, taken_left, lambda a, b, v: (a, b, 0, 0, v or only_left, ""))
    rest(right, taken_right, lambda a, b, v: (0, 0, a, b, v or only_right, ""))
    return out


def clean_matches(raw, original: list[str], typed: list[str]) -> list[CompareMatch]:
    """The model's matches made a diff that can be drawn (see ``place_parts``): what it judged is kept, a verdict that
    can't fit is put right, and a line it never placed goes in a match of its own ("missing" or "extra", or none to
    judge when blank)."""
    parts = place_parts([(m.original_from, m.original_to, m.yours_from, m.yours_to, m.verdict, m.comment) for m in raw or [] if isinstance(m, CompareMatch)],
                        original, typed, verdicts=VERDICTS, mismatch="incorrect", only_left="missing", only_right="extra", same="exact")
    return [CompareMatch(original_from=a, original_to=b, yours_from=c, yours_to=d, verdict=v, comment=t) for a, b, c, d, v, t in parts]


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
