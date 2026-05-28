"""Domain suite: Probability and statistics.

Covers expected value, variance, Bayes' theorem, distributions
(binomial, Poisson, geometric, uniform), conditional probability,
linearity of expectation, covariance, and Markov/Chebyshev bounds.

Note: ``E[X]`` bracket notation is rewritten to ``E(X)`` by
``_rewrite_bracket_functions`` before SymPy parsing, so both
forms produce identical function-call semantics.

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
    "function", "binomial", "factorial", "sum",
    "P", "E",
    "Abs", "abs",
    "less_equal", "greater_equal",
    "intersection",
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

PROBABILITY_EXPRESSIONS: list[CatalogEntry] = [
    ("prob_expected_sum",
     r"\mu = \sum_{i=1}^{n} x_i p_i",
     PASS,
         "p_{i},x_{i} -> multiply; i,num -> rel:equals; "
         "i,multiply,n,rel:equals -> sum; mu,sum -> rel:equals",
         "__num_3,i -> __equals_4; p_{i},x_{i} -> __multiply_5; "
         "__equals_4,__multiply_5,i,n -> __sum_2; "
         "__sum_2,mu -> __equals_1",
     None),

    ("prob_variance",
     r"\sigma^2 = E(X^2) - \mu^2",
     PASS,
         "X -> power; mu -> power; sigma -> power; power -> fn:E; "
         "power -> negation; fn:E,negation -> add; "
         "add,power -> rel:equals",
         "sigma -> __power_2; X -> __power_5; mu -> __power_7; "
         "__power_5 -> __E_4; __power_7 -> __negation_6; "
         "__E_4,__negation_6 -> __add_3; "
         "__add_3,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("prob_bayes",
     r"P(A|B) = \frac{P(B|A) P(A)}{P(B)}",
     PASS,
         "A -> fn:P; A,B -> fn:P; A,B -> fn:P; B -> fn:P; "
         "fn:P,fn:P -> multiply; fn:P -> power; "
         "multiply,power -> multiply; fn:P,multiply -> rel:equals",
         "A,B -> __P_2; A,B -> __P_5; A -> __P_6; B -> __P_8; "
         "__P_5,__P_6 -> __multiply_4; __P_8 -> __power_7; "
         "__multiply_4,__power_7 -> __multiply_3; "
         "__P_2,__multiply_3 -> __equals_1",
     [{"op": "P", "id": "__P_2", "_edge_roles": {"condition": 1}},
      {"op": "P", "id": "__P_5", "_edge_roles": {"condition": 1}},
      {"op": "P", "id": "__P_6", "_edge_roles": {"condition": 0}},
      {"op": "P", "id": "__P_8", "_edge_roles": {"condition": 0}}]),

    ("prob_normal",
     r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}",
     XFAIL,
     "", "",
     None),

    ("prob_binomial",
     r"P(X = k) = \binom{n}{k} p^k (1-p)^{n-k}",
     PASS,
         "k,n -> fn:choose; k -> negation; p -> negation; "
         "k,p -> power; X,k -> rel:equals; n,negation -> add; "
         "negation,num -> add; rel:equals -> fn:P; add,add -> power; "
         "power,power -> multiply; fn:choose,multiply -> multiply; "
         "fn:P,multiply -> rel:equals",
         "k,n -> __choose_5; X,k -> __equals_3; p -> __negation_11; "
         "k -> __negation_13; k,p -> __power_7; "
         "__equals_3 -> __P_2; __negation_13,n -> __add_12; "
         "__negation_11,__num_10 -> __add_9; "
         "__add_12,__add_9 -> __power_8; "
         "__power_7,__power_8 -> __multiply_6; "
         "__choose_5,__multiply_6 -> __multiply_4; "
         "__P_2,__multiply_4 -> __equals_1",
     None),

    ("prob_poisson",
     r"P(X = k) = \frac{\lambda^k e^{-\lambda}}{k!}",
     PASS,
         "k -> factorial; e -> power; k,lambda -> power; "
         "X,k -> rel:equals; rel:equals -> fn:P; "
         "power,power -> multiply; factorial -> power; "
         "multiply,power -> multiply; fn:P,multiply -> rel:equals",
         "X,k -> __equals_3; k -> __factorial_9; "
         "k,lambda -> __power_6; e -> __power_7; "
         "__equals_3 -> __P_2; __power_6,__power_7 -> __multiply_5; "
         "__factorial_9 -> __power_8; "
         "__multiply_5,__power_8 -> __multiply_4; "
         "__P_2,__multiply_4 -> __equals_1",
     None),

    ("prob_conditional",
     r"P(A \cap B) = P(A) P(B|A)",
     PASS,
         "A -> fn:P; A,B -> fn:P; A,B -> intersection; "
         "intersection -> fn:P; fn:P,fn:P -> multiply; "
         "fn:P,multiply -> rel:equals",
         "A -> __P_5; A,B -> __P_6; A,B -> __intersection_3; "
         "__intersection_3 -> __P_2; __P_5,__P_6 -> __multiply_4; "
         "__P_2,__multiply_4 -> __equals_1",
     [{"op": "P", "id": "__P_6", "_edge_roles": {"condition": 1}},
      {"op": "P", "id": "__P_5", "_edge_roles": {"condition": 0}}]),

    ("prob_linearity",
     r"E[aX + b] = aE[X] + b",
     PASS,
         "X -> fn:E; X,a -> multiply; b,multiply -> add; "
         "a,fn:E -> multiply; b,multiply -> add; "
         "add -> fn:E; add,fn:E -> rel:equals",
         "X -> __E_7; X,a -> __multiply_4; "
         "__multiply_4,b -> __add_3; __E_7,a -> __multiply_6; "
         "__add_3 -> __E_2; __multiply_6,b -> __add_5; "
         "__E_2,__add_5 -> __equals_1",
     [{"op": "E", "id": "__E_2", "_edge_roles": {"condition": 0}},
      {"op": "E", "id": "__E_7", "_edge_roles": {"condition": 0}}]),

    ("prob_covariance",
     r"\sigma_{XY} = E(XY) - \mu_X \mu_Y",
     PASS,
         "X,Y -> multiply; mu_{X},mu_{Y} -> multiply; multiply -> fn:E; "
         "multiply -> negation; fn:E,negation -> add; "
         "add,sigma_{XY} -> rel:equals",
         "X,Y -> __multiply_4; mu_{X},mu_{Y} -> __multiply_6; "
         "__multiply_4 -> __E_3; __multiply_6 -> __negation_5; "
         "__E_3,__negation_5 -> __add_2; "
         "__add_2,sigma_{XY} -> __equals_1",
     None),

    ("prob_markov",
     r"P(X \geq a) \leq \frac{E[X]}{a}",
    PASS,
         "X -> fn:E; a -> power; X,a -> rel:greater_equal; "
         "rel:greater_equal -> fn:P; fn:E,power -> multiply; "
         "fn:P,multiply -> rel:less_equal",
         "X -> __E_4; X,a -> __greater_equal_2; a -> __power_5; "
         "__greater_equal_2 -> __P_1; "
         "__E_4,__power_5 -> __multiply_3; "
         "__P_1,__multiply_3 -> __less_equal_6",
     None),

    ("prob_complement",
     r"P(A^c) = 1 - P(A)",
     PASS,
         "A -> fn:P; A,c -> power; power -> fn:P; fn:P -> negation; "
         "negation,num -> add; add,fn:P -> rel:equals",
         "A -> __P_7; A,c -> __power_3; __power_3 -> __P_2; "
         "__P_7 -> __negation_6; __negation_6,__num_5 -> __add_4; "
         "__P_2,__add_4 -> __equals_1",
     [{"op": "P", "id": "__P_2", "_edge_roles": {"condition": 0}},
      {"op": "P", "id": "__P_7", "_edge_roles": {"condition": 0}}]),

    ("prob_chebyshev",
     r"P(|X - \mu| \geq k\sigma) \leq \frac{1}{k^2}",
    PASS,
         "k,sigma -> multiply; mu -> negation; k -> power; "
         "X,negation -> add; power -> power; add -> fn:abs; "
         "fn:abs,multiply -> rel:greater_equal; "
         "rel:greater_equal -> fn:P; fn:P,power -> rel:less_equal",
         "k,sigma -> __multiply_6; mu -> __negation_5; k -> __power_8; "
         "X,__negation_5 -> __add_4; __power_8 -> __power_7; "
         "__add_4 -> __abs_3; __abs_3,__multiply_6 -> __greater_equal_2; "
         "__greater_equal_2 -> __P_1; "
         "__P_1,__power_7 -> __less_equal_9",
     None),

    ("prob_uniform",
     r"f(x) = \frac{1}{b - a}",
     PASS,
         "x -> fn:f; a -> negation; b,negation -> add; add -> power; "
         "fn:f,power -> rel:equals",
         "x -> __f_2; a -> __negation_5; __negation_5,b -> __add_4; "
         "__add_4 -> __power_3; __f_2,__power_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("prob_geometric",
     r"P(X = k) = (1 - p)^{k-1} p",
     PASS,
         "k,num -> add; p -> negation; X,k -> rel:equals; "
         "negation,num -> add; rel:equals -> fn:P; add,add -> power; "
         "p,power -> multiply; fn:P,multiply -> rel:equals",
         "__num_10,k -> __add_9; X,k -> __equals_3; p -> __negation_8; "
         "__equals_3 -> __P_2; __negation_8,__num_7 -> __add_6; "
         "__add_6,__add_9 -> __power_5; "
         "__power_5,p -> __multiply_4; "
         "__P_2,__multiply_4 -> __equals_1",
     None),

    ("prob_independence",
     r"P(A \cap B) = P(A) \cdot P(B)",
     PASS,
         "A -> fn:P; B -> fn:P; A,B -> intersection; "
         "intersection -> fn:P; fn:P,fn:P -> multiply; "
         "fn:P,multiply -> rel:equals",
         "A -> __P_5; B -> __P_6; A,B -> __intersection_3; "
         "__intersection_3 -> __P_2; __P_5,__P_6 -> __multiply_4; "
         "__P_2,__multiply_4 -> __equals_1",
     [{"op": "P", "id": "__P_5", "_edge_roles": {"condition": 0}},
      {"op": "P", "id": "__P_6", "_edge_roles": {"condition": 0}}]),

    ("prob_mgf",
     r"M_X(t) = E(e^{tX})",
     PASS,
         "t -> fn:M_{X}; X,t -> multiply; e,multiply -> power; "
         "power -> fn:E; fn:E,fn:M_{X} -> rel:equals",
         "t -> __M_{X}_2; X,t -> __multiply_5; "
         "__multiply_5,e -> __power_4; __power_4 -> __E_3; "
         "__E_3,__M_{X}_2 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = PROBABILITY_EXPRESSIONS


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
class TestProbabilityDomain:
    """Probability domain suite — universal + suite-specific invariants."""

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
