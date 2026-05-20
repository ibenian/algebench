"""Universal and suite-specific invariant assertions for semantic graph tests.

Every domain suite calls ``assert_universal_invariants`` on every expression.
Suite-specific invariants are composed from the helpers in this module to build
domain-tailored assertion functions.
"""

from __future__ import annotations

import re
from typing import Any

from backend.model.semantic_graph import SemanticGraph


_PLACEHOLDER_RE = re.compile(r"(?:Theta|Xi|Phi)_\{\d*\}")


def assert_valid_graph(graph: dict[str, Any], *, latex: str = "") -> None:
    """Graph is non-null with at least one node and an edges list."""
    assert graph is not None, f"Parser returned None for: {latex!r}"
    assert "nodes" in graph, f"Missing 'nodes' key for: {latex!r}"
    assert "edges" in graph, f"Missing 'edges' key for: {latex!r}"
    assert len(graph["nodes"]) >= 1, f"Empty nodes list for: {latex!r}"


def assert_classification_present(graph: dict[str, Any], *, latex: str = "") -> None:
    """Classification block exists with a valid ``kind``."""
    assert "classification" in graph, f"Missing classification for: {latex!r}"
    kind = graph["classification"].get("kind")
    assert kind in {"algebraic", "ODE", "PDE", "statements"}, (
        f"Invalid classification kind {kind!r} for: {latex!r}"
    )


def assert_pydantic_validates(graph: dict[str, Any], *, latex: str = "") -> None:
    """Graph passes Pydantic model validation."""
    try:
        SemanticGraph.model_validate(graph)
    except Exception as exc:
        raise AssertionError(
            f"Pydantic validation failed for: {latex!r}\n{exc}"
        ) from exc


def assert_no_placeholder_leak(graph: dict[str, Any], *, latex: str = "") -> None:
    """No internal placeholder tokens leak into node latex/label fields."""
    for node in graph["nodes"]:
        for field in ("latex", "label", "id"):
            val = node.get(field, "")
            if val and _PLACEHOLDER_RE.search(str(val)):
                raise AssertionError(
                    f"Placeholder leak in node {node.get('id')!r}.{field}: "
                    f"{val!r} for: {latex!r}"
                )


def assert_domain_propagated(
    graph: dict[str, Any], domain: str | None, *, latex: str = "",
) -> None:
    """When a domain is set on input, the graph carries it through."""
    if domain is not None:
        assert graph.get("domain") == domain, (
            f"Expected domain={domain!r}, got {graph.get('domain')!r} for: {latex!r}"
        )


def assert_universal_invariants(
    graph: dict[str, Any],
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


def find_node(graph: dict[str, Any], **attrs: Any) -> dict[str, Any] | None:
    """Find the first node matching all given attribute values."""
    for node in graph["nodes"]:
        if all(node.get(k) == v for k, v in attrs.items()):
            return node
    return None


def find_nodes(graph: dict[str, Any], **attrs: Any) -> list[dict[str, Any]]:
    """Find all nodes matching given attribute values."""
    return [
        n for n in graph["nodes"]
        if all(n.get(k) == v for k, v in attrs.items())
    ]


def has_node_with(graph: dict[str, Any], **attrs: Any) -> bool:
    """Check that at least one node matches."""
    return find_node(graph, **attrs) is not None


def has_operator(graph: dict[str, Any], op: str) -> bool:
    """Check that the graph contains an operator node with the given op."""
    return has_node_with(graph, type="operator", op=op)


def has_relation(graph: dict[str, Any], op: str) -> bool:
    """Check that the graph contains a relation node with the given op."""
    return has_node_with(graph, type="relation", op=op)


def has_function(graph: dict[str, Any], op: str | None = None) -> bool:
    """Check for a function node, optionally matching a specific op."""
    if op is not None:
        return has_node_with(graph, type="function", op=op)
    return has_node_with(graph, type="function")


def operator_ops(graph: dict[str, Any]) -> set[str]:
    """Return the set of all operator ``op`` values in the graph."""
    return {
        n["op"] for n in graph["nodes"]
        if n.get("type") == "operator" and n.get("op")
    }


def relation_ops(graph: dict[str, Any]) -> set[str]:
    """Return the set of all relation ``op`` values in the graph."""
    return {
        n["op"] for n in graph["nodes"]
        if n.get("type") == "relation" and n.get("op")
    }


def node_types(graph: dict[str, Any]) -> set[str]:
    """Return the set of all node types present."""
    return {n["type"] for n in graph["nodes"]}


def classification_kind(graph: dict[str, Any]) -> str | None:
    """Return the classification kind, or None."""
    c = graph.get("classification")
    return c.get("kind") if c else None


def classification_count(graph: dict[str, Any]) -> int | None:
    """Return the classification statement count, or None."""
    c = graph.get("classification")
    return c.get("count") if c else None


def assert_has_operator(
    graph: dict[str, Any], op: str, *, latex: str = "",
) -> None:
    """Assert the graph has an operator with the given ``op``."""
    assert has_operator(graph, op), (
        f"Expected operator op={op!r} not found in graph for: {latex!r}\n"
        f"  Found ops: {operator_ops(graph)}"
    )


def assert_has_relation(
    graph: dict[str, Any], op: str, *, latex: str = "",
) -> None:
    """Assert the graph has a relation with the given ``op``."""
    assert has_relation(graph, op), (
        f"Expected relation op={op!r} not found in graph for: {latex!r}\n"
        f"  Found relation ops: {relation_ops(graph)}"
    )


def assert_classification_kind_is(
    graph: dict[str, Any], kind: str, *, latex: str = "",
) -> None:
    """Assert the classification kind matches."""
    actual = classification_kind(graph)
    assert actual == kind, (
        f"Expected classification kind={kind!r}, got {actual!r} for: {latex!r}"
    )


def assert_node_exists(
    graph: dict[str, Any], *, latex: str = "", **attrs: Any,
) -> None:
    """Assert at least one node matches the given attributes."""
    assert has_node_with(graph, **attrs), (
        f"No node matching {attrs} found for: {latex!r}\n"
        f"  Nodes: {[{k: n.get(k) for k in ('id', 'type', 'op')} for n in graph['nodes']]}"
    )


def assert_operators_in(
    graph: dict[str, Any], allowed: set[str], *, latex: str = "",
) -> None:
    """Assert all operator ops are within the allowed set."""
    actual = operator_ops(graph)
    unexpected = actual - allowed
    assert not unexpected, (
        f"Unexpected operator ops {unexpected} for: {latex!r}\n"
        f"  Allowed: {allowed}"
    )
