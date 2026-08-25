"""The context a builder receives — validated here, ASSEMBLED on the client.

    chat intent -> [client] assemble context -> [backend] validate -> DSPy builder
                -> compose -> validate -> place

Assembly moved to the client for a measured reason: the lesson is the client's
authoritative copy and can be large. The biggest published lesson is 549KB, while
the context derived from it is 87KB — shipping the whole lesson so the backend
could slice it was ~6x waste on every build request.

The conversational AGENT still chooses nothing about context; selection is
deterministic code (`src/builder-context.ts`). It simply runs on the side that
already holds the lesson.

WHY THIS IS PYDANTIC WHEN THE FIRST VERSION WAS A DATACLASS
-----------------------------------------------------------
Because the move made it a BOUNDARY. A dataclass was right while this was built
in-process from an already-validated request. Now it arrives over the wire from
the client, so it is untrusted input and gets validated like any other — and it
is mirrored by a TypeScript type, so it needs the same parity guarantees as the
build contract. Same rule as before, opposite answer, because the shape moved.

`neighbours` and `current` stay `dict`, deliberately: they are real scene nodes,
and typing them as `Scene` would re-validate and COERCE them — the lossiness that
silently rewrote `1` as `1.0` in the canonical model. They are read-only input to
prompt formatting; the builder's OUTPUT is what must be typed.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

#: Mirrors the constants in src/builder-context.ts (pinned by
#: scripts/validate_model_parity.py). Enforced here too: the client is trusted to
#: assemble the context, not to have bounded it.
MAX_SCENES_SUMMARISED = 40
MAX_SUMMARY_CHARS = 200
MAX_INTENT_CHARS = 2000
MAX_NEIGHBOURS = 2


class SceneSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0)
    title: str = Field(max_length=MAX_SUMMARY_CHARS)
    description: str = Field(default="", max_length=MAX_SUMMARY_CHARS)


class Conventions(BaseModel):
    """House style, derived by scanning the lesson's own elements."""

    model_config = ConfigDict(extra="forbid")

    colors: list[str] = Field(default_factory=list, max_length=12)
    labelsAreLatex: bool = False
    elementsCarryPrompts: bool = False


class MemoryRef(BaseModel):
    """An agent-memory key and its SHAPE — never its value.

    `_resolve_memory_refs` (server.py) substitutes `$key` at apply time, so the
    model only needs to know a key exists and roughly what it holds. The values
    are computed arrays with no business in a prompt.
    """

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=120)
    shape: str = Field(default="", max_length=200)


class Clarification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(default="", max_length=1000)
    answer: str = Field(default="", max_length=2000)


class BuilderContext(BaseModel):
    """Everything the scene builder sees, and nothing else."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["insert", "replace"]
    sceneIndex: int = Field(ge=0)

    intent: str = Field(min_length=1, max_length=MAX_INTENT_CHARS)
    clarifications: list[Clarification] = Field(default_factory=list, max_length=8)

    lessonTitle: str = Field(default="", max_length=MAX_SUMMARY_CHARS)
    lessonDescription: str = Field(default="", max_length=MAX_SUMMARY_CHARS)
    conventions: Conventions = Field(default_factory=Conventions)
    sceneSummaries: list[SceneSummary] = Field(default_factory=list, max_length=MAX_SCENES_SUMMARISED)
    #: Raw scene nodes — see the module docstring on why these are not `Scene`.
    neighbours: list[dict] = Field(default_factory=list, max_length=MAX_NEIGHBOURS)
    current: Optional[dict] = None
    memory: list[MemoryRef] = Field(default_factory=list, max_length=32)
    sliderVocabulary: list[str] = Field(default_factory=list, max_length=200)
    #: What the client's bounding dropped, so a truncated context is visible
    #: rather than reading as "the model saw everything".
    omitted: list[str] = Field(default_factory=list, max_length=8)

    def require_consistent(self) -> None:
        """Refuse a context whose own fields disagree.

        The client assembles this, so these are not hypothetical: a `replace`
        with no `current` would silently become a from-scratch build wearing the
        label of a refinement — the failure the user would report as "it ignored
        my scene".
        """
        if self.op == "replace" and self.current is None:
            raise ValueError("a replace context must carry the scene being replaced")
        if self.op == "insert" and self.current is not None:
            raise ValueError("an insert context must not carry a current scene")
