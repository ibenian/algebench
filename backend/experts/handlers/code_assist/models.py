"""The wire shape of ``POST /api/expert/code_assist``.

The client sends the reference code the learner is typing, the section they are on, what they typed, and how much
help they asked for. Nothing here is stored.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.handlers.code_practice.models import MAX_CODE_CHARS, OpenNote, PracticeSection


class CodeAssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(default="", max_length=40)
    #: The reference code, and the line number its first line has in the file.
    expected: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    first_line: int = Field(default=1, ge=1)
    section: Optional[PracticeSection] = None
    typed: str = Field(default="", max_length=MAX_CODE_CHARS)
    #: The coach's open remarks on the typed code (its line notes), numbered as in ``typed``.
    issues: list[OpenNote] = Field(default_factory=list, max_length=40)
    #: The next logical piece, the rest of the section, the rest of the block, only fixes to what is typed, or what
    #: the learner asked for in ``request``.
    scope: Literal["next", "section", "all", "fix", "narrate", "ask"] = "next"
    #: The learner's own words: what "ask" does, or how to go about another scope.
    request: str = Field(default="", max_length=600)
