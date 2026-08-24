"""The wire contract every builder returns — mirror of src/placement.ts.

A builder returns a complete canonical NODE plus a PLACEMENT saying where it
goes. Three ops cover it: a built node is put somewhere new, swapped for an
existing one, or removed. Nothing finer, because a builder never produces
anything finer than a node.

The client applies these against `state.lessonSpec` (the browser holds the
authoritative lesson; this backend stays stateless) and derives the inverse ops
in the same pass for undo. `tests/backend/experts/test_placement_parity.py`
pins this module against its TypeScript twin.

Lives here rather than under ``handlers/`` because it is not a handler:
``discover_handlers()`` imports every package in that directory so the
``@register_handler`` decorators run, and a non-handler sitting in that import
path is a small structural lie that gets executed on every server start.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.model.lesson import Scene, Step

NodeKind = Literal["lesson", "scene", "step", "proof", "proof_step"]

class Placement(BaseModel):
    """WHERE a node goes — positional, not id-based.

    Positional because a node being inserted has no id in the document yet (ids
    are minted server-side, never proposed by the model), because position is
    itself meaningful (a step's index IS its pedagogy), and because ids are
    ambiguous anyway — the same element id may appear in ``scene.elements`` and
    again in a ``step.add[]``.

    There is deliberately NO ``field`` naming the target array. That made ``kind``
    and ``field`` independent axes when only a few pairings are legal, so
    ``{kind: "scene", field: "steps"}`` validated and would have spliced a Scene
    into a Step array. The container is DERIVED from the kind instead, which makes
    the illegal combinations unrepresentable rather than merely rejected:

        lesson      -> the root itself (replace only)
        scene       -> lesson.scenes
        step        -> lesson.scenes[scene].steps
        proof       -> scenes[scene].proof, or lesson.proof when ``scene`` is absent
        proof_step  -> scenes[scene].proof.steps

    ``kind`` deliberately does NOT live here; it is a discriminant on the op so
    that TypeScript narrows ``node`` natively. Placement answers WHERE, kind
    answers WHAT.
    """

    model_config = ConfigDict(extra="forbid")

    #: Which scene. Absent for a lesson-level placement, including the ``proof``
    #: the schema permits on LessonFormat itself.
    scene: Optional[int] = Field(default=None, ge=0)
    step: Optional[int] = Field(default=None, ge=0)
    index: Optional[int] = Field(default=None, ge=0)
    #: NOT for lookup — for VERIFICATION. On replace/delete the applier asserts
    #: the node at ``index`` still carries this id, so an op computed against a
    #: lesson that has since moved is discarded rather than overwriting the wrong
    #: node.
    id: Optional[str] = None


class _BuildOpBase(BaseModel):
    """Fields every op carries. ``kind`` and ``node`` are declared per subclass."""

    model_config = ConfigDict(extra="forbid")

    op: Literal["insert", "replace", "delete"]
    at: Placement

    @model_validator(mode="after")
    def _node_matches_op(self):
        """``insert``/``replace`` carry a node; ``delete`` must not.

        Without this an op can claim to insert nothing, which reaches the client
        as a successful build that renders an empty scene.
        """
        node = getattr(self, "node", None)
        if self.op == "delete" and node is not None:
            raise ValueError("a delete op must not carry a node")
        if self.op in ("insert", "replace") and node is None:
            raise ValueError(f"an {self.op} op must carry a node")
        return self


class SceneOp(_BuildOpBase):
    kind: Literal["scene"] = "scene"
    node: Optional[Scene] = None


class StepOp(_BuildOpBase):
    kind: Literal["step"] = "step"
    node: Optional[Step] = None


#: One op per node kind, DISCRIMINATED on ``kind``.
#:
#: Deliberately not ``Optional[Union[Scene, Step]]`` on a single class: pydantic's
#: smart union picks whichever member matches first, so ``kind="step"`` with a node
#: carrying only a title silently parsed as a ``Scene`` — kind and node disagreeing
#: with nothing to catch it. Worse, adding a member later could re-resolve payloads
#: that already worked.
#:
#: GROWTH PATH (iterations 3-6): adding a kind is ONE new subclass plus ONE union
#: member. Existing members are untouched, because the discriminator makes matching
#: exact rather than best-effort. `ProofOp`/`ProofStepOp` land in iteration 5 with
#: `Proof`/`ProofStep` in backend/model/lesson.py; `LessonOp` if a whole-lesson
#: build ever needs it. No refactor, no behaviour change to what already ships.
BuildOp = Annotated[Union[SceneOp, StepOp], Field(discriminator="kind")]

#: The kinds the wire contract declares, including those without an op class yet.
#: `src/placement.ts` NodeKind must stay in step with this — the parity test checks it.
NODE_KINDS: tuple[str, ...] = ("lesson", "scene", "step", "proof", "proof_step")


class BuildResult(BaseModel):
    """What a builder returns on success."""

    model_config = ConfigDict(extra="forbid")

    ops: list[BuildOp] = Field(default_factory=list)
    summary: str = ""
    focus: Optional[Placement] = None


# ── The four outcomes every builder returns ──────────────────────────────────
#
# Mirrors `BuilderOutcome` in src/placement.ts, and follows proof_edit's contract:
# a builder answers with exactly ONE of these, and "I could not do this" is a
# normal answer rather than an error. Modelled here (not just in TypeScript) so a
# handler cannot invent a fifth shape or misspell a field on the way out.


class BuilderQuestion(BaseModel):
    """A pedagogically load-bearing ambiguity the model will not guess at.

    Budgeted by the caller (see MAX_CLARIFICATIONS in proof_edit) so it cannot
    turn into an interrogation.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["question"] = "question"
    question: str = Field(min_length=1)
    focus: Optional[Placement] = None


class BuilderRefusal(BaseModel):
    """The request was understood and cannot be satisfied. Says why, offers nothing."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["refused"] = "refused"
    reason: str = Field(min_length=1)
    focus: Optional[Placement] = None


class BuilderPassthrough(BaseModel):
    """Not a build request at all — the conversational agent should handle it."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["passthrough"] = "passthrough"


class BuilderSuccess(BaseModel):
    """A built node, or nodes, and where they go."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["result"] = "result"
    result: BuildResult
    caveat: Optional[str] = None


BuilderOutcome = Annotated[
    Union[BuilderSuccess, BuilderQuestion, BuilderRefusal, BuilderPassthrough],
    Field(discriminator="kind"),
]
