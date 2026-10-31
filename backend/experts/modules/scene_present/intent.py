"""Inputs -> the presenter's beats. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.util.model_errors import model_error_message

from .signature import PresentStep, ScenePresentSig

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")
MAX_STEPS = 10
MARKS = ("point", "circle")
#: The longest line written on the scratchpad.
MAX_WRITE = 120

#: The learner waits with the view handed over: answer quickly.
_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't put a walk-through together this time. Try asking again."


class Presentation(BaseModel):
    steps: list[PresentStep] = Field(default_factory=list)
    error: str = ""


class Presenter(dspy.Module):
    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(ScenePresentSig)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter(restore_first_header=True)):
            return self.predict(**inputs)


@cache
def _presenter() -> Presenter:
    return Presenter()


def _clean(text) -> str:
    """Spoken text: no markers, and none of the marks that set math, code or emphasis (they would be read out)."""
    return re.sub(r"[`$]|\*{1,2}(?=\S)|(?<=\S)\*{1,2}", "", _DSPY_MARKER.sub("", str(text or ""))).strip()


def _ref(value, refs: set[str]) -> str:
    """A ref as given, if it is one of the listed targets; else none."""
    ref = str(value or "").strip().strip("`")
    return ref if ref in refs else ""


def clean_steps(raw, refs: set[str], frames: int) -> list[PresentStep]:
    """Beats safe to play: a ref not on the list points at nothing, a frame outside the run stays put, a beat with
    nothing to say is dropped."""
    out = []
    for s in raw or []:
        if not isinstance(s, PresentStep) or not _clean(s.say):
            continue
        target = str(s.target or "").strip().strip("`")
        try:
            frame = int(s.frame)
        except (TypeError, ValueError):
            frame = -1
        write = _DSPY_MARKER.sub("", str(s.write or "")).strip().splitlines()[0][:MAX_WRITE] if str(s.write or "").strip() else ""
        near = str(s.write_near or "").strip().strip("`")
        out.append(PresentStep(say=_clean(s.say), target=target if target in refs else "",
                               mark=s.mark if s.mark in MARKS else "point",
                               frame=frame if 0 <= frame < frames else -1,
                               write=write, write_near=near if write and near in refs else "", erase=bool(s.erase),
                               arrow_to=_ref(s.arrow_to, refs), arrow_from=_ref(s.arrow_from, refs) if _ref(s.arrow_to, refs) else ""))
    return out[:MAX_STEPS]


def present(target_refs: set[str], frame_count: int, **inputs) -> Presentation:
    """Ask the model for the beats; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _presenter()(**inputs), label="scene_present")
    except Exception as e:
        log.exception("scene_present: the model call failed")
        return Presentation(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return Presentation(steps=clean_steps(out.steps, target_refs, frame_count))
