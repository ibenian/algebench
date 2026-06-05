"""Context model for the ProofCompletionExpert.

The expert's input is not a single document node but a *transition* between two
semantic graphs (plus domain + intent). This is the per-expert
``context_model`` override registered on the expert — it does **not** become the
shared ``CONTEXT_MODELS["semanticGraph"]`` (other graph-scoped experts still take
a single ``SemanticGraph``).

Reuses the project's existing ``SemanticGraph`` model verbatim, so the
``_NO_HTML`` / ``_COLOR`` injection guards apply to both ``start`` and
``target``.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.model.semantic_graph import SemanticGraph


class GraphTransition(BaseModel):
    """A start graph, a target graph, and the context that motivates the path."""

    model_config = ConfigDict(extra="forbid")

    start: SemanticGraph
    target: SemanticGraph
    domain: Optional[str] = Field(default=None, max_length=60)
    intent: Optional[str] = Field(default=None, max_length=400)
