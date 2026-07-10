"""Tests for the stable-id tree matcher (``tree_match.rebase``).

The matcher relabels a new proof state so persisting sub-expressions keep the
previous state's node ids — the cross-step identity the frontend FLIP engine
morphs on. These tests pin two things:

* **Universal invariants** that must hold for *any* matcher (structure is never
  changed by relabeling, output is deterministic, ids stay unique, a symbol is
  never re-identified as a different symbol).
* **Stable-id behavior** on the everyday transitions (coefficient change, a
  partial change in a sum, commutative reorder, repeated subtree + one more) and
  the GumTree-fidelity capabilities implemented here — bottom-up Dice container
  matching, local recovery, and history-aware id revival.
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


# --------------------------------------------------------------------------- #
# connective-branch isolation (a ∨ b / a ∧ b morph independently)
# --------------------------------------------------------------------------- #

def test_disjunction_branches_do_not_steal_vanishing_terms():
    """The quadratic step 6→7 fly: a single equation splits into two symmetric
    roots joined by ``∨``. A term that vanishes on one side (the factored-away
    ``4a²``) must NOT be re-used on the OTHER branch — its prev id may thread into
    the FIRST solution but never the second, so the two roots morph separately."""
    from backend.experts.modules.proof_completion.tree_match import _index
    prev = _g(r"\left(x + \frac{b}{2 \cdot a}\right)^{2} = "
              r"\frac{b^{2} - 4 \cdot a \cdot c}{4 \cdot a^{2}}")
    new = _g(r"x = - \frac{b}{2 \cdot a} + \frac{\sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}"
             r" \lor "
             r"x = - \frac{b}{2 \cdot a} - \frac{\sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}")
    out = rebase(prev, new)
    prev_ids = {n.id for n in prev.nodes}
    branch = _index(out).branch
    second = [nid for nid, b in branch.items() if b == 1]
    assert second, "expected a tagged second disjunct"
    leaked = [nid for nid in second if nid in prev_ids]
    assert not leaked, f"prev ids leaked into the second disjunct (fly): {leaked}"


def test_disjunction_to_disjunction_keeps_each_branch_in_its_lane():
    """Rebasing one ``∨`` onto another (quadratic step 7→8) anchors the disjunction
    top-down, so ``_match_tree`` recurses through both branches. No node exclusive
    to one branch may inherit an id from the OTHER branch of the prior state — the
    two roots stay in their own lanes even under isomorphic anchoring."""
    from backend.experts.modules.proof_completion.tree_match import _index
    prev = _g(r"x = - \frac{b}{2 \cdot a} + \frac{\sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}"
              r" \lor "
              r"x = - \frac{b}{2 \cdot a} - \frac{\sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}")
    new = _g(r"x = \frac{- b + \sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}"
             r" \lor "
             r"x = \frac{- b - \sqrt{b^{2} - 4 \cdot a \cdot c}}{2 \cdot a}")
    pb = _index(prev).branch
    prev_b0 = {nid for nid, b in pb.items() if b == 0}
    prev_b1 = {nid for nid, b in pb.items() if b == 1}
    ob = _index(rebase(prev, new)).branch
    for nid, b in ob.items():
        if b == 1:
            assert nid not in prev_b0, f"branch-1 node inherited a prev branch-0 id: {nid}"
        if b == 0:
            assert nid not in prev_b1, f"branch-0 node inherited a prev branch-1 id: {nid}"


def test_non_connective_states_are_unaffected_by_branch_gate():
    """The branch gate is a no-op without a single connective: an ordinary rewrite
    still preserves ids (guards against the gate over-firing)."""
    out = rebase(_g("a + b + c"), _g("a + b + d"))
    assert {"a", "b"} <= _ids(out), "branch gate wrongly blocked a plain rewrite"


# --------------------------------------------------------------------------- #
# GumTree-rewrite capabilities (bottom-up Dice, recovery, history registry)
# --------------------------------------------------------------------------- #

def _children_of(graph, nid):
    return {e.from_ for e in graph.edges if e.to == nid}


def _add_with_child(graph, child_id):
    """Id of the ``add`` node that has ``child_id`` as a direct operand."""
    for n in graph.nodes:
        if n.op == "add" and child_id in _children_of(graph, n.id):
            return n.id
    return None


def test_thresholds_are_gumtree_defaults():
    from backend.experts.modules.proof_completion import tree_match as TM
    assert (TM.MIN_HEIGHT, TM.MIN_DICE, TM.MAX_SIZE) == (2, 0.5, 100)


def test_registry_none_is_pure_pairwise():
    """Without a registry the call still works (no revival, just pairwise)."""
    out = rebase(_g("x + 1"), _g("x + 2"))
    assert canonical_equal(out, _g("x + 2"))
    assert "x" in _ids(out)


def test_nested_sum_partial_change_keeps_unchanged_terms():
    """``a+b+c+d -> a+b+c+e``: bottom-up keeps the inner ``+`` operators and the
    unchanged terms; only the last term changes."""
    p, q = _g("a+b+c+d"), _g("a+b+c+e")
    out = rebase(p, q)
    assert {"a", "b", "c"} <= _ids(out)
    assert "e" in _ids(out) and "d" not in _ids(out)
    add_ids = {n.id for n in p.nodes if n.op == "add"}
    # the surviving add operators (all but possibly the changed root) keep ids
    assert len(add_ids & _ids(out)) >= len(add_ids) - 1


def test_ambiguous_container_match_does_not_teleport():
    """``(a·b)^2 -> a^2·b^2``: the old power-over-product is *equally* similar to
    ``a^2`` and ``b^2`` (a Dice tie), so it must NOT arbitrarily morph into one of
    them — that would teleport the exponent to an irrelevant spot. The old power
    ids fade; structure is still preserved."""
    p, q = _g(r"(a b)^2"), _g(r"a^2 b^2")
    out = rebase(p, q)
    old_pow = {n.id for n in p.nodes if (n.op or n.type) == "power"}
    assert not (old_pow & _ids(out)), "ambiguous power-split must not reuse/teleport an old power id"
    assert canonical_equal(out, _g(r"a^2 b^2"))
    assert {"a", "b"} <= _ids(out)            # the atoms still morph


def test_unique_best_container_still_morphs():
    """A *unique* best candidate still matches: ``√x -> √(x+y)`` resizes (the
    radical morphs), unlike the ambiguous tie above."""
    p, q = _g(r"\sqrt{x}"), _g(r"\sqrt{x + y}")
    out = rebase(p, q)
    assert {n.id for n in p.nodes if (n.op or n.type) == "power"} & _ids(out), \
        "the radical should keep its id (unique best, not a tie)"


def test_unmatched_node_never_reuses_a_faded_prev_id():
    """An unmatched new node must not coincidentally inherit a *faded* prev node's
    synthetic id (the frontend would treat the shared data-n as a false morph)."""
    p, q = _g(r"(a b)^2"), _g(r"a^2 b^2")
    out = rebase(p, q)
    # the new power ids must be disjoint from the (faded) old power ids
    old_pow = {n.id for n in p.nodes if (n.op or n.type) == "power"}
    new_pow = {n.id for n in out.nodes if (n.op or n.type) == "power"}
    assert not (old_pow & new_pow)


def test_history_revives_vanished_then_returning_subexpression():
    """A composite subtree that disappears for a step and reappears regains its
    original id through the shared registry (global, not just chain, consistency)."""
    reg: dict = {}
    g0 = rebase(_g("(x+1) + y"), _g("(x+1) + y"), reg)   # state 0 (registers)
    inner0 = _add_with_child(g0, "x")                     # id of the (x+1) node
    g1 = rebase(g0, _g("z + y"), reg)                     # (x+1) gone
    g2 = rebase(g1, _g("(x+1) + y"), reg)                 # (x+1) back
    inner2 = _add_with_child(g2, "x")
    assert inner0 is not None and inner2 == inner0, "vanished subtree didn't revive its id"


def test_history_makes_nonadjacent_states_share_ids():
    """With the registry, a sub-expression present in state 0 and state 2 (absent
    in state 1) carries the SAME id in both — so a jump 0->2 morphs it."""
    reg: dict = {}
    g0 = rebase(_g("a \\cdot (p+q)"), _g("a \\cdot (p+q)"), reg)
    add0 = _add_with_child(g0, "p")
    g1 = rebase(g0, _g("a \\cdot r"), reg)                # (p+q) collapsed away
    g2 = rebase(g1, _g("a \\cdot (p+q)"), reg)            # reappears
    add2 = _add_with_child(g2, "p")
    assert add0 is not None and add0 == add2


# --------------------------------------------------------------------------- #
# complex render constructs (Allen-Eggers shapes): fractions / division bars,
# square roots of different sizes, nested big+small parentheses, integrals.
#
# Parens, fraction bars and radicals are NOT graph nodes — they're how the
# renderer DRAWS structure: a fraction is multiply(num, power(denom, -1)) (the
# bar is just how a multiply-by-reciprocal is drawn), a square root is a power
# node (radicand^½), and parentheses are emitted purely from operator
# precedence. The matcher matches those underlying multiply/power nodes; the
# glyph follows. The integral sign, by contrast, IS a real node (an `integral`
# operator) and is matched directly. The tests assert the matcher keeps the
# stable ids that let all of these morph instead of delete+insert.
# --------------------------------------------------------------------------- #

def _ops(graph, op):
    """Ids of nodes whose op (or type) is ``op``."""
    return {n.id for n in graph.nodes if (n.op or n.type) == op}


def test_fraction_denominator_change_keeps_numerator_and_bar():
    """``(a+b)/c -> (a+b)/d``: the numerator subtree and the fraction bar
    (multiply node) stay; only the denominator changes."""
    p, q = _g(r"\frac{a+b}{c}"), _g(r"\frac{a+b}{d}")
    out = rebase(p, q)
    assert canonical_equal(out, _g(r"\frac{a+b}{d}"))
    assert {"a", "b"} <= _ids(out)
    assert _ops(p, "add") & _ids(out), "numerator (a+b) lost its id"
    assert _ops(p, "multiply") & _ids(out), "fraction bar (multiply) lost its id"
    assert "d" in _ids(out) and "c" not in _ids(out)


def test_square_root_of_different_sizes_keeps_radical():
    """A small radical that grows into a big one (``√x -> √(x+y)``) keeps the
    radical (power) node and the surviving radicand — so the √ glyph morphs
    (resizes) rather than being deleted and a new one inserted."""
    p, q = _g(r"\sqrt{x}"), _g(r"\sqrt{x + y}")
    out = rebase(p, q)
    assert canonical_equal(out, _g(r"\sqrt{x + y}"))
    assert "x" in _ids(out)
    assert _ops(p, "power") & _ids(out), "radical (power) node lost its id when it grew"


def test_sqrt_of_fraction_keeps_numerator_on_denominator_change():
    """An Allen-Eggers shape — ``√(p²/(2β)) -> √(p²/(2α))`` — keeps the radical,
    the bar and the numerator p² stable while the denominator symbol changes."""
    p, q = _g(r"\sqrt{\frac{p^2}{2\beta}}"), _g(r"\sqrt{\frac{p^2}{2\alpha}}")
    out = rebase(p, q)
    assert canonical_equal(out, _g(r"\sqrt{\frac{p^2}{2\alpha}}"))
    assert "p" in _ids(out)
    assert _ops(p, "power") & _ids(out), "the p² power / radical lost its id"


def test_nested_parentheses_inner_unchanged():
    """Big + small parens: ``a·((b+c)+e) -> d·((b+c)+e)`` keeps both the inner
    (small-paren) and outer (big-paren) sums and their atoms stable; only the
    leading factor changes."""
    p, q = _g(r"a \cdot ((b+c)+e)"), _g(r"k \cdot ((b+c)+e)")
    out = rebase(p, q)
    assert canonical_equal(out, _g(r"k \cdot ((b+c)+e)"))
    assert {"b", "c", "e"} <= _ids(out)
    assert len(_ops(p, "add") & _ids(out)) == 2, "an inner/outer paren sum lost its id"
    assert "k" in _ids(out) and "a" not in _ids(out)


def test_integral_lhs_unchanged_keeps_integral_sign():
    """``∫x dx = y -> ∫x dx = z``: the integral node and its integrand stay put
    (the ∫ glyph morphs), only the right-hand side changes."""
    p, q = _g(r"\int x \, dx = y"), _g(r"\int x \, dx = z")
    out = rebase(p, q)
    assert canonical_equal(out, _g(r"\int x \, dx = z"))
    assert "x" in _ids(out)
    assert _ops(p, "integral") & _ids(out), "integral node lost its id"
    assert "z" in _ids(out) and "y" not in _ids(out)


def test_differential_morphs_across_integral_boundary():
    """``\\frac{1}{v}\\,dv = -k\\,dh`` -> ``\\int \\frac{1}{v}\\,dv = \\int -k\\,dh``:
    the differentials must keep their ids (``dv``/``dh``) when ``\\int`` is applied.

    The loose differential is a ``scalar`` (``dv``); inside the integral it is a
    first-class ``differential`` node. The matcher unifies the two so the glyph
    morphs across the ∫ boundary instead of crossfading — without this the
    differential collides with the faded loose ``dv`` and dedups to ``_r1_dv``.
    """
    p = _g(r"\frac{1}{v} \, dv = -k \, dh")
    q = _g(r"\int \frac{1}{v} \, dv = \int -k \, dh")
    out = rebase(p, q)
    assert canonical_equal(out, q)
    ids = _ids(out)
    assert "dv" in ids and "dh" in ids, f"differential ids not preserved: {ids}"
    assert not any(i.startswith("_r") and i.endswith(("dv", "dh")) for i in ids), \
        f"a differential was relabeled (lost its morph): {ids}"
    # the integrand variable v keeps its bare id too
    assert "v" in ids


def test_allen_eggers_target_self_rebase_is_identity():
    """The full Allen-Eggers velocity-altitude result (22 nodes: nested fraction,
    exponentials, sin) rebased onto itself preserves every id and the structure —
    no spurious relabeling on a large, complex graph."""
    t = _g(r"v = v_E e^{-\frac{H \rho_0 e^{-h/H}}{2\beta\sin\gamma}}")
    out = rebase(t, t)
    assert _ids(t) == _ids(out)
    assert canonical_equal(out, t)
    assert len(t.nodes) >= 20
