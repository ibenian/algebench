"""Handler for the ``graph_trajectory`` output kind.

Validates the trajectory against the models and returns the normalized,
consumable form. (A future delivery layer would attach a command id / invoke id
here; for this backend-only slice it just produces a plain dict.)
"""

from __future__ import annotations

from ..outputs import GraphTrajectory
from ..registry import register_handler


@register_handler("graph_trajectory")
def handle(out: GraphTrajectory, *, context_id: str) -> dict:
    return {
        "kind": "graph_trajectory",
        "context_id": out.context_id or context_id,
        "ops": [op.model_dump(exclude_none=True) for op in out.ops],
    }
