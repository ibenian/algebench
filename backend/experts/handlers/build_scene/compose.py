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

from backend.experts.modules.build_scene.proposed import (
    SCENE_LEVEL, SUPPORTED_TYPES, ProposedElement, ProposedSlider, ProposedStep)

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

#: Which closer each opener expects. The KIND is tracked, not just a count:
#: `([)]` and `(]` balance numerically and are still malformed math.js.
_CLOSES = {"(": ")", "[": "]", "{": "}"}


def _split_top_level(text: str, where: str, sep: str = ",") -> list[str]:
    """Split on `sep`, but not inside brackets. Refuse brackets that do not pair.

    A coordinate is three math.js expressions, and a math.js expression may
    itself contain commas: `hypot(ax, ay, az)` is one value, not three. Splitting
    naively turned a perfectly good coordinate —

        (ax/hypot(ax,ay,az) + bx/hypot(bx,by,bz)) * 0.5, (ay/…) * 0.5, (az/…) * 0.5

    — into NINE parts and refused the whole scene, with a message about adding
    vectors component by component that had nothing to do with what went wrong.
    Observed live on a dot-product scene: the build was correct and was thrown
    away, taking the placeholder with it.

    Bad brackets are REFUSED rather than skipped past. Reading the text as though
    a stray character were not there turns malformed math.js into a coordinate
    that composes cleanly and then fails at render — silently, nothing drawn and
    nothing said, which is the failure class this module exists to close. Three
    ways it can be wrong, all caught: a closer with nothing open, a closer of the
    wrong KIND, and anything still open at the end.
    """
    parts: list[str] = []
    stack: list[str] = []
    current: list[str] = []
    for ch in text:
        if ch in _CLOSES:
            stack.append(_CLOSES[ch])
        elif ch in ")]}":
            if not stack:
                raise ComposeError(
                    f"{where}: unbalanced brackets in `{text}` — a '{ch}' with "
                    f"nothing open before it. Coordinates are math.js; count the "
                    f"brackets.")
            if stack[-1] != ch:
                raise ComposeError(
                    f"{where}: mismatched brackets in `{text}` — found '{ch}' "
                    f"where '{stack[-1]}' was expected. Coordinates are math.js; "
                    f"check the bracket kinds.")
            stack.pop()
        if ch == sep and not stack:
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    if stack:
        raise ComposeError(
            f"{where}: unbalanced brackets in `{text}` — {len(stack)} left open "
            f"('{''.join(reversed(stack))}' missing). Coordinates are math.js; "
            f"count the brackets.")
    parts.append("".join(current).strip())
    return parts


def _coord(text: str, where: str) -> Optional[Coord]:
    """`"1, 2, 0"` -> `[1, 2, 0]`; `""` -> None.

    Numbers stay numbers (`int` where the model wrote an int — the canonical
    model preserves that distinction and the corpus depends on it). Anything
    else rides through as a math.js expression string.
    """
    text = (text or "").strip()
    if not text:
        return None
    parts = _split_top_level(text, where)
    if len(parts) != 3:
        # TOO MANY parts has one cause in practice: the model tried to ADD TWO
        # VECTORS in place — `2, 1, 0 + 0, 2, 0` for "the tip of r plus F".
        # Naming the fix beats naming the count, because the count is not what
        # it got wrong. (That example splits into FIVE, not six: `0 + 0` is a
        # single part. Hence `> 3` rather than a guess at the arity.)
        hint = (" — to add two vectors, add them COMPONENT BY COMPONENT and write "
                "the three results: '2, 3, 0', not 'a, b, c + d, e, f'"
                if len(parts) > 3 else "")
        raise ComposeError(f"{where}: expected three comma-separated coordinates, "
                           f"got `{text}`{hint}")
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
        f"{where}: coordinate `{part}` is LaTeX, but coordinates are math.js — "
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


