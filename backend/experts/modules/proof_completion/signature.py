"""DSPy signatures.

A signature is parameterized by its expert's context model. The standard input
fields (``context``, ``context_id``, ``lesson_context``, ``instruction``) are
bound by name as kwargs in :func:`backend.experts.service.invoke` — we never
construct a ``Signature`` ourselves. The docstring holds the expert's *static*
role and is what the optimizer (MIPROv2/GEPA) rewrites.
"""

from __future__ import annotations

import dspy

from .outputs import GraphTrajectory
from .model import GraphTransition


class ProofCompletionSig(dspy.Signature):
    r"""Produce the math derivation that turns `start` into `target`, step by step.

    You are given two semantic graphs: a starting expression and a target
    expression. Emit a single trajectory of derivation `steps`. Each step is one
    mathematical move and holds the COMPLETE expression you reach after it — not
    a graph fragment, the whole expression as LaTeX.

    Do NOT emit graph nodes or edges. Work purely in math: write the full
    expression at each step and describe the move. The graphs (and the low-level
    edits for animation) are reconstructed from your LaTeX automatically.

    Rules:
    - Each step has: `step` (1-based index), `operation` (the move in plain math
      terms, e.g. "add 4 to both sides", "take the square root of both sides"),
      `expr_latex` (the COMPLETE, valid LaTeX of the expression after this move),
      and `justification` (why the move is mathematically valid).
    - Every `expr_latex` MUST be a single, complete, parseable expression — one
      you could hand to a CAS. Never a partial or malformed fragment.
    - Write EVERY multiplication explicitly with `\cdot`. A symbol written
      directly before a parenthesis is read as a FUNCTION CALL, not a product:
      `n(n+1)` means "apply function n to (n+1)" and is INVALID. Write
      `n \cdot (n+1)`, `r \cdot (\cos\theta + i\sin\theta)`, `2 \cdot (x+3)`.
      (Coefficient juxtaposition like `2x` or `a x^2` is fine; the hazard is a
      symbol immediately followed by `(`.)
    - Make each step small enough that its `expr_latex` is a clean intermediate
      expression. If a transformation is large, split it into as many smaller
      steps as needed. Prefer more small, valid steps over one big jump.
    - The final step's `expr_latex` must equal the target expression.
    """

    context: GraphTransition = dspy.InputField(
        desc="the start graph, the target graph, the domain, and the intent"
    )
    context_id: str = dspy.InputField(desc="id of the semantic graph being transformed")
    lesson_context: str = dspy.InputField(desc="surrounding lesson summary, may be empty")
    instruction: str = dspy.InputField(desc="the user's request")
    trajectory: GraphTrajectory = dspy.OutputField(
        desc="the ordered derivation steps, each a complete expression, from start to target"
    )
