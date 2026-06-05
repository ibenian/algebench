"""The ``Output`` base class + the typed ``ExpertResult`` container.

Generic framework code. Expert-specific output types live in the expert's own
package (e.g. ``modules/proof_completion/outputs.py``) and subclass ``Output``,
declaring a snake_case ``kind`` Literal. That ``kind`` field is the dispatch key
(``HANDLER_REGISTRY[out.kind]``); there is no separate output registry.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, SerializeAsAny


class Output(BaseModel):
    """Base class for all expert outputs.

    Subclasses declare a ``kind: Literal["..."]`` field (the dispatch key) plus
    their own payload fields.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    context_id: str = Field(min_length=1, max_length=200)


class ExpertResult(BaseModel):
    """Typed container for everything one ``invoke`` returns.

    Stays typed through the framework; the transport edge serializes it once
    (``result.model_dump()``).
    """

    model_config = ConfigDict(extra="forbid")

    expert: str
    context_id: str
    # SerializeAsAny so each output dumps with its *concrete* subclass fields
    # (a plain list[Output] would serialize only the base fields, dropping e.g.
    # GraphTrajectory.ops).
    outputs: List[SerializeAsAny[Output]] = Field(default_factory=list)
    invoke_id: Optional[str] = None
