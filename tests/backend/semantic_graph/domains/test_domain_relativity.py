"""Domain suite: Relativity.

Covers Lorentz transformations, metric tensors, Einstein field equations,
geodesics, and special/general relativity fundamentals.  This is Phase 4 —
the parser handles tensor index notation and most relativistic expressions
well; bracket commutators and some differential-geometry constructs remain
aspirational.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.

Connectivity is verified via ``graph_signature()`` — a canonical string
encoding of the graph's edge structure.
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
    "add", "multiply", "power", "equals", "negation",
    "integral", "derivative", "partial_derivative",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)
#   - tag: PASS | XFAIL | SKIP (imported from invariants)
#   - sig_by_type: label_by_type connectivity string (type-prefixed labels)
#   - sig_by_id:   label_by_id connectivity string (raw node IDs)
#   - "" for collapsed expressions (no edges)
#   - node_checks: list of dicts for node property assertions, or None
#
# XFAIL is strict — CI catches the fix and prompts mark removal.

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

# Special relativity
SPECIAL_RELATIVITY: list[CatalogEntry] = [
    ("mass_energy",
     r"E = mc^2",
     PASS,
     "c -> power; m,power -> multiply; E,multiply -> rel:equals",
     "c -> __power_3; __power_3,m -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("lorentz_factor",
     r"\gamma = \frac{1}{\sqrt{1 - \frac{v^2}{c^2}}}",
     PASS,
     "c -> power; v -> power; power -> power; power,power -> multiply; "
     "multiply -> negation; negation,num -> add; add -> power; "
     "power -> power; gamma,power -> rel:equals",
     "c -> __power_10; v -> __power_8; __power_10 -> __power_9; "
     "__power_8,__power_9 -> __multiply_7; __multiply_7 -> __negation_6; "
     "__negation_6,__num_5 -> __add_4; __add_4 -> __power_3; "
     "__power_3 -> __power_2; __power_2,gamma -> __equals_1",
     [{"op": "power", "exponent": "1/2"}]),

    ("energy_momentum",
     r"E^2 = (pc)^2 + (mc^2)^2",
     PASS,
     "c,p -> multiply; E -> power; c -> power; m,power -> multiply; "
     "multiply -> power; multiply -> power; power,power -> add; "
     "add,power -> rel:equals",
     "c,p -> __multiply_5; E -> __power_2; c -> __power_8; "
     "__power_8,m -> __multiply_7; __multiply_5 -> __power_4; "
     "__multiply_7 -> __power_6; __power_4,__power_6 -> __add_3; "
     "__add_3,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("length_contraction",
     r"L = \frac{L_0}{\gamma}",
     PASS,
     "gamma -> power; L_{0},power -> multiply; L,multiply -> rel:equals",
     "gamma -> __power_3; L_{0},__power_3 -> __multiply_2; "
     "L,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("minkowski_metric",
     r"ds^2 = -c^2 dt^2 + dx^2 + dy^2 + dz^2",
     PASS,
     "c -> power; ds -> power; dt -> power; dx -> power; dy -> power; "
     "dz -> power; power,power -> multiply; multiply -> negation; "
     "negation,power -> add; add,power -> add; add,power -> add; "
     "add,power -> rel:equals",
     "dx -> __power_10; dy -> __power_11; dz -> __power_12; "
     "ds -> __power_2; c -> __power_8; dt -> __power_9; "
     "__power_8,__power_9 -> __multiply_7; __multiply_7 -> __negation_6; "
     "__negation_6,__power_10 -> __add_5; __add_5,__power_11 -> __add_4; "
     "__add_4,__power_12 -> __add_3; __add_3,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

# General relativity — tensor notation
GENERAL_RELATIVITY: list[CatalogEntry] = [
    ("metric_tensor",
     r"ds^2 = g_{\mu\nu} dx^\mu dx^\nu",
     PASS,
     r"ds -> power; dx,mu -> power; dx,nu -> power; "
     r"power,power -> multiply; g_{\mu\nu},multiply -> multiply; "
     r"multiply,power -> rel:equals",
     r"ds -> __power_2; dx,mu -> __power_5; dx,nu -> __power_6; "
     r"__power_5,__power_6 -> __multiply_4; "
     r"__multiply_4,g_{\mu\nu} -> __multiply_3; "
     r"__multiply_3,__power_2 -> __equals_1",
     None),

    ("einstein_field",
     r"R_{\mu\nu} - \frac{1}{2} R g_{\mu\nu} + \Lambda g_{\mu\nu} = "
     r"\frac{8\pi G}{c^4} T_{\mu\nu}",
     PASS,
     r"G,const:pi -> multiply; Lambda,g_{\mu\nu} -> multiply; "
     r"R,g_{\mu\nu} -> multiply; c -> power; num -> power; "
     r"multiply,num -> multiply; multiply,power -> multiply; "
     r"power -> power; multiply,power -> multiply; multiply -> negation; "
     r"R_{\mu\nu},negation -> add; T_{\mu\nu},multiply -> multiply; "
     r"add,multiply -> add; add,multiply -> rel:equals",
     r"G,pi -> __multiply_14; R,g_{\mu\nu} -> __multiply_8; "
     r"Lambda,g_{\mu\nu} -> __multiply_9; c -> __power_16; "
     r"__num_7 -> __power_6; __multiply_14,__num_13 -> __multiply_12; "
     r"__multiply_8,__power_6 -> __multiply_5; __power_16 -> __power_15; "
     r"__multiply_12,__power_15 -> __multiply_11; "
     r"__multiply_5 -> __negation_4; R_{\mu\nu},__negation_4 -> __add_3; "
     r"T_{\mu\nu},__multiply_11 -> __multiply_10; "
     r"__add_3,__multiply_9 -> __add_2; __add_2,__multiply_10 -> __equals_1",
     None),

    ("proper_time",
     r"\tau = \int \sqrt{-g_{\mu\nu} dx^\mu dx^\nu}",
     PASS,
     r"g_{\mu\nu} -> negation; negation -> power; "
     r"power,x -> integral; integral,tau -> rel:equals",
     r"g_{\mu\nu} -> __negation_4; "
     r"__negation_4 -> __power_3; __power_3,x -> __integral_2; "
     r"__integral_2,tau -> __equals_1",
     None),

    ("stress_energy",
     r"T^{\mu\nu} = (\rho + p) u^\mu u^\nu + p g^{\mu\nu}",
     PASS,
     "p,rho -> add; mu,nu -> multiply; mu,nu -> multiply; "
     "mu,u -> power; nu,u -> power; power,power -> multiply; "
     "T,multiply -> power; g,multiply -> power; "
     "add,multiply -> multiply; p,power -> multiply; "
     "multiply,multiply -> add; add,power -> rel:equals",
     "p,rho -> __add_6; mu,nu -> __multiply_12; mu,nu -> __multiply_3; "
     "mu,u -> __power_8; nu,u -> __power_9; "
     "__power_8,__power_9 -> __multiply_7; "
     "__multiply_12,g -> __power_11; T,__multiply_3 -> __power_2; "
     "__power_11,p -> __multiply_10; __add_6,__multiply_7 -> __multiply_5; "
     "__multiply_10,__multiply_5 -> __add_4; "
     "__add_4,__power_2 -> __equals_1",
     None),

    ("conservation_law",
     r"\nabla_\mu T^{\mu\nu} = 0",
     PASS,
     r"mu,nu -> multiply; T,multiply -> power; "
     r"\nabla_{\mu},power -> multiply; multiply,num -> rel:equals",
     r"mu,nu -> __multiply_4; T,__multiply_4 -> __power_3; "
     r"\nabla_{\mu},__power_3 -> __multiply_2; "
     r"__multiply_2,__num_5 -> __equals_1",
     None),

    ("metric_inverse",
     r"g_{\mu\nu} g^{\nu\rho} = \delta^\rho_\mu",
     PASS,
     r"nu,rho -> multiply; \delta_{\mu},rho -> power; "
     r"g,multiply -> power; g_{\mu\nu},power -> multiply; "
     r"multiply,power -> rel:equals",
     r"nu,rho -> __multiply_4; \delta_{\mu},rho -> __power_5; "
     r"__multiply_4,g -> __power_3; __power_3,g_{\mu\nu} -> __multiply_2; "
     r"__multiply_2,__power_5 -> __equals_1",
     None),

    ("riemann_tensor",
     r"R^\rho_{\sigma\mu\nu} = \partial_\mu \Gamma^\rho_{\nu\sigma} "
     r"- \partial_\nu \Gamma^\rho_{\mu\sigma}",
     PASS,
     r"Gamma_{\mu\sigma},rho -> power; Gamma_{\nu\sigma},rho -> power; "
     r"R_{\sigma\mu\nu},rho -> power; "
     r"\partial_{\mu},power -> multiply; \partial_{\nu},power -> multiply; "
     r"multiply -> negation; multiply,negation -> add; add,power -> rel:equals",
     r"R_{\sigma\mu\nu},rho -> __power_2; "
     r"Gamma_{\nu\sigma},rho -> __power_5; "
     r"Gamma_{\mu\sigma},rho -> __power_8; "
     r"\partial_{\mu},__power_5 -> __multiply_4; "
     r"\partial_{\nu},__power_8 -> __multiply_7; "
     r"__multiply_7 -> __negation_6; "
     r"__multiply_4,__negation_6 -> __add_3; "
     r"__add_3,__power_2 -> __equals_1",
     None),
]

# Relativistic dynamics — algebraic, parse cleanly
RELATIVISTIC_DYNAMICS: list[CatalogEntry] = [
    ("time_dilation",
     r"\Delta t = \gamma \Delta t_0",
     PASS,
     "Delta t_0,gamma -> multiply; Delta t,multiply -> rel:equals",
     "Delta t_0,gamma -> __multiply_2; Delta t,__multiply_2 -> __equals_1",
     None),

    ("relativistic_momentum",
     r"p = \gamma m v",
     PASS,
     "m,v -> multiply; gamma,multiply -> multiply; multiply,p -> rel:equals",
     "m,v -> __multiply_3; __multiply_3,gamma -> __multiply_2; "
     "__multiply_2,p -> __equals_1",
     None),

    ("relativistic_energy",
     r"E = \gamma m c^2",
     PASS,
     "c -> power; m,power -> multiply; gamma,multiply -> multiply; "
     "E,multiply -> rel:equals",
     "c -> __power_4; __power_4,m -> __multiply_3; "
     "__multiply_3,gamma -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("schwarzschild_radius",
     r"r_s = \frac{2 G M}{c^2}",
     PASS,
     "G,M -> multiply; c -> power; multiply,num -> multiply; power -> power; "
     "multiply,power -> multiply; multiply,r_{s} -> rel:equals",
     "G,M -> __multiply_5; c -> __power_7; __multiply_5,__num_4 -> __multiply_3; "
     "__power_7 -> __power_6; __multiply_3,__power_6 -> __multiply_2; "
     "__multiply_2,r_{s} -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("velocity_addition",
     r"u = \frac{u' + v}{1 + \frac{u' v}{c^2}}",
     PASS,
     "u',v -> add; u',v -> multiply; c -> power; power -> power; "
     "multiply,power -> multiply; multiply,num -> add; add -> power; "
     "add,power -> multiply; multiply,u -> rel:equals",
     "u',v -> __add_3; u',v -> __multiply_8; c -> __power_10; "
     "__power_10 -> __power_9; __multiply_8,__power_9 -> __multiply_7; "
     "__multiply_7,__num_6 -> __add_5; __add_5 -> __power_4; "
     "__add_3,__power_4 -> __multiply_2; __multiply_2,u -> __equals_1",
     None),
]

# Aspirational expressions — parser does not handle these yet
ASPIRATIONAL_EXPRESSIONS: list[CatalogEntry] = [
    ("schwarzschild_metric",
     r"ds^2 = -\left(1 - \frac{r_s}{r}\right) c^2 dt^2 + "
     r"\frac{dr^2}{1 - \frac{r_s}{r}} + r^2 d\Omega^2",
     PASS,
     "c -> power; dOmega -> power; dr -> power; ds -> power; "
     "dt -> power; r -> power; r -> power; r -> power; "
     "power,power -> multiply; power,r_{s} -> multiply; "
     "power,r_{s} -> multiply; "
     "multiply -> negation; multiply -> negation; "
     "negation,num -> add; negation,num -> add; "
     "add,power,power -> multiply; add -> power; "
     "power,power -> multiply; multiply -> negation; "
     "multiply,negation -> add; add,multiply -> add; "
     "add,power -> rel:equals",
     "r -> __power_13; dr -> __power_15; ds -> __power_2; "
     "r -> __power_21; r -> __power_23; dOmega -> __power_24; "
     "c -> __power_7; dt -> __power_8; "
     "__power_13,r_{s} -> __multiply_12; "
     "__power_21,r_{s} -> __multiply_20; "
     "__power_23,__power_24 -> __multiply_22; "
     "__multiply_12 -> __negation_11; "
     "__multiply_20 -> __negation_19; "
     "__negation_19,__num_18 -> __add_17; "
     "__negation_11,__num_10 -> __add_9; "
     "__add_9,__power_7,__power_8 -> __multiply_6; "
     "__add_17 -> __power_16; "
     "__power_15,__power_16 -> __multiply_14; "
     "__multiply_6 -> __negation_5; "
     "__multiply_14,__negation_5 -> __add_4; "
     "__add_4,__multiply_22 -> __add_3; "
     "__add_3,__power_2 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = (
    SPECIAL_RELATIVITY
    + GENERAL_RELATIVITY
    + RELATIVISTIC_DYNAMICS
    + ASPIRATIONAL_EXPRESSIONS
)


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
class TestRelativityDomain:
    """Relativity domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_universal_invariants(graph, latex=latex, domain="mechanics")

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="mechanics")
        assert_node_properties(graph, node_checks, latex=latex)
