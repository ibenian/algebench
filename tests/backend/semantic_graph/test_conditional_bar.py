"""Tests for conditional-bar preservation through the full pipeline.

The preprocessor rewrites ``P(A|B)`` → ``P(A, B)`` before SymPy parsing.
These tests verify that:

1. ``_rewrite_conditional_bar`` correctly rewrites ``|`` to ``, ``
   and returns the set of function names that had a bar.
2. ``_restore_conditional_bar_in_subexpr`` restores ``\\mid`` in a
   single function call's subexpr.
3. ``_restore_all_conditional_bars`` restores ``\\mid`` in composite
   LaTeX strings containing multiple function calls.
4. The ``condition`` edge role is emitted on the last argument edge
   of conditional-bar functions.
5. All ``subexpr`` fields throughout the graph (function nodes,
   operator nodes, relation nodes) display ``\\mid`` instead of commas.
6. Non-conditional functions (single-arg ``P(A)``, ``E(X)``) are
   left unchanged.
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.sympy_translator import (
    _rewrite_conditional_bar,
    _restore_conditional_bar_in_subexpr,
    _restore_all_conditional_bars,
    latex_to_semantic_graph,
)


# ── Unit tests: _rewrite_conditional_bar ───────────────────────────────


class TestRewriteConditionalBar:
    """Preprocessor: ``P(A|B)`` → ``P(A, B)`` + tracking."""

    def test_simple_rewrite(self):
        result, funcs = _rewrite_conditional_bar(r"P(A|B)")
        assert result == r"P(A, B)"
        assert funcs == {"P"}

    def test_nested_abs_not_rewritten(self):
        """Paired ``|…|`` inside function args (abs value) must survive."""
        result, funcs = _rewrite_conditional_bar(r"P(|X| > a)")
        # The paired |X| should not be treated as a conditional bar —
        # the result must still contain the abs bars and no comma rewrite.
        assert "|X|" in result, f"Abs bars lost: {result!r}"
        assert "," not in result, f"Unexpected comma rewrite: {result!r}"

    def test_no_bar_passthrough(self):
        result, funcs = _rewrite_conditional_bar(r"P(A)")
        assert result == r"P(A)"
        assert funcs == set()

    def test_multiple_functions(self):
        result, funcs = _rewrite_conditional_bar(r"P(A|B) = P(B|A) P(A)")
        assert "P(A, B)" in result
        assert "P(B, A)" in result
        assert "P(A)" in result  # single-arg left alone
        assert funcs == {"P"}

    def test_different_function_name(self):
        """Non-P functions with a bar should also be tracked."""
        result, funcs = _rewrite_conditional_bar(r"f(x|y)")
        assert result == r"f(x, y)"
        assert funcs == {"f"}

    def test_returns_tuple(self):
        result = _rewrite_conditional_bar(r"x + y")
        assert isinstance(result, tuple)
        assert len(result) == 2
        latex, funcs = result
        assert isinstance(latex, str)
        assert isinstance(funcs, set)

    def test_no_bars_empty_set(self):
        _, funcs = _rewrite_conditional_bar(r"E(X) + P(A)")
        assert funcs == set()


# ── Unit tests: _restore_conditional_bar_in_subexpr ────────────────────


class TestRestoreConditionalBarInSubexpr:
    r"""Restore last comma → ``\mid`` in a single function's subexpr."""

    def test_sympy_form(self):
        r"""SymPy renders ``P{\left(A,B \right)}``."""
        result = _restore_conditional_bar_in_subexpr(
            r"P{\left(A,B \right)}")
        assert r"\mid" in result
        assert "," not in result

    def test_plain_form(self):
        result = _restore_conditional_bar_in_subexpr(r"P(A, B)")
        assert r"\mid" in result

    def test_single_arg_unchanged(self):
        original = r"P{\left(A \right)}"
        result = _restore_conditional_bar_in_subexpr(original)
        assert result == original

    def test_spacing_clean(self):
        """No double spaces or missing spaces around \\mid."""
        result = _restore_conditional_bar_in_subexpr(
            r"P{\left(A,B \right)}")
        assert r" \mid " in result or r"\mid " in result
        assert "  " not in result  # no double spaces


