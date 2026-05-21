"""Domain suite: Abstract algebra.

Covers groups, rings, homomorphisms, quotient groups, isomorphisms,
kernels, and coset notation.  This is Phase 4b — many constructs are
not yet fully supported, so a high XFAIL ratio is expected.

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
    "multiply", "power", "equals", "add", "negation", "function",
    "Abs", "abs",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("quotient_group",
     r"G / N",
     PASS,
     "N -> power; G,power -> multiply",
     "N -> __power_2; G,__power_2 -> __multiply_1",
     None),

    ("homomorphism",
     r"\phi : G \to H",
     PASS,
     "G -> power; phi,power -> multiply; H,multiply -> rel:maps_to",
     "G -> __power_2; __power_2,phi -> __multiply_1; H,__multiply_1 -> __maps_to_3",
     None),

    ("isomorphism",
     r"G \cong H",
     PASS,
     "H,cong -> multiply; G,multiply -> multiply",
     "H,cong -> __multiply_2; G,__multiply_2 -> __multiply_1",
     None),

    ("direct_product",
     r"G \times H",
     PASS,
     "G,H -> multiply",
     "G,H -> __multiply_1",
     None),

    ("kernel",
     r"\ker(\phi) = \{ e \}",
     PASS,
     "phi -> fn:ker; e,fn:ker -> equals",
     "phi -> __ker_2; __ker_2,e -> __equals_1",
     None),

    ("image",
     r"\phi(G) = H",
     PASS,
     "G -> fn:phi; H,fn:phi -> equals",
     "G -> __phi_2; H,__phi_2 -> __equals_1",
     None),

    ("normal_subgroup",
     r"N \trianglelefteq G",
     PASS,
     "G,trianglelefteq -> multiply; N,multiply -> multiply",
     "G,trianglelefteq -> __multiply_2; N,__multiply_2 -> __multiply_1",
     None),

    ("order",
     r"|G| = n",
     PASS,
     "G -> fn:Abs; fn:Abs,n -> equals",
     "G -> __Abs_2; __Abs_2,n -> __equals_1",
     [{"op": "Abs", "type": "function"}]),

    ("coset",
     r"gN = \{ gn : n \in N \}",
     PASS,
     "N,g -> multiply; N,in -> multiply; g,n -> multiply; "
     "multiply,n -> multiply; multiply -> power; "
     "multiply,power -> multiply; multiply,multiply -> equals",
     "N,g -> __multiply_2; g,n -> __multiply_4; N,in -> __multiply_7; "
     "__multiply_7,n -> __multiply_6; __multiply_6 -> __power_5; "
     "__multiply_4,__power_5 -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("first_iso_thm",
     r"G / \ker(\phi) \cong \phi(G)",
     PASS,
     "phi -> fn:ker; G -> fn:phi; cong,fn:phi -> multiply; "
     "fn:ker,multiply -> multiply; multiply -> power; G,power -> multiply",
     "phi -> __ker_4; G -> __phi_6; __phi_6,cong -> __multiply_5; "
     "__ker_4,__multiply_5 -> __multiply_3; __multiply_3 -> __power_2; "
     "G,__power_2 -> __multiply_1",
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
class TestAbstractAlgebraDomain:
    """Abstract algebra domain suite — universal + suite-specific invariants."""

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
