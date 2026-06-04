"""Domain suite: Thermodynamics.

Covers gas laws, entropy, Boltzmann statistics, partition functions,
Carnot efficiency, and free energy.  Uses domain hint ``thermodynamics``.

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

DOMAIN = "thermodynamics"


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "less_equal", "sum", "closed_integral",
}

ALLOWED_KINDS = {"algebraic"}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

GAS_LAW_EXPRESSIONS: list[CatalogEntry] = [
    ("ideal_gas",
     r"P V = n R T",
     PASS,
     "P,V -> multiply; R,T -> multiply; multiply,n -> multiply; "
     "multiply,multiply -> rel:equals",
     "P,V -> __multiply_2; R,T -> __multiply_4; "
     "__multiply_4,n -> __multiply_3; __multiply_2,__multiply_3 -> __equals_1",
     None),

    ("boyle",
     r"P_1 V_1 = P_2 V_2",
     PASS,
     'P_1,V_1 -> multiply; P_2,V_2 -> multiply; multiply,multiply -> rel:equals',
     'P_1,V_1 -> __multiply_2; P_2,V_2 -> __multiply_3; __multiply_2,__multiply_3 -> __equals_1',
     None),

    ("charles",
     r"\frac{V_1}{T_1} = \frac{V_2}{T_2}",
     PASS,
     'T_1 -> power; T_2 -> power; V_1,power -> multiply; V_2,power -> multiply; multiply,multiply -> rel:equals',
     'T_1 -> __power_3; T_2 -> __power_5; V_1,__power_3 -> __multiply_2; V_2,__power_5 -> __multiply_4; __multiply_2,__multiply_4 -> __equals_1',
     [{"op": "power", "exponent": "-1"}]),
]

ENERGY_EXPRESSIONS: list[CatalogEntry] = [
    ("internal_energy",
     r"U = Q - W",
     PASS,
     "W -> negation; Q,negation -> add; U,add -> rel:equals",
     "W -> __negation_3; Q,__negation_3 -> __add_2; U,__add_2 -> __equals_1",
     None),

    ("specific_heat",
     r"Q = m c T",
     PASS,
     "T,c -> multiply; m,multiply -> multiply; Q,multiply -> rel:equals",
     "T,c -> __multiply_3; __multiply_3,m -> __multiply_2; "
     "Q,__multiply_2 -> __equals_1",
     None),

    ("gibbs_free",
     r"G = H - T S",
     PASS,
     "S,T -> multiply; multiply -> negation; H,negation -> add; "
     "G,add -> rel:equals",
     "S,T -> __multiply_4; __multiply_4 -> __negation_3; "
     "H,__negation_3 -> __add_2; G,__add_2 -> __equals_1",
     None),

    ("helmholtz_free",
     r"F = U - T S",
     PASS,
     "S,T -> multiply; multiply -> negation; U,negation -> add; "
     "F,add -> rel:equals",
     "S,T -> __multiply_4; __multiply_4 -> __negation_3; "
     "U,__negation_3 -> __add_2; F,__add_2 -> __equals_1",
     None),

    ("avg_kinetic",
     r"E_k = \frac{3}{2} k_B T",
     PASS,
     'T,k_B -> multiply; num -> power; num,power -> multiply; multiply,multiply -> multiply; E_k,multiply -> rel:equals',
     'T,k_B -> __multiply_7; __num_6 -> __power_5; __num_4,__power_5 -> __multiply_3; __multiply_3,__multiply_7 -> __multiply_2; E_k,__multiply_2 -> __equals_1',
     [{"op": "power", "exponent": "-1"}]),
]

ENTROPY_EXPRESSIONS: list[CatalogEntry] = [
    ("entropy_ratio",
     r"S = \frac{Q}{T}",
     PASS,
     "T -> power; Q,power -> multiply; S,multiply -> rel:equals",
     "T -> __power_3; Q,__power_3 -> __multiply_2; "
     "S,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("boltzmann_entropy",
     r"S = k_B \ln W",
     PASS,
     'W,const:__const_4 -> fn:log; fn:log,k_B -> multiply; S,multiply -> rel:equals',
     'W,__const_4 -> __log_3; __log_3,k_B -> __multiply_2; S,__multiply_2 -> __equals_1',
     None),

    ("carnot",
     r"\eta = 1 - \frac{T_C}{T_H}",
     PASS,
     'T_H -> power; T_C,power -> multiply; multiply -> negation; negation,num -> add; add,eta -> rel:equals',
     'T_H -> __power_6; T_C,__power_6 -> __multiply_5; __multiply_5 -> __negation_4; __negation_4,__num_3 -> __add_2; __add_2,eta -> __equals_1',
     [{"op": "power", "exponent": "-1"}]),

    ("clausius",
     r"\oint \frac{dQ}{T} \leq 0",
     PASS,
     "T -> power; Q,power -> closed_integral; closed_integral,num -> rel:less_equal",
     "T -> __power_2; Q,__power_2 -> __closed_integral_1; "
     "__closed_integral_1,__num_3 -> __less_equal_4",
     [{"op": "power", "exponent": "-1"},
      {"op": "closed_integral"}]),

    ("partition_fn",
     r"Z = \sum_i e^{-E_i / k_B T}",
     PASS,
     'T,k_B -> multiply; E_i -> negation; multiply -> power; negation,power -> multiply; e,multiply -> power; i,power -> sum; Z,sum -> rel:equals',
     'T,k_B -> __multiply_7; E_i -> __negation_5; __multiply_7 -> __power_6; __negation_5,__power_6 -> __multiply_4; __multiply_4,e -> __power_3; __power_3,i -> __sum_2; Z,__sum_2 -> __equals_1',
     [{"op": "sum", "with_respect_to": "i"},
      {"op": "power", "exponent": "-1"}]),
]

RADIATION_EXPRESSIONS: list[CatalogEntry] = [
    ("stefan_boltzmann",
     r"P = \sigma A T^4",
     PASS,
     "T -> power; A,power -> multiply; multiply,sigma -> multiply; "
     "P,multiply -> rel:equals",
     "T -> __power_4; A,__power_4 -> __multiply_3; "
     "__multiply_3,sigma -> __multiply_2; P,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "4"}]),

    ("maxwell_speed",
     r"v_{rms} = \sqrt{\frac{3 k_B T}{m}}",
     PASS,
     'T,k_B -> multiply; m -> power; multiply,num -> multiply; multiply,power -> multiply; multiply -> power; power,v_rms -> rel:equals',
     'T,k_B -> __multiply_6; m -> __power_7; __multiply_6,__num_5 -> __multiply_4; __multiply_4,__power_7 -> __multiply_3; __multiply_3 -> __power_2; __power_2,v_rms -> __equals_1',
     [{"op": "power", "exponent": "1/2"}, {"op": "power", "exponent": "-1"}]),
]

ALL_EXPRESSIONS = (
    GAS_LAW_EXPRESSIONS
    + ENERGY_EXPRESSIONS
    + ENTROPY_EXPRESSIONS
    + RADIATION_EXPRESSIONS
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
class TestThermodynamicsDomain:
    """Thermodynamics domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_universal_invariants(graph, latex=latex, domain=DOMAIN)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

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