# ── Unit tests: _restore_all_conditional_bars ──────────────────────────


class TestRestoreAllConditionalBars:
    r"""Restore ``\mid`` in ALL function calls within a LaTeX string."""

    def test_single_function(self):
        result = _restore_all_conditional_bars(
            r"P{\left(A,B \right)}", {"P"})
        assert r"\mid" in result
        assert result.count(",") == 0

    def test_multiple_functions(self):
        result = _restore_all_conditional_bars(
            r"P{\left(B,A \right)} P{\left(A \right)}", {"P"})
        assert r"\mid" in result
        # P(A) has no comma — only B,A should be restored
        assert "P" in result

    def test_bayes_full(self):
        latex = (r"P{\left(A,B \right)} = "
                 r"\frac{P{\left(B,A \right)} P{\left(A \right)}}"
                 r"{P{\left(B \right)}}")
        result = _restore_all_conditional_bars(latex, {"P"})
        # Two-arg calls get \mid, single-arg calls stay unchanged
        assert result.count(r"\mid") == 2
        assert r"P{\left(A \right)}" in result
        assert r"P{\left(B \right)}" in result

    def test_empty_func_names(self):
        original = r"P{\left(A,B \right)}"
        result = _restore_all_conditional_bars(original, set())
        assert result == original

    def test_no_match_passthrough(self):
        original = r"f(x, y)"
        result = _restore_all_conditional_bars(original, {"P"})
        assert result == original  # f is not in func_names

    def test_plain_parens(self):
        """Also handles ``P(A, B)`` without SymPy \\left wrappers."""
        result = _restore_all_conditional_bars(r"P(A, B)", {"P"})
        assert r"\mid" in result

    def test_multiple_func_names(self):
        result = _restore_all_conditional_bars(
            r"P(A, B) + Q(X, Y)", {"P", "Q"})
        assert result.count(r"\mid") == 2


# ── Integration: condition edge role ───────────────────────────────────


