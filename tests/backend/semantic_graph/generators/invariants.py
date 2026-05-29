"""Universal and suite-specific invariant assertions for semantic graph tests.

Every domain suite calls ``assert_universal_invariants`` on every expression.
Suite-specific invariants are composed from the helpers in this module to build
domain-tailored assertion functions.

All helpers accept ``SemanticGraph`` (Pydantic model) — the parser's return type
since the #309 refactor.
"""

from __future__ import annotations

import re
from typing import Any, Callable

import pytest

from backend.model.semantic_graph import (
    SemanticGraph,
    SemanticGraphNode,
)


# ── Expression tags ──────────────────────────────────────────────────

PASS = None
XFAIL = pytest.mark.xfail(strict=True, reason="Known parser limitation")
XFAIL_LENIENT = pytest.mark.xfail(strict=False, reason="Partial parser limitation")
SKIP = pytest.mark.skip(reason="Feature not yet implemented")


_PLACEHOLDER_RE = re.compile(r"(?:Theta|Xi|Phi)_\{\d*\}")


def assert_valid_graph(graph: SemanticGraph, *, latex: str = "") -> None:
    """Graph is non-null, structurally sound, and acyclic."""
    assert graph is not None, f"Parser returned None for: {latex!r}"
    assert len(graph.nodes) >= 1, f"Empty nodes list for: {latex!r}"

    node_ids = {n.id for n in graph.nodes}
    assert len(node_ids) == len(graph.nodes), (
        f"Duplicate node IDs for: {latex!r}"
    )

    for e in graph.edges:
        assert e.from_ in node_ids, (
            f"Dangling edge from={e.from_!r} not in nodes for: {latex!r}"
        )
        assert e.to in node_ids, (
            f"Dangling edge to={e.to!r} not in nodes for: {latex!r}"
        )

    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for e in graph.edges:
        adj[e.from_].append(e.to)

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in node_ids}

    def _has_cycle(nid: str) -> bool:
        color[nid] = GRAY
        for neighbor in adj[nid]:
            if color[neighbor] == GRAY:
                return True
            if color[neighbor] == WHITE and _has_cycle(neighbor):
                return True
        color[nid] = BLACK
        return False

    for nid in node_ids:
        if color[nid] == WHITE:
            assert not _has_cycle(nid), f"Cycle detected in graph for: {latex!r}"


