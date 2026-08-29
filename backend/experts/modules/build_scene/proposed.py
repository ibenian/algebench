r"""What the model is asked to fill in — deliberately narrower than a `Scene`.

FLAT, BECAUSE THE WIRE FORMAT IS FLAT
-------------------------------------
`LineAdapter` is one level deep: a field of an output model must be a leaf, so
`list`/`dict`/nested models are rejected at format time rather than silently
mis-rendered (`_is_leaf`). Two consequences shape everything here:

* A coordinate is a STRING — `"1, 2, 0"` — not `list[Num]`. `compose.py` parses
  it.
* A step cannot contain its elements. Instead every element says which step
  introduces it (`step`), and compose groups them. This is the adapter's own
  advice: "Lift them into the signature as their own output fields."

THREE NOTATIONS, AND THE FIELD SAYS WHICH
-----------------------------------------
========================  ==================================================
coordinates, expressions  math.js: ``cos(theta)``, ``Rp+h``, ``2*pi*r``
labels                    KaTeX: ``$\vec{a}$``
titles, descriptions      markdown with embedded KaTeX
========================  ==================================================

Nothing converts between them — a converter cannot tell which notation it was
handed, and translating valid math.js as if it were LaTeX turns ``cos(theta)``
into ``c*o*s(E*a*h*t**2)`` without erroring. So each ``description`` below states
the notation for its field, and ``compose.py`` refuses a coordinate that is
plainly LaTeX rather than guessing.

These descriptions are PROMPT SURFACE: ``LineAdapter`` renders each key with its
description as the block template the model fills in, so this table is not
documentation about the prompt — it IS the prompt.

WHAT THE MODEL DOES NOT DECIDE
------------------------------
No ids (they are minted — see compose), no camera, no range, no scale. Those are
arithmetic on what it proposed, and a model asked for a camera returns a
plausible one that frames nothing.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from backend.mathjs_extensions import EXTENSION_NAMES

#: The names the model CANNOT infer — math.js's own library it already knows.
#: Kept in sync with src/expr.ts by tests/test_mathjs_extensions_sync.py.
_EXTENSIONS = ", ".join(EXTENSION_NAMES)

#: The types iteration 1 builds. Bounded on purpose: a type the composer cannot
#: stage is worse than one it refuses, because it renders as an empty scene.
SUPPORTED_TYPES = (
    "point", "animated_point", "vector", "animated_vector",
    "line", "animated_line", "text", "axis", "grid",
    # Curves. Added because their absence was not a gap the model worked around
    # gracefully: asked for a sine wave it approximated one with FORTY-EIGHT
    # `animated_line` segments, one per sample, and none of them rendered.
    # `parametric_curve` is also the 4th most common element in the corpus (211).
    "animated_curve", "parametric_curve",
)

#: `step` for an element that is present from the start.
SCENE_LEVEL = -1


class ProposedElement(BaseModel):
    """One object the model wants in the scene."""

    model_config = ConfigDict(extra="ignore")

    step: int = Field(
        default=SCENE_LEVEL,
        description="which step introduces this element; -1 means it is present "
                    "from the start (axes, grid, origin)")
    type: str = Field(
        default="",
        # The "nothing else" half is not decoration. Asked for a scene "with
        # sliders to adjust r and F", the model invented `type: slider` with
        # `value`/`min`/`max` keys; the adapter refused the unknown key and the
        # whole build died on a parse error. Naming what is NOT available, and
        # what to do instead, costs one line and prevents that class of answer.
        #
        # It has to name what IS available just as carefully. An earlier revision
        # of this line still said "no curve type" after curves were added — in
        # the same f-string that interpolates SUPPORTED_TYPES listing them — and
        # a contradiction sends the model back to approximating with segments,
        # which is the failure the curve types exist to remove.
        description=f"one of: {', '.join(SUPPORTED_TYPES)}. NOTHING ELSE — there "
                    f"is no polygon, sphere, surface, plane or vector-field type "
                    f"yet, and no element may carry any field not listed here. A "
                    f"SLIDER is not a type either: it goes in the `sliders` list. "
                    f"If the ask needs a shape you cannot make, show the idea with "
                    f"the types above rather than inventing a type")
    label: str = Field(
        default="",
        # NOT "written BARE" — that phrasing was added here to mean "not in
        # quotes" and, sitting next to "in KaTeX", was read as "without
        # delimiters": the model answered `proj_b a`, which is LaTeX with the
        # `$…$` stripped off and renders as literal text. The quotes rule is
        # made once, globally, in the signature; it does not need restating in a
        # sentence that is about notation.
        description="the text shown beside it. MATHS GOES IN $…$ — `$\\vec{a}$`, "
                    "`$\\theta$`, `$\\text{proj}_{\\vec{b}}\\vec{a}$` — always, "
                    "because a symbol written without them renders as literal "
                    "text. A plain word is a plain word: `Pivot`, not `$Pivot$`. "
                    "ALWAYS ON ONE LINE; a label is a caption, not a panel, so "
                    "for several lines of maths use the step description. "
                    "`conventions` says which STYLE of maths the lesson "
                    "writes — never whether to write it as text. Leave empty "
                    "for axes and grids")
    color: str = Field(
        default="",
        description="a hex colour from the lesson's palette, e.g. #ff6644")
    axis: str = Field(
        default="",
        description="for an `axis` element ONLY: which one — x, y or z. "
                    "Required — three axes that do not say which they are all "
                    "get drawn on top of each other")
    plane: str = Field(
        default="",
        description="for a `grid` element ONLY: which plane it lies in — xy, "
                    "xz or yz. Defaults to xy")
    position: str = Field(
        default="",
        description="where it sits: three comma-separated coordinates in MATH.JS, "
                    "1, 2, 0 or cos(theta), 0, r*2 — bare, no quotes. NOT LaTeX — write "
                    "cos(theta), never \\cos(\\theta). WORK OUT CONSTANTS: write "
                    "1, 0, 0, never (2*1 + 0*2)/(2*2 + 0*0), 0, 0. Use an "
                    "expression only when it depends on a slider. For a point or "
                    "a text label")
    # See schemas/lesson.schema.json, `$defs.element.properties`, for every name
    # these map onto — and `$defs.vec3` for why `from_pos`/`to_pos` are separate
    # from `from_expr`/`to_expr` here even though the schema's `vec3` would let a
    # single field carry either ("Components can be numbers or math.js expression
    # strings"). Only some renderers honour that permission: `text.ts` falls back
    # to reading `position` as expressions, `vector.ts` does not, and 0 of the
    # corpus's 1088 coordinates mix the two. The dedicated `*Expr` fields are the
    # channel that always works.
    #
    # NAMING RULE: the schema's own word, snake_cased. Measured against every
    # geometry key in the corpus, `from` is the ONLY one that is illegal in
    # Python (`range` merely shadows a builtin), so nothing else needs inventing
    # — `center`, `radius`, `vertices`, `x`/`y`/`z` will all keep their names.
    #
    # `from` is disambiguated by a suffix the schema itself implies: it already
    # distinguishes `from` from `fromExpr`. So static positions take `_pos` and
    # animated ones `_expr`, and `to_*` pairs with them. The alternative,
    # `tail`/`head`, reads well for a vector but drags the divergence into every
    # animated field after it.
    #
    # It also cannot be an alias on `from`: LineAdapter renders FIELD NAMES, so
    # the model would be shown `from_`, answer `from_`, and pydantic would drop
    # it for not being the alias — every vector losing its tail, in silence.
    from_pos: str = Field(
        default="",
        description="where a vector or line STARTS, as math.js x, y, z — bare. "
                    "Work out constants — write the number, not the formula")
    to_pos: str = Field(
        default="",
        description="where a vector or line ENDS, as math.js x, y, z — bare. "
                    "Work out constants — write the number, not the formula")
    from_expr: str = Field(
        default="",
        description="for an animated_* element: where it STARTS over time, as "
                    "three math.js expressions x, y, z in terms of a slider — "
                    "e.g. cos(t), sin(t), 0 — bare. Omit to start from a fixed point")
    to_expr: str = Field(
        default="",
        description="for an animated_* element: where it ENDS over time, as "
                    "three math.js expressions in terms of a slider. This is what "
                    "makes an animated_* element move; without it, it does not")
    curve_expr: str = Field(
        default="",
        description=f"for an `animated_curve` ONLY: y as a single math.js function "
                    "of x, e.g. A*sin(k*x). ONE expression, not three — the curve "
                    f"is drawn by sampling x across `range`. This is how you draw a "
                    f"graph: one curve element, never a chain of line segments. "
                    f"Every math.js function is available, plus these, which are "
                    f"this project's own and exist nowhere else: {_EXTENSIONS}")
    range: str = Field(
        default="",
        description="for a curve ONLY: the interval it is drawn over, as two "
                    "math.js values min, max. For an animated_curve that is the "
                    "range of x; for a parametric_curve, of t. e.g. -2*pi, 2*pi")
    points: str = Field(
        default="",
        description="a polyline, as math.js coordinates separated by semicolons: "
                    "0,0,0; 1,1,0; 2,0,0 — bare, no quotes. For a HANDFUL of "
                    "real corners: a triangle, an arrowhead, a path with three "
                    "bends. NEVER for sampling a curve — write the formula in an "
                    "animated_curve or parametric_curve instead")
    prompt: str = Field(
        default="",
        description="a question a reader might ask about this object, for the "
                    "Ask-AI button. Markdown with $…$ for any maths; leave empty "
                    "and one will be written for you")


class ProposedSlider(BaseModel):
    """One interactive control.

    A slider is NOT an element — the schema hangs it off `step.sliders`, and the
    corpus agrees. That mismatch is why the model kept writing `type: slider`
    with `min`/`max` keys: the only place it had to put one was the element list,
    where those keys do not exist, and the adapter refused the whole answer.

    `id` is the variable name the coordinates use. A vector `to_pos` of
    `rx, ry, rz` means nothing until a slider called `rx` exists, so ids are the
    join between the two lists and must match exactly.
    """

    model_config = ConfigDict(extra="ignore")

    step: int = Field(
        default=0,
        description="which step introduces this slider; the reader can only "
                    "move it from that step onwards")
    id: str = Field(
        default="",
        description="the variable name coordinates use, e.g. rx. A valid math.js "
                    "identifier: letters, digits and underscore, not starting "
                    "with a digit. Must not be an id listed in existing_names")
    label: str = Field(
        default="",
        description="what the reader sees beside the control. Maths goes in $…$ "
                    "— `$r_x$`, `$|\\vec{F}|$`. Defaults to the id")
    min: float = Field(default=0.0, description="lowest value, e.g. -5")
    max: float = Field(default=1.0, description="highest value, e.g. 5")
    step_size: float = Field(
        default=0.1,
        description="increment between values, e.g. 0.1. NOT called `step` — "
                    "that names the scene step this slider belongs to")
    default: float = Field(
        default=0.0,
        description="the value it starts at. Choose one that makes the scene "
                    "read well the moment it appears, because it is what the "
                    "reader sees before touching anything")


class ProposedStep(BaseModel):
    """One beat of the scene. Elements point AT these by index."""

    model_config = ConfigDict(extra="ignore")

    index: int = Field(
        default=0, description="0-based position in the scene")
    title: str = Field(
        default="",
        description="a short imperative caption in markdown with KaTeX, "
                    "written BARE — e.g. Add vector $\\vec{a}$, never in quotes")
    description: str = Field(
        default="",
        description="one or two sentences saying what changes and why it "
                    "matters; markdown with $…$ for any maths")
