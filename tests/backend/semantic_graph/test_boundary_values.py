"""Boundary value analysis for the LaTeX → semantic graph parser."""

from __future__ import annotations

import pytest

from tests.backend.semantic_graph.generators.invariants import (
    assert_valid_graph,
    assert_pydantic_validates,
)


class TestDeepNesting:

    @pytest.mark.parametrize("depth", [5, 10, 15, 20])
    def test_nested_parentheses(self, parse, depth):
        inner = "x"
        for _ in range(depth):
            inner = rf"\left({inner}\right)"
        graph = parse(inner)
        assert_valid_graph(graph, latex=inner)
        assert_pydantic_validates(graph, latex=inner)

    @pytest.mark.parametrize("depth", [3, 5, 8])
    def test_nested_fractions(self, parse, depth):
        expr = "1"
        for i in range(2, 2 + depth):
            expr = rf"\frac{{{expr}}}{{{i}}}"
        graph = parse(expr)
        assert_valid_graph(graph, latex=expr)

    @pytest.mark.parametrize("depth", [3, 5, 7])
    def test_nested_subscripts(self, parse, depth):
        expr = "x"
        for c in "abcdefg"[:depth]:
            expr = rf"{expr}_{{{c}}}"
        graph = parse(expr)
        assert_valid_graph(graph, latex=expr)


class TestLongExpressions:

    @pytest.mark.parametrize("n_terms", [10, 25, 50])
    def test_long_addition_chain(self, parse, n_terms):
        terms = [f"x_{{{i}}}" for i in range(n_terms)]
        expr = " + ".join(terms)
        try:
            graph = parse(expr)
        except (ValueError, Exception) as exc:
            if "too_long" in str(exc) or "string_too_long" in str(exc):
                pytest.skip("Expression exceeds subexpr length limit")
            raise
        assert_valid_graph(graph, latex=expr)
        assert_pydantic_validates(graph, latex=expr)

    @pytest.mark.parametrize("n_terms", [10, 25, 50])
    def test_long_multiplication_chain(self, parse, n_terms):
        terms = [f"a_{{{i}}}" for i in range(n_terms)]
        expr = r" \cdot ".join(terms)
        try:
            graph = parse(expr)
        except (ValueError, Exception) as exc:
            if "too_long" in str(exc) or "string_too_long" in str(exc):
                pytest.skip("Expression exceeds subexpr length limit")
            raise
        assert_valid_graph(graph, latex=expr)


class TestMinimalExpressions:

    def test_single_variable(self, parse):
        graph = parse("x")
        assert_valid_graph(graph, latex="x")
        assert_pydantic_validates(graph, latex="x")

    def test_single_number(self, parse):
        graph = parse("5")
        assert_valid_graph(graph, latex="5")
        assert_pydantic_validates(graph, latex="5")

    def test_single_zero(self, parse):
        graph = parse("0")
        assert_valid_graph(graph, latex="0")


class TestEmptyInput:

    def test_empty_string(self, parse):
        with pytest.raises((ValueError, Exception)):
            parse("")

    def test_whitespace_only(self, parse):
        with pytest.raises((ValueError, Exception)):
            parse("   ")


class TestSubscriptSuperscriptNesting:

    def test_deep_subscript_chain(self, parse):
        expr = r"x_{a_{b_{c_{d}}}}"
        graph = parse(expr)
        assert_valid_graph(graph, latex=expr)

    def test_deep_superscript_chain(self, parse):
        expr = r"x^{a^{b^{c}}}"
        graph = parse(expr)
        assert_valid_graph(graph, latex=expr)

    def test_mixed_sub_super(self, parse):
        expr = r"x_{a}^{b_{c}}"
        graph = parse(expr)
        assert_valid_graph(graph, latex=expr)