#: Grid planes the schema allows. `xy` is its default and the corpus majority
#: (63 of 84), so an unstated plane is not an error.
PLANES = ("xy", "xz", "yz")
AXES = ("x", "y", "z")


def _which_axis(el: ProposedElement, where: str) -> str:
    """Which axis this `axis` element is.

    Falls back to the LABEL, because that is what the model reliably writes: an
    axis is labelled `x` or `$x$` even when nothing said `axis: x`. Without this
    every axis composed identically and all three were drawn on the same line —
    the scene showed one axis wearing three labels, and nothing errored.
    """
    stated = el.axis.strip().lower()
    if stated in AXES:
        return stated
    # `$x$`, `x`, `X` — strip the KaTeX and see what is left.
    guess = el.label.strip().strip("$").strip().lower()
    if guess in AXES:
        return guess
    raise ComposeError(
        f"{where}: an axis element must say which axis it is — set `axis` to "
        f"'x', 'y' or 'z'. Three axes that do not say are all drawn on the same "
        f"line, which renders as one axis with three labels.")


def _which_plane(el: ProposedElement) -> str:
    stated = el.plane.strip().lower()
    return stated if stated in PLANES else "xy"


#: A math.js identifier, which is what a slider id has to be: it becomes a
#: variable name inside every coordinate that references it.
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")


#: The two curve types, which are drawn by SAMPLING an interval rather than by
#: naming endpoints — so they need `range`, and nothing else in the contract does.
CURVE_TYPES = ("animated_curve", "parametric_curve")

#: The corpus default for a curve. Enough that a sine wave reads as a curve
#: rather than a polygon, cheap enough that nothing notices.
CURVE_SAMPLES = 200


def _interval(text: str, where: str) -> list:
    """`"0, 6"` -> `[0, 6]`; `"-2*pi, 2*pi"` -> `["-2*pi", "2*pi"]`.

    A number becomes a number and an expression stays exactly as written — the
    schema allows either ("Components can be numbers or math.js expression
    strings") and math.js resolves it in the browser. The docstring used to
    promise `[-6.28, 6.28]`, from when this evaluated; leaving that claim behind
    would invite someone to reintroduce the evaluator it describes.
    """
    parts = _split_top_level(text or "", where)
    if len(parts) != 2 or not all(parts):
        raise ComposeError(
            f"{where}: a curve needs `range` — the interval it is drawn over, as "
            f"two math.js values `min, max` (e.g. `-2*pi, 2*pi`). Got `{text}`.")
    # `_scalar`, not an evaluator: a number stays a number and `2*pi` stays the
    # string `2*pi`. The schema allows either — "Components can be numbers or
    # math.js expression strings" — and math.js resolves it in the browser,
    # which is the only place these are ever executed.
    return [_scalar(part, where) for part in parts]


def _curve(el: ProposedElement, body: dict, where: str) -> None:
    """Fill in a curve's own fields, in the shape its renderer reads.

    The two differ and it matters: `animated_curve` takes ONE expression for y
    over x, while `parametric_curve` takes x, y and z separately over t. Handing
    either the other's shape draws nothing at all.
    """
    body["range"] = _interval(el.range, f"{where} range")
    body["samples"] = CURVE_SAMPLES
    if el.type == "animated_curve":
        if not el.curve_expr.strip():
            raise ComposeError(
                f"{where}: an animated_curve needs `curve_expr` — y as a single "
                f"math.js function of x, e.g. A*sin(k*x). One expression, not "
                f"three: the curve is drawn by sampling x across `range`.")
        body["expr"] = el.curve_expr.strip()
        body["plane"] = _which_plane(el) if el.plane.strip() else "xy"
        return
    # parametric_curve: the point at parameter t, as x, y and z.
    triple = _coord(el.to_expr, f"{where} to_expr")
    if triple is None:
        raise ComposeError(
            f"{where}: a parametric_curve needs `to_expr` — the point at "
            f"parameter t, as three math.js expressions, e.g. cos(t), sin(t), 0.")
    for axis, value in zip("xyz", triple):
        body[axis] = str(value)


