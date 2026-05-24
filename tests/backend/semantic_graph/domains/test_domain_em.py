"""Domain suite: Electromagnetism.

Covers Coulomb's law, Ohm's law, Maxwell's equations, Lorentz force,
circuit laws, and electromagnetic wave relations.  Uses domain hint
``electromagnetism``.

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


# ── Domain ─────────────────────────────────────────────────────────────

DOMAIN = "electromagnetism"


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "derivative", "partial_derivative",
}

ALLOWED_KINDS = {"algebraic", "ODE"}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

CIRCUIT_EXPRESSIONS: list[CatalogEntry] = [
    ("ohm",
     r"V = I R",
     PASS,
     "I,R -> multiply; V,multiply -> rel:equals",
     "I,R -> __multiply_2; V,__multiply_2 -> __equals_1",
     None),

    ("power_electric",
     r"P = I V",
     PASS,
     "I,V -> multiply; P,multiply -> rel:equals",
     "I,V -> __multiply_2; P,__multiply_2 -> __equals_1",
     None),

    ("resistance_series",
     r"R = R_1 + R_2 + R_3",
     PASS,
     "R_{1},R_{2} -> add; R_{3},add -> add; R,add -> rel:equals",
     "R_{1},R_{2} -> __add_3; R_{3},__add_3 -> __add_2; "
     "R,__add_2 -> __equals_1",
     None),

    ("capacitance",
     r"C = \frac{Q}{V}",
     PASS,
     "V -> power; Q,power -> multiply; C,multiply -> rel:equals",
     "V -> __power_3; Q,__power_3 -> __multiply_2; C,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("energy_capacitor",
     r"U = \frac{1}{2} C V^2",
     PASS,
     "V -> power; num -> power; C,power -> multiply; "
     "multiply,power -> multiply; U,multiply -> rel:equals",
     "__num_4 -> __power_3; V -> __power_6; C,__power_6 -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; U,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}, {"op": "power", "exponent": "-1"}]),

    ("inductance",
     r"V = -L \frac{dI}{dt}",
     PASS,
     "I,t -> derivative; L,derivative -> multiply; "
     "multiply -> negation; V,negation -> rel:equals",
     "I,t -> __deriv_4; L,__deriv_4 -> __multiply_3; "
     "__multiply_3 -> __negation_2; V,__negation_2 -> __equals_1",
     None),
]

ELECTROSTATICS_EXPRESSIONS: list[CatalogEntry] = [
    ("coulomb",
     r"F = k_e \frac{q_1 q_2}{r^2}",
     PASS,
     "q_{1},q_{2} -> multiply; r -> power; power -> power; "
     "multiply,power -> multiply; k_{e},multiply -> multiply; "
     "F,multiply -> rel:equals",
     "q_{1},q_{2} -> __multiply_4; r -> __power_6; "
     "__power_6 -> __power_5; __multiply_4,__power_5 -> __multiply_3; "
     "__multiply_3,k_{e} -> __multiply_2; F,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}, {"op": "power", "exponent": "-1"}]),

    ("electric_field",
     r"E = \frac{F}{q}",
     PASS,
     "q -> power; F,power -> multiply; E,multiply -> rel:equals",
     "q -> __power_3; F,__power_3 -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("magnetic_force",
     r"F = q v B \sin\theta",
     PASS,
     "theta -> fn:sin; B,fn:sin -> multiply; multiply,v -> multiply; "
     "multiply,q -> multiply; F,multiply -> rel:equals",
     "theta -> __sin_5; B,__sin_5 -> __multiply_4; "
     "__multiply_4,v -> __multiply_3; __multiply_3,q -> __multiply_2; "
     "F,__multiply_2 -> __equals_1",
     None),

    ("wave_speed_em",
     r"c = \frac{1}{\sqrt{\mu_0 \epsilon_0}}",
     PASS,
     "epsilon_{0},mu_{0} -> multiply; multiply -> power; "
     "power -> power; c,power -> rel:equals",
     "epsilon_{0},mu_{0} -> __multiply_4; __multiply_4 -> __power_3; "
     "__power_3 -> __power_2; __power_2,c -> __equals_1",
     [{"op": "power", "exponent": "1/2"}, {"op": "power", "exponent": "-1"}]),
]

MAXWELL_EXPRESSIONS: list[CatalogEntry] = [
    ("gauss_law",
     r"\oint \vec{E} \cdot d\vec{A} = \frac{Q}{\epsilon_0}",
     PASS,
     "A,dvec -> multiply; E,vec -> multiply; epsilon_{0} -> power; "
     "Q,power -> multiply; multiply,oint -> multiply; "
     "multiply,multiply -> multiply; multiply,multiply -> rel:equals",
     "E,vec -> __multiply_4; A,dvec -> __multiply_5; "
     "epsilon_{0} -> __power_7; __multiply_4,oint -> __multiply_3; "
     "Q,__power_7 -> __multiply_6; __multiply_3,__multiply_5 -> __multiply_2; "
     "__multiply_2,__multiply_6 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("faraday",
     r"\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}",
     PASS,
     "B,vec -> multiply; E,vec -> multiply; multiply,nabla -> multiply; "
     "multiply,t -> partial_derivative; partial_derivative -> negation; "
     "multiply,negation -> rel:equals",
     "E,vec -> __multiply_3; B,vec -> __multiply_6; "
     "__multiply_6,t -> __deriv_5; __multiply_3,nabla -> __multiply_2; "
     "__deriv_5 -> __negation_4; __multiply_2,__negation_4 -> __equals_1",
     None),

    ("lorentz",
     r"\vec{F} = q(\vec{E} + \vec{v} \times \vec{B})",
     PASS,
     "B,vec -> multiply; E,vec -> multiply; F,vec -> multiply; "
     "v,vec -> multiply; multiply,multiply -> multiply; "
     "multiply,multiply -> add; add -> fn:q; fn:q,multiply -> rel:equals",
     "F,vec -> __multiply_2; E,vec -> __multiply_5; "
     "v,vec -> __multiply_7; B,vec -> __multiply_8; "
     "__multiply_7,__multiply_8 -> __multiply_6; "
     "__multiply_5,__multiply_6 -> __add_4; __add_4 -> __q_3; "
     "__multiply_2,__q_3 -> __equals_1",
     None),

    ("poynting",
     r"\vec{S} = \frac{1}{\mu_0} \vec{E} \times \vec{B}",
     PASS,
     "B,vec -> multiply; E,vec -> multiply; S,vec -> multiply; "
     "mu_{0} -> power; multiply,power -> multiply; "
     "multiply,multiply -> multiply; multiply,multiply -> rel:equals",
     "S,vec -> __multiply_2; E,vec -> __multiply_6; "
     "B,vec -> __multiply_7; mu_{0} -> __power_5; "
     "__multiply_6,__power_5 -> __multiply_4; "
     "__multiply_4,__multiply_7 -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("ampere_maxwell",
     r"\nabla \times \vec{B} = \mu_0 \vec{J} "
     r"+ \mu_0 \epsilon_0 \frac{\partial \vec{E}}{\partial t}",
     PASS,
     "B,vec -> multiply; E,vec -> multiply; J,vec -> multiply; "
     "mu_{0},multiply -> multiply; multiply,nabla -> multiply; "
     "multiply,t -> partial_derivative; "
     "epsilon_{0},partial_derivative -> multiply; "
     "mu_{0},multiply -> multiply; multiply,multiply -> add; "
     "add,multiply -> rel:equals",
     "E,vec -> __multiply_10; B,vec -> __multiply_3; "
     "J,vec -> __multiply_6; __multiply_10,t -> __deriv_9; "
     "__multiply_3,nabla -> __multiply_2; "
     "__multiply_6,mu_{0} -> __multiply_5; "
     "__deriv_9,epsilon_{0} -> __multiply_8; "
     "__multiply_8,mu_{0} -> __multiply_7; "
     "__multiply_5,__multiply_7 -> __add_4; "
     "__add_4,__multiply_2 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = (
    CIRCUIT_EXPRESSIONS
    + ELECTROSTATICS_EXPRESSIONS
    + MAXWELL_EXPRESSIONS
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
class TestElectromagnetismDomain:
    """Electromagnetism domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_universal_invariants(graph, latex=latex, domain=DOMAIN)

    def test_classification_kind(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        kind = graph.classification.kind
        assert kind in ALLOWED_KINDS, (
            f"Expected kind in {ALLOWED_KINDS}, got {kind!r} for: {latex!r}"
        )

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_node_properties(graph, node_checks, latex=latex)
