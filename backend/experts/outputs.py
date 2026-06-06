"""The ``Output`` base class + the typed ``ExpertResult`` container.

Generic framework code. Expert-specific output types live in the expert's own
package (e.g. ``modules/proof_completion/outputs.py``) and subclass ``Output``,
declaring a snake_case ``kind`` Literal. The ``kind`` is how a *consumer*
dispatches an output; routing/target (``context_id``) lives on the container.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, SerializeAsAny


class Output(BaseModel):
    """Base class for all expert outputs — a pure typed payload.

    Subclasses declare a ``kind: Literal["..."]`` field (consumers dispatch on it)
    plus their own payload fields. No routing/meta here — that's on
    ``ExpertResult``.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str


class ExpertResult(BaseModel):
    """Typed container for everything one ``invoke`` returns.

    Stays typed through the framework; the transport edge serializes it once
    (``result.model_dump()``).
    """

    model_config = ConfigDict(extra="forbid")

    expert: str
    context_id: str
    # Always a list (consumers iterate it uniformly; the UI gets a JSON array).
    # SerializeAsAny so each output dumps with its *concrete* subclass fields
    # (a plain list[Output] would serialize only the base fields, dropping e.g.
    # ProofTrajectory.ops).
    outputs: List[SerializeAsAny[Output]] = Field(default_factory=list)
    invoke_id: Optional[str] = None

    def single(self) -> Output:
        """Backend convenience: the one output, for single-output experts.

        Consumers that may receive several outputs (the UI) just iterate
        ``outputs``; this is for Python callers that know there is exactly one.
        """
        if len(self.outputs) != 1:
            raise ValueError(f"expected exactly 1 output, got {len(self.outputs)}")
        return self.outputs[0]
