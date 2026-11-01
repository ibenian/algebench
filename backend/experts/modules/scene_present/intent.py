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

from .signature import DrawElement, Drawing, PresentStep, ScenePresentSig

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")
MAX_STEPS = 10
MARKS = ("point", "circle", "underline", "check", "cross")
ARROW_KINDS = ("arrow", "line", "both")
HEADS = ("end", "start", "both", "none")
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


def _target_ref(value, refs: set[str], written: set[str], drawn: dict[str, str] | None = None) -> str:
    ref = str(value or "").strip().strip("`")
    if drawn and ref.startswith("draw:") and ref[5:] in drawn:
        return ref
    return _note_ref(value, written) or _ref(value, refs)


def _part(value, target: str, drawn: dict[str, str] | None = None) -> str:
    """The words of a note (or a drawn shape's label) pointed at: kept only when they are in it."""
    part = " ".join(str(value or "").split()).strip("`")
    text = target[5:] if target.startswith("note:") else (drawn or {}).get(target[5:], "") if target.startswith("draw:") else ""
    return part if part and part in text else ""


SHAPES = ("rectangle", "ellipse", "diamond")
LINKS = ("arrow", "line")
LAYOUTS = ("row", "column", "grid", "tree", "flow", "graph", "free")
ALIGNS = ("start", "center", "end")
#: The most elements one beat draws, and the longest label.
MAX_ELEMENTS = 24
MAX_LABEL = 60
#: The most points a path runs through.
MAX_POINTS = 32
_ID = re.compile(r"[^A-Za-z0-9_-]")


