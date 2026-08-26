r"""Proposal -> a canonical `Scene` the renderer accepts. No LM.

Everything here is arithmetic on what the model said, which is why it is a
separate step: a model can say WHAT a scene shows; where to point the camera is
a consequence of that, not a second judgement.

Four jobs:

ids         minted, never proposed. `remove[]` directives and slider bindings
            reference them, so a model that repeats one silently breaks a LATER
            step — the scene builds, and something vanishes three beats on.
geometry    coordinate strings -> numbers or math.js expressions.
prompts     the Ask-AI question per element, when the lesson uses them.
staging     `range` and `camera` from the bounding box. Both appear on 84/84
            published scenes, so a scene without them is not a finished scene.

THREE NOTATIONS, ONE PER KIND OF FIELD, AND NO CONVERSION BETWEEN THEM
----------------------------------------------------------------------
========================  ==================================================
coordinates, expressions  math.js — `cos(theta)`, `Rp+h`, `lambda + 0.6`
labels                    KaTeX — `$\vec{a}$`
titles, descriptions      markdown with embedded KaTeX
========================  ==================================================

The model is told which is which (see `proposed.py`, whose field descriptions are
prompt surface). Compose does NOT translate between them, and an early version
that tried is why this is spelled out: coordinates in the corpus are already
math.js, none of the 782 contains a backslash, and running them through
`latex_to_mathjs` is not a no-op but destruction::

    'cos(theta)'   -> 'c*o*s(E*a*h*t**2)'
    'Rp+h'         -> 'R*p + h'          # Rp is ONE variable in the corpus
    'lambda + 0.6' -> 'a*b*da*l*m + 0.6'

No exception, just a different scene. A converter cannot tell which notation it
was handed, so it is the PROMPT's job to get it right and this module's job to
say plainly when it did not. Refusing names the field and the expected notation,
which is also the feedback a retry needs.

`scale` and `views` are NOT derived. `scale` appears on 41/84 scenes with no
relationship to `range` I could find, and a `views` entry is mostly `name` and
`description` — editorial, not geometric. Deriving a single "Overview" view whose
position equals the camera's would add a line and no information.
"""
from __future__ import annotations

import logging
import re
from typing import Optional, Union

from backend.model.lesson import Element, Scene, Step

from .proposed import SCENE_LEVEL, SUPPORTED_TYPES, ProposedElement, ProposedStep

log = logging.getLogger(__name__)

Num = Union[int, float]
Coord = list[Union[Num, str]]

#: Half a unit of air around the geometry, so nothing sits on the frame edge.
PADDING = 0.5
#: Smallest half-extent for an axis. A scene drawn entirely in the z=0 plane has
#: zero depth, and a zero-depth range collapses the view.
MIN_EXTENT = 1.0
#: How far back the camera sits, as a multiple of the scene's largest half-extent.
CAMERA_STANDOFF = 2.2

_SLUG = re.compile(r"[^a-z0-9]+")


class ComposeError(ValueError):
    """The proposal cannot become a scene. Says which element and why."""


# --------------------------------------------------------------- coordinates

def _coord(text: str, where: str) -> Optional[Coord]:
    """`"1, 2, 0"` -> `[1, 2, 0]`; `""` -> None.

    Numbers stay numbers (`int` where the model wrote an int — the canonical
    model preserves that distinction and the corpus depends on it). Anything
    else rides through as a math.js expression string.
    """
    text = (text or "").strip()
    if not text:
        return None
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 3:
        raise ComposeError(f"{where}: expected three comma-separated coordinates, got {text!r}")
    return [_scalar(p, where) for p in parts]


def _scalar(part: str, where: str) -> Union[Num, str]:
    if not part:
        raise ComposeError(f"{where}: empty coordinate in {part!r}")
    try:
        return int(part)
    except ValueError:
        pass
    try:
        return float(part)
    except ValueError:
        pass
    return _expression(part, where)


def _expression(part: str, where: str) -> str:
    """A non-numeric coordinate. Must be math.js; must not be LaTeX.

    Backslash is the whole test, and it is a measurement rather than a heuristic:
    0 of the corpus's 782 coordinates contain one, and every LaTeX command needs
    one. So this never fires on valid input, and fires exactly when a model that
    has been writing KaTeX labels carries the habit into a coordinate.
    """
    if "\\" not in part:
        return part
    raise ComposeError(
        f"{where}: coordinate {part!r} is LaTeX, but coordinates are math.js — "
        f"write cos(theta), not \\cos(\\theta). LaTeX belongs in `label`.")


def _polyline(text: str, where: str) -> Optional[list[Coord]]:
    text = (text or "").strip()
    if not text:
        return None
    return [_coord(chunk, where) for chunk in text.split(";") if chunk.strip()]


# ---------------------------------------------------------------------- ids

def _slug(text: str, fallback: str) -> str:
    """A readable id fragment. Labels carry LaTeX, so strip to letters first."""
    plain = re.sub(r"[\\${}^_]|\\[a-zA-Z]+", " ", text or "")
    slug = _SLUG.sub("-", plain.lower()).strip("-")
    return slug[:24] or fallback


