"""The wire shape of ``POST /api/expert/code_quiz``.

``mode: "ask"`` sends what Help me sends (the reference, the section, the editor), plus the questions already asked;
``mode: "grade"`` sends the question back with its answer key, the editor as the question left it, and the answer.
Nothing here is stored.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.handlers.code_practice.models import MAX_CODE_CHARS, PracticeSection
from backend.experts.modules.code_quiz.intent import MAX_TEXT


class CodeQuizRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["ask", "grade"] = "ask"
    language: str = Field(default="", max_length=40)
    expected: str = Field(min_length=1, max_length=MAX_CODE_CHARS)
    first_line: int = Field(default=1, ge=1)
    section: Optional[PracticeSection] = None
    typed: str = Field(default="", max_length=MAX_CODE_CHARS)
    #: Ask: what the learner wants to be asked about, and the questions asked already.
    request: str = Field(default="", max_length=600)
    asked: list[str] = Field(default_factory=list, max_length=20)
    #: Grade: the question as asked, how it is answered, its key, and the editor right after it was set up.
    #: Sent back as the ask returned them (intent.py caps them there), so a long key is never refused here.
    question: str = Field(default="", max_length=MAX_TEXT)
    kind: Literal["type", "answer"] = "answer"
    answer_key: str = Field(default="", max_length=MAX_TEXT)
    setup: str = Field(default="", max_length=MAX_CODE_CHARS)
    #: Grade: the learner's words ("answer"); for "type", their editor is ``typed``.
    answer: str = Field(default="", max_length=3000)
