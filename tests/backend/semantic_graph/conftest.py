"""Shared fixtures and helpers for semantic graph tests."""

from __future__ import annotations

from typing import Any

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph


@pytest.fixture
def parse():
    """Return a parser callable for use in tests.

    Usage::

        def test_something(parse):
            graph = parse(r"x + y = z")
            assert graph is not None
    """
    def _parse(latex: str, *, domain: str | None = None) -> dict[str, Any]:
        return latex_to_semantic_graph(latex, domain=domain)
    return _parse
