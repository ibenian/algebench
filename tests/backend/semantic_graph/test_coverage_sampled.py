"""Sampled cross-product generator with daily seed rotation.

Draws a random subset from the full structure x relation x var_style x operator
matrix, using a seed derived from today's date so that different combinations
are exercised each day.
"""

from __future__ import annotations

from datetime import date

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph
from tests.backend.semantic_graph.generators.expressions import sampled
from tests.backend.semantic_graph.generators.invariants import (
    assert_valid_graph,
    assert_pydantic_validates,
    assert_no_placeholder_leak,
)

_DAILY_SEED = int(date.today().strftime("%Y%m%d"))
_CASES = sampled(seed=_DAILY_SEED, n=200)

_PLACEHOLDER_LEAK_STYLES = {"compound"}


def _safe_parse(template):
    try:
        return latex_to_semantic_graph(template.latex)
    except ValueError:
        pytest.skip("Known rejection (empty/unparseable)")


@pytest.mark.parametrize(
    "template",
    _CASES,
    ids=[t.test_id for t in _CASES],
)
class TestSampledCoverage:

    def test_parser_does_not_crash(self, template):
        _safe_parse(template)

    def test_valid_graph_structure(self, template):
        graph = _safe_parse(template)
        assert_valid_graph(graph, latex=template.latex)

    def test_pydantic_validates(self, template):
        graph = _safe_parse(template)
        assert_pydantic_validates(graph, latex=template.latex)

    def test_no_placeholder_leak(self, template):
        if template.var_style in _PLACEHOLDER_LEAK_STYLES:
            pytest.xfail("Compound symbol placeholders leak into node IDs")
        graph = _safe_parse(template)
        assert_no_placeholder_leak(graph, latex=template.latex)
