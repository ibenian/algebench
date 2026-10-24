"""The wire shape of ``POST /api/expert/code_practice``.

The client sends the reference code it is showing (a lesson's code file, or the
part of it the learner is typing), the section being typed, and what the learner
typed. Nothing here is stored.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

MAX_CODE_CHARS = 12_000


class PracticeSection(BaseModel):
    """The section being typed, in the reference's own line numbers."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=200)
    hint: str = Field(default="", max_length=600)
    start: int = Field(ge=1)
    end: int = Field(ge=1)


class LineMatch(BaseModel):
    """How one typed line compares with the reference, by text alone (the client measures it)."""

    model_config = ConfigDict(extra="forbid")

    typed: int = Field(ge=1)
    reference: Optional[int] = Field(default=None, ge=1)
    score: int = Field(ge=0, le=100)


class OpenNote(BaseModel):
    """A remark from the last review, on a line of the code as it was then."""

    model_config = ConfigDict(extra="forbid")

    line: int = Field(ge=1)
    note: str = Field(max_length=400)


class CodePracticeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(default="", max_length=40)
    #: The reference code, and the line number its first line has in the file.
    expected: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    first_line: int = Field(default=1, ge=1)
    section: Optional[PracticeSection] = None
    typed: str = Field(default="", max_length=MAX_CODE_CHARS)
    #: What was typed at the last review, so the coach can speak to what changed since; None on a first review.
    previous: Optional[str] = Field(default=None, max_length=MAX_CODE_CHARS)
    #: The last review's line notes, numbered as in ``previous``: those on lines not touched since are still open.
    open_notes: list[OpenNote] = Field(default_factory=list, max_length=40)
    match: list[LineMatch] = Field(default_factory=list, max_length=400)
    attempts: int = Field(default=0, ge=0, le=1000)
    #: Guide the next step (and how to begin, before anything is typed); off, only review what is typed.
    hints: bool = False
