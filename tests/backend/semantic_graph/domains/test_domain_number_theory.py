"""Domain suite: Number theory.

Covers modular arithmetic, divisibility, GCD, floor/ceiling functions,
prime counting, Euler's totient, Fermat's little theorem, and the
Legendre symbol.  Many notations (``\\pmod``, ``\\equiv``, ``\\mid``)
are parsed as plain symbols — entries lock in current behavior.

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
    "function", "gcd", "floor", "ceiling",
    "phi", "pi", "factorial", "log",
    "binomial", "congruent", "divides",
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

NUMBER_THEORY_EXPRESSIONS: list[CatalogEntry] = [
    ("nt_modular",
     r"a \equiv b \pmod{n}",
     PASS,
     "a,b,n -> rel:congruent",
     "a,b,n -> __congruent_1",
     [{"op": "congruent", "type": "relation"}]),

    ("nt_divides",
     r"a \mid b",
     PASS,
     "a,b -> rel:divides",
     "a,b -> __divides_1",
     [{"op": "divides", "type": "relation"}]),

    ("nt_gcd",
     r"\gcd(a, b) = d",
     PASS,
         "a,b -> fn:gcd; d,fn:gcd -> rel:equals",
         "a,b -> __gcd_2; __gcd_2,d -> __equals_1",
     [{"op": "gcd", "type": "function"}]),

    ("nt_floor",
     r"\lfloor x \rfloor = n",
     PASS,
         "x -> fn:floor; fn:floor,n -> rel:equals",
         "x -> __floor_2; __floor_2,n -> __equals_1",
     [{"op": "floor", "type": "function"}]),

    ("nt_ceiling",
     r"\lceil x \rceil = n",
     PASS,
         "x -> fn:ceiling; fn:ceiling,n -> rel:equals",
         "x -> __ceiling_2; __ceiling_2,n -> __equals_1",
     [{"op": "ceiling", "type": "function"}]),

    ("nt_prime_counting",
     r"\pi(x) \sim \frac{x}{\ln x}",
     PASS,
     "const:__const_7,x -> fn:log; x -> fn:pi; fn:log -> power; "
     "power,x -> multiply; multiply,sim -> multiply; "
     "fn:pi,multiply -> multiply",
     "__const_7,x -> __log_6; x -> __pi_2; __log_6 -> __power_5; "
     "__power_5,x -> __multiply_4; __multiply_4,sim -> __multiply_3; "
     "__multiply_3,__pi_2 -> __multiply_1",
     None),

    ("nt_euler_totient",
     r"\phi(n) = n",
     PASS,
         "n -> fn:phi; fn:phi,n -> rel:equals",
         "n -> __phi_2; __phi_2,n -> __equals_1",
     [{"op": "phi", "type": "function"}]),

    ("nt_fermat_little",
     r"a^{p-1} \equiv 1 \pmod{p}",
     PASS,
     "num,p -> add; a,add -> power; num,p,power -> rel:congruent",
     "__num_3,p -> __add_2; __add_2,a -> __power_1; "
     "__num_4,__power_1,p -> __congruent_5",
     [{"op": "congruent", "type": "relation"}]),

    ("nt_sum_divisors",
     r"\sum_{d \mid n} d = \sigma(n)",
     XFAIL,
     "", "",
     None),

    ("nt_factorial",
     r"n! = n \cdot (n-1)!",
     PASS,
     "n,num -> add; n -> factorial; add -> factorial; "
     "factorial,n -> multiply; factorial,multiply -> rel:equals",
     "__num_6,n -> __add_5; n -> __factorial_2; __add_5 -> __factorial_4; "
     "__factorial_4,n -> __multiply_3; __factorial_2,__multiply_3 -> __equals_1",
     [{"op": "factorial", "type": "operator"}]),

    ("nt_legendre",
     r"\left(\frac{a}{p}\right) = a^{(p-1)/2} \pmod{p}",
     PASS,
         "num,p -> add; num -> power; p -> power; "
         "a,power -> multiply; add,power -> multiply; "
         "a,multiply -> power; multiply,power -> rel:equals",
         "__num_7,p -> __add_6; p -> __power_3; __num_9 -> __power_8; "
         "__power_3,a -> __multiply_2; "
         "__add_6,__power_8 -> __multiply_5; "
         "__multiply_5,a -> __power_4; "
         "__multiply_2,__power_4 -> __equals_1",
     [{"type": "annotation", "label": "mod p"}]),

    ("nt_congruence",
     r"a \equiv b \pmod{m}",
     PASS,
     "a,b,m -> rel:congruent",
     "a,b,m -> __congruent_1",
     [{"op": "congruent", "type": "relation"}]),
]


ALL_EXPRESSIONS = NUMBER_THEORY_EXPRESSIONS


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
class TestNumberTheoryDomain:
    """Number theory domain suite — universal + suite-specific invariants."""

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
