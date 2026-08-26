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
    """One object the model wants in the scene.

    The per-field ``description``s are PROMPT SURFACE, not documentation:
    ``LineAdapter`` renders each key with its description as the block template
    the model fills in. Without them the template degrades to bare
    ``type: <type>`` placeholders.
    """

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
        description="the text shown beside it; LaTeX if the lesson's conventions "
                    "say so. Leave empty for axes and grids")
    color: str = Field(
        default="",
        description="a hex colour from the lesson's palette, e.g. #ff6644")
    position: str = Field(
        default="",
        description="where it sits, as three comma-separated coordinates: "
                    "'1, 2, 0'. For a point or a text label")
    from_: str = Field(
        default="", alias="from",
        description="the tail of a vector or line, as 'x, y, z'")
    to: str = Field(
        default="",
        description="the head of a vector or line, as 'x, y, z'")
    points: str = Field(
        default="",
        description="a polyline, as coordinates separated by semicolons: "
                    "'0,0,0; 1,1,0; 2,0,0'")
    prompt: str = Field(
        default="",
        description="a question a reader might ask about this object, for the "
                    "Ask-AI button; leave empty and one will be written for you")


class ProposedStep(BaseModel):
    """One beat of the scene. Elements point AT these by index."""

    model_config = ConfigDict(extra="ignore")

    index: int = Field(
        default=0, description="0-based position in the scene")
    title: str = Field(
        default="", description="a short imperative caption, e.g. 'Add vector $\\vec{a}$'")
    description: str = Field(
        default="",
        description="one or two sentences saying what changes and why it matters")