#: How many straight pieces in one step stop being a shape and start being a
#: sampled curve. Measured against the corpus, where the busiest step holding
#: `line`/`animated_line` has 5 — a coordinate frame, a chord and its drop lines.
#: The observed approximation had 48.
MAX_SEGMENTS_PER_STEP = 8


def _refuse_sampled_curves(per_step: dict[int, list], scene_level: list) -> None:
    """Refuse a curve that was PLOTTED rather than described.

    A closed-form expression is resampled every frame, which is the only reason a
    curve stays smooth as the reader drags a slider or zooms. A chain of straight
    pieces is frozen at whatever resolution it was written at, is slow, and — as
    observed — often does not render at all.

    The prompt says this at length. It is enforced too because prompting alone
    has already failed twice on this signature: the model kept inventing
    `type: slider` after being told the type list was closed. A count is a crude
    test, but the failure it catches is not subtle — 48 segments where the
    busiest published step has 5.
    """
    for step, built in list(per_step.items()) + [(SCENE_LEVEL, scene_level)]:
        pieces = [e for e in built if e.type in ("line", "animated_line")]
        if len(pieces) <= MAX_SEGMENTS_PER_STEP:
            continue
        where = "the scene" if step == SCENE_LEVEL else f"step {step}"
        raise ComposeError(
            f"{where} has {len(pieces)} straight segments — that is a curve "
            f"sampled by hand, not a shape. Write the formula instead: an "
            f"`animated_curve` with one `curve_expr` for a y = f(x) graph, or a "
            f"`parametric_curve` with `to_expr` for anything traced by a "
            f"parameter. One element, resampled every frame, so it stays smooth "
            f"when a slider moves.")


#: Fields that are never math.js, so their words are not slider references.
#: A DENYLIST, not an allowlist: an unknown field keeps being scanned, so a new
#: expression-bearing key is covered the day it appears rather than the day
#: someone remembers to list it. The cost of that choice is a false positive
#: (a slider appears a step early); the cost of the other is an element that
#: renders nothing and says nothing.
_NOT_EXPRESSIONS = frozenset({"type", "id", "label", "color", "prompt", "axis", "plane"})


def _references(built, slider_ids: set[str]) -> set[str]:
    """Which sliders this composed element's EXPRESSIONS name.

    Scanning every string field read PROSE as code. `label` is KaTeX and `prompt`
    is an English question, so a point at `[0, 0, 0]` "referenced" a slider named
    `a` because its prompt said "What does a represent here?", and every axis
    "referenced" one named `x` through its own `axis: "x"`. Both then dragged the
    slider forward to a step nothing on it actually uses — and `x`, `a`, `t` are
    exactly the names sliders get.
    """
    found: set[str] = set()
    for key, value in built.model_dump(exclude_none=True).items():
        if key in _NOT_EXPRESSIONS:
            continue
        for text in _strings(value):
            found |= set(_NAMES.findall(text)) & slider_ids
    return found


def _strings(value):
    """Every string anywhere in a composed element's value.

    Dicts are walked too. `Element` is `extra="allow"`, so a field this composer
    does not build today can still ride through — and a slider reference hiding
    in one would not be seen, `_pull_sliders_forward` would not move the slider,
    and the element would render nothing with no error anywhere. No composed
    element holds a dict today; this is so the answer does not depend on that
    staying true.
    """
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            yield from _strings(item)


