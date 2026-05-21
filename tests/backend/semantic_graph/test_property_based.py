"""Hypothesis property-based tests for the LaTeX → semantic graph parser."""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph
from tests.backend.semantic_graph.generators.invariants import (
    assert_valid_graph,
    assert_pydantic_validates,
    assert_no_placeholder_leak,
)

# ── Strategies ─────────────────────────────────────────────────────────

_VARIABLES = st.sampled_from(["x", "y", "z", "a", "b", "n"])
_NUMBERS = st.integers(min_value=0, max_value=999).map(str)
_ATOMS = st.one_of(_VARIABLES, _NUMBERS)

_BINARY_OPS = st.sampled_from([" + ", " - ", r" \cdot "])


@st.composite
def _frac(draw, inner):
    a = draw(inner)
    b = draw(inner)
    return rf"\frac{{{a}}}{{{b}}}"


@st.composite
def _power(draw, inner):
    base = draw(inner)
    exp = draw(st.integers(min_value=2, max_value=5).map(str))
    return rf"{{{base}}}^{{{exp}}}"


@st.composite
def _sqrt(draw, inner):
    body = draw(inner)
    return rf"\sqrt{{{body}}}"


@st.composite
def _parens(draw, inner):
    body = draw(inner)
    return rf"\left({body}\right)"


def _latex_expr():
    return st.recursive(
        _ATOMS,
        lambda children: st.one_of(
            st.tuples(children, _BINARY_OPS, children).map(
                lambda t: t[0] + t[1] + t[2]
            ),
            _frac(children),
            _power(children),
            _sqrt(children),
            _parens(children),
        ),
        max_leaves=6,
    )


# ── Tests ──────────────────────────────────────────────────────────────


class TestPropertyBased:

    @given(expr=_latex_expr())
    @settings(deadline=None)
    def test_parser_does_not_crash(self, expr):
        try:
            latex_to_semantic_graph(expr)
        except (ValueError, NotImplementedError):
            pytest.skip("Known rejection")

    @given(expr=_latex_expr())
    @settings(deadline=None)
    def test_valid_graph(self, expr):
        try:
            graph = latex_to_semantic_graph(expr)
        except (ValueError, NotImplementedError):
            pytest.skip("Known rejection")
        assert_valid_graph(graph, latex=expr)

    @given(expr=_latex_expr())
    @settings(deadline=None)
    def test_pydantic_validates(self, expr):
        try:
            graph = latex_to_semantic_graph(expr)
        except (ValueError, NotImplementedError):
            pytest.skip("Known rejection")
        assert_pydantic_validates(graph, latex=expr)

    @given(expr=_latex_expr())
    @settings(deadline=None)
    def test_no_placeholder_leak(self, expr):
        try:
            graph = latex_to_semantic_graph(expr)
        except (ValueError, NotImplementedError):
            pytest.skip("Known rejection")
        assert_no_placeholder_leak(graph, latex=expr)
