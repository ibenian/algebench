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
    """Produce the ordered atomic graph edits that turn `start` into `target`.

    You are given two semantic graphs: a starting graph and a target graph.
    Emit a single trajectory of atomic operations — add_node, remove_node,
    add_edge, remove_edge — that, applied in order to the start graph, yields a
    graph structurally and semantically identical to the target graph.

    Rules:
    - Reference existing nodes/edges by their ids; choose fresh, descriptive ids
      for new nodes (ids must not contain a hyphen).
    - Group the operations into derivation `step`s (1-based). After applying
      all ops up to and including step k, the graph MUST reconstruct to a single
      connected, sympy-convertible expression (one root, every node wired in) —
      a valid math waypoint, never a half-edited or disconnected fragment. If a
      transformation is too large to leave the graph convertible in one step,
      split it into as many smaller steps as needed so that *every* step
      boundary is convertible. Prefer more small, valid steps over one big jump.
    - Every operation needs a one-line `explanation` (what changes) and a
      `justification` (the mathematical reason it is valid).
    - The cumulative result must equal the target graph exactly.
    """

    context: GraphTransition = dspy.InputField(
        desc="the start graph, the target graph, the domain, and the intent"
    )
    context_id: str = dspy.InputField(desc="id of the semantic graph being transformed")
    lesson_context: str = dspy.InputField(desc="surrounding lesson summary, may be empty")
    instruction: str = dspy.InputField(desc="the user's request")
    trajectory: GraphTrajectory = dspy.OutputField(
        desc="the trajectory whose ops transform the start graph into the target"
    )