def _mint(el: ProposedElement, taken: set[str]) -> str:
    """`s2-velocity`, uniquely. Scoped by step so ids read as a timeline.

    Never taken from the model: `remove[{id}]` and slider bindings reference
    these, so a repeat does not fail here — it removes the wrong object later.
    """
    stem = "scene" if el.step == SCENE_LEVEL else f"s{el.step}"
    base = f"{stem}-{_slug(el.label, el.type or 'element')}"
    candidate, n = base, 2
    while candidate in taken:
        candidate, n = f"{base}-{n}", n + 1
    taken.add(candidate)
    return candidate


# ------------------------------------------------------------------ prompts

def _prompt(el: ProposedElement) -> Optional[str]:
    """The Ask-AI question, when the model did not write one.

    Phrased about the OBJECT, since that is what the reader clicked.
    """
    if el.prompt.strip():
        return el.prompt.strip()
    if el.type in ("axis", "grid"):
        return None
    subject = el.label.strip() or f"this {el.type.replace('_', ' ')}"
    return f"What does {subject} represent here?"


# ------------------------------------------------------------------ staging

def _extents(coords: list[Coord]) -> Optional[list[tuple[float, float]]]:
    """Per-axis (min, max) over every NUMERIC coordinate.

    Expression coordinates are skipped rather than guessed at: `Rp+h` has no
    value until the sliders exist, and a made-up one would frame the scene
    around a number nobody chose.
    """
    axes: list[list[float]] = [[], [], []]
    for c in coords:
        for i, v in enumerate(c):
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                axes[i].append(float(v))
    if not any(axes):
        return None
    return [(min(a), max(a)) if a else (0.0, 0.0) for a in axes]


def _range(extents: list[tuple[float, float]]) -> list[list[Num]]:
    out = []
    for lo, hi in extents:
        mid, half = (lo + hi) / 2, max((hi - lo) / 2 + PADDING, MIN_EXTENT)
        out.append([_tidy(mid - half), _tidy(mid + half)])
    return out


def _camera(extents: list[tuple[float, float]]) -> dict:
    """Back off along +z, raised a little, looking at the middle of the geometry.

    A single standoff derived from the LARGEST half-extent, so a wide flat scene
    and a tall narrow one are both fully in frame.
    """
    target = [_tidy((lo + hi) / 2) for lo, hi in extents]
    reach = max(max((hi - lo) / 2 for lo, hi in extents), MIN_EXTENT)
    return {"position": [target[0], _tidy(target[1] + reach * 0.4),
                         _tidy(target[2] + reach * CAMERA_STANDOFF)],
            "target": target}


def _tidy(x: float) -> Num:
    """Two decimals, and an int when it is one — the corpus writes `0`, not `0.0`."""
    r = round(x, 2)
    return int(r) if r == int(r) else r


# ----------------------------------------------------------------- assembly

def _element(el: ProposedElement, taken: set[str], with_prompts: bool) -> tuple[Element, list[Coord]]:
    if el.type not in SUPPORTED_TYPES:
        raise ComposeError(f"unsupported element type {el.type!r}; "
                           f"expected one of {', '.join(SUPPORTED_TYPES)}")
    where = f"{el.type} {el.label or '(unlabelled)'!r}"
    body: dict = {"type": el.type, "id": _mint(el, taken)}
    coords: list[Coord] = []

    # `tail`/`head` are the model's words; `from`/`to` are the schema's.
    for name, value in (("position", _coord(el.position, where)),
                        ("from", _coord(el.tail, where)),
                        ("to", _coord(el.head, where))):
        if value is not None:
            body[name] = value
            coords.append(value)
    if (line := _polyline(el.points, where)) is not None:
        body["points"] = line
        coords += line

    if el.label.strip():
        body["label"] = el.label.strip()
    if el.color.strip():
        body["color"] = el.color.strip()
    if with_prompts and (prompt := _prompt(el)):
        body["prompt"] = prompt
    return Element.model_validate(body), coords


def compose(
    title: str,
    description: str,
    elements: list[ProposedElement],
    steps: list[ProposedStep],
    *,
    with_prompts: bool = True,
) -> Scene:
    """Assemble a canonical `Scene`. Raises `ComposeError` with the offender named."""
    if not (title or "").strip():
        raise ComposeError("a scene needs a title; the schema requires one")

    taken: set[str] = set()
    scene_level: list[Element] = []
    per_step: dict[int, list[Element]] = {}
    all_coords: list[Coord] = []

    for el in elements:
        built, coords = _element(el, taken, with_prompts)
        all_coords += coords
        (scene_level if el.step == SCENE_LEVEL else per_step.setdefault(el.step, [])).append(built)

    ordered = sorted(steps, key=lambda s: s.index)
    built_steps = [
        Step.model_validate({
            "title": s.title.strip() or f"Step {i + 1}",
            **({"description": s.description.strip()} if s.description.strip() else {}),
            **({"add": per_step.pop(s.index, [])} if per_step.get(s.index) else {}),
        })
        for i, s in enumerate(ordered)
    ]
    if per_step:
        raise ComposeError(
            f"element(s) placed in step(s) {sorted(per_step)}, which the proposal "
            f"does not define (it has {len(ordered)}). An element in a step that "
            f"never runs simply never appears.")

    body: dict = {"title": title.strip()}
    if (description or "").strip():
        body["description"] = description.strip()
    if scene_level:
        body["elements"] = scene_level
    if built_steps:
        body["steps"] = built_steps
    if (extents := _extents(all_coords)) is not None:
        body["range"] = _range(extents)
        body["camera"] = _camera(extents)
    return Scene.model_validate(body)
