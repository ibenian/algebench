"""Domain suite: Chemistry.

Covers rate laws, equilibrium constants, Nernst equation, Arrhenius
equation, ideal gas law, and Beer-Lambert law.  This is Phase 4 — the
``domain="chemistry"`` hint enables concentration-bracket parsing, so
``[A]`` becomes a dedicated ``concentration`` operator node wrapping the
species (``k[A]`` → ``k × concentration(A)``).  The parser still struggles
with ionic notation (charge superscripts inside brackets), which is why the
``[H^+]`` / ``[A^{m+}]`` cases remain leniently-expected failures.

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
    XFAIL_LENIENT,
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
    "concentration",
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

# Rate laws and kinetics
KINETICS_EXPRESSIONS: list[CatalogEntry] = [
    ("rate_first_order",
     r"r = k [A]",
     PASS,
     "A -> concentration; concentration,k -> multiply; "
     "multiply,r -> rel:equals",
     "A -> __concentration_3; __concentration_3,k -> __multiply_2; "
     "__multiply_2,r -> __equals_1",
     [{"op": "concentration"}]),

    ("rate_second_order",
     r"r = k [A]^2",
     PASS,
     "A -> concentration; concentration -> power; k,power -> multiply; "
     "multiply,r -> rel:equals",
     "A -> __concentration_4; __concentration_4 -> __power_3; "
     "__power_3,k -> __multiply_2; __multiply_2,r -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("rate_general",
     r"r = k [A]^m [B]^n",
     PASS,
     "A -> concentration; B -> concentration; concentration,m -> power; "
     "concentration,n -> power; power,power -> multiply; "
     "k,multiply -> multiply; multiply,r -> rel:equals",
     "A -> __concentration_5; B -> __concentration_7; "
     "__concentration_5,m -> __power_4; __concentration_7,n -> __power_6; "
     "__power_4,__power_6 -> __multiply_3; __multiply_3,k -> __multiply_2; "
     "__multiply_2,r -> __equals_1",
     None),

    ("first_order_integrated",
     r"\ln [A] = -kt + \ln [A]_0",
     PASS,
     "A -> concentration; A_{0} -> concentration; k,t -> multiply; "
     "concentration,const:__const_4 -> fn:log; "
     "concentration,const:__const_4 -> fn:log; multiply -> negation; "
     "fn:log,negation -> add; add,fn:log -> rel:equals",
     "A -> __concentration_3; A_{0} -> __concentration_9; "
     "k,t -> __multiply_7; __concentration_3,__const_4 -> __log_2; "
     "__concentration_9,__const_4 -> __log_8; __multiply_7 -> __negation_6; "
     "__log_8,__negation_6 -> __add_5; __add_5,__log_2 -> __equals_1",
     None),

    ("second_order_integrated",
     r"\frac{1}{[A]} = kt + \frac{1}{[A]_0}",
     PASS,
     "A -> concentration; A_{0} -> concentration; k,t -> multiply; "
     "concentration -> power; concentration -> power; "
     "multiply,power -> add; add,power -> rel:equals",
     "A -> __concentration_3; A_{0} -> __concentration_7; "
     "k,t -> __multiply_5; __concentration_3 -> __power_2; "
     "__concentration_7 -> __power_6; __multiply_5,__power_6 -> __add_4; "
     "__add_4,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("first_order_decay",
     r"[A] = [A]_0 e^{-kt}",
     PASS,
     "A -> concentration; A_{0} -> concentration; k,t -> multiply; "
     "multiply -> negation; e,negation -> power; "
     "concentration,power -> multiply; concentration,multiply -> rel:equals",
     "A -> __concentration_2; A_{0} -> __concentration_4; "
     "k,t -> __multiply_7; __multiply_7 -> __negation_6; "
     "__negation_6,e -> __power_5; __concentration_4,__power_5 -> __multiply_3; "
     "__concentration_2,__multiply_3 -> __equals_1",
     None),
]

# Thermodynamics and equilibrium
EQUILIBRIUM_EXPRESSIONS: list[CatalogEntry] = [
    ("equilibrium_constant",
     r"K = \frac{[C]^c [D]^d}{[A]^a [B]^b}",
     PASS,
     "A -> concentration; B -> concentration; C -> concentration; "
     "D -> concentration; a,concentration -> power; b,concentration -> power; "
     "c,concentration -> power; concentration,d -> power; "
     "power,power -> multiply; power,power -> multiply; "
     "multiply -> power; multiply,power -> multiply; "
     "K,multiply -> rel:equals",
     "A -> __concentration_11; B -> __concentration_13; "
     "C -> __concentration_5; D -> __concentration_7; "
     "__concentration_11,a -> __power_10; __concentration_13,b -> __power_12; "
     "__concentration_5,c -> __power_4; __concentration_7,d -> __power_6; "
     "__power_4,__power_6 -> __multiply_3; "
     "__power_10,__power_12 -> __multiply_9; "
     "__multiply_9 -> __power_8; "
     "__multiply_3,__power_8 -> __multiply_2; "
     "K,__multiply_2 -> __equals_1",
     None),

    ("ideal_gas_law",
     r"P V = n R T",
     PASS,
     "P,V -> multiply; R,T -> multiply; multiply,n -> multiply; "
     "multiply,multiply -> rel:equals",
     "P,V -> __multiply_2; R,T -> __multiply_4; "
     "__multiply_4,n -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("arrhenius",
     r"k = A e^{-E_a / (R T)}",
     PASS,
     "R,T -> multiply; E_{a} -> negation; multiply -> power; "
     "negation,power -> multiply; e,multiply -> power; "
     "A,power -> multiply; k,multiply -> rel:equals",
     "R,T -> __multiply_7; E_{a} -> __negation_5; "
     "__multiply_7 -> __power_6; "
     "__negation_5,__power_6 -> __multiply_4; "
     "__multiply_4,e -> __power_3; A,__power_3 -> __multiply_2; "
     "__multiply_2,k -> __equals_1",
     None),

    ("half_life",
     r"t_{1/2} = \frac{\ln 2}{k}",
     PASS,
     "const:__const_5,num -> fn:log; k -> power; "
     "fn:log,power -> multiply; multiply,t_{1/2} -> rel:equals",
     "__const_5,__num_4 -> __log_3; k -> __power_6; "
     "__log_3,__power_6 -> __multiply_2; "
     "__multiply_2,t_{1/2} -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
]

# Electrochemistry and spectroscopy
ELECTROCHEMISTRY_EXPRESSIONS: list[CatalogEntry] = [
    ("nernst_equation",
     r"E = E^0 - \frac{R T}{n F} \ln Q",
     PASS,
     "Q,const:__const_11 -> fn:log; F,n -> multiply; R,T -> multiply; "
     "E -> power; multiply -> power; multiply,power -> multiply; "
     "fn:log,multiply -> multiply; multiply -> negation; "
     "negation,power -> add; E,add -> rel:equals",
     "Q,__const_11 -> __log_10; R,T -> __multiply_7; F,n -> __multiply_9; "
     "E -> __power_3; __multiply_9 -> __power_8; "
     "__multiply_7,__power_8 -> __multiply_6; "
     "__log_10,__multiply_6 -> __multiply_5; "
     "__multiply_5 -> __negation_4; "
     "__negation_4,__power_3 -> __add_2; E,__add_2 -> __equals_1",
     None),

    ("beer_lambert",
     r"A = \epsilon b c",
     PASS,
     "b,c -> multiply; epsilon,multiply -> multiply; "
     "A,multiply -> rel:equals",
     "b,c -> __multiply_3; __multiply_3,epsilon -> __multiply_2; "
     "A,__multiply_2 -> __equals_1",
     None),
]

# Solution chemistry and thermodynamics — algebraic, parse cleanly
SOLUTION_EXPRESSIONS: list[CatalogEntry] = [
    ("molarity",
     r"M = \frac{n}{V}",
     PASS,
     "V -> power; n,power -> multiply; M,multiply -> rel:equals",
     "V -> __power_3; __power_3,n -> __multiply_2; M,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("density",
     r"\rho = \frac{m}{V}",
     PASS,
     "V -> power; m,power -> multiply; multiply,rho -> rel:equals",
     "V -> __power_3; __power_3,m -> __multiply_2; __multiply_2,rho -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("dilution",
     r"M_1 V_1 = M_2 V_2",
     PASS,
     "M_{1},V_{1} -> multiply; M_{2},V_{2} -> multiply; "
     "multiply,multiply -> rel:equals",
     "M_{1},V_{1} -> __multiply_2; M_{2},V_{2} -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("gibbs_free_energy",
     r"\Delta G = \Delta H - T \Delta S",
     PASS,
     "Delta S,T -> multiply; multiply -> negation; Delta H,negation -> add; "
     "Delta G,add -> rel:equals",
     "Delta S,T -> __multiply_4; __multiply_4 -> __negation_3; "
     "Delta H,__negation_3 -> __add_2; Delta G,__add_2 -> __equals_1",
     None),
]

# Aspirational expressions — parser limitations with ionic notation.
# Concentration brackets now parse, but charge superscripts inside the
# bracket (``[H^+]``, ``[A^{m+}]``) still leak the species as a raw symbol
# rather than feeding a clean concentration node — hence lenient xfail.
ASPIRATIONAL_EXPRESSIONS: list[CatalogEntry] = [
    ("ph_definition",
     r"\text{pH} = -\log [H^+]",
     XFAIL_LENIENT,
     "", "",
     None),

    ("solubility_product",
     r"K_{sp} = [A^{m+}]^m [B^{n-}]^n",
     XFAIL_LENIENT,
     "", "",
     None),

    ("water_autoionization",
     r"K_w = [H^+][OH^-]",
     XFAIL_LENIENT,
     "", "",
     None),
]


ALL_EXPRESSIONS = (
    KINETICS_EXPRESSIONS
    + EQUILIBRIUM_EXPRESSIONS
    + ELECTROCHEMISTRY_EXPRESSIONS
    + SOLUTION_EXPRESSIONS
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
class TestChemistryDomain:
    """Chemistry domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_universal_invariants(graph, latex=latex, domain="chemistry")

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="chemistry")
        assert_node_properties(graph, node_checks, latex=latex)
