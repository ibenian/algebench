"""DSPy signatures.

The model reasons in **math**, not graphs: it is given the start and target as
LaTeX (``start_latex`` / ``target_latex``) and emits a derivation. The semantic
graphs never reach the prompt — they are a code-side substrate (verification +
animation). ``module.forward`` derives the LaTeX from the context graphs via
``graph_to_latex`` and binds these fields. The docstring holds the expert's
*static* role and is what the optimizer (MIPROv2/GEPA) rewrites.
"""

from __future__ import annotations

import dspy

from .outputs import ProofTrajectory


class ProofCompletionSig(dspy.Signature):
    r"""Produce the math derivation that turns `start_latex` into `target_latex`.

    You are given a starting expression and a target expression, both as LaTeX.
    Emit a single trajectory of derivation `steps`. Each step is one mathematical
    move and holds the COMPLETE expression you reach after it, as LaTeX.

    Rules:
    - Each step has: `operation` (the move, e.g. "add 4 to both sides"),
      `expr_latex` (the COMPLETE, valid LaTeX of the expression after this move),
      and `justification` (why the move is mathematically valid).
    - In `operation` and `justification`, write ANY math as inline LaTeX delimited
      by `$…$` — e.g. "add $\frac{c}{a}$ to both sides", "the discriminant is
      $b^2 - 4ac$". Do NOT use backticks or bare text for math; plain words stay plain.
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
    - The final step's `expr_latex` must equal `target_latex`.
    """

    start_latex: str = dspy.InputField(desc="the starting expression, as LaTeX")
    target_latex: str = dspy.InputField(desc="the target expression to reach, as LaTeX")
    domain: str = dspy.InputField(desc="math domain hint (e.g. algebra, calculus), may be empty")
    intent: str = dspy.InputField(desc="what the derivation should accomplish, may be empty")
    lesson_context: str = dspy.InputField(desc="surrounding lesson summary, may be empty")
    instruction: str = dspy.InputField(desc="the user's request, may be empty")
    trajectory: ProofTrajectory = dspy.OutputField(
        desc="the ordered derivation steps, each a complete expression, from start to target"
    )
