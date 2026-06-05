"""ProofCompletionExpert — start graph + target graph → edit trajectory.

A thin ``dspy.Module`` wrapping ``ChainOfThought(ProofCompletionSig)``. The
optimizer (MIPROv2/GEPA) compiles *this* module; the compiled state is saved to
an artifact and loaded back here.
"""

from __future__ import annotations


import dspy

from backend.experts.registry import register_expert
from .signature import ProofCompletionSig
from .model import GraphTransition


@register_expert(
    "proof_completion",
    context_scope="semanticGraph",
    context_model=GraphTransition,
)
class ProofCompletionExpert(dspy.Module):
    """Produce the ordered atomic graph edits transforming start into target."""

    def __init__(self, artifact: str | None = None):
        super().__init__()
        self.predict = dspy.ChainOfThought(ProofCompletionSig)
        if artifact and os.path.exists(artifact):
            self.load(artifact)

    def forward(self, *, context: GraphTransition, context_id: str,
                lesson_context: str = "", instruction: str = ""):
        pred = self.predict(
            context=context,
            context_id=context_id,
            lesson_context=lesson_context,
            instruction=instruction,
        )
        return pred.outputs
