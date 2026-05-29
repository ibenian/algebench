"""Domain suite: Fluid dynamics.

Covers Navier-Stokes, continuity equation, Bernoulli's principle, Reynolds
number, drag, Stokes flow, and incompressible flow.  This is Phase 4 —
the parser handles many fluid-dynamics expressions; full Navier-Stokes with
material derivatives and ``\\nabla^2`` remains aspirational.

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
    "partial_derivative", "derivative",
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

# Core fluid dynamics equations (algebraic, no placeholder leaks)
CORE_EQUATIONS: list[CatalogEntry] = [
    ("reynolds_number",
     r"Re = \frac{\rho v L}{\mu}",
     PASS,
     "L,v -> multiply; R,e -> multiply; mu -> power; "
     "multiply,rho -> multiply; multiply,power -> multiply; "
     "multiply,multiply -> rel:equals",
     "R,e -> __multiply_2; L,v -> __multiply_5; mu -> __power_6; "
     "__multiply_5,rho -> __multiply_4; "
     "__multiply_4,__power_6 -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("pressure_depth",
     r"P = P_0 + \rho g h",
     PASS,
     "g,h -> multiply; multiply,rho -> multiply; "
     "P_{0},multiply -> add; P,add -> rel:equals",
     "g,h -> __multiply_4; __multiply_4,rho -> __multiply_3; "
     "P_{0},__multiply_3 -> __add_2; P,__add_2 -> __equals_1",
     None),

    ("drag_force",
     r"F_D = \frac{1}{2} \rho v^2 C_D A",
     PASS,
     "A,C_{D} -> multiply; num -> power; v -> power; "
     "multiply,power -> multiply; multiply,rho -> multiply; "
     "multiply,power -> multiply; F_{D},multiply -> rel:equals",
     "A,C_{D} -> __multiply_8; __num_4 -> __power_3; v -> __power_7; "
     "__multiply_8,__power_7 -> __multiply_6; "
     "__multiply_6,rho -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; "
     "F_{D},__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("stokes_drag",
     r"F = 6 \pi \mu r v",
     PASS,
     "r,v -> multiply; mu,multiply -> multiply; "
     "const:pi,multiply -> multiply; multiply,num -> multiply; "
     "F,multiply -> rel:equals",
     "r,v -> __multiply_6; __multiply_6,mu -> __multiply_5; "
     "__multiply_5,pi -> __multiply_4; "
     "__multiply_4,__num_3 -> __multiply_2; "
     "F,__multiply_2 -> __equals_1",
     None),

    ("mach_number",
     r"Ma = \frac{v}{c}",
     PASS,
     "M,a -> multiply; c -> power; power,v -> multiply; "
     "multiply,multiply -> rel:equals",
     "M,a -> __multiply_2; c -> __power_4; "
     "__power_4,v -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("incompressible_flow",
     r"\nabla \cdot \vec{v} = 0",
     PASS,
     "nabla,vec:v -> multiply; multiply,num -> rel:equals",
     "nabla,v -> __multiply_2; __multiply_2,__num_3 -> __equals_1",
     None),

    ("vorticity",
     r"\omega = \nabla \times \vec{v}",
     PASS,
     "nabla,vec:v -> multiply; multiply,omega -> rel:equals",
     "nabla,v -> __multiply_2; __multiply_2,omega -> __equals_1",
     None),

    ("continuity_area_velocity",
     r"A_1 v_1 = A_2 v_2",
     PASS,
     "A_{1},v_{1} -> multiply; A_{2},v_{2} -> multiply; "
     "multiply,multiply -> rel:equals",
     "A_{1},v_{1} -> __multiply_2; A_{2},v_{2} -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("volumetric_flow",
     r"Q = A v",
     PASS,
     "A,v -> multiply; Q,multiply -> rel:equals",
     "A,v -> __multiply_2; Q,__multiply_2 -> __equals_1",
     None),

    ("pressure_definition",
     r"P = \frac{F}{A}",
     PASS,
     "A -> power; F,power -> multiply; P,multiply -> rel:equals",
     "A -> __power_3; F,__power_3 -> __multiply_2; P,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("dynamic_pressure",
     r"q = \frac{1}{2} \rho v^2",
     PASS,
     "num -> power; v -> power; power,rho -> multiply; "
     "multiply,power -> multiply; multiply,q -> rel:equals",
     "__num_4 -> __power_3; v -> __power_6; __power_6,rho -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; __multiply_2,q -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("bernoulli",
     r"P + \frac{1}{2} \rho v^2 + \rho g h = C",
     PASS,
     "g,h -> multiply; num -> power; v -> power; multiply,rho -> multiply; "
     "power,rho -> multiply; multiply,power -> multiply; P,multiply -> add; "
     "add,multiply -> add; C,add -> rel:equals",
     "g,h -> __multiply_10; __num_6 -> __power_5; v -> __power_8; "
     "__power_8,rho -> __multiply_7; __multiply_10,rho -> __multiply_9; "
     "__multiply_7,__power_5 -> __multiply_4; P,__multiply_4 -> __add_3; "
     "__add_3,__multiply_9 -> __add_2; C,__add_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("froude_number",
     r"Fr = \frac{v}{\sqrt{g L}}",
     PASS,
     "F,r -> multiply; L,g -> multiply; multiply -> power; power -> power; "
     "power,v -> multiply; multiply,multiply -> rel:equals",
     "F,r -> __multiply_2; L,g -> __multiply_6; __multiply_6 -> __power_5; "
     "__power_5 -> __power_4; __power_4,v -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "1/2"}]),
]

# Navier-Stokes variants — these parse but are classified as ODE
# (material derivative / time derivative detected), not algebraic.
ASPIRATIONAL_EXPRESSIONS: list[CatalogEntry] = [
    ("navier_stokes_full",
     r"\rho \left( \frac{\partial \vec{v}}{\partial t} + \vec{v} \cdot "
     r"\nabla \vec{v} \right) = -\nabla p + \mu \nabla^2 \vec{v}",
     SKIP,
     "", "",
     None),

    ("continuity_equation",
     r"\frac{\partial \rho}{\partial t} + \nabla \cdot (\rho \vec{v}) = 0",
     SKIP,
     "", "",
     None),

    ("mass_flow_rate",
     r"\dot{m} = \rho A v",
     SKIP,
     "", "",
     None),
]


ALL_EXPRESSIONS = CORE_EQUATIONS + ASPIRATIONAL_EXPRESSIONS


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
class TestFluidsDomain:
    """Fluid dynamics domain suite — universal + suite-specific invariants."""

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
