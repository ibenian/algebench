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

Only three fields are typed beyond their name, because only three are read by
CODE rather than by a formatter: ``op`` selects a branch, ``sceneIndex`` becomes
a list index during placement (a bad one is a wrong-scene write, and the scene it
clobbers looks fine afterwards), and ``intent`` carries a length that decides
prompt size. Everything else is prompt material on its way to becoming text.

Prompt bounds live in ``format.py``, NOT here, because they are properties of the
prompt rather than of the request: the honest response to an oversized context is
to truncate it and say so, not to refuse to build the scene. See ``_format_proof``
for the same choice.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.model.lesson import Scene

#: Bounds the request itself, because it bounds a field the formatter passes
#: through verbatim. The rest of the bounding is the formatter's job.
MAX_INTENT_CHARS = 2000


class BuildSceneRequest(BaseModel):
    """What the client sends. Assembled by ``src/builder-context.ts``."""

    model_config = ConfigDict(extra="forbid")

    # --- read by code -------------------------------------------------------
    op: Literal["insert", "replace"]
    sceneIndex: int = Field(ge=0)
    intent: str = Field(min_length=1, max_length=MAX_INTENT_CHARS)

    # --- read only by format.py, on the way to the prompt -------------------
    #: title, description, and one line per scene.
    lesson: dict = Field(default_factory=dict)
    #: The scenes either side of the target — enough to match tone.
    neighbours: list = Field(default_factory=list)
    #: The scene being replaced. Absent on insert; see require_consistent.
    current: Optional[dict] = None
    #: House style derived by the client from the lesson's own elements.
    conventions: dict = Field(default_factory=dict)
    clarifications: list = Field(default_factory=list)
    #: Agent-memory keys and their SHAPES — never their values.
    memory: list = Field(default_factory=list)
    #: Slider ids already in use, so the model cannot collide with one.
    sliderVocabulary: list = Field(default_factory=list)
    #: What the client's own bounding dropped, so a truncated context is visible
    #: rather than reading as "the model saw everything".
    omitted: list = Field(default_factory=list)

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
                raise ValueError(f"the scene being replaced does not parse: {e.errors()[0]}")

        neighbours: list[Scene] = []
        for item in self.neighbours:
            try:
                neighbours.append(Scene.model_validate(item))
            except ValidationError:
                notes.append("1 neighbouring scene could not be read")
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
