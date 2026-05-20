"""Exhaustive cross-product generator: structure × relation × var_style.

~168 combinations covering the parser's feature matrix. Runs on every CI push.
Asserts universal invariants only — domain-specific assertions belong in the
domain suite files.
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph
from tests.backend.semantic_graph.generators.expressions import exhaustive
from tests.backend.semantic_graph.generators.invariants import (
    assert_valid_graph,
    assert_pydantic_validates,
    assert_no_placeholder_leak,
)


_CASES = exhaustive()

# Var styles where compound symbol placeholders leak into node IDs.
# Tracked as a known parser gap — when fixed, strict xfail catches it.
_PLACEHOLDER_LEAK_STYLES = {"compound"}

# Compound cases where the parser no longer leaks placeholders.
# Discovered via strict xfail — keep this set updated as more are fixed.
_COMPOUND_FIXED = {"single-=-compound-add"}


def _safe_parse(template):
    """Parse, skipping known rejections."""
    try:
        graph = latex_to_semantic_graph(template.latex)
    except ValueError:
        pytest.skip("Known rejection (empty/unparseable)")
    return graph


def _placeholder_params():
    """Build parametrize params for placeholder leak tests with strict xfail marks."""
    params = []
    for t in _CASES:
        marks = []
        if t.var_style in _PLACEHOLDER_LEAK_STYLES and t.test_id not in _COMPOUND_FIXED:
            marks.append(pytest.mark.xfail(
                strict=True,
                reason="Compound symbol placeholders leak into node IDs",
            ))
        params.append(pytest.param(t, id=t.test_id, marks=marks))
    return params


@pytest.mark.parametrize(
    "template",
    _CASES,
    ids=[t.test_id for t in _CASES],
)
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


@pytest.mark.parametrize("template", _placeholder_params())
def test_no_placeholder_leak(template):
    """No internal placeholder tokens leak into node fields.

    Compound var_style cases are marked as strict xfail — when the parser
    is fixed, CI will catch the flip and prompt us to remove the mark.
    """
    graph = _safe_parse(template)
    assert_no_placeholder_leak(graph, latex=template.latex)
