"""Tests for backend.semantic_graph.equation_chain."""

from __future__ import annotations

import pytest

from backend.semantic_graph.equation_chain import (
    _has_top_level_logical_connective,
    _has_top_level_statement_comma,
    _split_equation_chain_sides,
    _derive_single_expression,
    derive_equation_chain_graph,
)


# ------------------------------------------------------------------
# _has_top_level_logical_connective
# ------------------------------------------------------------------

class TestHasTopLevelLogicalConnective:
    def test_implies(self):
        assert _has_top_level_logical_connective(r"a \implies b") is True

    def test_rightarrow(self):
        assert _has_top_level_logical_connective(r"p \Rightarrow q") is True

    def test_iff(self):
        assert _has_top_level_logical_connective(r"x \iff y") is True

    def test_no_connective(self):
        assert _has_top_level_logical_connective("a = b") is False

    def test_nested_not_matched(self):
        assert _has_top_level_logical_connective(r"{\implies}") is False

    def test_empty(self):
        assert _has_top_level_logical_connective("") is False

    def test_none(self):
        assert _has_top_level_logical_connective(None) is False

    def test_connective_as_prefix_not_matched(self):
        assert _has_top_level_logical_connective(r"\impliesExtra") is False


# ------------------------------------------------------------------
# _has_top_level_statement_comma
# ------------------------------------------------------------------

class TestHasTopLevelStatementComma:
    def test_basic(self):
        assert _has_top_level_statement_comma("a = 1, b = 2") is True

    def test_nested_not_matched(self):
        assert _has_top_level_statement_comma("f(x, y)") is False

    def test_escaped_comma(self):
        assert _has_top_level_statement_comma(r"a\, b") is False

    def test_empty(self):
        assert _has_top_level_statement_comma("") is False

    def test_none(self):
        assert _has_top_level_statement_comma(None) is False

    def test_braces(self):
        assert _has_top_level_statement_comma("{a, b}") is False


# ------------------------------------------------------------------
# _split_equation_chain_sides
# ------------------------------------------------------------------

class TestSplitEquationChainSides:
    def test_two_sides(self):
        result = _split_equation_chain_sides("a = b")
        assert result == ["a", "b"]

    def test_three_sides(self):
        result = _split_equation_chain_sides("a = b = c")
        assert result == ["a", "b", "c"]

    def test_approx(self):
        result = _split_equation_chain_sides(r"a \approx b")
        assert result == ["a", "b"]

    def test_nested_equals(self):
        result = _split_equation_chain_sides(r"\frac{a = b}{c}")
        assert len(result) == 1

    def test_empty(self):
        assert _split_equation_chain_sides("") == []

    def test_none(self):
        assert _split_equation_chain_sides(None) == []

    def test_no_equals(self):
        result = _split_equation_chain_sides("a + b")
        assert result == ["a + b"]

    def test_backslash_equals_not_split(self):
        result = _split_equation_chain_sides(r"\ne x")
        assert len(result) == 1


# ------------------------------------------------------------------
# _derive_single_expression
# ------------------------------------------------------------------

class TestDeriveSingleExpression:
    def test_simple(self):
        graph = _derive_single_expression("F = m a")
        assert graph is not None
        assert "nodes" in graph
        assert "edges" in graph

    def test_invalid(self):
        graph = _derive_single_expression("")
        assert graph is None

    def test_returns_none_for_non_string(self):
        graph = _derive_single_expression(None)
        assert graph is None


# ------------------------------------------------------------------
# derive_equation_chain_graph
# ------------------------------------------------------------------

class TestDeriveEquationChainGraph:
    def test_empty(self):
        assert derive_equation_chain_graph("") is None

    def test_none(self):
        assert derive_equation_chain_graph(None) is None

    def test_simple_equation(self):
        graph = derive_equation_chain_graph("a = b")
        assert graph is not None
        assert "nodes" in graph

    def test_chained_three_sides(self):
        graph = derive_equation_chain_graph("a = b = c")
        assert graph is not None
        eq_nodes = [n for n in graph["nodes"] if n.get("op") == "equals"]
        assert len(eq_nodes) >= 1

    def test_single_expression_no_equals(self):
        graph = derive_equation_chain_graph("a + b")
        assert graph is not None

    def test_logical_connective_delegates(self):
        graph = derive_equation_chain_graph(r"a = 1 \implies b = 2")
        assert graph is not None

    def test_statement_comma_delegates(self):
        graph = derive_equation_chain_graph("a = 1, b = 2")
        assert graph is not None

    def test_backslash_newline_delegates(self):
        graph = derive_equation_chain_graph(r"a = 1 \\ b = 2")
        assert graph is not None

    def test_annotation_preserved(self):
        graph = derive_equation_chain_graph(
            r"F = ma \quad (v_e \text{ constant})"
        )
        assert graph is not None
        ann_nodes = [n for n in graph["nodes"]
                     if n.get("id", "").startswith("__annotation_")]
        assert len(ann_nodes) >= 1

    def test_chain_merges_shared_variables(self):
        graph = derive_equation_chain_graph("x = y = x + 1")
        assert graph is not None
        x_nodes = [n for n in graph["nodes"] if n.get("id") == "x"]
        assert len(x_nodes) == 1
