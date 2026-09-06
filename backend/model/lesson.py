"""Pydantic models mirroring `schemas/lesson.schema.json`.

The JSON schema remains canonical for validating lesson files on disk; these
models exist so a DSPy builder's output can be typed and structurally enforced
before it reaches the browser. Same division of labour as
`backend/model/semantic_graph.py`, which mirrors the semantic-graph schema for
the same reason.

SCOPE
-----
Only the subset the builders emit is typed, and it grows per builder. ``$defs.element``
alone carries 86 properties across 23 ``type`` values; mirroring all of it would be
maintenance with no consumer. So the open nodes (``Element``, ``Step``, ``Scene``) use
``extra="allow"`` — the long tail rides through untouched and is judged by jsonschema —
while the small closed shapes (``Slider``, ``Camera``, ``View``, ``RemoveDirective``,
``InfoOverlay``) use ``extra="forbid"``, verified against every published lesson.

ROUND-TRIPPING
--------------
Every field defaults to ``None`` rather than an empty list, so an absent key stays
absent under ``model_dump(by_alias=True, exclude_none=True)``. That is what makes
`tests/test_lesson_model.py` able to assert the model is lossless over the whole
published corpus.

GROWING THIS MODEL (planned, so it stays additive)
--------------------------------------------------
Coverage today is deliberately iteration 1's surface, measured against the schema:

    Slider 12/12 · View 12/12 · Camera 3/3 · RemoveDirective 2/2 · InfoOverlay 6/6
    Scene  12/16   (absent: functions, proof, starfield, data)
    Step   12/14   (absent: proof, virtualTime)
    Element 24/86  (absent: the per-type geometry fields)

    No model yet: lessonFormat, singleSceneFormat, proof, proofStep, proofHighlight,
    sceneFunction, dataTable, starfield, shader, trail, vectorPanels, regularPolygon,
    fillRegion, virtualTime.

Every one of those is an ADDITIVE change, by construction:

* ``Element`` stays ONE FLAT MODEL, never split into per-type subclasses. The schema
  is flat and ``additionalProperties: true``; the generated TypeScript ``Element`` is
  flat; so adding the remaining 62 fields is appending optional fields, and a
  discriminated split later would be the breaking change. Do not split it.
* ``Scene``/``Step`` grow by adding ``Optional[X] = None`` fields once ``X`` exists.
  Field order does not matter and nothing existing changes.
* New ``$defs`` become new classes. Nothing references them until a field is added.
* Anything untyped already round-trips through ``extra="allow"`` — so adding a type
  later changes validation strictness, never the serialized output. The corpus test
  in tests/test_lesson_model.py is what proves that on every published lesson.

The one place growth was NOT naturally additive was the build-op union in
``backend/experts/contracts.py``; it is now discriminated on ``kind`` for exactly
this reason. See the GROWTH PATH note there.

IMPORTS
-------
Deliberately nothing heavy — no dspy, litellm, sympy or FastAPI. The CI job that
checks this model against the schema installs only pydantic + jsonschema and runs
in seconds, and scripts can reuse these models without dragging in the LM stack.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

# ── Positional aliases (mirroring the schema's $defs) ────────────────────────
#
# Two things these MUST get right, both caught by the corpus round-trip test:
#
#   * ``Union[int, float]``, not ``float``. Pydantic would coerce the JSON ``0``
#     to ``0.0``, so a lesson full of integer coordinates would not round-trip.
#     Smart-mode union keeps an int an int.
#   * ``list``, not ``tuple``. Arity is pinned with Field constraints instead, so
#     the dumped shape stays a JSON array.

Num = Union[int, float]


def _integral(v):
    """Require an integral VALUE without coercing the type it arrived as."""
    if isinstance(v, float) and not v.is_integer():
        raise ValueError("must be a whole number")
    return v


#: A JSON Schema `"type": "integer"`: integral in value, either int or float in
#: representation. Coercing to `int` here would rewrite `1.0` as `1` and make the
#: model lossy against real lessons.
IntegralNum = Annotated[Union[int, float], BeforeValidator(_integral)]
Vec3Number = Annotated[list[Num], Field(min_length=3, max_length=3)]
Vec3 = Annotated[list[Union[Num, str]], Field(min_length=3, max_length=3)]
Range3D = Annotated[
    list[Annotated[list[Num], Field(min_length=2, max_length=2)]],
    Field(min_length=3, max_length=3),
]
#: `^#rrggbb` / `^#rrggbbaa`, or three components in [0, 1] — as the schema says.
#: A bare `str` here would let the "canonical" model bless a colour the schema
#: rejects, which is the one thing this model exists not to do.
HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6,8}$")]
# `Num`, not `float`: the schema says "number in [0,1]", and `1` is one. Annotating
# `float` enforced the range correctly but rewrote `1` as `1.0` on the way out,
# making the model lossy against real lessons — caught only once the round-trip
# comparison started checking numeric TYPE as well as value.
ExprTriple = Annotated[list[str], Field(min_length=3, max_length=3)]
Rgb01 = Annotated[list[Annotated[Num, Field(ge=0, le=1)]], Field(min_length=3, max_length=3)]
Color = Union[HexColor, Rgb01]

ScreenPosition = Literal[
    "top-left", "top-right", "bottom-left", "bottom-right", "top-center", "bottom-center",
]

ElementType = Literal[
    "skybox", "axis", "grid", "vector", "point", "line", "surface",
    "parametric_curve", "parametric_surface", "sphere", "ellipsoid", "vectors",
    "vector_field", "plane", "polygon", "cylinder", "text", "animated_vector",
    "animated_line", "animated_point", "animated_cylinder", "animated_polygon",
    "animated_curve", "tensor", "chart",
]


# ── Closed shapes (extra="forbid" — verified against every published lesson) ──

class Camera(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: Optional[Vec3Number] = None
    target: Optional[Vec3Number] = None
    up: Optional[Vec3Number] = None


class View(BaseModel):
    """A named camera button. 15 of 16 published lessons define these."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: Optional[str] = None
    position: Optional[Vec3Number] = None
    target: Optional[Vec3Number] = None
    up: Optional[Vec3Number] = None
    # Three-item expression tuples, and a list `follow` needs at least one
    # candidate id — the schema constrains all three, so the mirror must too.
    positionExpr: Optional[Annotated[list[str], Field(min_length=3, max_length=3)]] = None
    targetExpr: Optional[Annotated[list[str], Field(min_length=3, max_length=3)]] = None
    follow: Optional[Union[str, Annotated[list[str], Field(min_length=1)]]] = None
    offset: Optional[Vec3Number] = None
    #: The schema constrains these to integer-or-string items; `list` took anything.
    angleLockAxis: Optional[list[Union[int, str]]] = None
    angleLockDirection: Optional[list[Union[int, str]]] = None
    angleLockVector: Optional[list[Union[int, str]]] = None


