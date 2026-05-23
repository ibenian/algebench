"""Cross-product coverage: structure × relation × var_style × nesting.

Defaults to a random sample (~200) for fast local iteration.
CI passes ``--exhaustive`` for full coverage (~504 combos).

Usage::

    # Local default: sampled 200 from all 6 axes (~10s)
    pytest tests/backend/semantic_graph/test_coverage_exhaustive.py

    # Custom sample size
    pytest tests/backend/semantic_graph/test_coverage_exhaustive.py --sampled 50

    # CI: full exhaustive (~504 combos, ~45s)
    pytest tests/backend/semantic_graph/test_coverage_exhaustive.py --exhaustive
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph
from tests.backend.semantic_graph.generators.expressions import exhaustive, sampled
from tests.backend.semantic_graph.generators.invariants import (
    XFAIL,
    assert_valid_graph,
    assert_pydantic_validates,
    assert_no_placeholder_leak,
)


# Var styles where compound symbol placeholders leak into node IDs.
# Tracked as a known parser gap — when fixed, strict xfail catches it.
# To un-xfail individual cases after fixing, add their axis_id to
# _COMPOUND_FIXED and the strict xfail will catch any regression.
_PLACEHOLDER_LEAK_STYLES = {"compound"}
_COMPOUND_FIXED: set[str] = set()


def _get_cases(config):
    if config.getoption("--exhaustive"):
        return exhaustive()
    return sampled(n=config.getoption("--sampled"))


def _safe_parse(template):
    """Parse, skipping known rejections."""
    try:
        graph = latex_to_semantic_graph(template.latex)
    except ValueError:
        pytest.skip("Known rejection (empty/unparseable)")
    return graph


def _add_placeholder_marks(template):
    """Return xfail mark list for placeholder leak tests."""
    if template.var_style in _PLACEHOLDER_LEAK_STYLES and template.axis_id not in _COMPOUND_FIXED:
        return [XFAIL]
    return []


def pytest_generate_tests(metafunc):
    if "template" not in metafunc.fixturenames:
        return

    cases = _get_cases(metafunc.config)

    if metafunc.function.__name__ == "test_no_placeholder_leak":
        params = [
            pytest.param(t, id=t.test_id, marks=_add_placeholder_marks(t))
            for t in cases
        ]
    else:
        params = [pytest.param(t, id=t.test_id) for t in cases]

    metafunc.parametrize("template", params)


class TestExhaustiveCoverage:
    """Universal invariants across the structure × relation × var_style matrix."""

    def test_parser_does_not_crash(self, template):
        """Parser must not raise an unhandled exception."""
        _safe_parse(template)

    def test_valid_graph_structure(self, template):
        graph = _safe_parse(template)
        assert_valid_graph(graph, latex=template.latex)

    def test_pydantic_validates(self, template):
        graph = _safe_parse(template)
        assert_pydantic_validates(graph, latex=template.latex)


def test_no_placeholder_leak(template):
    """No internal placeholder tokens leak into node fields.

    Compound var_style cases are marked as strict xfail — when the parser
    is fixed, CI will catch the flip and prompt us to remove the mark.
    """
    graph = _safe_parse(template)
    assert_no_placeholder_leak(graph, latex=template.latex)
