"""ProofCompletion outputs: the ``proof_trajectory`` discriminated union.

One strongly-typed class per atomic op (``AddNode`` / ``RemoveNode`` /
``AddEdge`` / ``RemoveEdge``), each carrying exactly its own fields, with shared
fields on ``GraphOpBase`` and behavior provided polymorphically via ``apply_to``.
"""

from __future__ import annotations

from typing import Annotated, List, Literal, Optional, Union

from pydantic import (
    BaseModel, ConfigDict, Discriminator, Field, Tag, TypeAdapter,
)

from backend.model.semantic_graph import SemanticGraphEdge, SemanticGraphNode

from backend.experts.outputs import Output


class GraphOpError(ValueError):
    """An op could not be legally applied (penalized by the metric)."""


class GraphOpBase(BaseModel):
    """Shared fields + the polymorphic apply contract for every graph op."""

    model_config = ConfigDict(extra="forbid")

    # 1-based derivation step this op belongs to. Ops sharing a step are applied
    # together; the cumulative graph at each step boundary must be a complete,
    # groundable expression (a valid waypoint in the derivation).
    step: int = Field(default=1, ge=1, description="1-based derivation step index")
    explanation: str = Field(min_length=1, max_length=400, description="what changes")
    justification: str = Field(min_length=1, max_length=400,
                               description="why the change is mathematically valid")

    def apply_to(self, graph, node_ids: set) -> None:
        """Mutate ``graph`` in place (and ``node_ids``); raise on illegal op."""
        raise NotImplementedError


class AddNode(GraphOpBase):
    op: Literal["add_node"] = "add_node"
    node: SemanticGraphNode

    def apply_to(self, graph, node_ids: set) -> None:
        if self.node.id in node_ids:
            raise GraphOpError(f"add_node: duplicate id {self.node.id!r}")
        graph.nodes.append(self.node.model_copy(deep=True))
        node_ids.add(self.node.id)


class RemoveNode(GraphOpBase):
    op: Literal["remove_node"] = "remove_node"
    node_id: str = Field(min_length=1, max_length=80)

    def apply_to(self, graph, node_ids: set) -> None:
        if self.node_id not in node_ids:
            raise GraphOpError(f"remove_node: missing id {self.node_id!r}")
        if any(e.from_ == self.node_id or e.to == self.node_id for e in graph.edges):
            raise GraphOpError(f"remove_node: {self.node_id!r} still has edges")
        graph.nodes = [n for n in graph.nodes if n.id != self.node_id]
        node_ids.discard(self.node_id)


class AddEdge(GraphOpBase):
    op: Literal["add_edge"] = "add_edge"
    edge: SemanticGraphEdge

    def apply_to(self, graph, node_ids: set) -> None:
        if self.edge.from_ not in node_ids or self.edge.to not in node_ids:
            raise GraphOpError("add_edge: dangling endpoint")
        graph.edges.append(self.edge.model_copy(deep=True))


class RemoveEdge(GraphOpBase):
    op: Literal["remove_edge"] = "remove_edge"
    edge_from: str = Field(min_length=1, max_length=80)
    edge_to: str = Field(min_length=1, max_length=80)
    edge_role: Optional[str] = Field(default=None, max_length=40)

    def apply_to(self, graph, node_ids: set) -> None:
        for i, e in enumerate(graph.edges):
            if (e.from_ == self.edge_from and e.to == self.edge_to
                    and (self.edge_role is None or e.role == self.edge_role)):
                del graph.edges[i]
                return
        raise GraphOpError(f"remove_edge: no edge {self.edge_from!r}->{self.edge_to!r}")


def _op_discriminator(v) -> Optional[str]:
    """Pick the op subclass — robustly.

    LMs reliably emit the *fields* of an op but often omit the explicit ``op``
    discriminator. Fall back to inferring it from which fields are present, so
    the union still parses (the subclass then sets ``op`` via its default).
    """
    if isinstance(v, dict):
        if v.get("op"):
            return v["op"]
        if "node" in v:
            return "add_node"
        if "node_id" in v:
            return "remove_node"
        if "edge" in v:
            return "add_edge"
        if "edge_from" in v or "edge_to" in v:
            return "remove_edge"
        return None
    return getattr(v, "op", None)


# The discriminated union the LM (and our code) work with. A *callable*
# discriminator makes it tolerant of a missing ``op`` tag (see above).
GraphOp = Annotated[
    Union[
        Annotated[AddNode, Tag("add_node")],
        Annotated[RemoveNode, Tag("remove_node")],
        Annotated[AddEdge, Tag("add_edge")],
        Annotated[RemoveEdge, Tag("remove_edge")],
    ],
    Discriminator(_op_discriminator),
]

# For (de)serializing a single op from/to a plain dict.
GRAPH_OP_ADAPTER: TypeAdapter = TypeAdapter(GraphOp)


class DerivationStep(BaseModel):
    """One derivation step: a complete reachable state + the move that reached it.

    The model emits what it is good at — a *full* expression — not low-level
    graph edits. ``expr_latex`` is the COMPLETE LaTeX of the expression after
    this step (e.g. ``x^2 = 4``), and ``operation`` describes the move in plain
    math terms (e.g. ``add 4 to both sides``).

    The graph for each state is derived deterministically in code via
    ``SemanticGraphService.latex_to_graph``; the atomic node/edge edits between
    consecutive states are recovered with ``diff``. So every step is a
    single-root, sympy-convertible expression *by construction* — the model
    never does graph bookkeeping.
    """

    model_config = ConfigDict(extra="forbid")

    operation: str = Field(min_length=1, max_length=200,
                           description="the math move, e.g. 'add 4 to both sides'")
    expr_latex: str = Field(min_length=1, max_length=600,
                            description="the COMPLETE LaTeX of the resulting expression")
    justification: str = Field(min_length=1, max_length=400,
                               description="why this step is mathematically valid")


class ProofTrajectory(Output):
    """A derivation as an ordered list of complete reachable states.

    Each step holds the full expression after one math operation. The per-state
    graphs (and the atomic edits between them, for animation) are derived in code
    from ``steps`` — the model only supplies the math. ``kind`` is the
    consumer-facing dispatch key.

    ``start_latex`` / ``target_latex`` are the **reconstructed ("proper") LaTeX**
    of the start and target graphs, attached by the expert after inference so the
    trajectory is self-contained (the endpoints it derived between travel with
    it). They are NOT produced by the model.
    """

    kind: Literal["proof_trajectory"] = "proof_trajectory"
    start_latex: Optional[str] = None
    target_latex: Optional[str] = None
    steps: List[DerivationStep] = Field(default_factory=list)