def _grid(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return min(100.0, max(0.0, v)) if v == v else None


def _drawing(d, refs: set[str], written: set[str], drawn: dict[str, str], groups: set[str]) -> Drawing | None:
    """A drawing safe to draw: known element types, ids of letters and digits, places on the 0-100 grid, and links
    whose ends are shapes drawn before them (on this beat or an earlier one) or refs from the list. ``drawn``
    collects the ids it adds, with their labels, so later beats can link to them and point at them; ``groups``
    the ids of the groups among them, which later elements may sit in."""
    if not isinstance(d, Drawing):
        return None
    out: list[DrawElement] = []
    for e in d.elements[:MAX_ELEMENTS]:
        if not isinstance(e, DrawElement) or e.type not in (*SHAPES, *LINKS, "path", "text", "group"):
            continue
        eid = _ID.sub("", str(e.id or ""))[:24]
        label = _clean(e.label)[:MAX_LABEL]
        end = lambda v: _ID.sub("", str(v or "")) if _ID.sub("", str(v or "")) in drawn else _target_ref(v, refs, written)
        start_ref, end_ref = (end(e.start), end(e.end)) if e.type in LINKS else ("", "")
        if (e.type == "text" and not label) or (e.type == "group" and not eid):
            continue
        group = _ID.sub("", str(e.group or ""))[:24]
        group = group if group in groups and group != eid else ""
        # A path's stroke, or a free arrow or line (a vector from one place to another) when it joins no shapes.
        free = e.type == "path" or (e.type in LINKS and not (start_ref and end_ref))
        points = [[_grid(p[0]), _grid(p[1])] for p in e.points[:MAX_POINTS] if isinstance(p, list) and len(p) >= 2] if free else []
        points = [p for p in points if None not in p]
        if free and len(points) < 2:
            continue
        if free:
            start_ref = end_ref = ""
        if e.type in LINKS and not eid and start_ref:
            eid = _ID.sub("", f"{start_ref}_{end_ref}")[:24]
        # Drawn already (a beat repeating the drawing so far): it stays as it is, not drawn twice.
        if eid and eid in drawn:
            continue
        near = (_ID.sub("", str(e.near or "")) if _ID.sub("", str(e.near or "")) in drawn else _target_ref(e.near, refs, written)) if e.type == "text" else ""
        out.append(DrawElement(type=e.type, id=eid, label=label, x=_grid(e.x), y=_grid(e.y), w=_grid(e.w), h=_grid(e.h),
                               start=start_ref, end=end_ref, near=near, points=points, group=group,
                               layout=e.layout if e.type == "group" and e.layout in LAYOUTS else "",
                               align=e.align if e.type == "group" and e.align in ALIGNS else "",
                               heads=e.heads if e.type == "arrow" and e.heads in HEADS else "",
                               closed=bool(e.closed) and e.type == "path" and len(points) > 2, color=_ink(e.color)))
        if eid:
            drawn[eid] = label
            if e.type == "group":
                groups.add(eid)
    if not out:
        return None
    return Drawing(layout=d.layout if d.layout in LAYOUTS else "", elements=out)


def _rub_out(value, drawn: dict[str, str], links: dict[str, tuple[str, str]]) -> list[str]:
    """The drawn ids a beat rubs out; with them go the links joined to them and what sits in them (and so on): all
    of it leaves ``drawn``."""
    ids = [i for i in dict.fromkeys(_ID.sub("", str(v or ""))[:24] for v in (value or [])) if i in drawn]
    gone = set(ids)
    while more := {lid for lid, ends in links.items() if lid not in gone and gone & set(ends)}:
        gone |= more
    for i in gone:
        drawn.pop(i, None)
        links.pop(i, None)
    return ids


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


def clean_steps(raw, refs: set[str], frames: int, left=None) -> list[PresentStep]:
    """Beats safe to play: a ref not on the list points at nothing, a frame outside the run stays put, a beat with
    nothing to say is dropped. ``left`` is what earlier walk-throughs left on the view (notes, board lines, drawn
    shapes): the beats may point at it, build on it or wipe it."""
    out = []
    written: set[str] = set()       # the notes on the view so far, by text: a beat may point at them
    drawn: dict[str, str] = {}      # what was drawn so far, id -> label: a beat may link to it or point at it
    links: dict[str, tuple[str, ...]] = {}   # the drawn links, texts and grouped things, id -> what they hang on
    groups: set[str] = set()        # the drawn groups' ids: what a later element may sit in
    if left is not None:
        written |= {_note_key(t) for t in [*left.notes, *left.board] if t.strip()}
        for d in left.drawn:
            eid = _ID.sub("", d.id)[:24]
            if eid:
                drawn[eid] = _clean(d.label)[:MAX_LABEL]
                if d.type == "group":
                    groups.add(eid)
                if d.joins:
                    links[eid] = tuple(_ID.sub("", j)[:24] for j in d.joins)
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
        if s.erase:
            drawn.clear();links.clear();groups.clear()
        rubbed = _rub_out(s.erase_draw, drawn, links)
        groups &= set(drawn)
        drawing = _drawing(s.draw, refs, written, drawn, groups)
        for e in drawing.elements if drawing else []:
            if e.id and (e.start or e.near or e.group):
                links[e.id] = (e.start, e.end) if e.start else (e.near,) if e.near else (e.group,)
        target = _target_ref(s.target, refs, written, drawn)
        out.append(PresentStep(say=_clean(s.say), target=target, part=_part(s.part, target, drawn),
                               mark=s.mark if s.mark in MARKS else "point",
                               frame=frame if 0 <= frame < frames else -1,
                               write=write, write_near=_target_ref(s.write_near, refs, written, drawn) if write else "", erase=bool(s.erase),
                               arrow_to=_target_ref(s.arrow_to, refs, written, drawn),
                               arrow_from=_target_ref(s.arrow_from, refs, written, drawn) if _target_ref(s.arrow_to, refs, written, drawn) else "",
                               draw=drawing,
                               arrow_kind=s.arrow_kind if s.arrow_kind in ARROW_KINDS else "arrow",
                               board=board, erase_notes=_notes(s.erase_notes), erase_draw=rubbed,
                               color=_ink(s.color), **_slider_move(s, refs)))
    return out[:MAX_STEPS]


def present(target_refs: set[str], frame_count: int, left=None, **inputs) -> Presentation:
    """Ask the model for the beats; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _presenter()(**inputs), label="scene_present")
    except Exception as e:
        log.exception("scene_present: the model call failed")
        return Presentation(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    return Presentation(steps=clean_steps(out.steps, target_refs, frame_count, left))
