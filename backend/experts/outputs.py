"""The ``Output`` base class for every structured result an expert can emit.

Generic framework code: expert-specific output types live in the expert's own
package (e.g. ``modules/proof_completion/outputs.py``). Each subclass declares a
snake_case ``kind`` and self-registers by passing ``output_kind=`` as a class
keyword argument — no central config.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from .registry import OUTPUT_REGISTRY


class Output(BaseModel):
    """Base class for all expert outputs.

    Subclasses self-register by passing ``output_kind="..."`` in the class
    header, e.g. ``class GraphTrajectory(Output, output_kind="graph_trajectory")``.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    context_id: str = Field(min_length=1, max_length=200)

    def __init_subclass__(cls, *, output_kind: Optional[str] = None, **kwargs):
        super().__init_subclass__(**kwargs)
        if output_kind:
            if output_kind in OUTPUT_REGISTRY:
                raise ValueError(f"output kind {output_kind!r} already registered")
            cls.__output_kind__ = output_kind
            OUTPUT_REGISTRY[output_kind] = cls
