"""Domain suite: Information theory.

Covers entropy, KL divergence, mutual information, channel capacity,
and conditional entropy.  This is Phase 4b — semicolon-separated
arguments and ``\\|`` inside parentheses are not yet parsed.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.

Connectivity is verified via ``graph_signature()``.
"""

from __future__ import annotations

import pytest

from tests.backend.semantic_graph.generators.invariants import (
    PASS,
    XFAIL,
    SKIP,
    label_by_type,
    label_by_id,
    assert_universal_invariants,
    assert_operators_in,
    assert_classification_kind_is,
    assert_signature,
    assert_node_properties,
)


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "multiply", "power", "equals", "add", "negation",
    "sum", "integral", "function", "greater_equal",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("entropy",
     r"H(X) = -\sum_{x} p(x) \log p(x)",
     XFAIL,
     "",
     "",
     None),

    ("kl_divergence",
     r"D_{\text{KL}}(P \| Q) = \sum_x P(x) \log \frac{P(x)}{Q(x)}",
     XFAIL,
     "",
     "",
     None),

    ("mutual_info",
     r"I(X; Y) = H(X) - H(X | Y)",
     XFAIL,
     "",
     "",
     None),

    ("channel_capacity",
     r"C = \max_{p(x)} I(X; Y)",
     XFAIL,
     "",
     "",
     None),

    ("joint_entropy",
     r"H(X, Y) = -\sum_{x,y} p(x,y) \log p(x,y)",
     XFAIL,
     "",
     "",
     None),

    ("conditional_entropy",
     r"H(X | Y) = H(X, Y) - H(Y)",
     PASS,
     "",
     "",
     None),

    ("data_processing",
     r"I(X; Y) \geq I(X; Z)",
     XFAIL,
     "",
     "",
     None),

    ("rate_distortion",
     r"R(D) = \min_{p(\hat{x}|x)} I(X; \hat{X})",
     XFAIL,
     "",
     "",
     None),
]


ALL_EXPRESSIONS = EXPRESSIONS


# ── Test collection ─────────────────────────────────────────────────────


def _build_params():
    """Build pytest parametrize params from the expression catalog."""
    params = []
    for test_id, latex, tag, sig_type, sig_id, node_checks in ALL_EXPRESSIONS:
        marks = [tag] if tag is not None else []
        params.append(pytest.param(
            latex, sig_type, sig_id, node_checks, id=test_id, marks=marks,
        ))
    return params


@pytest.mark.parametrize("latex, sig_type, sig_id, node_checks", _build_params())
class TestInformationDomain:
    """Information theory domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_node_properties(graph, node_checks, latex=latex)
