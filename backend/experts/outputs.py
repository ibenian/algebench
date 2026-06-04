"""Output types emitted by experts.

``Output`` is the base for every structured result an expert can emit. Each
subclass declares a snake_case ``kind`` (the *only* shared key across
``OUTPUT_REGISTRY`` / ``HANDLER_REGISTRY``) and self-registers by passing
``output_kind=`` as a class keyword argument.

The proof-completion output (``graph_trajectory``) lives here, built on a
**discriminated union** of atomic graph ops: one strongly-typed class per op
(``AddNode`` / ``RemoveNode`` / ``AddEdge`` / ``RemoveEdge``) carrying exactly
its own fields, with shared fields on ``GraphOpBase`` and behavior provided
polymorphically via ``apply_to`` — classical OO, no optional-field soup.
"""

from __future__ import annotations

from typing import Annotated, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from backend.model.semantic_graph import SemanticGraphEdge, SemanticGraphNode

from .registry import OUTPUT_REGISTRY


class Output(BaseModel):
    """Base class for all expert outputs.

    Subclasses self-register by passing ``output_kind="..."`` in the class
    header, e.g. ``class GraphTrajectory(Output, output_kind="graph_trajectory")``.
    """

    model_config = ConfigDict(extra="forbid")

    kind: str
    context_id: str = Field(min_length=1, max_length=200)

    def __init_subclass__(cls, *, output_kind: Optional[str] = None, **kwargs):
        super().__init_subclass__(**kwargs)
        if output_kind:
            if output_kind in OUTPUT_REGISTRY:
                raise ValueError(f"output kind {output_kind!r} already registered")
            cls.__output_kind__ = output_kind
            OUTPUT_REGISTRY[output_kind] = cls


# --------------------------------------------------------------------------- #
# Atomic graph ops — a discriminated union (one typed class per op).
# --------------------------------------------------------------------------- #

class GraphOpError(ValueError):
    """An op could not be legally applied (penalized by the metric)."""


class GraphOpBase(BaseModel):
    """Shared fields + the polymorphic apply contract for every graph op."""

    model_config = ConfigDict(extra="forbid")

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


# The discriminated union the LM (and our code) work with.
GraphOp = Annotated[
    Union[AddNode, RemoveNode, AddEdge, RemoveEdge],
    Field(discriminator="op"),
]

# For (de)serializing a single op from/to a plain dict.
GRAPH_OP_ADAPTER: TypeAdapter = TypeAdapter(GraphOp)


class GraphTrajectory(Output, output_kind="graph_trajectory"):
    """An ordered list of atomic graph edits transforming start into target."""

    kind: Literal["graph_trajectory"] = "graph_trajectory"
    ops: List[GraphOp] = Field(default_factory=list)