class Slider(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    min: Num
    max: Num
    label: Optional[str] = None
    step: Optional[Num] = None
    default: Optional[Num] = None
    animate: Optional[bool] = None
    animateMode: Optional[Literal["loop", "once", "bounce"]] = None
    autoplay: Optional[bool] = None
    duration: Optional[int] = None
    reset: Optional[bool] = None
    valueExpr: Optional[str] = None


class RemoveDirective(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Optional[str] = None
    type: Optional[str] = None


class InfoOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    content: str
    position: Optional[ScreenPosition] = None
    pos: Optional[ScreenPosition] = None
    keep: Optional[bool] = None
    title: Optional[str] = None


# ── Open shapes (extra="allow" — the long tail is judged by jsonschema) ───────

class Element(BaseModel):
    """One scene object.

    ``extra="allow"``: the schema declares 86 properties across 23 types and is
    itself ``additionalProperties: true``. The common fields are typed here; the
    rest (shader, trail, panels, keyframes, per-type geometry, …) ride through.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    type: ElementType
    id: Optional[str] = None
    label: Optional[str] = None
    color: Optional[Color] = None
    #: Numeric opacity is [0,1] per the schema; only the string form (an
    #: expression) is unrestricted. A bare `Num` accepted `2`.
    opacity: Optional[Union[Annotated[Num, Field(ge=0, le=1)], str]] = None
    width: Optional[Num] = None
    prompt: Optional[str] = None
    # NOTE: `legendGroup` is used 66+ times in the published corpus but is NOT in
    # `$defs.element.properties` — a pre-existing schema gap, not one to paper over
    # here. It rides through via extra="allow" and round-trips correctly. Typing it
    # would need the schema (and the generated .d.ts) updated first.
    visibleExpr: Optional[str] = None

    # `from` is a Python keyword AND a schema property — the one alias in this
    # module, and the first thing the Python/TS parity test must pin.
    from_: Optional[Vec3] = Field(default=None, alias="from")
    to: Optional[Vec3] = None
    origin: Optional[Vec3] = None
    position: Optional[Vec3] = None

    #: Component triplets. Without the arity constraint a builder could emit
    #: `expr: []` or a two-component `fromExpr`, which renders as nothing.
    expr: Optional[Union[ExprTriple, str]] = None
    fromExpr: Optional[ExprTriple] = None
    toExpr: Optional[ExprTriple] = None

    labelPosition: Optional[Vec3] = None
    labelOffset: Optional[Vec3Number] = None
    arrowScale: Optional[Num] = None
    shaftScale: Optional[Num] = None

    # `$defs.element.size` is `"type": "integer"`, which in JSON Schema means an
    # INTEGRAL VALUE, not an integral Python type — `1.0` is a valid integer and
    # the corpus contains it. Annotating `int` made pydantic coerce `1.0` -> `1`,
    # silently rewriting published lessons. So: reject a fractional size, but
    # preserve whatever numeric form it arrived in.
    size: Optional[IntegralNum] = None
    radius: Optional[Num] = None
    #: `$defs.element.points` is an array of exactly-three-component vectors; a
    #: bare `list` validated neither the item type nor the arity.
    points: Optional[list[Vec3]] = None
    text: Optional[str] = None
    value: Optional[str] = None


class Proof(BaseModel):
    """A derivation attached to a scene or step.

    PARTIAL, like `Scene` and `Step` above: only the fields the generated
    TypeScript type makes mandatory are pinned, so a builder cannot emit a proof
    node the client contract rejects. The rest rides through `extra="allow"` and
    is judged by jsonschema. Completed in iteration 5, when the proof builders
    are re-expressed under the build contract.
    """

    model_config = ConfigDict(extra="allow")

    title: str
    steps: list


class Step(BaseModel):
    """One step of a scene. ``extra="allow"`` for virtualTime, proof, … ."""

    model_config = ConfigDict(extra="allow")

    title: str
    id: Optional[str] = None
    description: Optional[str] = None
    prompt: Optional[str] = None
    caption: Optional[str] = None
    add: Optional[list[Element]] = None
    remove: Optional[list[RemoveDirective]] = None
    sliders: Optional[list[Slider]] = None
    info: Optional[list[InfoOverlay]] = None
    camera: Optional[Camera] = None
    range: Optional[Range3D] = None
    duration: Optional[int] = None


class Scene(BaseModel):
    """One scene. ``extra="allow"`` for functions, proof, starfield, data, … ."""

    model_config = ConfigDict(extra="allow")

    title: str
    id: Optional[str] = None
    description: Optional[str] = None
    markdown: Optional[str] = None
    prompt: Optional[str] = None
    range: Optional[Range3D] = None
    scale: Optional[Vec3Number] = None
    camera: Optional[Camera] = None
    views: Optional[list[View]] = None
    elements: Optional[list[Element]] = None
    steps: Optional[list[Step]] = None
    duration: Optional[int] = None


__all__ = [
    "Camera", "Color", "Element", "ElementType", "InfoOverlay", "Proof", "Range3D",
    "RemoveDirective", "Scene", "Slider", "Step", "Vec3", "Vec3Number", "View",
]
