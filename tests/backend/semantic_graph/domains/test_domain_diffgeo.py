"""Domain suite: Differential geometry.

Covers Christoffel symbols, covariant derivatives, wedge products,
metric tensors, Riemann/Ricci tensors, and geodesic equations.
This is Phase 4b — many tensor index constructs are not yet supported.

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
    "derivative", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("christoffel",
     r"\Gamma^{i}_{jk}",
     PASS,
     "Gamma,i -> power",
     "Gamma,i -> __power_1",
     None),

    ("covariant_deriv",
     r"\nabla_{\mu} V^{\nu}",
     PASS,
     "V,nu -> power; nabla_{mu},power -> multiply",
     "V,nu -> __power_2; __power_2,nabla_{mu} -> __multiply_1",
     None),

    ("wedge_product",
     r"\omega \wedge \eta",
     PASS,
     "eta,wedge -> multiply; multiply,omega -> multiply",
     "eta,wedge -> __multiply_2; __multiply_2,omega -> __multiply_1",
     None),

    ("metric_tensor",
     r"ds^2 = g_{\mu\nu} dx^{\mu} dx^{\nu}",
     PASS,
     "ds -> power; dx,mu -> power; dx,nu -> power; "
     "power,power -> multiply; g_{mu*nu},multiply -> multiply; "
     "multiply,power -> equals",
     "ds -> __power_2; dx,mu -> __power_5; dx,nu -> __power_6; "
     "__power_5,__power_6 -> __multiply_4; "
     "__multiply_4,g_{mu*nu} -> __multiply_3; "
     "__multiply_3,__power_2 -> __equals_1",
     None),

    ("riemann_tensor",
     r"R^{\rho}_{\ \sigma\mu\nu}",
     XFAIL,
     "",
     "",
     None),

    ("ricci_scalar",
     r"R = g^{\mu\nu} R_{\mu\nu}",
     PASS,
     "mu,nu -> multiply; g,multiply -> power; "
     "R_{mu*nu},power -> multiply; R,multiply -> equals",
     "mu,nu -> __multiply_4; __multiply_4,g -> __power_3; "
     "R_{mu*nu},__power_3 -> __multiply_2; "
     "R,__multiply_2 -> __equals_1",
     None),

    ("exterior_deriv",
     r"d\omega = 0",
     PASS,
     "domega,num -> equals",
     "__num_2,domega -> __equals_1",
     None),

    ("lie_bracket",
     r"[X, Y] = XY - YX",
     XFAIL,
     "",
     "",
     None),

    ("parallel_transport",
     r"\nabla_{\dot{\gamma}} V = 0",
     PASS,
     "V,nabla_{Derivative(gamma, t)} -> multiply; multiply,num -> equals",
     "V,nabla_{Derivative(gamma, t)} -> __multiply_2; "
     "__multiply_2,__num_3 -> __equals_1",
     None),

    ("geodesic_eq",
     r"\ddot{x}^{\mu} + \Gamma^{\mu}_{\alpha\beta} \dot{x}^{\alpha} \dot{x}^{\beta} = 0",
     PASS,
     "Gamma,mu -> power; alpha,x -> power; beta,x -> power; "
     "mu,x -> power; power,t -> derivative; power,t -> derivative; "
     "derivative,power -> multiply; multiply,t -> derivative; "
     "derivative,power -> multiply; derivative,multiply -> add; "
     "add,num -> equals",
     "beta,x -> __power_11; mu,x -> __power_4; Gamma,mu -> __power_6; "
     "alpha,x -> __power_9; __power_11,t -> __deriv_10; "
     "__power_4,t -> __deriv_3; __deriv_10,__power_9 -> __multiply_8; "
     "__multiply_8,t -> __deriv_7; __deriv_7,__power_6 -> __multiply_5; "
     "__deriv_3,__multiply_5 -> __add_2; __add_2,__num_12 -> __equals_1",
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
class TestDiffGeoDomain:
    """Differential geometry domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_valid(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"algebraic", "ODE"}, (
            f"Expected 'algebraic' or 'ODE', got {kind!r} for: {latex!r}"
        )

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
