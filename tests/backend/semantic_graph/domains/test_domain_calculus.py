"""Domain suite: Single-variable calculus.

Covers limits, derivatives, integrals, series, and Taylor expansion.
This is Phase 1 — locking in coverage for core calculus constructs.

Suite-specific invariant (from design doc §8.3):
  Derivative/integral structures produce expected operator nodes.
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
    "add", "multiply", "power", "equals", "negation",
    "derivative", "integral", "sum", "function",
    "Limit", "Tuple",
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

LIMIT_EXPRESSIONS: list[CatalogEntry] = [
    ("limit_basic",
     r"\lim_{x \to 0} \frac{\sin x}{x} = 1",
     PASS,
     "x -> fn:sin; x -> power; fn:sin,power -> multiply; "
     "+-,multiply,num,x -> Limit; Limit,num -> equals",
     "x -> __power_5; x -> __sin_4; __power_5,__sin_4 -> __multiply_3; "
     "+-,__multiply_3,__num_6,x -> __expr_2; __expr_2,__num_7 -> __equals_1",
     [{"op": "Limit", "type": "expression"}]),

    ("lhopital",
     r"\lim_{x \to a} \frac{f(x)}{g(x)} = \lim_{x \to a} \frac{f'(x)}{g'(x)}",
     PASS,
     "x -> fn:f; x -> fn:f'; x -> fn:g; x -> fn:g'; fn:g -> power; "
     "fn:g' -> power; fn:f,power -> multiply; fn:f',power -> multiply; "
     "+-,a,multiply,x -> Limit; +-,a,multiply,x -> Limit; "
     "Limit,Limit -> equals",
     "x -> __f'_9; x -> __f_4; x -> __g'_11; x -> __g_6; "
     "__g'_11 -> __power_10; __g_6 -> __power_5; "
     "__f_4,__power_5 -> __multiply_3; __f'_9,__power_10 -> __multiply_8; "
     "+-,__multiply_3,a,x -> __expr_2; +-,__multiply_8,a,x -> __expr_7; "
     "__expr_2,__expr_7 -> __equals_1",
     [{"op": "Limit", "type": "expression"}]),
]

DERIVATIVE_EXPRESSIONS: list[CatalogEntry] = [
    ("derivative_power",
     r"\frac{d}{dx} x^n = n x^{n-1}",
     PASS,
     "n,num -> add; n,x -> power; power,x -> derivative; add,x -> power; "
     "n,power -> multiply; derivative,multiply -> equals",
     "__num_7,n -> __add_6; n,x -> __power_3; __power_3,x -> __deriv_2; "
     "__add_6,x -> __power_5; __power_5,n -> __multiply_4; "
     "__deriv_2,__multiply_4 -> __equals_1",
     [{"op": "derivative"}]),

    ("derivative_chain",
     r"\frac{dy}{dx} = \frac{dy}{du} \cdot \frac{du}{dx}",
     PASS,
     "u,x -> derivative; u,y -> derivative; x,y -> derivative; "
     "derivative,derivative -> multiply; derivative,multiply -> equals",
     "x,y -> __deriv_2; u,y -> __deriv_4; u,x -> __deriv_5; "
     "__deriv_4,__deriv_5 -> __multiply_3; "
     "__deriv_2,__multiply_3 -> __equals_1",
     [{"op": "derivative"}]),

    ("product_rule",
     r"(fg)' = f'g + fg'",
     PASS,
     "f,g -> multiply",
     "f,g -> __multiply_1",
     None),

    ("quotient_rule",
     r"\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}",
     PASS,
     "g -> power; f,power -> multiply",
     "g -> __power_2; __power_2,f -> __multiply_1",
     [{"op": "power", "exponent": "-1"}]),

    ("mvt",
     r"f'(c) = \frac{f(b) - f(a)}{b - a}",
     PASS,
     "a -> fn:f; b -> fn:f; c -> fn:f'; a -> negation; b,negation -> add; "
     "fn:f -> negation; fn:f,negation -> add; add -> power; "
     "add,power -> multiply; fn:f',multiply -> equals",
     "c -> __f'_2; b -> __f_5; a -> __f_7; a -> __negation_10; "
     "__negation_10,b -> __add_9; __f_7 -> __negation_6; "
     "__f_5,__negation_6 -> __add_4; __add_9 -> __power_8; "
     "__add_4,__power_8 -> __multiply_3; "
     "__f'_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
]

INTEGRAL_EXPRESSIONS: list[CatalogEntry] = [
    ("integral_power",
     r"\int x^n \, dx = \frac{x^{n+1}}{n+1} + C",
     PASS,
     "x -> Tuple; n,num -> add; n,num -> add; n,x -> power; "
     "Tuple,power -> integral; add -> power; add,x -> power; "
     "power,power -> multiply; C,multiply -> add; add,integral -> equals",
     "__num_12,n -> __add_11; __num_9,n -> __add_8; x -> __expr_4; "
     "n,x -> __power_3; __expr_4,__power_3 -> __integral_2; "
     "__add_11 -> __power_10; __add_8,x -> __power_7; "
     "__power_10,__power_7 -> __multiply_6; C,__multiply_6 -> __add_5; "
     "__add_5,__integral_2 -> __equals_1",
     [{"op": "integral"}]),

    ("integral_definite",
     r"\int_a^b f(x) \, dx = F(b) - F(a)",
     PASS,
     "a,b,x -> Tuple; a -> fn:F; b -> fn:F; x -> fn:f; "
     "Tuple,fn:f -> integral; fn:F -> negation; fn:F,negation -> add; "
     "add,integral -> equals",
     "b -> __F_6; a -> __F_8; a,b,x -> __expr_4; x -> __f_3; "
     "__expr_4,__f_3 -> __integral_2; __F_8 -> __negation_7; "
     "__F_6,__negation_7 -> __add_5; __add_5,__integral_2 -> __equals_1",
     [{"op": "integral"}]),

    ("ftc",
     r"\frac{d}{dx} \int_a^x f(t) \, dt = f(x)",
     PASS,
     "a,t,x -> Tuple; t -> fn:f; x -> fn:f; Tuple,fn:f -> integral; "
     "integral,x -> derivative; derivative,fn:f -> equals",
     "a,t,x -> __expr_5; t -> __f_4; x -> __f_6; "
     "__expr_5,__f_4 -> __integral_3; __integral_3,x -> __deriv_2; "
     "__deriv_2,__f_6 -> __equals_1",
     [{"op": "integral"}, {"op": "derivative"}]),
]

SERIES_EXPRESSIONS: list[CatalogEntry] = [
    ("taylor_exp",
     r"e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}",
     PASS,
     "const:__const_10,n,num -> Tuple; n -> fn:factorial; e,x -> power; "
     "n,x -> power; fn:factorial -> power; power,power -> multiply; "
     "Tuple,multiply -> sum; power,sum -> equals",
     "__const_10,__num_9,n -> __expr_8; n -> __factorial_7; e,x -> __power_2; "
     "n,x -> __power_5; __factorial_7 -> __power_6; "
     "__power_5,__power_6 -> __multiply_4; __expr_8,__multiply_4 -> __sum_3; "
     "__power_2,__sum_3 -> __equals_1",
     [{"op": "sum"}, {"op": "factorial", "type": "function"}]),

    ("series_geometric",
     r"\sum_{n=0}^{\infty} r^n = \frac{1}{1 - r}",
     PASS,
     "const:__const_6,n,num -> Tuple; r -> negation; n,r -> power; "
     "negation,num -> add; Tuple,power -> sum; add -> power; "
     "power,sum -> equals",
     "__const_6,__num_5,n -> __expr_4; r -> __negation_10; n,r -> __power_3; "
     "__negation_10,__num_9 -> __add_8; __expr_4,__power_3 -> __sum_2; "
     "__add_8 -> __power_7; __power_7,__sum_2 -> __equals_1",
     [{"op": "sum"}]),
]

ALL_EXPRESSIONS = (
    LIMIT_EXPRESSIONS
    + DERIVATIVE_EXPRESSIONS
    + INTEGRAL_EXPRESSIONS
    + SERIES_EXPRESSIONS
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
class TestCalculusDomain:
    """Calculus domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"algebraic", "ODE", "PDE"}, (
            f"Expected algebraic/ODE/PDE classification, got {kind!r} for: {latex!r}"
        )

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


class TestCalculusRegressions:
    """Regression tests for specific calculus parsing issues."""
