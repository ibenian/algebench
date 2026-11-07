"""The wire shape of ``POST /api/expert/code_compare``. Nothing here is stored."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.handlers.code_practice.models import MAX_CODE_CHARS


class CodeCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: str = Field(default="", max_length=40)
    #: The reference code. Both sides are numbered from 1, as the split view shows them.
    expected: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    typed: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    recent_turns: str = Field(default="", max_length=3000)
    #: A question about the comparison already on screen, instead of a new comparison.
    question: str = Field(default="", max_length=600)
    #: That comparison as the client has it, one part a line, and the part the question is about.
    comparison: str = Field(default="", max_length=8000)
    about: str = Field(default="", max_length=600)
    #: The presenter is on: the comparer can draw on the code.
    canvas: bool = False
