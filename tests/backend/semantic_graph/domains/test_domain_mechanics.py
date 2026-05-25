"""Domain suite: Classical mechanics.

Covers Newton's laws, energy, momentum, Lagrangian, Hamiltonian, and related
kinematics/dynamics identities.  Uses domain hint ``mechanics``.

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

DOMAIN = "mechanics"


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "derivative", "partial_derivative",
}

ALLOWED_KINDS = {"algebraic", "ODE", "PDE"}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

CORE_EXPRESSIONS: list[CatalogEntry] = [
    ("newton_second_law",
     r"F = m a",
     PASS,
     "a,m -> multiply; F,multiply -> rel:equals",
     "a,m -> __multiply_2; F,__multiply_2 -> __equals_1",
     None),

    ("weight",
     r"W = m g",
     PASS,
     "g,m -> multiply; W,multiply -> rel:equals",
     "g,m -> __multiply_2; W,__multiply_2 -> __equals_1",
     None),

    ("kinetic_energy",
     r"E_k = \frac{1}{2} m v^2",
     PASS,
     "num -> power; v -> power; m,power -> multiply; "
     "multiply,power -> multiply; E_{k},multiply -> rel:equals",
     "__num_4 -> __power_3; v -> __power_6; __power_6,m -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; E_{k},__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("potential_energy",
     r"U = m g h",
     PASS,
     "g,h -> multiply; m,multiply -> multiply; U,multiply -> rel:equals",
     "g,h -> __multiply_3; __multiply_3,m -> __multiply_2; "
     "U,__multiply_2 -> __equals_1",
     None),

    ("work",
     r"W = F s \cos\theta",
     PASS,
     "theta -> fn:cos; fn:cos,s -> multiply; F,multiply -> multiply; "
     "W,multiply -> rel:equals",
     "theta -> __cos_4; __cos_4,s -> __multiply_3; "
     "F,__multiply_3 -> __multiply_2; W,__multiply_2 -> __equals_1",
     None),

    ("momentum",
     r"p = m v",
     PASS,
     "m,v -> multiply; multiply,p -> rel:equals",
     "m,v -> __multiply_2; __multiply_2,p -> __equals_1",
     None),

    ("gravitational",
     r"F = G \frac{m_1 m_2}{r^2}",
     PASS,
     "m_{1},m_{2} -> multiply; r -> power; power -> power; "
     "multiply,power -> multiply; G,multiply -> multiply; F,multiply -> rel:equals",
     "m_{1},m_{2} -> __multiply_4; r -> __power_6; __power_6 -> __power_5; "
     "__multiply_4,__power_5 -> __multiply_3; G,__multiply_3 -> __multiply_2; "
     "F,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}, {"op": "power", "exponent": "-1"}]),

    ("centripetal",
     r"F = \frac{m v^2}{r}",
     PASS,
     "r -> power; v -> power; m,power -> multiply; "
     "multiply,power -> multiply; F,multiply -> rel:equals",
     "v -> __power_4; r -> __power_5; __power_4,m -> __multiply_3; "
     "__multiply_3,__power_5 -> __multiply_2; F,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}, {"op": "power", "exponent": "-1"}]),

    ("hooke",
     r"F = -k x",
     PASS,
     "k,x -> multiply; multiply -> negation; F,negation -> rel:equals",
     "k,x -> __multiply_3; __multiply_3 -> __negation_2; "
     "F,__negation_2 -> __equals_1",
     None),

    ("power_mech",
     r"P = \frac{W}{t}",
     PASS,
     "t -> power; W,power -> multiply; P,multiply -> rel:equals",
     "t -> __power_3; W,__power_3 -> __multiply_2; P,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("lagrangian",
     r"L = T - V",
     PASS,
     "V -> negation; T,negation -> add; L,add -> rel:equals",
     "V -> __negation_3; T,__negation_3 -> __add_2; L,__add_2 -> __equals_1",
     None),

    ("euler_lagrange",
     r"\frac{d}{dt} \frac{\partial L}{\partial \dot{q}} "
     r"- \frac{\partial L}{\partial q} = 0",
     PASS,
     "q,t -> derivative; L,partial -> multiply; L,q -> partial_derivative; "
     "derivative,partial -> multiply; partial_derivative -> negation; "
     "multiply -> power; multiply,power -> multiply; multiply,t -> derivative; "
     "derivative,negation -> add; add,num -> rel:equals",
     "L,q -> __deriv_10; q,t -> __deriv_8; L,partial -> __multiply_5; "
     "__deriv_8,partial -> __multiply_7; __deriv_10 -> __negation_9; "
     "__multiply_7 -> __power_6; __multiply_5,__power_6 -> __multiply_4; "
     "__multiply_4,t -> __deriv_3; __deriv_3,__negation_9 -> __add_2; "
     "__add_2,__num_11 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("hamiltonian",
     r"H = T + V",
     PASS,
     "T,V -> add; H,add -> rel:equals",
     "T,V -> __add_2; H,__add_2 -> __equals_1",
     None),

    ("angular_momentum",
     r"L = I \omega",
     PASS,
     "I,omega -> multiply; L,multiply -> rel:equals",
     "I,omega -> __multiply_2; L,__multiply_2 -> __equals_1",
     None),

    ("torque",
     r"\tau = r F \sin\theta",
     PASS,
     "theta -> fn:sin; F,fn:sin -> multiply; multiply,r -> multiply; "
     "multiply,tau -> rel:equals",
     "theta -> __sin_4; F,__sin_4 -> __multiply_3; "
     "__multiply_3,r -> __multiply_2; __multiply_2,tau -> __equals_1",
     None),
]


ALL_EXPRESSIONS = CORE_EXPRESSIONS


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
class TestMechanicsDomain:
    """Classical mechanics domain suite — universal + suite-specific invariants."""

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
