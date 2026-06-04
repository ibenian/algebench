"""Pure semantic-graph edit engine — the shared truth for dataset gen + metric.

No DSPy, no I/O. Three capabilities:

* :func:`apply` — fold a trajectory of ops onto a graph (raises on illegal ops).
* :func:`diff` — minimal structural delta between two graphs (gold trajectory).
* :func:`canonical_equal` / :func:`canonical_key` — id-name-invariant structural
  comparison (the match criterion).

**Canonicalization.** Node ids are only meaningful for symbol leaves
(``scalar`` / ``vector`` / ``constant``) — there the id *is* the variable name.
Operators, functions, numbers, etc. have synthetic (``__add_3``) ids that carry
no meaning; their identity is their content (``op`` / ``label`` / ``latex``) plus
their position in the graph. We compare graphs with Weisfeiler-Lehman color
refinement over (content + edge roles/semantics), so arbitrary synthetic id
naming never affects equality, while variable names still distinguish nodes.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Iterable

from backend.model.semantic_graph import SemanticGraph, SemanticGraphEdge

from ..outputs import AddEdge, AddNode, GraphOpError, RemoveEdge, RemoveNode

# Node types whose id is the symbol name (semantically meaningful).
_ID_MEANINGFUL_TYPES = frozenset({"scalar", "vector", "constant"})


# --------------------------------------------------------------------------- #
# apply (polymorphic — each op knows how to apply itself)
# --------------------------------------------------------------------------- #

def apply(graph: SemanticGraph, ops: Iterable) -> SemanticGraph:
    """Return a new graph with ``ops`` applied in order. Raise on illegal ops."""
    g = graph.model_copy(deep=True)
    node_ids = {n.id for n in g.nodes}
    for op in ops:
        op.apply_to(g, node_ids)
    return g


# --------------------------------------------------------------------------- #
# canonicalization (Weisfeiler-Lehman color refinement)
# --------------------------------------------------------------------------- #

def _h(value) -> str:
    return hashlib.sha1(repr(value).encode("utf-8")).hexdigest()[:16]


def _sort_key(t: tuple) -> tuple:
    """Sort tuples that may contain ``None`` mixed with strings."""
    return tuple("" if v is None else str(v) for v in t)


def _content(node: SemanticGraphNode) -> tuple:
    canon_id = node.id if node.type in _ID_MEANINGFUL_TYPES else None
    val = None if node.value is None else str(node.value)
    # Include the parser's literal structural attributes (exponent, derivative
    # variable, bounds, …): they carry meaning the edges don't, so omitting them
    # would make x^2 and x^3 — or d/dx and d/dy — compare equal.
    return (
        canon_id, node.type, node.op, node.label, node.latex, val, node.role,
        node.exponent, node.with_respect_to, node.lower_bound, node.upper_bound,
        node.modulus, node.limit_point, node.limit_direction,
    )


def wl_colors(graph: SemanticGraph, rounds: int | None = None) -> dict[str, str]:
    """Stable per-node colors invariant to synthetic id naming.

    ``rounds=None`` refines to a fixpoint (full structural identity — used for
    equality). A small ``rounds`` (e.g. 1) gives a shallower signature that
    keeps shared leaves matchable across edits — used by :func:`diff` so gold
    trajectories stay small.
    """
    nodes = {n.id: n for n in graph.nodes}
    out_e: dict[str, list] = defaultdict(list)
    in_e: dict[str, list] = defaultdict(list)
    for e in graph.edges:
        out_e[e.from_].append((e.role, e.semantic, e.to))
        in_e[e.to].append((e.role, e.semantic, e.from_))

    color = {nid: _h(_content(n)) for nid, n in nodes.items()}
    n_rounds = max(1, len(nodes)) if rounds is None else rounds
    for _ in range(n_rounds):
        new = {}
        for nid in nodes:
            outs = sorted(
                ((r, s, color.get(t, "?")) for (r, s, t) in out_e[nid]),
                key=_sort_key,
            )
            ins = sorted(
                ((r, s, color.get(f, "?")) for (r, s, f) in in_e[nid]),
                key=_sort_key,
            )
            new[nid] = _h((color[nid], ("o", outs), ("i", ins)))
        if new == color:
            break
        color = new
    return color


def canonical_key(graph: SemanticGraph):
    """A hashable signature; equal iff two graphs are structurally identical."""
    color = wl_colors(graph)
    node_sig = tuple(sorted(color.values()))
    edge_sig = tuple(
        sorted(
            (
                (e.role, e.semantic, color.get(e.from_, "?"), color.get(e.to, "?"))
                for e in graph.edges
            ),
            key=_sort_key,
        )
    )
    return (node_sig, edge_sig)


def canonical_equal(a: SemanticGraph, b: SemanticGraph) -> bool:
    return canonical_key(a) == canonical_key(b)


# --------------------------------------------------------------------------- #
# diff (gold trajectory between two graphs)
# --------------------------------------------------------------------------- #

def _gold(cls, explanation: str, **kw):
    """Construct a typed gold op (prose is generic — gold scores op identity)."""
    return cls(explanation=explanation,
               justification="structural derivation step", **kw)


def diff(a: SemanticGraph, b: SemanticGraph) -> list:
    """A valid, reasonably-minimal op sequence with ``apply(a, diff(a,b)) ≅ b``.

    Nodes are matched across graphs by Weisfeiler-Lehman color (so equal
    subgraphs are preserved); unmatched nodes/edges in ``a`` are removed and
    those in ``b`` are added. Resulting ids: matched nodes keep ``a``'s ids,
    added nodes keep ``b``'s ids — canonically equal to ``b``.

    Matching uses a shallow (1-round) coloring so shared leaves/subexpressions
    persist across an edit, keeping the trajectory small; correctness
    (``apply(a, diff(a,b)) ≅ b``) holds regardless of match quality.
    """
    ca = wl_colors(a, rounds=0)
    cb = wl_colors(b, rounds=0)

    a_by_color: dict[str, list[str]] = defaultdict(list)
    for nid, col in sorted(ca.items()):
        a_by_color[col].append(nid)
    b_by_color: dict[str, list[str]] = defaultdict(list)
    for nid, col in sorted(cb.items()):
        b_by_color[col].append(nid)

    # Pair nodes of equal color. bmap: b_id -> a_id ; amap: a_id -> b_id.
    bmap: dict[str, str] = {}
    amap: dict[str, str] = {}
    for col, a_ids in a_by_color.items():
        b_ids = b_by_color.get(col, [])
        for a_id, b_id in zip(a_ids, b_ids):
            bmap[b_id] = a_id
            amap[a_id] = b_id

    a_unmatched = [nid for nid in ca if nid not in amap]
    b_unmatched = [nid for nid in cb if nid not in bmap]

    b_nodes = {n.id: n for n in b.nodes}
    b_edge_set = {(e.from_, e.to, e.role, e.semantic) for e in b.edges}

    # Final id of a b-node in the applied (a-id-space) graph.
    surviving = set(amap.keys())  # matched a ids that remain
    addmap: dict[str, str] = {}
    for b_id in b_unmatched:
        final = b_id
        while final in surviving or final in addmap.values():
            final = final + "_"
        addmap[b_id] = final

    def b_to_final(b_id: str) -> str:
        return bmap.get(b_id) or addmap[b_id]

    # Which a-edges are preserved (a corresponding b-edge exists)?
    preserved_b_edges: set[tuple] = set()
    remove_edge_ops: list = []
    for e in a.edges:
        bf, bt = amap.get(e.from_), amap.get(e.to)
        match = None
        if bf is not None and bt is not None:
            cand = (bf, bt, e.role, e.semantic)
            if cand in b_edge_set:
                match = cand
        if match is not None:
            preserved_b_edges.add(match)
        else:
            remove_edge_ops.append(
                _gold(RemoveEdge, "remove edge",
                      edge_from=e.from_, edge_to=e.to, edge_role=e.role)
            )

    ops: list = []
    # 1. remove non-preserved edges, 2. remove unmatched nodes
    ops.extend(remove_edge_ops)
    for a_id in a_unmatched:
        ops.append(_gold(RemoveNode, "remove node", node_id=a_id))
    # 3. add unmatched nodes (with collision-safe final ids)
    for b_id in b_unmatched:
        src = b_nodes[b_id]
        node = src.model_copy(deep=True, update={"id": addmap[b_id]})
        ops.append(_gold(AddNode, "add node", node=node))
    # 4. add b-edges that were not preserved
    for e in b.edges:
        if (e.from_, e.to, e.role, e.semantic) in preserved_b_edges:
            continue
        new_edge = SemanticGraphEdge(
            **{
                "from": b_to_final(e.from_),
                "to": b_to_final(e.to),
                "role": e.role,
                "semantic": e.semantic,
                "label": e.label,
                "weight": e.weight,
            }
        )
        ops.append(_gold(AddEdge, "add edge", edge=new_edge))

    return ops
