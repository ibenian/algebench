"""Canonical structural signatures for semantic graphs.

``graph_signature`` encodes a graph's *connectivity + node kinds* as a stable,
order-independent string — a structural fingerprint that ignores presentation
and enrichment (descriptions, emoji, units, edge weights/roles, …). Two graphs
with the same signature are structurally equivalent.

Originally written for the domain test-suite invariants; lifted here so
non-test code (e.g. the prebake staleness check) can reuse the *same* notion of
structural equality instead of re-deriving its own.
"""

from __future__ import annotations

from typing import Callable

from backend.model.semantic_graph import SemanticGraph, SemanticGraphNode

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


def _node_map(graph: SemanticGraph) -> dict[str, SemanticGraphNode]:
    return {n.id: n for n in graph.nodes}


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
