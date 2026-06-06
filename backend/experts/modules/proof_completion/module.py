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
from .grounding import graph_to_latex

# The "blessed" compiled program. If this file exists it is loaded by default —
# so service.invoke and the CLI use the optimized expert without --program.
# (gitignored; produced by proof_completion/optimize.py --out <this path>.)
DEFAULT_ARTIFACT = os.path.join(os.path.dirname(__file__), "artifacts",
                                "proof_completion.json")


@register_expert(
    "proof_completion",
    context_scope="semanticGraph",
    context_model=GraphTransition,
)
class ProofCompletionExpert(dspy.Module):
    """Produce the step-by-step derivation transforming start into target.

    Returns a single ``ProofTrajectory`` of derivation *states* (each a complete
    ``expr_latex`` + operation + justification). The model emits math, not graph
    edits; the per-state graphs and the atomic edits between them are recovered
    deterministically in code (``latex_to_graph`` + ``diff``).
    """

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
        # The model reasons in math, not graphs: translate the context graphs to
        # proper LaTeX here and feed *that* to the LM. The graphs never enter the
        # prompt — they stay code-side for verification + animation.
        start_latex = graph_to_latex(context.start) or ""
        target_latex = graph_to_latex(context.target) or ""
        pred = self.predict(
            start_latex=start_latex,
            target_latex=target_latex,
            domain=context.domain or "",
            intent=context.intent or "",
            lesson_context=lesson_context,
            instruction=instruction,
        )
        traj = pred.trajectory
        # attach the endpoints so the trajectory is self-contained (not LM output)
        traj.start_latex = start_latex or None
        traj.target_latex = target_latex or None
        return [traj]  # the canonical list[Output] (one trajectory)
