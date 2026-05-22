"""Domain suite: Polynomials & algebra.

Covers polynomial manipulation, factoring, roots, binomial theorem,
Vieta's formulas, and polynomial division.  This is Phase 1 — locking
in coverage for core algebraic identities.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.
  Classification ``kind`` is ``algebraic``.

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
    "sum", "function",
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

POLYNOMIAL_EXPRESSIONS: list[CatalogEntry] = [
    ("poly_expand",
     r"(x + 1)(x - 1) = x^2 - 1",
     PASS,
     "num,x -> add; num,x -> add; x -> power; num,power -> add; add,add -> multiply; add,multiply -> equals",
     "__num_4,x -> __add_3; __num_6,x -> __add_5; x -> __power_8; "
     "__num_9,__power_8 -> __add_7; __add_3,__add_5 -> __multiply_2; "
     "__add_7,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("poly_quadratic",
     r"ax^2 + bx + c = 0",
     PASS,
     "b,x -> multiply; x -> power; a,power -> multiply; "
     "multiply,multiply -> add; add,c -> add; add,num -> equals",
     "b,x -> __multiply_6; x -> __power_5; __power_5,a -> __multiply_4; "
     "__multiply_4,__multiply_6 -> __add_3; __add_3,c -> __add_2; "
     "__add_2,__num_7 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("quadratic_formula",
     r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
     PASS,
     "a,c -> multiply; a,num -> multiply; b -> power; "
     "multiply,num -> multiply; multiply -> power; multiply -> negation; "
     "negation,power -> add; add -> power; b,pm,power -> multiply; "
     "multiply -> negation; negation,power -> multiply; multiply,x -> equals",
     "a,c -> __multiply_11; __num_14,a -> __multiply_13; b -> __power_7; "
     "__multiply_11,__num_10 -> __multiply_9; __multiply_13 -> __power_12; "
     "__multiply_9 -> __negation_8; __negation_8,__power_7 -> __add_6; "
     "__add_6 -> __power_5; __power_5,b,pm -> __multiply_4; "
     "__multiply_4 -> __negation_3; __negation_3,__power_12 -> __multiply_2; "
     "__multiply_2,x -> __equals_1",
     [{"op": "power", "exponent": "1/2"}, {"op": "power", "exponent": "-1"}]),

    ("cubic_depressed",
     r"t^3 + pt + q = 0",
     PASS,
     "p,t -> multiply; t -> power; multiply,power -> add; add,q -> add; add,num -> equals",
     "p,t -> __multiply_5; t -> __power_4; __multiply_5,__power_4 -> __add_3; "
     "__add_3,q -> __add_2; __add_2,__num_6 -> __equals_1",
     [{"op": "power", "exponent": "3"}]),

    ("poly_degree_3",
     r"x^3 - 6x^2 + 11x - 6 = 0",
     PASS,
     "num,x -> multiply; x -> power; x -> power; num,power -> multiply; "
     "multiply -> negation; negation,power -> add; add,multiply -> add; "
     "add,num -> add; add,num -> equals",
     "__num_11,x -> __multiply_10; x -> __power_5; x -> __power_9; "
     "__num_8,__power_9 -> __multiply_7; __multiply_7 -> __negation_6; "
     "__negation_6,__power_5 -> __add_4; __add_4,__multiply_10 -> __add_3; "
     "__add_3,__num_12 -> __add_2; __add_2,__num_13 -> __equals_1",
     [{"op": "power", "exponent": "3"}, {"op": "power", "exponent": "2"}]),
]

FACTORING_EXPRESSIONS: list[CatalogEntry] = [
    ("factor_diff_squares",
     r"a^2 - b^2 = (a + b)(a - b)",
     PASS,
     "a,b -> add; b -> negation; a -> power; b -> power; a,negation -> add; "
     "power -> negation; negation,power -> add; add,add -> multiply; "
     "add,multiply -> equals",
     "a,b -> __add_7; b -> __negation_9; a -> __power_3; b -> __power_5; "
     "__negation_9,a -> __add_8; __power_5 -> __negation_4; "
     "__negation_4,__power_3 -> __add_2; __add_7,__add_8 -> __multiply_6; "
     "__add_2,__multiply_6 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("factor_perfect_square",
     r"a^2 + 2ab + b^2 = (a + b)^2",
     PASS,
     "a,b -> add; a,b -> multiply; a -> power; b -> power; "
     "multiply,num -> multiply; add -> power; multiply,power -> add; "
     "add,power -> add; add,power -> equals",
     "a,b -> __add_10; a,b -> __multiply_7; a -> __power_4; b -> __power_8; "
     "__multiply_7,__num_6 -> __multiply_5; __add_10 -> __power_9; "
     "__multiply_5,__power_4 -> __add_3; __add_3,__power_8 -> __add_2; "
     "__add_2,__power_9 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("sum_of_cubes",
     r"a^3 + b^3 = (a + b)(a^2 - ab + b^2)",
     PASS,
     "a,b -> add; a,b -> multiply; a -> power; a -> power; b -> power; "
     "b -> power; power,power -> add; multiply -> negation; "
     "negation,power -> add; add,power -> add; add,add -> multiply; "
     "add,multiply -> equals",
     "a,b -> __add_6; a,b -> __multiply_11; b -> __power_12; a -> __power_3; "
     "b -> __power_4; a -> __power_9; __power_3,__power_4 -> __add_2; "
     "__multiply_11 -> __negation_10; __negation_10,__power_9 -> __add_8; "
     "__add_8,__power_12 -> __add_7; __add_6,__add_7 -> __multiply_5; "
     "__add_2,__multiply_5 -> __equals_1",
     [{"op": "power", "exponent": "3"}, {"op": "power", "exponent": "2"}]),
]

ROOT_EXPRESSIONS: list[CatalogEntry] = [
    ("vietas_sum",
     r"r_1 + r_2 = -\frac{b}{a}",
     PASS,
     "r_{1},r_{2} -> add; a -> power; b,power -> multiply; "
     "multiply -> negation; add,negation -> equals",
     "r_{1},r_{2} -> __add_2; a -> __power_5; __power_5,b -> __multiply_4; "
     "__multiply_4 -> __negation_3; __add_2,__negation_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("vietas_product",
     r"r_1 r_2 = \frac{c}{a}",
     PASS,
     "r_{1},r_{2} -> multiply; a -> power; c,power -> multiply; "
     "multiply,multiply -> equals",
     "r_{1},r_{2} -> __multiply_2; a -> __power_4; __power_4,c -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
]

BINOMIAL_EXPRESSIONS: list[CatalogEntry] = [
    ("binomial_theorem",
     r"(x + y)^n = \sum_{k=0}^{n} \binom{n}{k} x^{n-k} y^k",
     PASS,
     "x,y -> add; k,n -> fn:choose; k -> negation; "
     "k,y -> power; n,negation -> add; add,n -> power; add,x -> power; "
     "power,power -> multiply; fn:choose,multiply -> multiply; "
     "multiply -> sum; power,sum -> equals",
     "x,y -> __add_3; k,n -> __choose_7; "
     "k -> __negation_11; k,y -> __power_12; __negation_11,n -> __add_10; "
     "__add_3,n -> __power_2; __add_10,x -> __power_9; "
     "__power_12,__power_9 -> __multiply_8; "
     "__choose_7,__multiply_8 -> __multiply_6; "
     "__multiply_6 -> __sum_4; __power_2,__sum_4 -> __equals_1",
     [{"op": "choose", "type": "function"},
      {"op": "sum", "with_respect_to": "k", "upper_bound": "n"}]),
]

FUNCTION_EXPRESSIONS: list[CatalogEntry] = [
    ("poly_division",
     r"f(x) = q(x) \cdot d(x) + r(x)",
     PASS,
     "x -> fn:d; x -> fn:f; x -> fn:q; x -> fn:r; fn:d,fn:q -> multiply; "
     "fn:r,multiply -> add; add,fn:f -> equals",
     "x -> __d_6; x -> __f_2; x -> __q_5; x -> __r_7; "
     "__d_6,__q_5 -> __multiply_4; __multiply_4,__r_7 -> __add_3; "
     "__add_3,__f_2 -> __equals_1",
     None),
]

ALL_EXPRESSIONS = (
    POLYNOMIAL_EXPRESSIONS
    + FACTORING_EXPRESSIONS
    + ROOT_EXPRESSIONS
    + BINOMIAL_EXPRESSIONS
    + FUNCTION_EXPRESSIONS
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
class TestAlgebraDomain:
    """Algebra domain suite — universal + suite-specific invariants."""

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


# ── Extensibility: add regression cases here ────────────────────────────


class TestAlgebraRegressions:
    """Regression tests for specific algebra parsing issues."""
