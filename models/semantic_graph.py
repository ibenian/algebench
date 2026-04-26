"""Pydantic models mirroring `schemas/semantic-graph.schema.json`.

The JSON schema remains canonical for validating scene files on disk; these
models exist so Pydantic-AI can enforce structured output from the LLM and
reject prompt-injection-style payloads (HTML brackets, non-hex colors, etc.)
before they reach the cache or the browser.
"""

from __future__ import annotations

from typing import List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


NodeType = Literal[
    "scalar",
    "vector",
    "constant",
    "number",
    "operator",
    "function",
    "relation",
    "expression",
    "text",
]

Role = Literal[
    "state_variable",
    "parameter",
    "constant",
    "coefficient",
    "index",
    "dependent",
    "independent",
    "observable",
    "field",
]

EdgeSemantic = Literal["direct", "inverse", "neutral"]

ClassificationKind = Literal["algebraic", "ODE", "PDE", "statements"]


_NO_HTML = r"^[^<>]*$"
_HEX_COLOR = r"^#[0-9A-Fa-f]{3,8}$"


class SemanticGraphNode(BaseModel):
    """A node in the semantic graph. See `schemas/semantic-graph.schema.json`."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=_NO_HTML)
    type: NodeType
    label: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    emoji: Optional[str] = Field(default=None, max_length=4)
    latex: Optional[str] = Field(default=None, max_length=200)
    op: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    exponent: Optional[str] = Field(default=None, max_length=20, pattern=_NO_HTML)
    with_respect_to: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    subexpr: Optional[str] = Field(default=None, max_length=400)
    description: Optional[str] = Field(default=None, max_length=200, pattern=_NO_HTML)
    quantity: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    dimension: Optional[str] = Field(default=None, max_length=60)
    unit: Optional[str] = Field(default=None, max_length=30, pattern=_NO_HTML)
    value: Optional[Union[float, int, str]] = Field(default=None)
    role: Optional[Role] = None
    color: Optional[str] = Field(default=None, pattern=_HEX_COLOR)
    highlight: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    variant: Optional[EdgeSemantic] = None


class SemanticGraphEdge(BaseModel):
    """An edge in the semantic graph."""

    model_config = ConfigDict(extra="forbid")

    from_: str = Field(alias="from", min_length=1, max_length=80, pattern=_NO_HTML)
    to: str = Field(min_length=1, max_length=80, pattern=_NO_HTML)
    label: Optional[str] = Field(default=None, max_length=40, pattern=_NO_HTML)
    semantic: Optional[EdgeSemantic] = None
    weight: Optional[float] = Field(default=None, ge=0)


class Classification(BaseModel):
    """Optional classification block. Mirrors the `classification` $def."""

    model_config = ConfigDict(extra="forbid")

    kind: ClassificationKind
    count: Optional[int] = Field(default=None, ge=2)
    clauses: Optional[List["Classification"]] = None
    order: Optional[int] = Field(default=None, ge=1)
    dependent_variables: Optional[List[str]] = None
    independent_variables: Optional[List[str]] = None
    sympy_hints: Optional[List[str]] = None
    linear: Optional[bool] = None
    homogeneous: Optional[bool] = None
    constant_coefficients: Optional[bool] = None


Classification.model_rebuild()


class SemanticGraph(BaseModel):
    """Top-level semantic graph object."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    nodes: List[SemanticGraphNode]
    edges: List[SemanticGraphEdge]
    classification: Optional[Classification] = None
    domain: Optional[str] = Field(default=None, max_length=60, pattern=_NO_HTML)
    # Set to ``true`` after a graph has been through the Gemini enricher.
    # Both the server and the client check this to short-circuit redundant
    # enrichment calls — a graph that already carries the marker has the
    # description / quantity / dimension / unit / emoji metadata the
    # enricher produces, so re-running on it would just burn a Gemini call.
    enriched: Optional[bool] = Field(default=None)
