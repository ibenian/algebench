"""Shared fixtures and helpers for semantic graph tests."""

from __future__ import annotations

import pytest

from backend.model.semantic_graph import SemanticGraph
from backend.semantic_graph.sympy_translator import latex_to_semantic_graph


def pytest_addoption(parser):
    parser.addoption(
        "--exhaustive",
        action="store_true",
        default=False,
        help="Run the full exhaustive cross-product (~504 combos). Used by CI.",
    )
    parser.addoption(
        "--sampled",
        action="store",
        default="200",
        metavar="N",
        help="Sample N cases from the full cross-product (default: 200).",
    )


@pytest.fixture
def parse():
    """Return a parser callable for use in tests.

    Usage::

        def test_something(parse):
            graph = parse(r"x + y = z")
            assert graph is not None
    """
    def _parse(latex: str, *, domain: str | None = None) -> SemanticGraph:
        return latex_to_semantic_graph(latex, domain=domain)
    return _parse
