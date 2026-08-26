"""The wire shape of ``POST /api/expert/build_scene``.

NAMES ARE TYPED, VALUES ARE NOT
-------------------------------
Every field here maps 1:1 onto one ``dspy.InputField``, through one formatter in
``format.py``. Reading this class therefore tells you what the model will be
told — which is the whole reason the context arrives as several named fields
rather than one opaque ``context`` bag.

SCENES ARRIVE AS DICTS AND ARE PARSED HERE, NOT BY THE FIELD
------------------------------------------------------------
``neighbours`` and ``current`` are ``dict`` on the wire but reach the formatter
as :class:`~backend.model.lesson.Scene`. Typing the FIELD would be wrong — one
malformed neighbour would 422 the whole request, so a lesson could become
unbuildable because a scene NEXT to the target is broken. Parsing here lets the
two be treated differently, which they are (see :meth:`scenes`).

Parsing at all is worth it because a formatter has no schema to disagree with.
``format.py`` originally read ``step["text"]`` — proof_edit's vocabulary, where
scenes use ``title`` — and rendered "(no caption)" for all 358 steps in the
corpus while every test passed. Against a typed ``Step`` that is an immediate
``AttributeError``: the model declares ``title`` and has no ``text``.

Coercion is not a concern on this path even though it is on the round-trip one:
these values are RENDERED, never written back, so a `1` shown as `1.0` in a
prompt costs nothing. The canonical model is also parity-checked against the
schema, which no shape invented here would be.

SHAPE IS CHECKED HERE; SIZE IS NOT
----------------------------------
The split that matters, and the one an earlier version of this file got wrong by
putting both in the same place:

* **Shape** — which keys exist — is a CONTRACT with ``src/builder-context.ts``.
  A renamed key is a bug on one side, and left unchecked it does not fail: it
  renders as an emptier prompt, which looks like a weaker model. So the derived
  shapes below are declared, ``extra="forbid"``, and a mismatch is a 422 that
  names the field.
* **Size** — how much of it there is — is a property of the PROMPT, and lives in
  ``format.py``, where it truncates and says so. A large lesson is a legitimate
  request; refusing to build a scene because someone wrote 41 of them is not.

The earlier version bounded these models with ``max_length`` and so answered an
oversized context with a 422. That was the mistake, not the models.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.model.lesson import Scene

#: Bounds the request itself, because it bounds a field the formatter passes
#: through verbatim. The rest of the bounding is the formatter's job.
MAX_INTENT_CHARS = 2000


class SceneSummary(BaseModel):
    """One line about a scene. NOT a ``Scene``, deliberately.

    ``Scene`` would validate this — title required, everything else optional —
    but the result would carry ``elements=None``, which reads as "this scene has
    no elements" when it means "we did not send them". A dict is honestly
    shapeless; a ``Scene`` with holes is dishonestly complete.
    """

    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0)
    title: str = ""
    description: str = ""


class LessonOutline(BaseModel):
    """The map, not the territory: what the lesson is and what is already in it."""

    model_config = ConfigDict(extra="forbid")

    title: str = ""
    description: str = ""
    sceneSummaries: list[SceneSummary] = Field(default_factory=list)


class Conventions(BaseModel):
    """House style, DERIVED by the client from the lesson's own elements.

    A model told "match the lesson's style" invents one; handed the palette
    actually in use, it reuses it.
    """

    model_config = ConfigDict(extra="forbid")

    colors: list[str] = Field(default_factory=list)
    labelsAreLatex: bool = False
    elementsCarryPrompts: bool = False


class MemoryRef(BaseModel):
    """An agent-memory key and its SHAPE.

    ``extra="forbid"`` is load-bearing here rather than tidy: it means a ref
    carrying its ``value`` is REFUSED at the door, so computed arrays cannot
    reach a prompt even by accident. `$key` is substituted at apply time by
    ``_resolve_memory_refs``; the value has no business in the request at all.
    """

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1)
    shape: str = ""


class Clarification(BaseModel):
    """One question the builder asked and the answer it got."""

    model_config = ConfigDict(extra="forbid")

    question: str = ""
    answer: str = ""


class BuildSceneRequest(BaseModel):
    """What the client sends. Assembled by ``src/builder-context.ts``."""

    model_config = ConfigDict(extra="forbid")

    # --- read by code -------------------------------------------------------
    op: Literal["insert", "replace"]
    sceneIndex: int = Field(ge=0)
    intent: str = Field(min_length=1, max_length=MAX_INTENT_CHARS)

    # --- read only by format.py, on the way to the prompt -------------------
    lesson: LessonOutline = Field(default_factory=LessonOutline)
    #: The scenes either side of the target — enough to match tone.
    neighbours: list = Field(default_factory=list)
    #: The scene being replaced. Absent on insert; see require_consistent.
    current: Optional[dict] = None
    conventions: Conventions = Field(default_factory=Conventions)
    clarifications: list[Clarification] = Field(default_factory=list)
    #: The tail of the chat thread. The expert is STATELESS, so a question it
    #: asked and the answer it got live only here — see `handler.clarifications`.
    #: Raw dicts because they are the chat's shape, not ours, and they are read
    #: only by `clarifications_from_thread`, which takes its own tail (`limit=6`).
    #: NOT length-capped here: a long conversation is a legitimate request, and
    #: rejecting it would 422 someone for having talked a lot. Size is bounded
    #: where it becomes prompt — the same split this module already applies to
    #: every other field.
    messages: list[dict] = Field(default_factory=list)
    memory: list[MemoryRef] = Field(default_factory=list)
    #: Slider ids already in use, so the model cannot collide with one.
    sliderVocabulary: list[str] = Field(default_factory=list)
    #: What the client's own bounding dropped, so a truncated context is visible
    #: rather than reading as "the model saw everything".
    omitted: list[str] = Field(default_factory=list)

    def scenes(self) -> tuple[Optional[Scene], list[Scene], list[str]]:
        """``(current, neighbours, notes)`` — parsed, with the two treated apart.

        A neighbour is DECORATION: it exists so the new scene matches the tone of
        its surroundings. One that will not parse is dropped and noted, because
        refusing to build over it would make a broken scene poison the ones near
        it.

        ``current`` is the SUBJECT of a replace, and unreadable is not the same
        as absent: building anyway would produce a from-scratch scene wearing the
        label of a refinement — the failure ``require_consistent`` exists to stop.
        So it raises.
        """
        notes: list[str] = []
        current = None
        if self.current is not None:
            try:
                current = Scene.model_validate(self.current)
            except ValidationError as e:
                raise ValueError(
                    f"the scene being replaced does not parse: {e.errors()[0]}") from e

        neighbours: list[Scene] = []
        dropped = 0
        for item in self.neighbours:
            try:
                neighbours.append(Scene.model_validate(item))
            except ValidationError:
                dropped += 1
        # ONE note with a count. Appending per failure made two drops read as two
        # separate single drops, which understates what the builder cannot see.
        if dropped:
            notes.append(f"{dropped} neighbouring scene(s) could not be read")
        return current, neighbours, notes

    def require_consistent(self) -> None:
        """Refuse a request whose own fields disagree.

        A ``replace`` with no ``current`` would silently become a from-scratch
        build wearing the label of a refinement — the failure a user reports as
        "it ignored my scene". Worth checking precisely because the result looks
        fine: a plausible new scene, and the one it was asked to improve gone.
        """
        if self.op == "replace" and self.current is None:
            raise ValueError("a replace request must carry the scene being replaced")
        if self.op == "insert" and self.current is not None:
            raise ValueError("an insert request must not carry a current scene")
