"""Tests for the stable-id tree matcher (``tree_match.rebase``).

The matcher relabels a new proof state so persisting sub-expressions keep the
previous state's node ids — the cross-step identity the frontend FLIP engine
morphs on. These tests pin two things:

* **Universal invariants** that must hold for *any* matcher (structure is never
  changed by relabeling, output is deterministic, ids stay unique, a symbol is
  never re-identified as a different symbol).
* **Current stable-id behavior** on the everyday transitions (coefficient change,
  a partial change in a sum, commutative reorder, repeated subtree + one more) —
  a regression lock for the upcoming GumTree-fidelity / history-aware rewrite,
  which will *strengthen* matching on large/repeated structure without regressing
  any of these.
"""

from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.experts.modules.proof_completion.tree_match import rebase
from backend.experts.modules.proof_completion.graph_ops import canonical_equal

_svc = SemanticGraphService()


def _g(latex: str):
    g = _svc.latex_to_graph(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    return g


def _ids(graph):
    return {n.id for n in graph.nodes}


def _id_rows(graph):
    """A stable, comparable snapshot of (id, content) for determinism checks."""
    return sorted((n.id, n.type, n.op, n.label, n.value) for n in graph.nodes)


# --------------------------------------------------------------------------- #
# universal invariants
# --------------------------------------------------------------------------- #

def test_rebase_preserves_structure():
    """Relabeling must never change the graph's structure (canonical equality)."""
    for src, dst in [("2x", "3x"), ("a+b+c", "a+b+d"), ("a+b", "b+a"),
                     ("x^2 + x^2", "x^2 + x^2 + x^2"), ("c^2 + 1", "c^2 + 2")]:
        out = rebase(_g(src), _g(dst))
        assert canonical_equal(out, _g(dst)), f"{src} -> {dst} changed structure"


def test_rebase_is_deterministic():
    p, q = _g("x^2 + x^2"), _g("x^2 + x^2 + x^2")
    assert _id_rows(rebase(p, q)) == _id_rows(rebase(p, q))


def test_rebase_produces_unique_ids():
    out = rebase(_g("x^2 + x^2"), _g("x^2 + x^2 + x^2"))
    node_ids = [n.id for n in out.nodes]
    assert len(node_ids) == len(set(node_ids)), "duplicate ids in rebased graph"


def test_rebase_does_not_mutate_inputs():
    p, q = _g("a+b+c"), _g("a+b+d")
    before_p, before_q = _id_rows(p), _id_rows(q)
    rebase(p, q)
    assert _id_rows(p) == before_p, "rebase mutated prev"
    assert _id_rows(q) == before_q, "rebase mutated gnew"


def test_symbol_never_cross_matches_a_different_symbol():
    """A scalar's id IS its name; ``x`` must never be relabeled into ``y``."""
    out = rebase(_g("x + 1"), _g("y + 1"))
    assert "y" in _ids(out), "new symbol y missing"
    assert "x" not in _ids(out), "x was wrongly carried onto a different symbol"


# --------------------------------------------------------------------------- #
# current stable-id behavior (regression lock for the rewrite)
# --------------------------------------------------------------------------- #

def test_coefficient_change_keeps_operand_and_operator():
    """``2x -> 3x``: the variable and the product operator stay put."""
    p, q = _g("2x"), _g("3x")
    out = rebase(p, q)
    mul_ids = {n.id for n in p.nodes if n.op == "multiply"}
    assert "x" in _ids(out)
    assert mul_ids & _ids(out) == mul_ids, "multiply operator lost its id"


def test_partial_change_in_sum_keeps_unchanged_terms():
    """``a+b+c -> a+b+d``: ``a``, ``b`` and both ``+`` operators persist."""
    p, q = _g("a+b+c"), _g("a+b+d")
    out = rebase(p, q)
    add_ids = {n.id for n in p.nodes if n.op == "add"}
    assert {"a", "b"} <= _ids(out)
    assert add_ids <= _ids(out), "an add operator was not kept stable"
    assert "d" in _ids(out) and "c" not in _ids(out)


def test_commutative_reorder_preserves_ids():
    """``a+b -> b+a``: every id is preserved (a move, not delete+insert)."""
    p, q = _g("a+b"), _g("b+a")
    out = rebase(p, q)
    assert _ids(p) == _ids(out)


def test_persisting_subexpression_keeps_id():
    """The unchanged ``c^2`` keeps its power node and operand across the step."""
    p, q = _g("c^2 + 1"), _g("c^2 + 2")
    out = rebase(p, q)
    pow_ids = {n.id for n in p.nodes if n.op in ("power", "pow")} or \
        {n.id for n in p.nodes if n.exponent is not None}
    assert "c" in _ids(out)
    assert pow_ids <= _ids(out), "the c^2 power subtree lost its id"


def test_repeated_subtree_existing_kept_and_new_is_fresh():
    """``x^2+x^2 -> +x^2``: both existing power subtrees stay; the third is new
    with a collision-free id (no clobbering of an existing id)."""
    p, q = _g("x^2 + x^2"), _g("x^2 + x^2 + x^2")
    out = rebase(p, q)
    # every prev id that still has a counterpart is preserved
    assert _ids(p) <= _ids(out), "an existing subtree id was dropped"
    # exactly one more power node than before, and ids remain unique
    pow_before = sum(1 for n in p.nodes if n.exponent is not None)
    pow_after = sum(1 for n in out.nodes if n.exponent is not None)
    assert pow_after == pow_before + 1
    assert len({n.id for n in out.nodes}) == len(out.nodes)
