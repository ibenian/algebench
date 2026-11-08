"""The wire shape of ``POST /api/expert/code_alternatives``. Nothing here is stored."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.handlers.code_practice.models import MAX_CODE_CHARS


class CodeAlternativesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: "compare": `left` beside `right`. "ask": a question about the two on screen.
    action: Literal["compare", "ask"]
    language: str = Field(default="", max_length=40)
    #: From the lesson's alternatives group: the problem, each side's approach, and what to bring out.
    focus: str = Field(default="", max_length=2000)
    left: str = Field(default="", max_length=MAX_CODE_CHARS)
    left_name: str = Field(default="", max_length=120)
    right: str = Field(default="", max_length=MAX_CODE_CHARS)
    right_name: str = Field(default="", max_length=120)
    recent_turns: str = Field(default="", max_length=3000)
    question: str = Field(default="", max_length=600)
    #: The comparison on screen, one part a line, and the part the question is about.
    comparison: str = Field(default="", max_length=8000)
    about: str = Field(default="", max_length=600)
    #: The presenter is on: the comparer can draw on the code.
    canvas: bool = False
