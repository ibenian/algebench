"""Universal and suite-specific invariant assertions for semantic graph tests.

Every domain suite calls ``assert_universal_invariants`` on every expression.
Suite-specific invariants are composed from the helpers in this module to build
domain-tailored assertion functions.

All helpers accept ``SemanticGraph`` (Pydantic model) — the parser's return type
since the #309 refactor.
"""

from __future__ import annotations

import re
from typing import Any

from backend.model.semantic_graph import (
    SemanticGraph,
    SemanticGraphNode,
)


_PLACEHOLDER_RE = re.compile(r"(?:Theta|Xi|Phi)_\{\d*\}")


def assert_valid_graph(graph: SemanticGraph, *, latex: str = "") -> None:
    """Graph is non-null with at least one node and an edges list."""
    assert graph is not None, f"Parser returned None for: {latex!r}"
    assert len(graph.nodes) >= 1, f"Empty nodes list for: {latex!r}"


def assert_classification_present(graph: SemanticGraph, *, latex: str = "") -> None:
    """Classification block exists with a valid ``kind``."""
    assert graph.classification is not None, f"Missing classification for: {latex!r}"
    kind = graph.classification.kind
    assert kind in {"algebraic", "ODE", "PDE", "statements"}, (
        f"Invalid classification kind {kind!r} for: {latex!r}"
    )


def assert_pydantic_validates(graph: SemanticGraph, *, latex: str = "") -> None:
    """Graph round-trips through Pydantic model validation."""
    try:
        SemanticGraph.model_validate(graph.model_dump(by_alias=True))
    except Exception as exc:
        raise AssertionError(
            f"Pydantic validation failed for: {latex!r}\n{exc}"
        ) from exc


def assert_no_placeholder_leak(graph: SemanticGraph, *, latex: str = "") -> None:
    """No internal placeholder tokens leak into node latex/label fields."""
    for node in graph.nodes:
        for field in ("latex", "label", "id"):
            val = getattr(node, field, None) or ""
            if val and _PLACEHOLDER_RE.search(str(val)):
                raise AssertionError(
                    f"Placeholder leak in node {node.id!r}.{field}: "
                    f"{val!r} for: {latex!r}"
                )


def assert_domain_propagated(
    graph: SemanticGraph, domain: str | None, *, latex: str = "",
) -> None:
    """When a domain is set on input, the graph carries it through."""
    if domain is not None:
        assert graph.domain == domain, (
            f"Expected domain={domain!r}, got {graph.domain!r} for: {latex!r}"
        )


def assert_universal_invariants(
    graph: SemanticGraph,
    *,
    latex: str = "",
    domain: str | None = None,
) -> None:
    """Run all universal invariants. Every domain suite calls this."""
    assert_valid_graph(graph, latex=latex)
    assert_classification_present(graph, latex=latex)
    assert_pydantic_validates(graph, latex=latex)
    assert_no_placeholder_leak(graph, latex=latex)
    assert_domain_propagated(graph, domain, latex=latex)


# ── Suite-specific helpers ──────────────────────────────────────────────


def find_node(graph: SemanticGraph, **attrs: Any) -> SemanticGraphNode | None:
    """Find the first node matching all given attribute values."""
    for node in graph.nodes:
        if all(getattr(node, k, None) == v for k, v in attrs.items()):
            return node
    return None


def find_nodes(graph: SemanticGraph, **attrs: Any) -> list[SemanticGraphNode]:
    """Find all nodes matching given attribute values."""
    return [
        n for n in graph.nodes
        if all(getattr(n, k, None) == v for k, v in attrs.items())
    ]


def has_node_with(graph: SemanticGraph, **attrs: Any) -> bool:
    """Check that at least one node matches."""
    return find_node(graph, **attrs) is not None


def has_operator(graph: SemanticGraph, op: str) -> bool:
    """Check that the graph contains an operator node with the given op."""
    return has_node_with(graph, type="operator", op=op)


def has_relation(graph: SemanticGraph, op: str) -> bool:
    """Check that the graph contains a relation node with the given op."""
    return has_node_with(graph, type="relation", op=op)


def has_function(graph: SemanticGraph, op: str | None = None) -> bool:
    """Check for a function node, optionally matching a specific op."""
    if op is not None:
        return has_node_with(graph, type="function", op=op)
    return has_node_with(graph, type="function")


def operator_ops(graph: SemanticGraph) -> set[str]:
    """Return the set of all operator ``op`` values in the graph."""
    return {
        n.op for n in graph.nodes
        if n.type == "operator" and n.op
    }


def relation_ops(graph: SemanticGraph) -> set[str]:
    """Return the set of all relation ``op`` values in the graph."""
    return {
        n.op for n in graph.nodes
        if n.type == "relation" and n.op
    }


def node_types(graph: SemanticGraph) -> set[str]:
    """Return the set of all node types present."""
    return {n.type for n in graph.nodes}


def classification_kind(graph: SemanticGraph) -> str | None:
    """Return the classification kind, or None."""
    return graph.classification.kind if graph.classification else None


def classification_count(graph: SemanticGraph) -> int | None:
    """Return the classification statement count, or None."""
    return graph.classification.count if graph.classification else None


def assert_has_operator(
    graph: SemanticGraph, op: str, *, latex: str = "",
) -> None:
    """Assert the graph has an operator with the given ``op``."""
    assert has_operator(graph, op), (
        f"Expected operator op={op!r} not found in graph for: {latex!r}\n"
        f"  Found ops: {operator_ops(graph)}"
    )


def assert_has_relation(
    graph: SemanticGraph, op: str, *, latex: str = "",
) -> None:
    """Assert the graph has a relation with the given ``op``."""
    assert has_relation(graph, op), (
        f"Expected relation op={op!r} not found in graph for: {latex!r}\n"
        f"  Found relation ops: {relation_ops(graph)}"
    )


def assert_classification_kind_is(
    graph: SemanticGraph, kind: str, *, latex: str = "",
) -> None:
    """Assert the classification kind matches."""
    actual = classification_kind(graph)
    assert actual == kind, (
        f"Expected classification kind={kind!r}, got {actual!r} for: {latex!r}"
    )


def assert_node_exists(
    graph: SemanticGraph, *, latex: str = "", **attrs: Any,
) -> None:
    """Assert at least one node matches the given attributes."""
    assert has_node_with(graph, **attrs), (
        f"No node matching {attrs} found for: {latex!r}\n"
        f"  Nodes: {[{'id': n.id, 'type': n.type, 'op': n.op} for n in graph.nodes]}"
    )


def assert_operators_in(
    graph: SemanticGraph, allowed: set[str], *, latex: str = "",
) -> None:
    """Assert all operator ops are within the allowed set."""
    actual = operator_ops(graph)
    unexpected = actual - allowed
    assert not unexpected, (
        f"Unexpected operator ops {unexpected} for: {latex!r}\n"
        f"  Allowed: {allowed}"
    )
