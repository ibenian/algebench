"""The wire shape of ``POST /api/expert/learning_plan``.

The request says what the learner wants to understand, where they are, and
what they already know. It carries no lesson content: the catalog is built on
the server from the published lessons, so nothing the client sends becomes a
step the model can pick.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

MAX_TARGET_CHARS = 500
#: The client's own checks (``TOKEN`` and ``LESSON_ID`` in src/plan-core.ts):
#: ids are plain tokens; a lesson id is path segments that can't start with a
#: dot, so ``..`` is refused here rather than only failing the catalog lookup.
_ID = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9_.:\-]+$")
_LESSON = Field(default=None, max_length=200,
                pattern=r"^[A-Za-z0-9_\-][A-Za-z0-9_.\-]*(/[A-Za-z0-9_\-][A-Za-z0-9_.\-]*)*$")


class PlanWhere(BaseModel):
    """Where the learner is now, as the deep-link ids of their view."""

    model_config = ConfigDict(extra="forbid")

    lesson: Optional[str] = _LESSON
    sc: Optional[str] = _ID
    st: Optional[str] = _ID
    pf: Optional[str] = _ID
    ps: Optional[str] = _ID


class Clarification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(max_length=500)
    answer: str = Field(max_length=500)


class LearningPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: What the learner wants to understand, in their words.
    target: str = Field(min_length=1, max_length=MAX_TARGET_CHARS)
    where: PlanWhere = Field(default_factory=PlanWhere)
    #: Titles of what they've already covered (a parent plan's done steps, for a
    #: sub-plan). Bounded again, per item, when rendered.
    known: list[str] = Field(default_factory=list, max_length=60)
    #: Questions this expert asked and the learner's answers.
    clarifications: list[Clarification] = Field(default_factory=list, max_length=4)
