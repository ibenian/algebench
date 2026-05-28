"""Domain suite: Trigonometry.

Covers trig identities, inverse trig functions, hyperbolic functions,
and Euler's formula.  Many of these push parser boundaries with
composed function calls and implicit multiplication.

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
    "sin", "cos", "tan", "csc", "sec", "cot",
    "asin", "acos", "atan",
    "sinh", "cosh", "tanh",
    "function",
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

TRIG_EXPRESSIONS: list[CatalogEntry] = [
    ("trig_sin_eq",
     r"\sin(x) = y",
     PASS,
         "x -> fn:sin; fn:sin,y -> rel:equals",
         "x -> __sin_2; __sin_2,y -> __equals_1",
     [{"op": "sin", "type": "function"}]),

    ("trig_cos_eq",
     r"\cos(x) = y",
     PASS,
         "x -> fn:cos; fn:cos,y -> rel:equals",
         "x -> __cos_2; __cos_2,y -> __equals_1",
     [{"op": "cos", "type": "function"}]),

    ("trig_tan_eq",
     r"\tan(x) = y",
     PASS,
         "x -> fn:tan; fn:tan,y -> rel:equals",
         "x -> __tan_2; __tan_2,y -> __equals_1",
     [{"op": "tan", "type": "function"}]),

    ("trig_pythagorean",
     r"\sin^2(x) + \cos^2(x) = 1",
     PASS,
         "x -> fn:cos; x -> fn:sin; fn:cos -> power; fn:sin -> power; "
         "power,power -> add; add,num -> rel:equals",
         "x -> __cos_6; x -> __sin_4; __sin_4 -> __power_3; "
         "__cos_6 -> __power_5; __power_3,__power_5 -> __add_2; "
         "__add_2,__num_7 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("trig_double_angle_sin",
     r"\sin(2x) = 2\sin(x)\cos(x)",
     PASS,
         "x -> fn:cos; x -> fn:sin; num,x -> multiply; "
         "multiply -> fn:sin; fn:cos,fn:sin -> multiply; "
         "multiply,num -> multiply; fn:sin,multiply -> rel:equals",
         "x -> __cos_9; __num_4,x -> __multiply_3; x -> __sin_8; "
         "__cos_9,__sin_8 -> __multiply_7; __multiply_3 -> __sin_2; "
         "__multiply_7,__num_6 -> __multiply_5; "
         "__multiply_5,__sin_2 -> __equals_1",
     None),

    ("trig_sum_formula",
     r"\sin(a + b) = \sin(a)\cos(b) + \cos(a)\sin(b)",
     PASS,
         "a,b -> add; a -> fn:cos; b -> fn:cos; a -> fn:sin; "
         "b -> fn:sin; add -> fn:sin; fn:cos,fn:sin -> multiply; "
         "fn:cos,fn:sin -> multiply; multiply,multiply -> add; "
         "add,fn:sin -> rel:equals",
         "a,b -> __add_3; b -> __cos_7; a -> __cos_9; b -> __sin_10; "
         "a -> __sin_6; __cos_7,__sin_6 -> __multiply_5; "
         "__cos_9,__sin_10 -> __multiply_8; __add_3 -> __sin_2; "
         "__multiply_5,__multiply_8 -> __add_4; "
         "__add_4,__sin_2 -> __equals_1",
     None),

    ("trig_arcsin",
     r"\arcsin(x) = y",
     PASS,
         "x -> fn:asin; fn:asin,y -> rel:equals",
         "x -> __asin_2; __asin_2,y -> __equals_1",
     [{"op": "asin", "type": "function"}]),

    ("trig_arccos",
     r"\arccos(x) = y",
     PASS,
         "x -> fn:acos; fn:acos,y -> rel:equals",
         "x -> __acos_2; __acos_2,y -> __equals_1",
     [{"op": "acos", "type": "function"}]),

    ("trig_arctan",
     r"\arctan(x) = y",
     PASS,
         "x -> fn:atan; fn:atan,y -> rel:equals",
         "x -> __atan_2; __atan_2,y -> __equals_1",
     [{"op": "atan", "type": "function"}]),

    ("trig_sinh",
     r"\sinh(x) = y",
     PASS,
         "x -> fn:sinh; fn:sinh,y -> rel:equals",
         "x -> __sinh_2; __sinh_2,y -> __equals_1",
     [{"op": "sinh", "type": "function"}]),

    ("trig_cosh",
     r"\cosh(x) = y",
     PASS,
         "x -> fn:cosh; fn:cosh,y -> rel:equals",
         "x -> __cosh_2; __cosh_2,y -> __equals_1",
     [{"op": "cosh", "type": "function"}]),

    ("trig_tanh",
     r"\tanh(x) = y",
     PASS,
         "x -> fn:tanh; fn:tanh,y -> rel:equals",
         "x -> __tanh_2; __tanh_2,y -> __equals_1",
     [{"op": "tanh", "type": "function"}]),

    ("trig_euler",
     r"e^{ix} = \cos(x) + i\sin(x)",
     PASS,
         "x -> fn:cos; x -> fn:sin; i,x -> multiply; "
         "fn:sin,i -> multiply; e,multiply -> power; "
         "fn:cos,multiply -> add; add,power -> rel:equals",
         "x -> __cos_5; i,x -> __multiply_3; x -> __sin_7; "
         "__sin_7,i -> __multiply_6; __multiply_3,e -> __power_2; "
         "__cos_5,__multiply_6 -> __add_4; "
         "__add_4,__power_2 -> __equals_1",
     None),

    ("trig_csc",
     r"\csc(x) = \frac{1}{\sin(x)}",
     PASS,
         "x -> fn:csc; x -> fn:sin; fn:sin -> power; "
         "fn:csc,power -> rel:equals",
         "x -> __csc_2; x -> __sin_4; __sin_4 -> __power_3; "
         "__csc_2,__power_3 -> __equals_1",
     [{"op": "csc", "type": "function"}]),

    ("trig_sec",
     r"\sec(x) = \frac{1}{\cos(x)}",
     PASS,
         "x -> fn:cos; x -> fn:sec; fn:cos -> power; "
         "fn:sec,power -> rel:equals",
         "x -> __cos_4; x -> __sec_2; __cos_4 -> __power_3; "
         "__power_3,__sec_2 -> __equals_1",
     [{"op": "sec", "type": "function"}]),

    ("trig_cot",
     r"\cot(x) = \frac{1}{\tan(x)}",
     PASS,
         "x -> fn:cot; x -> fn:tan; fn:tan -> power; "
         "fn:cot,power -> rel:equals",
         "x -> __cot_2; x -> __tan_4; __tan_4 -> __power_3; "
         "__cot_2,__power_3 -> __equals_1",
     [{"op": "cot", "type": "function"}]),
]


ALL_EXPRESSIONS = TRIG_EXPRESSIONS


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
class TestTrigonometryDomain:
    """Trigonometry domain suite — universal + suite-specific invariants."""

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
