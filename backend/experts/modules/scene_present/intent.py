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
MARKS = ("point", "circle", "underline", "check", "cross")
ARROW_KINDS = ("arrow", "line")
#: The longest line written on the scratchpad.
MAX_WRITE = 400
COLORS = ("green", "yellow", "red", "blue", "purple", "orange", "pink")

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


_INDEXED = re.compile(r"^(.+?)\[([\d\s:,]+)\]$")


def _ref(value, refs: set[str]) -> str:
    """A ref as given, if it is one of the listed targets; or an index into a listed object: several of an array's,
    dict's or graph's listed cells (a slice `nums[1:4]`, cells 1 to 3, or a list `g[1,3,4]`), or for an object
    without listed cells (a tensor) any index, which the client places or drops. Else none."""
    ref = str(value or "").strip().strip("`")
    if ref in refs:
        return ref
    m = _INDEXED.match(ref)
    if not m or m.group(1) not in refs:
        return ""
    base, index = m.group(1), re.sub(r"\s+", "", m.group(2))
    if f"{base}[0]" not in refs:
        return f"{base}[{m.group(2).strip()}]"
    if re.fullmatch(r"\d+:\d+", index):
        start, stop = map(int, index.split(":"))
        cells = list(range(start, stop))
    elif re.fullmatch(r"\d+(,\d+)+", index):
        cells = [int(i) for i in index.split(",")]
    else:
        return ""
    if not cells or any(f"{base}[{i}]" not in refs for i in cells):
        return ""
    return f"{base}[{cells[0]}]" if len(cells) == 1 else f"{base}[{index}]"


def _ink(value) -> str:
    """One of the presenter's colours, or none (green)."""
    color = str(value or "").strip().lower()
    return color if color in COLORS and color != "green" else ""


def _notes(value) -> list[str]:
    """Notes named by their text: strings only, a few at most."""
    items = value if isinstance(value, list) else [value] if isinstance(value, str) else []
    return [str(t).strip()[:MAX_WRITE] for t in items if isinstance(t, str) and t.strip()][:8]


def _note_key(text: str) -> str:
    return " ".join(str(text or "").split())


def _note_ref(value, written: set[str]) -> str:
    """A `note:<text>` ref, when the text is a note written by an earlier beat (or this one); else none."""
    ref = str(value or "").strip().strip("`")
    if not ref.startswith("note:"):
        return ""
    key = _note_key(ref[5:])
    return f"note:{key}" if key in written else ""


def _target_ref(value, refs: set[str], written: set[str]) -> str:
    return _note_ref(value, written) or _ref(value, refs)


def _part(value, target: str) -> str:
    """The words of a note pointed at: kept only when the target is a note and they are in it."""
    part = " ".join(str(value or "").split()).strip("`")
    return part if part and target.startswith("note:") and part in target[5:] else ""


def _slider_move(s: PresentStep, refs: set[str]) -> dict:
    """A slider move, when it names a listed slider and a number; else none. The client keeps it within range."""
    ref = _ref(s.slider, refs)
    try:
        value = float(s.slider_to) if s.slider_to is not None else None
    except (TypeError, ValueError):
        value = None
    if not ref.startswith("slider:") or value is None or value != value:   # NaN is no value
        return {"slider": "", "slider_to": None}
    return {"slider": ref, "slider_to": value}


def clean_steps(raw, refs: set[str], frames: int) -> list[PresentStep]:
    """Beats safe to play: a ref not on the list points at nothing, a frame outside the run stays put, a beat with
    nothing to say is dropped."""
    out = []
    written: set[str] = set()       # the notes on the view so far, by text: a beat may point at them
    for s in raw or []:
        if not isinstance(s, PresentStep) or not _clean(s.say):
            continue
        try:
            frame = int(s.frame)
        except (TypeError, ValueError):
            frame = -1
        write = _DSPY_MARKER.sub("", str(s.write or "")).strip().splitlines()[0][:MAX_WRITE] if str(s.write or "").strip() else ""
        board = _notes(s.board)
        written |= {_note_key(t) for t in [write, *board] if t}
        target = _target_ref(s.target, refs, written)
        out.append(PresentStep(say=_clean(s.say), target=target, part=_part(s.part, target),
                               mark=s.mark if s.mark in MARKS else "point",
                               frame=frame if 0 <= frame < frames else -1,
                               write=write, write_near=_target_ref(s.write_near, refs, written) if write else "", erase=bool(s.erase),
                               arrow_to=_target_ref(s.arrow_to, refs, written),
                               arrow_from=_target_ref(s.arrow_from, refs, written) if _target_ref(s.arrow_to, refs, written) else "",
                               arrow_kind=s.arrow_kind if s.arrow_kind in ARROW_KINDS else "arrow",
                               board=board, erase_notes=_notes(s.erase_notes),
                               color=_ink(s.color), **_slider_move(s, refs)))
    return out[:MAX_STEPS]


def present(target_refs: set[str], frame_count: int, **inputs) -> Presentation:
    """Ask the model for the beats; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _presenter()(**inputs), label="scene_present")
    except Exception as e:
        log.exception("scene_present: the model call failed")
        return Presentation(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return Presentation(steps=clean_steps(out.steps, target_refs, frame_count))
