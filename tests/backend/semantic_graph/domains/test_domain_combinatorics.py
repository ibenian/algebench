"""Domain suite: Combinatorics.

Covers binomial coefficients, recurrences, Stirling's approximation,
generating functions, Catalan numbers, inclusion-exclusion, Pascal's
rule, and derangements.

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
    "function", "binomial", "choose", "factorial", "ceiling", "sum",
    "Abs", "abs", "approximately",
    "intersection", "union",
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

COMBINATORICS_EXPRESSIONS: list[CatalogEntry] = [
    ("comb_binomial_coeff",
     r"\binom{n}{k} = \frac{n!}{k!(n-k)!}",
     PASS,
         "k -> factorial; n -> factorial; k,n -> fn:choose; "
         "k -> negation; n,negation -> add; add -> factorial; "
         "factorial,factorial -> multiply; multiply -> power; "
         "factorial,power -> multiply; "
         "fn:choose,multiply -> rel:equals",
         "k,n -> __choose_2; n -> __factorial_4; k -> __factorial_7; "
         "k -> __negation_10; __negation_10,n -> __add_9; "
         "__add_9 -> __factorial_8; "
         "__factorial_7,__factorial_8 -> __multiply_6; "
         "__multiply_6 -> __power_5; "
         "__factorial_4,__power_5 -> __multiply_3; "
         "__choose_2,__multiply_3 -> __equals_1",
     [{"op": "choose", "type": "function"}]),

    ("comb_recurrence",
     r"a_n = a_{n-1} + a_{n-2}",
     PASS,
         "a_{n - 1},a_{n - 2} -> add; a_{n},add -> rel:equals",
         "a_{n - 1},a_{n - 2} -> __add_2; __add_2,a_{n} -> __equals_1",
     None),

    ("comb_sum_binomial",
     r"\sum_{k=0}^{n} \binom{n}{k} = 2^n",
     PASS,
         "k,n -> fn:choose; n,num -> power; k,num -> rel:equals; "
         "fn:choose,k,n,rel:equals -> sum; power,sum -> rel:equals",
         "k,n -> __choose_5; __num_3,k -> __equals_4; "
         "__num_7,n -> __power_6; __choose_5,__equals_4,k,n -> __sum_2; "
         "__power_6,__sum_2 -> __equals_1",
     None),

    ("comb_stirling",
     r"n! \approx \sqrt{2\pi n} \left(\frac{n}{e}\right)^n",
     PASS,
         "n -> factorial; const:pi,n -> multiply; e -> power; "
         "multiply,num -> multiply; n,power -> multiply; "
         "multiply -> power; multiply,n -> power; "
         "power,power -> multiply; "
         "factorial,multiply -> rel:approximately",
         "n -> __factorial_1; n,pi -> __multiply_6; e -> __power_9; "
         "__multiply_6,__num_5 -> __multiply_4; "
         "__power_9,n -> __multiply_8; __multiply_4 -> __power_3; "
         "__multiply_8,n -> __power_7; "
         "__power_3,__power_7 -> __multiply_2; "
         "__factorial_1,__multiply_2 -> __approximately_10",
     [{"op": "factorial", "type": "operator"}]),

    ("comb_pigeonhole",
     r"\lceil n/k \rceil",
     PASS,
     "k -> power; n,power -> multiply; multiply -> fn:ceiling",
     "k -> __power_3; __power_3,n -> __multiply_2; "
     "__multiply_2 -> __ceiling_1",
     [{"op": "ceiling", "type": "function"}]),

    ("comb_generating_fn",
     r"G(x) = \sum_{n=0}^{\infty} a_n x^n",
     PASS,
         "x -> fn:G; n,x -> power; n,num -> rel:equals; "
         "a_{n},power -> multiply; "
         "const:__const_5,multiply,n,rel:equals -> sum; "
         "fn:G,sum -> rel:equals",
         "x -> __G_2; __num_4,n -> __equals_6; n,x -> __power_8; "
         "__power_8,a_{n} -> __multiply_7; "
         "__const_5,__equals_6,__multiply_7,n -> __sum_3; "
         "__G_2,__sum_3 -> __equals_1",
     None),

    ("comb_catalan",
     r"C_n = \frac{1}{n+1} \binom{2n}{n}",
     PASS,
         "n,num -> add; n,num -> multiply; multiply,n -> fn:choose; "
         "add -> power; fn:choose,power -> multiply; "
         "C_{n},multiply -> rel:equals",
         "__num_5,n -> __add_4; __num_8,n -> __multiply_7; "
         "__multiply_7,n -> __choose_6; __add_4 -> __power_3; "
         "__choose_6,__power_3 -> __multiply_2; "
         "C_{n},__multiply_2 -> __equals_1",
     [{"op": "choose", "type": "function"}]),

    ("comb_inclusion_exclusion",
     r"|A \cup B| = |A| + |B| - |A \cap B|",
     PASS,
         "A -> fn:abs; B -> fn:abs; A,B -> intersection; A,B -> union; "
         "fn:abs,fn:abs -> add; intersection -> fn:abs; union -> fn:abs; "
         "fn:abs -> negation; add,negation -> add; "
         "add,fn:abs -> rel:equals",
         "A -> __abs_6; B -> __abs_7; "
         "A,B -> __intersection_10; A,B -> __union_3; "
         "__union_3 -> __abs_2; __intersection_10 -> __abs_9; "
         "__abs_6,__abs_7 -> __add_5; __abs_9 -> __negation_8; "
         "__add_5,__negation_8 -> __add_4; "
         "__abs_2,__add_4 -> __equals_1",
     None),

    ("comb_pascals_rule",
     r"\binom{n}{k} = \binom{n-1}{k-1} + \binom{n-1}{k}",
     PASS,
         "k,num -> add; n,num -> add; n,num -> add; k,n -> fn:choose; "
         "add,add -> fn:choose; add,k -> fn:choose; "
         "fn:choose,fn:choose -> add; add,fn:choose -> rel:equals",
         "__num_11,n -> __add_10; __num_6,n -> __add_5; "
         "__num_8,k -> __add_7; k,n -> __choose_2; "
         "__add_5,__add_7 -> __choose_4; __add_10,k -> __choose_9; "
         "__choose_4,__choose_9 -> __add_3; "
         "__add_3,__choose_2 -> __equals_1",
     [{"op": "choose", "type": "function"}]),

    ("comb_derangement",
     r"D_n = n! \sum_{k=0}^{n} \frac{(-1)^k}{k!}",
     PASS,
         "k -> factorial; n -> factorial; k,num -> power; "
         "k,num -> rel:equals; factorial -> power; "
         "power,power -> multiply; k,multiply,n,rel:equals -> sum; "
         "factorial,sum -> multiply; D_{n},multiply -> rel:equals",
         "__num_5,k -> __equals_6; k -> __factorial_11; "
         "n -> __factorial_3; __num_9,k -> __power_8; "
         "__factorial_11 -> __power_10; "
         "__power_10,__power_8 -> __multiply_7; "
         "__equals_6,__multiply_7,k,n -> __sum_4; "
         "__factorial_3,__sum_4 -> __multiply_2; "
         "D_{n},__multiply_2 -> __equals_1",
     [{"op": "factorial", "type": "operator"}]),
]


ALL_EXPRESSIONS = COMBINATORICS_EXPRESSIONS


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
class TestCombinatoricsDomain:
    """Combinatorics domain suite — universal + suite-specific invariants."""

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
