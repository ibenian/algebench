"""Handler for the ``graph_trajectory`` output kind — typed-in / typed-out.

Normalizes/enriches the typed output and returns it typed; serialization to the
wire happens once at the transport edge, not here.
"""

from __future__ import annotations

from .outputs import GraphTrajectory
from backend.experts.registry import register_handler


@register_handler("graph_trajectory")
def handle(out: GraphTrajectory, *, context_id: str) -> GraphTrajectory:
    # ensure the output carries a context_id (fall back to the invoke's)
    if not out.context_id:
        return out.model_copy(update={"context_id": context_id})
    return out
