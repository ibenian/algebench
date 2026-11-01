"""The wire shape of ``POST /api/expert/scene_present``.

The client describes the view it shows: the lesson, scene and step, what is on screen, the execution states of the
run, and every target the pointer can reach, each with a ref the client knows how to find on screen. Nothing here is
stored.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Target(BaseModel):
    """Something the pointer can reach: its ref (the client resolves it to a place on screen) and what it is."""

    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=120)
    about: str = Field(default="", max_length=300)


class Frame(BaseModel):
    """One execution state of the run, and what happens in it."""

    model_config = ConfigDict(extra="forbid")

    n: int = Field(ge=0)
    text: str = Field(default="", max_length=400)
    #: The state's values (variable=value, ...), as the run recorded them.
    state: str = Field(default="", max_length=800)


class Drawn(BaseModel):
    """A shape still drawn on the view from an earlier walk-through: its id, kind and label, and what it joins."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=40)
    type: str = Field(default="", max_length=20)
    label: str = Field(default="", max_length=120)
    #: For a link or text: the ids (or refs) it joins or sits beside.
    joins: list[str] = Field(default_factory=list, max_length=2)


class OnView(BaseModel):
    """What earlier walk-throughs left on the view: nothing fades on its own, the presenter wipes it."""

    model_config = ConfigDict(extra="forbid")

    notes: list[str] = Field(default_factory=list, max_length=40)
    board: list[str] = Field(default_factory=list, max_length=40)
    drawn: list[Drawn] = Field(default_factory=list, max_length=80)


class ScenePresentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    lesson: str = Field(default="", max_length=8000)
    view: str = Field(default="", max_length=8000)
    frames: list[Frame] = Field(default_factory=list, max_length=400)
    #: The state on screen; -1 when the step has no run to step through.
    frame: int = Field(default=-1, ge=-1)
    targets: list[Target] = Field(default_factory=list, max_length=400)
    on_view: OnView = Field(default_factory=OnView)
