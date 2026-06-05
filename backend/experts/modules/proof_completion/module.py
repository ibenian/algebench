"""ProofCompletionExpert — start graph + target graph → edit trajectory.

A thin ``dspy.Module`` wrapping ``ChainOfThought(ProofCompletionSig)``. The
optimizer (MIPROv2/GEPA) compiles *this* module; the compiled state is saved to
an artifact and loaded back here.
"""

from __future__ import annotations

import os

import dspy

from backend.experts.registry import register_expert
from .signature import ProofCompletionSig
from .model import GraphTransition

# The "blessed" compiled program. If this file exists it is loaded by default —
# so service.invoke and the CLI use the optimized expert without --program.
# (gitignored; produced by proof_completion_optimize.py --out <this path>.)
DEFAULT_ARTIFACT = os.path.join(os.path.dirname(__file__), "artifacts",
                                "proof_completion.json")


@register_expert(
    "proof_completion",
    context_scope="semanticGraph",
    context_model=GraphTransition,
)
class ProofCompletionExpert(dspy.Module):
    """Produce the ordered atomic graph edits transforming start into target."""

    def __init__(self, artifact: str | None = None, load_default: bool = True):
        super().__init__()
        self.predict = dspy.ChainOfThought(ProofCompletionSig)
        # explicit artifact wins; else the blessed default if present and allowed;
        # else uncompiled (baseline). load_default=False forces baseline.
        path = artifact or (DEFAULT_ARTIFACT if load_default else None)
        if path and os.path.exists(path):
            self.load(path)
            self.loaded_artifact = path
        else:
            self.loaded_artifact = None

    def forward(self, *, context: GraphTransition, context_id: str,
                lesson_context: str = "", instruction: str = ""):
        pred = self.predict(
            context=context,
            context_id=context_id,
            lesson_context=lesson_context,
            instruction=instruction,
        )
        return [pred.trajectory]  # the canonical list[Output] (one trajectory)
