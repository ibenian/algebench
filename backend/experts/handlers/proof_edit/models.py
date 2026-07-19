"""Typed wire contract for ``POST /api/expert/proof_edit``.

The response is the client's whole picture of an edit, so its shape is worth
pinning rather than assembling ad hoc dicts: a typo in a key here becomes a
silently missing variant in the UI, and the client's assembly logic (mirrored in
``tests/backend/experts/test_proof_edit_patch.py``) depends on every field being
present and correctly named.

The payload is deliberately COMPACT. The variants are nested — *insert only* is
op A, *insert + glue* is A, B, C, *supersede* is A, B, C plus deletions — so
:class:`NewStep` list is emitted ONCE and each :class:`Variant` is a small
selection over it. That keeps the response proportional to the size of the edit
rather than the size of the proof.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

VariantKind = Literal["insert", "glue", "propagate", "supersede"]

VARIANT_INSERT: VariantKind = "insert"
VARIANT_GLUE: VariantKind = "glue"
# Rewrites every following step through the same operation. A substitution is
# global by nature — "substitute all a with sin(w)" means everywhere, not once —
# so inserting it at one step leaves the rest of the proof still saying `a` and
# the chain measurably worse. Neither `glue` (bridge back to the unchanged next
# step) nor `supersede` (delete what follows) can express the repair.
VARIANT_PROPAGATE: VariantKind = "propagate"
VARIANT_SUPERSEDE: VariantKind = "supersede"


class NewStep(BaseModel):
    """One rendered step the edit adds, shared across every variant.

    Sharing is sound because a step's rendered fields and confidence depend only
    on its predecessors, and all variants share the same prefix — so these render
    identically wherever they appear. ``index`` is absent on purpose: the client
    renumbers after splicing.
    """

    model_config = ConfigDict(extra="forbid")

    operation: str = ""
    justification: str = ""
    input_latex: str = ""
    latex: str = ""
    plain: str = ""
    confidence: dict = Field(default_factory=dict)


class Variant(BaseModel):
    """One way to apply the edit — a selection over the shared ``new_steps``."""

    model_config = ConfigDict(extra="forbid")

    kind: VariantKind
    at: int = Field(ge=0, description="index of the step the edit follows")
    take: int = Field(ge=1, description="how many of new_steps this variant uses")
    delete_count: int = Field(
        default=0, ge=0, description="following steps dropped (supersede only)")
    # Keyed by ORIGINAL step index — the proof the client already has — so it is
    # applied BEFORE renumbering.
    step_updates: dict[str, dict] = Field(default_factory=dict)
    terms_added: dict[str, dict] = Field(default_factory=dict)
    overall_confidence: Optional[dict] = None
    badge_delta: str = Field(
        default="", description="tier changes on pre-existing steps, e.g. 'step 5: Verified → Plausible'")
    # What the CAS cannot tell you: two states can be provably equivalent while
    # the chain still READS wrong, because the following caption now describes a
    # move that no longer happens there. Without this, badges alone would make
    # the bridge variant look pointless.
    readability_note: str = ""


class EditPayload(BaseModel):
    """The ``variants`` outcome of a proof edit."""

    model_config = ConfigDict(extra="forbid")

    new_steps: list[NewStep] = Field(default_factory=list)
    variants: list[Variant] = Field(default_factory=list)
    summary: str = ""
    # Set when the CAS could neither confirm nor disprove the step. Surfaced in
    # words because the resulting "Plausible" badge reads as mild approval — and
    # the CAS returns exactly that tier for outright nonsense.
    caveat: str = ""
    focus_step: int = 0


__all__ = [
    "EditPayload", "NewStep", "VARIANT_GLUE", "VARIANT_INSERT",
    "VARIANT_PROPAGATE", "VARIANT_SUPERSEDE", "Variant", "VariantKind",
]


# Log tag for the whole proof-edit subsystem, matching the CAS guard's ``🧬 CAS``
# convention so a mixed server log stays greppable. Defined once here rather than
# repeated per module — three copies of a string constant drift.
LOG_TAG = "✏️ proof-edit"
