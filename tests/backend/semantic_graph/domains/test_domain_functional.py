"""Domain suite: Functional analysis.

Covers norms, inner products, operator notation, Hilbert/Banach space
membership, and convergence.  This is Phase 4b — double-bar norm
notation and angle-bracket inner products are not yet parsed.

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
    "function", "integral", "element_of", "maps_to",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("norm",
     r"\| x \| = \sqrt{\langle x, x \rangle}",
     XFAIL,
     "",
     "",
     None),

    ("inner_product",
     r"\langle f, g \rangle = \int_a^b f(x) \overline{g(x)} dx",
     XFAIL,
     "",
     "",
     None),

    ("triangle_ineq",
     r"\| x + y \| \leq \| x \| + \| y \|",
     XFAIL,
     "",
     "",
     None),

    ("operator_norm",
     r"\| T \| = \sup_{\| x \| = 1} \| Tx \|",
     XFAIL,
     "",
     "",
     None),

    ("hilbert_membership",
     r"f \in L^2(\mathbb{R})",
     PASS,
     "L -> power; R,power -> multiply; f,multiply -> rel:element_of",
     "L -> __power_2; R,__power_2 -> __multiply_1; "
     "__multiply_1,f -> __element_of_3",
     None),

    ("cauchy_schwarz",
     r"|\langle x, y \rangle| \leq \| x \| \cdot \| y \|",
     XFAIL,
     "",
     "",
     None),

    ("dual_space",
     r"X^* = \mathcal{B}(X, \mathbb{R})",
     PASS,
     "",
     "",
     None),

    ("weak_convergence",
     r"x_n \rightharpoonup x",
     PASS,
     "rightharpoonup,x -> multiply; multiply,x_{n} -> multiply",
     "rightharpoonup,x -> __multiply_2; "
     "__multiply_2,x_{n} -> __multiply_1",
     None),

    ("compact_operator",
     r"T : X \to Y",
     PASS,
     "X -> power; T,power -> multiply; Y,multiply -> rel:maps_to",
     "X -> __power_2; T,__power_2 -> __multiply_1; "
     "Y,__multiply_1 -> __maps_to_3",
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
class TestFunctionalDomain:
    """Functional analysis domain suite — universal + suite-specific invariants."""

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