def assert_classification_present(graph: SemanticGraph, *, latex: str = "") -> None:
    """Classification block exists with a valid ``kind``."""
    assert graph.classification is not None, f"Missing classification for: {latex!r}"
    kind = graph.classification.kind
    assert kind in {"algebraic", "ODE", "PDE", "statements", "piecewise"}, (
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
    """Assert all operator and relation ops are within the allowed set."""
    actual = operator_ops(graph) | relation_ops(graph)
    unexpected = actual - allowed
    assert not unexpected, (
        f"Unexpected operator/relation ops {unexpected} for: {latex!r}\n"
        f"  Allowed: {allowed}"
    )


def assert_node_properties(
    graph: SemanticGraph,
    checks: list[dict[str, Any]] | None,
    *,
    latex: str = "",
) -> None:
    """Assert that nodes matching the given attribute sets exist.

    Each dict in ``checks`` specifies a set of attribute values that must
    all be present on at least one node.  This lets test catalogs verify
    fine-grained node properties — e.g. ``{"op": "power", "exponent": "2"}``
    — beyond what connectivity signatures capture.

    Edge-role assertions: if ``checks`` contains an ``_edge_roles`` key,
    its value must be a dict mapping ``role → count`` (e.g.
    ``{"exp": 1}``).  The assertion verifies that the matched node has
    exactly that many inbound edges with each role.
    """
    if not checks:
        return
    for raw_attrs in checks:
        edge_roles = raw_attrs.get("_edge_roles")
        attrs = {k: v for k, v in raw_attrs.items() if k != "_edge_roles"}
        if not has_node_with(graph, **attrs):
            # Show the checked fields on every node for easy debugging
            check_fields = set(attrs.keys())
            relevant = []
            for n in graph.nodes:
                d = {k: getattr(n, k, None)
                     for k in check_fields | {"id", "type", "op"}}
                relevant.append({k: v for k, v in d.items() if v is not None})
            raise AssertionError(
                f"No node matching {attrs} found for: {latex!r}\n"
                f"  Nodes: {relevant}"
            )
        if edge_roles:
            # Find the matched node(s) and verify edge roles
            matched = [n for n in graph.nodes
                       if all(getattr(n, k, None) == v
                              for k, v in attrs.items())]
            for node in matched:
                inbound = [e for e in graph.edges if e.to == node.id]
                for role, expected_count in edge_roles.items():
                    actual_count = sum(1 for e in inbound if e.role == role)
                    assert actual_count == expected_count, (
                        f"Node {node.id} (op={node.op}): expected "
                        f"{expected_count} inbound edge(s) with "
                        f"role={role!r}, got {actual_count} "
                        f"for: {latex!r}"
                    )


# ── Connectivity helpers ──────────────────────────────────────────────


def _node_map(graph: SemanticGraph) -> dict[str, SemanticGraphNode]:
    return {n.id: n for n in graph.nodes}


def children_of(graph: SemanticGraph, node_id: str) -> list[SemanticGraphNode]:
    """Return nodes that have an edge *to* the given node (i.e. its inputs)."""
    nmap = _node_map(graph)
    return [nmap[e.from_] for e in graph.edges if e.to == node_id and e.from_ in nmap]


def parent_of(graph: SemanticGraph, node_id: str) -> SemanticGraphNode | None:
    """Return the node that the given node feeds *into* (first match)."""
    nmap = _node_map(graph)
    for e in graph.edges:
        if e.from_ == node_id and e.to in nmap:
            return nmap[e.to]
    return None


def children_of_op(graph: SemanticGraph, op: str) -> list[SemanticGraphNode]:
    """Return input nodes of the first node with the given ``op``."""
    node = find_node(graph, op=op)
    if node is None:
        return []
    return children_of(graph, node.id)


def child_ids_of_op(graph: SemanticGraph, op: str) -> set[str]:
    """Return IDs of input nodes of the first operator with the given ``op``."""
    return {n.id for n in children_of_op(graph, op)}


def child_ops_of_op(graph: SemanticGraph, op: str) -> set[str | None]:
    """Return ``op`` values of input nodes feeding into the given operator."""
    return {n.op for n in children_of_op(graph, op)}


def assert_op_has_child(
    graph: SemanticGraph, parent_op: str, child_id: str, *, latex: str = "",
) -> None:
    """Assert that a node with ``child_id`` feeds into the operator ``parent_op``."""
    ids = child_ids_of_op(graph, parent_op)
    assert child_id in ids, (
        f"Expected {child_id!r} as child of op={parent_op!r}, "
        f"got children {ids} for: {latex!r}"
    )


def assert_op_has_child_op(
    graph: SemanticGraph, parent_op: str, child_op: str, *, latex: str = "",
) -> None:
    """Assert that an operator with ``child_op`` feeds into ``parent_op``."""
    ops = child_ops_of_op(graph, parent_op)
    assert child_op in ops, (
        f"Expected child op={child_op!r} under op={parent_op!r}, "
        f"got child ops {ops} for: {latex!r}"
    )


def assert_var_feeds_into(
    graph: SemanticGraph, var_id: str, target_op: str, *, latex: str = "",
) -> None:
    """Assert that variable ``var_id`` eventually reaches operator ``target_op``."""
    nmap = _node_map(graph)
    visited: set[str] = set()
    queue = [var_id]
    while queue:
        nid = queue.pop(0)
        if nid in visited:
            continue
        visited.add(nid)
        for e in graph.edges:
            if e.from_ == nid and e.to in nmap:
                target = nmap[e.to]
                if target.op == target_op:
                    return
                queue.append(e.to)
    raise AssertionError(
        f"Variable {var_id!r} does not reach op={target_op!r} for: {latex!r}"
    )


# ── Graph signature ──────────────────────────────────────────────────


NodeLabeler = Callable[[SemanticGraphNode], str]

_TYPE_PREFIX: dict[str, str] = {
    "function":   "fn",
    "relation":   "rel",
    "vector":     "vec",
    "constant":   "const",
    "ket":        "ket",
    "bra":        "bra",
    "braket":     "braket",
    "text":       "text",
    "annotation": "ann",
}


def label_by_type(node: SemanticGraphNode) -> str:
    """Type-aware label: ``fn:sin``, ``vec:a``, ``add``, ``num``."""
    prefix = _TYPE_PREFIX.get(node.type, "")
    if node.op:
        return f"{prefix}:{node.op}" if prefix else node.op
    if node.type == "number":
        return "num"
    if node.type == "expression":
        return "expr"
    return f"{prefix}:{node.id}" if prefix else node.id


def label_by_id(node: SemanticGraphNode) -> str:
    """Raw node id."""
    return node.id


def label_by_op(node: SemanticGraphNode) -> str:
    """Bare ``op`` when present, else node id."""
    return node.op if node.op else node.id


def graph_signature(
    graph: SemanticGraph,
    labeler: NodeLabeler | None = None,
) -> str:
    """Deterministic string encoding of graph connectivity.

    ``labeler`` controls how each node is rendered in the output string.
    Defaults to ``label_by_type``.

    Format: ``"child1,child2 -> parent; ..."`` with groups sorted by
    (topological depth, parent label, sorted child labels).  The sort key
    is purely content-based — no dependency on node/edge iteration order —
    so the output is stable across parser refactors that preserve structure.
    """
    label = labeler or label_by_type
    nmap = _node_map(graph)

    parent_children: dict[str, list[str]] = {}
    for e in graph.edges:
        if e.to in nmap and e.from_ in nmap:
            parent_children.setdefault(e.to, []).append(e.from_)

    if not parent_children:
        return ""

    depths: dict[str, int] = {}
    visiting: set[str] = set()

    def _depth(nid: str) -> int:
        if nid in depths:
            return depths[nid]
        if nid in visiting:
            raise ValueError(
                f"Cycle detected at node {nid!r} — "
                "graph_signature requires an acyclic graph"
            )
        visiting.add(nid)
        children = parent_children.get(nid, [])
        depths[nid] = (max(_depth(c) for c in children) + 1) if children else 0
        visiting.discard(nid)
        return depths[nid]

    for nid in nmap:
        _depth(nid)

    groups: list[tuple[int, str, list[str]]] = []
    for pid, children in parent_children.items():
        plabel = label(nmap[pid])
        clabels = sorted(label(nmap[c]) for c in children)
        groups.append((depths[pid], plabel, clabels))

    groups.sort(key=lambda g: (g[0], g[1], g[2]))
    return "; ".join(
        ",".join(clabels) + " -> " + plabel
        for _, plabel, clabels in groups
    )


def assert_signature(
    graph: SemanticGraph,
    expected: str,
    *,
    labeler: NodeLabeler | None = None,
    latex: str = "",
) -> None:
    """Assert that the graph's connectivity signature matches ``expected``."""
    actual = graph_signature(graph, labeler=labeler)
    assert actual == expected, (
        f"Signature mismatch for: {latex!r}\n"
        f"  expected: {expected}\n"
        f"  actual:   {actual}"
    )
