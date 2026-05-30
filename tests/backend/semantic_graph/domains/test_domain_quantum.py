"""Domain suite: Quantum mechanics.

Covers Dirac notation, commutators, bra-ket, density matrices, Pauli
matrices, and fundamental quantum equations.  This is Phase 4 — the parser
handles basic quantum expressions but struggles with bracket notation,
matrix notation, and mixed bra-ket constructs.

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
    "inner_product", "partial_derivative", "greater_equal",
    "sum", "outer_product",
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

# Expressions that parse cleanly with bra-ket and operator notation
BRA_KET_EXPRESSIONS: list[CatalogEntry] = [
    ("dirac_bra_ket",
     r"\langle \phi | \hat{A} | \psi \rangle",
     PASS,
     "A,ket:__ket_4 -> multiply; bra:__bra_2,multiply -> multiply",
     "A,__ket_4 -> __multiply_3; __bra_2,__multiply_3 -> __multiply_1",
     [{"type": "bra"}, {"type": "ket"}]),

    ("eigenvalue",
     r"\hat{A} | a \rangle = a | a \rangle",
     PASS,
     "A,ket:__ket_3 -> multiply; a,ket:__ket_5 -> multiply; "
     "multiply,multiply -> rel:equals",
     "A,__ket_3 -> __multiply_2; __ket_5,a -> __multiply_4; "
     "__multiply_2,__multiply_4 -> __equals_1",
     [{"type": "ket"}]),

    ("qubit_state",
     r"| \psi \rangle = \alpha |0\rangle + \beta |1\rangle",
     PASS,
     "alpha,ket:__ket_5 -> multiply; beta,ket:__ket_7 -> multiply; "
     "multiply,multiply -> add; add,ket:__ket_2 -> rel:equals",
     "__ket_5,alpha -> __multiply_4; __ket_7,beta -> __multiply_6; "
     "__multiply_4,__multiply_6 -> __add_3; __add_3,__ket_2 -> __equals_1",
     [{"type": "ket"}]),
]

# Operator and algebraic quantum expressions
OPERATOR_EXPRESSIONS: list[CatalogEntry] = [
    ("schrodinger_indep",
     r"\hat{H} \psi = E \psi",
     PASS,
     "E,psi -> multiply; H,psi -> multiply; "
     "multiply,multiply -> rel:equals",
     "H,psi -> __multiply_2; E,psi -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("pauli_commutation",
     r"\sigma_x \sigma_y = i \sigma_z",
     PASS,
     "i,sigma_{z} -> multiply; sigma_{x},sigma_{y} -> multiply; "
     "multiply,multiply -> rel:equals",
     "sigma_{x},sigma_{y} -> __multiply_2; i,sigma_{z} -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("pauli_square",
     r"\sigma_x^2 = I",
     PASS,
     "sigma_{x} -> power; I,power -> rel:equals",
     "sigma_{x} -> __power_2; I,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("hamiltonian",
     r"\hat{H} = \frac{\hat{p}^2}{2m} + V(x)",
     PASS,
     "x -> fn:V; m,num -> multiply; p -> power; "
     "multiply -> power; power,power -> multiply; "
     "fn:V,multiply -> add; H,add -> rel:equals",
     "x -> __V_8; __num_7,m -> __multiply_6; "
     "p -> __power_4; __multiply_6 -> __power_5; "
     "__power_4,__power_5 -> __multiply_3; __V_8,__multiply_3 -> __add_2; "
     "H,__add_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

# Fundamental quantum constants and relations
FUNDAMENTAL_EXPRESSIONS: list[CatalogEntry] = [
    ("planck_relation",
     r"E = h \nu",
     PASS,
     "h,nu -> multiply; E,multiply -> rel:equals",
     "h,nu -> __multiply_2; E,__multiply_2 -> __equals_1",
     None),

    ("de_broglie",
     r"\lambda = \frac{h}{p}",
     PASS,
     "p -> power; h,power -> multiply; lambda,multiply -> rel:equals",
     "p -> __power_3; __power_3,h -> __multiply_2; __multiply_2,lambda -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("free_particle",
     r"\psi(x) = A e^{ikx} + B e^{-ikx}",
     PASS,
     "x -> fn:psi; i,k,x -> multiply; k,x -> multiply; "
     "i,multiply -> multiply; multiply -> negation; "
     "e,multiply -> power; e,negation -> power; "
     "A,power -> multiply; B,power -> multiply; "
     "multiply,multiply -> add; add,fn:psi -> rel:equals",
     "i,k,x -> __multiply_11; k,x -> __multiply_7; x -> __psi_2; "
     "__multiply_7,i -> __multiply_6; __multiply_11 -> __negation_10; "
     "__multiply_6,e -> __power_5; __negation_10,e -> __power_9; "
     "A,__power_5 -> __multiply_4; B,__power_9 -> __multiply_8; "
     "__multiply_4,__multiply_8 -> __add_3; __add_3,__psi_2 -> __equals_1",
     None),
]

# Energy relations and uncertainty — algebraic, parse cleanly
ENERGY_EXPRESSIONS: list[CatalogEntry] = [
    ("heisenberg_uncertainty",
     r"\Delta x \Delta p \geq \frac{\hbar}{2}",
     PASS,
     "Delta p,Delta x -> multiply; num -> power; hbar,power -> multiply; "
     "multiply,multiply -> rel:greater_equal",
     "Delta p,Delta x -> __multiply_1; __num_4 -> __power_3; "
     "__power_3,hbar -> __multiply_2; "
     "__multiply_1,__multiply_2 -> __greater_equal_5",
     [{"op": "power", "exponent": "-1"}]),

    ("photon_energy",
     r"E = \frac{hc}{\lambda}",
     PASS,
     "c,h -> multiply; lambda -> power; multiply,power -> multiply; "
     "E,multiply -> rel:equals",
     "c,h -> __multiply_3; lambda -> __power_4; "
     "__multiply_3,__power_4 -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("particle_in_box",
     r"E_n = \frac{n^2 h^2}{8 m L^2}",
     PASS,
     "L -> power; h -> power; n -> power; m,power -> multiply; "
     "power,power -> multiply; multiply,num -> multiply; multiply -> power; "
     "multiply,power -> multiply; E_{n},multiply -> rel:equals",
     "L -> __power_10; n -> __power_4; h -> __power_5; "
     "__power_4,__power_5 -> __multiply_3; __power_10,m -> __multiply_9; "
     "__multiply_9,__num_8 -> __multiply_7; __multiply_7 -> __power_6; "
     "__multiply_3,__power_6 -> __multiply_2; E_{n},__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("reduced_planck",
     r"\hbar = \frac{h}{2\pi}",
     PASS,
     "const:pi,num -> multiply; multiply -> power; h,power -> multiply; "
     "hbar,multiply -> rel:equals",
     "__num_5,pi -> __multiply_4; __multiply_4 -> __power_3; "
     "__power_3,h -> __multiply_2; __multiply_2,hbar -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("kinetic_energy_momentum",
     r"E = \frac{p^2}{2m}",
     PASS,
     "m,num -> multiply; p -> power; multiply -> power; "
     "power,power -> multiply; E,multiply -> rel:equals",
     "__num_6,m -> __multiply_5; p -> __power_3; __multiply_5 -> __power_4; "
     "__power_3,__power_4 -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

# Aspirational expressions — parser does not handle these yet
ASPIRATIONAL_EXPRESSIONS: list[CatalogEntry] = [
    ("commutator",
     r"[\hat{x}, \hat{p}] = i \hbar",
     XFAIL,
     "", "",
     None),

    ("expectation_value",
     r"\langle A \rangle = \langle \psi | \hat{A} | \psi \rangle",
     XFAIL,
     "", "",
     None),

    ("completeness_relation",
     r"\sum_n | n \rangle \langle n | = I",
     PASS,
     "bra:__bra_5,ket:__ket_4 -> outer_product; n,outer_product -> sum; "
     "I,sum -> rel:equals",
     "__bra_5,__ket_4 -> __outer_product_3; __outer_product_3,n -> __sum_2; "
     "I,__sum_2 -> __equals_1",
     None),

    ("density_matrix",
     r"\rho = \sum_i p_i | \psi_i \rangle \langle \psi_i |",
     XFAIL_LENIENT,
     "bra:__bra_6,ket:__ket_5 -> outer_product; outer_product,p_{i} -> multiply; "
     "i,multiply -> sum; rho,sum -> rel:equals",
     "__bra_6,__ket_5 -> __outer_product_4; __outer_product_4,p_{i} -> __multiply_3; "
     "__multiply_3,i -> __sum_2; __sum_2,rho -> __equals_1",
     None),

    ("pauli_x_matrix",
     r"\sigma_x = \begin{pmatrix} 0 & 1 \\ 1 & 0 \end{pmatrix}",
     XFAIL,
     "", "",
     None),

    ("momentum_operator",
     r"\hat{p} = -i\hbar \frac{\partial}{\partial x}",
     XFAIL,
     "", "",
     None),
]


ALL_EXPRESSIONS = (
    BRA_KET_EXPRESSIONS
    + OPERATOR_EXPRESSIONS
    + FUNDAMENTAL_EXPRESSIONS
    + ENERGY_EXPRESSIONS
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
class TestQuantumDomain:
    """Quantum mechanics domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_universal_invariants(graph, latex=latex, domain="quantum_mechanics")

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain="quantum_mechanics")
        assert_node_properties(graph, node_checks, latex=latex)