def _pull_sliders_forward(by_step: dict[int, list], first_use: dict[str, int]) -> None:
    """Move a slider to the step where it is first NEEDED, if that is earlier.

    A step's sliders come into existence with the step. So an element added at
    step 1 whose expression names `A`, with `A` introduced at step 2, cannot
    evaluate — and an `animated_curve` that cannot evaluate renders NOTHING, with
    no error anywhere. Observed exactly: a sine wave `A*sin(k*x)` drawn at step 1
    with `A` at step 2 and `k` at step 3, on an empty pair of axes.

    Moving the control earlier rather than refusing: the model's staging is a
    reasonable teaching order ("show the wave, then let them change A"), and the
    cost of honouring it literally is a blank scene. A slider appearing one step
    before its narration is a far smaller loss.
    """
    for step, defined in list(by_step.items()):
        for slider in list(defined):
            needed = first_use.get(slider["id"])
            # `>=`, not `>`: equality is the ordinary case — the slider is
            # already where it is needed — and moving it to its own step would
            # remove it from this list and append it straight back. Skipping is
            # for clarity, not correctness; the two behave the same.
            if needed is None or needed >= step:
                continue
            defined.remove(slider)
            by_step.setdefault(needed, []).append(slider)
            log.info("moved slider %r from step %d to %d, where it is first used",
                     slider["id"], step, needed)
        if not defined:
            by_step.pop(step, None)


def _sliders(proposed: list[ProposedSlider]) -> tuple[list, dict[int, list]]:
    """Validate the controls and group them by the step that introduces them.

    Returns `(all, by_step)`. The flat list is not used to build the scene — it
    is the record of which ids exist, which is what makes a coordinate like
    `rx, ry, 0` mean something.
    """
    built: list = []
    by_step: dict[int, list] = {}
    seen: set[str] = set()
    for sl in proposed:
        name = sl.id.strip()
        if not _IDENTIFIER.match(name):
            raise ComposeError(
                f"slider id {sl.id!r} is not a usable variable name — it becomes "
                f"a math.js identifier inside every coordinate that references "
                f"it, so it must be letters, digits and underscores, and must "
                f"not start with a digit.")
        if name in seen:
            raise ComposeError(
                f"two sliders share the id {name!r}. A coordinate naming it "
                f"cannot say which one it means.")
        seen.add(name)
        if sl.min >= sl.max:
            raise ComposeError(
                f"slider {name!r} has min {sl.min} and max {sl.max}: a slider "
                f"with nowhere to travel is a constant, so write the number.")
        # CLAMPED, not refused. A default outside the track is the model being
        # careless about a number the reader can fix in one drag — refusing the
        # whole scene over it costs far more than it saves.
        start = min(max(sl.default, sl.min), sl.max)
        body = {"id": name, "min": sl.min, "max": sl.max,
                "step": sl.step_size if sl.step_size > 0 else 0.1,
                "default": start}
        if sl.label.strip():
            body["label"] = sl.label.strip()
        built.append(body)
        by_step.setdefault(sl.step, []).append(body)
    return built, by_step


# ------------------------------------------------------------------ staging

#: Bare identifiers inside a math.js expression. Used only to ask "does this
#: mention a slider", so operators and numbers are irrelevant — this READS the
#: text, it never evaluates it.
_NAMES = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _animated(kind: str) -> str:
    """The moving counterpart of a static type."""
    return kind if kind.startswith("animated_") else f"animated_{kind}"


