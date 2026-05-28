"""Domain suite: Linear algebra.

Covers matrix products, determinants, eigenvalues, SVD, norms, trace,
transpose, rank-nullity, and cross products.  Inner product and norm
notation (angle brackets, double bars) are not yet supported by the
parser and are marked XFAIL.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.
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
    "function", "det", "Abs", "abs",
    "sin",
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

# Type alias for catalog entries
CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

LINALG_EXPRESSIONS: list[CatalogEntry] = [
    ("linalg_matrix_product",
     r"C = A B",
     PASS,
         "A,B -> multiply; C,multiply -> rel:equals",
         "A,B -> __multiply_2; C,__multiply_2 -> __equals_1",
     None),

    ("linalg_determinant",
     r"\det(A) = ad - bc",
     PASS,
         "A -> fn:det; a,d -> multiply; b,c -> multiply; "
         "multiply -> negation; multiply,negation -> add; "
         "add,fn:det -> rel:equals",
         "A -> __det_2; a,d -> __multiply_4; b,c -> __multiply_6; "
         "__multiply_6 -> __negation_5; "
         "__multiply_4,__negation_5 -> __add_3; "
         "__add_3,__det_2 -> __equals_1",
     [{"op": "det", "type": "function"}]),

    ("linalg_eigenvalue",
     r"A \vec{v} = \lambda \vec{v}",
     PASS,
         "A,vec:v -> multiply; lambda,vec:v -> multiply; "
         "multiply,multiply -> rel:equals",
         "A,v -> __multiply_2; lambda,v -> __multiply_3; "
         "__multiply_2,__multiply_3 -> __equals_1",
     None),

    ("linalg_inverse",
     r"A A^{-1} = I",
     PASS,
         "A -> power; A,power -> multiply; I,multiply -> rel:equals",
         "A -> __power_3; A,__power_3 -> __multiply_2; "
         "I,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("linalg_transpose",
     r"(AB)^T = B^T A^T",
     PASS,
         "A,B -> multiply; A,T -> power; B,T -> power; "
         "power,power -> multiply; T,multiply -> power; "
         "multiply,power -> rel:equals",
         "A,B -> __multiply_3; B,T -> __power_5; A,T -> __power_6; "
         "__power_5,__power_6 -> __multiply_4; "
         "T,__multiply_3 -> __power_2; "
         "__multiply_4,__power_2 -> __equals_1",
     None),

    ("linalg_inner_product",
     r"\langle u, v \rangle = \sum_{i} u_i v_i",
     XFAIL,
     "", "",
     None),

    ("linalg_norm",
     r"\| \vec{x} \| = \sqrt{x_1^2 + x_2^2 + x_3^2}",
     XFAIL,
     "", "",
     None),

    ("linalg_characteristic",
     r"\det(A - \lambda I) = 0",
     PASS,
         "I,lambda -> multiply; multiply -> negation; "
         "A,negation -> add; add -> fn:det; fn:det,num -> rel:equals",
         "I,lambda -> __multiply_5; __multiply_5 -> __negation_4; "
         "A,__negation_4 -> __add_3; __add_3 -> __det_2; "
         "__det_2,__num_6 -> __equals_1",
     [{"op": "det", "type": "function"}]),

    ("linalg_svd",
     r"A = U \Sigma V^T",
     PASS,
         "T,V -> power; Sigma,power -> multiply; "
         "U,multiply -> multiply; A,multiply -> rel:equals",
         "T,V -> __power_4; Sigma,__power_4 -> __multiply_3; "
         "U,__multiply_3 -> __multiply_2; A,__multiply_2 -> __equals_1",
     None),

    ("linalg_projection",
     r"P = A(A^T A)^{-1} A^T",
     PASS,
         "A,T -> power; A,T -> power; A,power -> multiply; "
         "multiply -> fn:A; fn:A -> power; power,power -> multiply; "
         "P,multiply -> rel:equals",
         "A,T -> __power_6; A,T -> __power_7; "
         "A,__power_6 -> __multiply_5; __multiply_5 -> __A_4; "
         "__A_4 -> __power_3; __power_3,__power_7 -> __multiply_2; "
         "P,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("linalg_cross_product",
     r"\vec{a} \times \vec{b} = \hat{n} |a||b| \sin\theta",
     PASS,
         "vec:a -> fn:abs; vec:b -> fn:abs; theta -> fn:sin; "
         "vec:a,vec:b -> multiply; fn:abs,fn:sin -> multiply; "
         "fn:abs,multiply -> multiply; multiply,n -> multiply; "
         "multiply,multiply -> rel:equals",
         "a -> __abs_5; b -> __abs_7; a,b -> __multiply_2; "
         "theta -> __sin_8; __abs_7,__sin_8 -> __multiply_6; "
         "__abs_5,__multiply_6 -> __multiply_4; "
         "__multiply_4,n -> __multiply_3; "
         "__multiply_2,__multiply_3 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = LINALG_EXPRESSIONS


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
class TestLinalgDomain:
    """Linear algebra domain suite — universal + suite-specific invariants."""

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