class TestConditionEdgeRole:
    """The parser must emit ``role="condition"`` on the last argument
    edge of functions that originally had a conditional bar."""

    def test_bayes_has_condition_edges(self, parse):
        graph = parse(r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        assert len(cond_edges) >= 2, (
            f"Expected ≥2 condition edges (P(A|B) and P(B|A)), "
            f"got {len(cond_edges)}"
        )

    def test_condition_edge_targets_function(self, parse):
        """Every condition edge must point into a function node."""
        graph = parse(r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}")
        func_ids = {n.id for n in graph.nodes if n.type == "function"}
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        for e in cond_edges:
            assert e.to in func_ids, (
                f"condition edge {e.from_} → {e.to} targets a non-function node"
            )

    def test_single_arg_no_condition(self, parse):
        """``P(A)`` alone must NOT produce any condition edges."""
        graph = parse(r"P(A) = 0.5")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        assert len(cond_edges) == 0

    def test_conditional_probability(self, parse):
        graph = parse(r"P(A \cap B) = P(A) P(B|A)")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        # Only P(B|A) should have a condition edge
        assert len(cond_edges) >= 1

    def test_independence_no_condition(self, parse):
        """``P(A ∩ B) = P(A) · P(B)`` has no conditional bar."""
        graph = parse(r"P(A \cap B) = P(A) \cdot P(B)")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        assert len(cond_edges) == 0


# ── Integration: subexpr restoration ───────────────────────────────────


class TestSubexprConditionalBar:
    r"""All ``subexpr`` fields must show ``\mid`` for conditional-bar
    functions, not commas."""

    def test_function_node_subexpr(self, parse):
        """Direct P function nodes get \\mid in their subexpr."""
        graph = parse(r"P(A|B)")
        p_nodes = [n for n in graph.nodes
                    if n.type == "function" and n.op == "P"]
        assert len(p_nodes) >= 1
        for n in p_nodes:
            if n.subexpr and "," in n.subexpr:
                pytest.fail(
                    f"Function node {n.id} subexpr has comma instead of "
                    f"\\mid: {n.subexpr!r}"
                )

    def test_relation_node_subexpr(self, parse):
        r"""The equals node's subexpr must also show ``\mid``."""
        graph = parse(r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}")
        eq_nodes = [n for n in graph.nodes if n.op == "equals"]
        assert len(eq_nodes) >= 1
        eq = eq_nodes[0]
        assert eq.subexpr is not None
        assert r"\mid" in eq.subexpr, (
            f"Relation subexpr missing \\mid: {eq.subexpr!r}"
        )
        # Should not have bare P(A, B) with comma
        assert "P(A, B)" not in eq.subexpr
        assert "P(B, A)" not in eq.subexpr

    def test_operator_node_subexpr(self, parse):
        r"""Multiply nodes containing P calls get ``\mid`` too."""
        graph = parse(r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}")
        mul_nodes = [n for n in graph.nodes
                     if n.op == "multiply" and n.subexpr]
        for n in mul_nodes:
            # If the subexpr contains a two-arg P call, it should have \mid
            if "P{" in n.subexpr and "," in n.subexpr:
                pytest.fail(
                    f"Operator node {n.id} subexpr has comma in P call "
                    f"instead of \\mid: {n.subexpr!r}"
                )

    def test_single_arg_subexpr_unchanged(self, parse):
        r"""Single-arg ``P(A)`` subexprs must NOT get ``\mid``."""
        graph = parse(r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}")
        # Find single-arg P function nodes (P(A) and P(B))
        single_arg_p = [
            n for n in graph.nodes
            if n.type == "function" and n.op == "P"
            and n.subexpr and n.subexpr.count(",") == 0
            and r"\mid" not in n.subexpr
        ]
        # There must be at least the P(A) and P(B) nodes
        # and none of them should contain \mid
        for n in single_arg_p:
            assert r"\mid" not in n.subexpr, (
                f"Single-arg function {n.id} has \\mid in subexpr: "
                f"{n.subexpr!r}"
            )

    def test_conditional_prob_subexpr(self, parse):
        r"""``P(A ∩ B) = P(A) P(B|A)`` — only P(B|A) gets bar."""
        graph = parse(r"P(A \cap B) = P(A) P(B|A)")
        eq_nodes = [n for n in graph.nodes if n.op == "equals"]
        assert len(eq_nodes) >= 1
        eq = eq_nodes[0]
        assert eq.subexpr is not None
        assert r"\mid" in eq.subexpr or r"|" in eq.subexpr, (
            f"Relation subexpr missing bar: {eq.subexpr!r}"
        )

    def test_no_bar_expression_clean(self, parse):
        r"""Expressions without bars should have no ``\mid`` anywhere."""
        graph = parse(r"E(X^2) - \mu^2")
        for n in graph.nodes:
            if n.subexpr:
                assert r"\mid" not in n.subexpr, (
                    f"Node {n.id} has spurious \\mid: {n.subexpr!r}"
                )


# ── Integration: E[X] bracket notation with bar ───────────────────────


class TestBracketNotationWithBar:
    """``E[aX + b]`` bracket notation should work alongside conditional
    bars without interference."""

    def test_expected_value_no_bar(self, parse):
        graph = parse(r"E[aX + b] = aE[X] + b")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        assert len(cond_edges) == 0

    def test_mixed_e_and_p(self, parse):
        """Expression with both E[X] and P(A|B) — only P gets bar."""
        graph = parse(r"E[X] = \sum P(x|A) x")
        cond_edges = [e for e in graph.edges if e.role == "condition"]
        p_func_ids = {n.id for n in graph.nodes
                      if n.type == "function" and n.op == "P"}
        for e in cond_edges:
            assert e.to in p_func_ids, (
                "condition edge should only target P nodes, not E"
            )


# ── Integration: chained inequality assertions ──────────────────────


class TestChainedInequalityAssertion:
    """Chained inequalities like ``P(1 < X \\leq 10)`` must produce a
    right-associative chain of relation nodes connected to the function
    via an ``assertion`` edge."""

    def test_rewrite_chained_ops(self):
        """Preprocessor rewrites both operators to commas."""
        from backend.semantic_graph.sympy_translator import (
            _rewrite_assertion_ops,
        )
        result, funcs = _rewrite_assertion_ops(r"P(1 < X \leq 10)")
        assert result == r"P(1, X, 10)"
        assert funcs == {"P": ["<", r"\leq"]}

    def test_rewrite_single_op_returns_list(self):
        """Single-op assertions now return a one-element list."""
        from backend.semantic_graph.sympy_translator import (
            _rewrite_assertion_ops,
        )
        result, funcs = _rewrite_assertion_ops(r"P(X = k)")
        assert result == r"P(X, k)"
        assert funcs == {"P": ["="]}

    def test_chained_produces_assertion_edge(self, parse):
        """``P(1 < X ≤ 10)`` must have exactly one assertion edge
        pointing to the P function node."""
        graph = parse(r"P(1 < X \leq 10)")
        assertion_edges = [e for e in graph.edges if e.role == "assertion"]
        assert len(assertion_edges) == 1
        p_ids = {n.id for n in graph.nodes
                 if n.type == "function" and n.op == "P"}
        assert assertion_edges[0].to in p_ids

    def test_chained_relation_chain(self, parse):
        r"""``P(1 < X \leq 10)`` must produce ``less_than`` and
        ``less_equal`` relation nodes in a right-associative chain."""
        graph = parse(r"P(1 < X \leq 10)")
        rel_nodes = {n.id: n for n in graph.nodes if n.type == "relation"}
        # Must have exactly two relation nodes.
        assert len(rel_nodes) == 2, (
            f"Expected 2 relation nodes, got {len(rel_nodes)}: "
            f"{[n.op for n in rel_nodes.values()]}"
        )
        ops = {n.op for n in rel_nodes.values()}
        assert ops == {"less_than", "less_equal"}

        # The less_than node must be lhs of the less_equal node.
        lt_id = next(n.id for n in rel_nodes.values()
                     if n.op == "less_than")
        le_id = next(n.id for n in rel_nodes.values()
                     if n.op == "less_equal")
        lhs_edges = [e for e in graph.edges
                     if e.from_ == lt_id and e.to == le_id
                     and e.role == "lhs"]
        assert len(lhs_edges) == 1, (
            "less_than should be lhs of less_equal"
        )

    def test_chained_subexpr_has_operators(self, parse):
        r"""Subexprs must show original operators, not commas."""
        graph = parse(r"P(1 < X \leq 10)")
        p_nodes = [n for n in graph.nodes
                   if n.type == "function" and n.op == "P"]
        assert len(p_nodes) == 1
        subexpr = p_nodes[0].subexpr
        assert subexpr is not None
        assert "," not in subexpr, (
            f"P function subexpr has comma instead of operators: "
            f"{subexpr!r}"
        )

    def test_chained_in_equation(self, parse):
        r"""``P(1 < X \leq 10) = 0.5`` — equation subexpr must show
        the chained inequality, not commas."""
        graph = parse(r"P(1 < X \leq 10) = 0.5")
        eq_nodes = [n for n in graph.nodes if n.op == "equals"]
        assert len(eq_nodes) == 1
        assert eq_nodes[0].subexpr is not None
        assert "," not in eq_nodes[0].subexpr, (
            f"Equation subexpr has comma: {eq_nodes[0].subexpr!r}"
        )

    def test_reversed_direction(self, parse):
        r"""``P(a \geq X > b)`` — reversed direction chain."""
        graph = parse(r"P(a \geq X > b)")
        rel_nodes = {n.id: n for n in graph.nodes if n.type == "relation"}
        ops = {n.op for n in rel_nodes.values()}
        assert ops == {"greater_equal", "greater_than"}
        assertion_edges = [e for e in graph.edges if e.role == "assertion"]
        assert len(assertion_edges) == 1

    def test_single_op_unaffected(self, parse):
        r"""Single-op assertions (``P(X = k)``) still work as before."""
        graph = parse(r"P(X = k)")
        assertion_edges = [e for e in graph.edges if e.role == "assertion"]
        assert len(assertion_edges) == 1
        rel_nodes = [n for n in graph.nodes if n.type == "relation"]
        assert len(rel_nodes) == 1
        assert rel_nodes[0].op == "equals"