def _extents(coords: list[Coord]) -> Optional[list[tuple[float, float]]]:
    """Per-axis (min, max) over every NUMERIC coordinate.

    Expression coordinates are skipped rather than guessed at: `Rp+h` has no
    value until the sliders exist, and a made-up one would frame the scene
    around a number nobody chose.

    A TYPE CHECK, never an evaluation. A scene's expressions are math.js — plus
    this project's own extensions — and they are executed in ONE place, the
    browser, by math.js itself. An earlier revision of this function evaluated
    them here with `safe_eval_math`, which is a PYTHON ast parser: that is one
    language read through another language's grammar, and it works only where the
    two happen to agree. Where they do not, the failure is silent and total —
    `x^2` is exponentiation in math.js and XOR in Python, so a parabola composed
    with no `range` and no `camera` at all. Ternaries, factorials and
    element-wise operators diverge the same way.

    The constant that started it (`3*sin(PI/4)`) should never have reached here:
    the contract already says a coordinate not depending on a slider is a NUMBER.
    Enforce that rule rather than building a second evaluator so it can be broken.
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
    # Plain quotes, NOT `!r`. `repr()` escapes the backslash, so a label that is
    # `$\theta$` was reported as `$\\theta$` — doubling in an error message, in a
    # module whose entire thesis is that backslash-doubling is the silent
    # corruption to avoid. It also makes the label unrecognisable to whoever is
    # trying to find the element it names.
    # Backticks, not quotes: this string is embedded in a reason that is rendered
    # as MARKDOWN — in chat and in the failure report — and a label is KaTeX, full
    # of backslashes and underscores. Quoted plainly, `sa_x*sb_x` came out as
    # `sa_xsb_x` because the asterisks were read as emphasis, which made a correct
    # refusal look like a nonsense one.
    #
    # An unlabelled element says WHERE it is rather than repeating its type,
    # which identifies nothing.
    where = (f"{el.type} `{el.label.strip()}`" if el.label.strip()
             else f"{el.type} in step {el.step}" if el.step != SCENE_LEVEL
             else f"scene-level {el.type}")
    body: dict = {"type": el.type, "id": _mint(el, taken)}
    coords: list[Coord] = []

    # The proposal speaks snake_case; the schema speaks its own names.
    #
    # See schemas/lesson.schema.json, `$defs.element.properties`. The vocabulary
    # IS symmetric — `from`/`fromExpr` and `to`/`toExpr` — and an earlier comment
    # here claimed otherwise, that "the animated HEAD is `expr`, not `toExpr`".
    # That was simply wrong: `toExpr` exists, the corpus uses it 18 times, and
    # the schema calls it "Alias for 'expr' on animated_vector/animated_cylinder".
    #
    # `expr` is still what we emit, because it is what every animated renderer
    # checks FIRST (`el.expr || el.toExpr`, src/objects/animated-vector.ts) and
    # it is the only spelling that also serves animated_curve, whose `expr` is a
    # single string rather than a triple. A synonym, chosen deliberately — not a
    # gap being worked around.
    #
    # A STATIC coordinate that references a slider is PROMOTED to the animated
    # form rather than refused. The renderer resolves `to` once at load, with no
    # sliders bound, so `to: ["a_x", "a_y", "a_z"]` on a plain `vector` silently
    # draws nothing — observed: nine sliders, a full legend, and an empty
    # viewport. Every slider-driven vector in the corpus is an `animated_vector`
    # carrying `expr`. Which of the two shapes to use is a representation detail
    # the model should not have to know, and it is mechanical to decide here.
    # Each field names ITSELF in the error, using the name the MODEL wrote
    # (`from_pos`, not the schema's `from`). All three used to pass the same
    # `where`, so a refusal said `text '$\theta$': expected three coordinates`
    # and left you to work out which of three fields it meant — by elimination,
    # if you happened to know a `text` has no endpoints.
    static = {"position": _coord(el.position, f"{where} position"),
              "from": _coord(el.from_pos, f"{where} from_pos"),
              "to": _coord(el.to_pos, f"{where} to_pos")}
    #: `from`/`to` -> the schema's animated names. `position` animates as `expr`,
    #: the same key a moving head uses.
    ANIMATED_NAME = {"position": "expr", "from": "fromExpr", "to": "expr"}

    # THE FIELD DECIDES, per schemas/lesson.schema.json: `from`/`to`/`position`
    # carry CONSTANTS and the `*Expr` family carries math.js. So the test is
    # simply "is this component a number?" — not "does it name a slider".
    #
    # Keying on slider names left a hole: `to_pos: 2*pi, 0, 0` references no
    # slider, so it stayed on a static `vector` as `to: ["2*pi", 0, 0]`. That is
    # schema-legal — `$defs.vec3` items are `oneOf: [number, string]` — but
    # `vector.ts` passes `to` straight into `makeArrowMesh` and into
    # `(from[0] + to[0]) / 2` with no evaluation, so the component is NaN and the
    # element renders nothing. 0 of the corpus's 1088 coordinates mix the two.
    #
    # Decided for the ELEMENT, not per coordinate: a line with ONE moving end is
    # still a moving line, and it has to be built the moving way throughout.
    moves = any(isinstance(v, str)
                for value in static.values() if value for v in value)
    if moves and not el.type.startswith("animated_"):
        moving = _animated(el.type)
        if moving not in SUPPORTED_TYPES:
            raise ComposeError(
                f"{where}: its coordinates depend on a slider, but there is no "
                f"{moving} type — a {el.type} cannot move. Give it fixed "
                f"coordinates, or use a type that can.")
        body["type"] = moving
    kind = body["type"]

    for name, value in static.items():
        if value is None:
            continue
        if moves and kind == "animated_line":
            # An `animated_line` is driven by `points` — expression TRIPLES, not
            # `fromExpr`/`expr`. `renderAnimatedLine` reads `el.points` and
            # returns null without it, so promoting a line the way a vector is
            # promoted produced an element that drew nothing and said nothing.
            # BOTH ends go in, moving or not, or the line has only one.
            body.setdefault("points", []).append([str(v) for v in value])
        elif moves and any(isinstance(v, str) for v in value):
            # Per COORDINATE, not per element: a vector with a fixed tail and a
            # moving head is ordinary — 3 of the 4 animated vectors in the
            # corpus's own interactive step are exactly that — and forcing the
            # tail into `fromExpr` would rewrite a literal as an expression for
            # no reason.
            body[ANIMATED_NAME[name]] = [str(v) for v in value]
        else:
            body[name] = value
        # Either way it is offered to the frame. `_extents` keeps only the
        # LITERAL numbers among them — an expression has no value until math.js
        # evaluates it in the browser, and guessing one here would frame the
        # scene around a number nobody chose.
        coords.append(value)

    # Expression geometry never joins `coords`: it has no value until the
    # sliders exist, and a made-up one frames the scene around a number nobody
    # chose. See `_extents`.
    # A `parametric_curve` reads `to_expr` as its x/y/z (see `_curve`), so the
    # generic mapping would ALSO leave an `expr` triple behind — a key its
    # renderer does not read and the schema does not want on that type.
    if el.type != "parametric_curve":
        for name, raw in (("fromExpr", el.from_expr), ("expr", el.to_expr)):
            said = "from_expr" if name == "fromExpr" else "to_expr"
            if (value := _coord(raw, f"{where} {said}")) is not None:
                body[name] = [str(v) for v in value]

    # An animated element has to carry SOMETHING time-varying, but not all of
    # them carry it the same way: all 97 `animated_line` in the corpus are driven
    # by `points` and NONE use `expr`, so requiring `to_expr` refused every
    # legitimate one. Measured, not assumed — the earlier version was assumed.
    # A CURVE is exempt: it is animated by sampling `range`, and `_curve` checks
    # its own fields. Requiring `to_expr` here refused every legitimate one.
    if (el.type.startswith("animated_") and el.type not in CURVE_TYPES
            and not (el.to_expr.strip() or el.points.strip())):
        raise ComposeError(
            f"{where}: an {el.type} needs `to_expr` (three math.js expressions in "
            f"terms of a slider) or `points`. Without either nothing moves, and it "
            f"is a {el.type.removeprefix('animated_')} wearing the wrong type.")
    if (line := _polyline(el.points, f"{where} points")) is not None:
        body["points"] = line
        coords += line

    if el.type in CURVE_TYPES:
        # A curve names an INTERVAL, so it contributes no coordinates the way an
        # element with endpoints does — and it must not be sampled here to invent
        # some, because sampling means evaluating math.js in Python. Framing a
        # curve-only scene belongs where math.js lives.
        _curve(el, body, where)

    if el.type == "axis":
        body["axis"] = _which_axis(el, where)
    elif el.type == "grid":
        body["plane"] = _which_plane(el)

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
    sliders: Optional[list[ProposedSlider]] = None,
    *,
    with_prompts: bool = True,
) -> Scene:
    """Assemble a canonical `Scene`. Raises `ComposeError` with the offender named."""
    if not (title or "").strip():
        raise ComposeError("a scene needs a title; the schema requires one")

    built_sliders, per_step_sliders = _sliders(sliders or [])
    # The ids that exist, taken from the BUILT sliders rather than the proposals.
    # `_sliders` is the one place that normalises, and reading the raw ids here
    # meant normalising in two places and disagreeing: a model that wrote
    # `id: ax ` got a slider called `ax` and a lookup key of `ax `, so
    # `_is_dynamic` never matched and the vector was never promoted. One trailing
    # space, and nothing animated.
    slider_ids = {s["id"] for s in built_sliders}

    taken: set[str] = set()
    scene_level: list[Element] = []
    per_step: dict[int, list[Element]] = {}
    all_coords: list[Coord] = []

    #: slider id -> the earliest step whose content references it.
    first_use: dict[str, int] = {}

    for el in elements:
        built, coords = _element(el, taken, with_prompts)
        all_coords += coords
        for name in _references(built, slider_ids):
            # A scene-level element is on screen before ANY step runs, so its
            # sliders have to exist from step 0.
            at = 0 if el.step == SCENE_LEVEL else el.step
            first_use[name] = min(first_use.get(name, at), at)
        (scene_level if el.step == SCENE_LEVEL else per_step.setdefault(el.step, [])).append(built)

    _refuse_sampled_curves(per_step, scene_level)
    _pull_sliders_forward(per_step_sliders, first_use)

    ordered = sorted(steps, key=lambda s: s.index)
    built_steps = [
        Step.model_validate({
            "title": s.title.strip() or f"Step {i + 1}",
            **({"description": s.description.strip()} if s.description.strip() else {}),
            **({"add": per_step.pop(s.index, [])} if per_step.get(s.index) else {}),
            **({"sliders": per_step_sliders.pop(s.index)}
               if per_step_sliders.get(s.index) else {}),
        })
        for i, s in enumerate(ordered)
    ]
    if per_step_sliders:
        raise ComposeError(
            f"slider(s) placed in step(s) {sorted(per_step_sliders)}, which the "
            f"proposal does not define (it has {len(ordered)}). A slider in a step "
            f"that never runs leaves every coordinate naming it unresolvable.")
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
    scene = Scene.model_validate(body)
    _stretch_axes(scene)
    return scene


def _stretch_axes(scene: Scene) -> None:
    """Give every axis the scene's own extent along that axis.

    All 192 axes in the corpus carry a `range`; none rely on a default. It cannot
    be set in `_element` because the scene range is not known until every
    element has been measured — so it is backfilled here, in the one place that
    already knows both.
    """
    if not scene.range:
        return
    spans = {name: scene.range[i] for i, name in enumerate(AXES) if i < len(scene.range)}
    for el in _every_element(scene):
        # `Element` is `extra="allow"`: the schema declares 86 properties across
        # 23 types, so `axis` and `range` ride through as extras rather than
        # attributes. `getattr` with a default, not `el.range`, which raises.
        #
        # No "unless the author set one" check: the proposal has no `range`
        # field, so `_element` never writes one and the branch would be
        # unreachable. Add it back the day an element can carry its own.
        if el.type != "axis":
            continue
        if span := spans.get(str(getattr(el, "axis", "") or "")):
            setattr(el, "range", list(span))


def _every_element(scene: Scene):
    """Scene-level elements and everything any step adds."""
    yield from (scene.elements or [])
    for step in (scene.steps or []):
        yield from (step.add or [])
