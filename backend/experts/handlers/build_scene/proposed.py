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

#: The types iteration 1 builds. Bounded on purpose: a type the composer cannot
#: stage is worse than one it refuses, because it renders as an empty scene.
SUPPORTED_TYPES = (
    "point", "animated_point", "vector", "animated_vector",
    "line", "animated_line", "text", "axis", "grid",
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
        description=f"one of: {', '.join(SUPPORTED_TYPES)}")
    label: str = Field(
        default="",
        description="the text shown beside it, in KaTeX: $\\vec{a}$, $\\theta$. "
                    "Wrap maths in $…$ only when the lesson's conventions say "
                    "labels are LaTeX. Leave empty for axes and grids")
    color: str = Field(
        default="",
        description="a hex colour from the lesson's palette, e.g. #ff6644")
    position: str = Field(
        default="",
        description="where it sits: three comma-separated coordinates in MATH.JS, "
                    "'1, 2, 0' or 'cos(theta), 0, r*2'. NOT LaTeX — write "
                    "cos(theta), never \\cos(\\theta). For a point or a text label")
    # `tail`/`head`, not `from`/`to`: `from` is a Python keyword, so the field
    # would have to be `from_` with an alias — and LineAdapter renders the FIELD
    # NAME, so the model would be shown `from_`, answer `from_`, and pydantic
    # would silently drop it for not being the alias. Every vector would lose its
    # tail and the scene would still compose. compose.py maps these to the
    # schema's `from`/`to`.
    tail: str = Field(
        default="",
        description="where a vector or line STARTS, as math.js 'x, y, z'")
    head: str = Field(
        default="",
        description="where a vector or line ENDS, as math.js 'x, y, z'")
    points: str = Field(
        default="",
        description="a polyline, as math.js coordinates separated by semicolons: "
                    "'0,0,0; 1,1,0; 2,0,0'")
    prompt: str = Field(
        default="",
        description="a question a reader might ask about this object, for the "
                    "Ask-AI button. Markdown with $…$ for any maths; leave empty "
                    "and one will be written for you")


class ProposedStep(BaseModel):
    """One beat of the scene. Elements point AT these by index."""

    model_config = ConfigDict(extra="ignore")

    index: int = Field(
        default=0, description="0-based position in the scene")
    title: str = Field(
        default="",
        description="a short imperative caption in markdown with KaTeX, "
                    "e.g. 'Add vector $\\vec{a}$'")
    description: str = Field(
        default="",
        description="one or two sentences saying what changes and why it "
                    "matters; markdown with $…$ for any maths")
