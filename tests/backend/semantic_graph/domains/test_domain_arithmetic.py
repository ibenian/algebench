"""Domain suite: Basic arithmetic.

Covers integer operations, order of operations, negation, absolute value,
fractions, exponents, and nested parentheses.  This is Phase 1 — the parser
is already strong here, so the goal is to lock in coverage and catch
regressions.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.

Connectivity is verified via ``graph_signature()`` — a canonical string
encoding of the graph's edge structure (e.g. ``"x,y -> add; add,z -> equals"``).
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
)


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "less_than", "greater_than", "less_equal", "greater_equal",
    "sqrt", "Abs", "abs", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id)
#   - tag: PASS | XFAIL | SKIP (imported from invariants)
#   - sig_by_type: label_by_type connectivity string (type-prefixed labels)
#   - sig_by_id:   label_by_id connectivity string (raw node IDs)
#   - "" for collapsed expressions (no edges)
#
# XFAIL is strict — CI catches the fix and prompts mark removal.

# Expressions with symbolic variables (parser decomposes fully)
VARIABLE_EXPRESSIONS: list[tuple[str, str, object, str, str]] = [
    ("var_addition",
     r"x + y = z",
     PASS,
     "x,y -> add; add,z -> equals",
     "x,y -> __add_2; __add_2,z -> __equals_1"),

    ("var_subtraction",
     r"a - b = c",
     PASS,
     "b -> negation; negation,vec:a -> add; add,c -> equals",
     "b -> __negation_3; __negation_3,a -> __add_2; __add_2,c -> __equals_1"),

    ("var_multiplication",
     r"a \cdot b = c",
     PASS,
     "b,vec:a -> multiply; c,multiply -> equals",
     "a,b -> __multiply_2; __multiply_2,c -> __equals_1"),

    ("var_times",
     r"a \times b = c",
     PASS,
     "b,vec:a -> multiply; c,multiply -> equals",
     "a,b -> __multiply_2; __multiply_2,c -> __equals_1"),

    ("var_fraction",
     r"\frac{a}{b} = c",
     PASS,
     "b -> power; power,vec:a -> multiply; c,multiply -> equals",
     "b -> __power_3; __power_3,a -> __multiply_2; __multiply_2,c -> __equals_1"),

    ("var_power",
     r"x^2 + y^2 = z^2",
     PASS,
     "x -> power; y -> power; z -> power; power,power -> add; add,power -> equals",
     "x -> __power_3; y -> __power_4; z -> __power_5; "
     "__power_3,__power_4 -> __add_2; __add_2,__power_5 -> __equals_1"),

    ("var_nested_parens",
     r"((a + b) \cdot c) = ac + bc",
     PASS,
     "b,vec:a -> add; b,c -> multiply; c,vec:a -> multiply; "
     "multiply,multiply -> add; add,c -> multiply; add,multiply -> equals",
     "a,b -> __add_3; a,c -> __multiply_5; b,c -> __multiply_6; "
     "__multiply_5,__multiply_6 -> __add_4; __add_3,c -> __multiply_2; "
     "__add_4,__multiply_2 -> __equals_1"),

    ("var_negation",
     r"-x = y",
     PASS,
     "x -> negation; negation,y -> equals",
     "x -> __negation_2; __negation_2,y -> __equals_1"),

    ("var_double_negation",
     r"-(-x) = x",
     PASS, "", ""),

    ("var_sqrt",
     r"\sqrt{x} = y",
     PASS,
     "x -> power; power,y -> equals",
     "x -> __power_2; __power_2,y -> __equals_1"),

    ("var_mixed_ops",
     r"a + b \cdot c = d",
     PASS,
     "b,c -> multiply; multiply,vec:a -> add; add,d -> equals",
     "b,c -> __multiply_3; __multiply_3,a -> __add_2; __add_2,d -> __equals_1"),

    ("var_triple_add",
     r"a + b + c = d",
     PASS,
     "b,vec:a -> add; add,c -> add; add,d -> equals",
     "a,b -> __add_3; __add_3,c -> __add_2; __add_2,d -> __equals_1"),

    ("var_negative_exponent",
     r"x^{-1} = y",
     PASS,
     "x -> power; power,y -> equals",
     "x -> __power_2; __power_2,y -> __equals_1"),

    ("var_frac_equation",
     r"\frac{x + y}{z} = w",
     PASS,
     "x,y -> add; z -> power; add,power -> multiply; multiply,w -> equals",
     "x,y -> __add_3; z -> __power_4; "
     "__add_3,__power_4 -> __multiply_2; __multiply_2,w -> __equals_1"),

    ("var_nested_frac",
     r"\frac{\frac{a}{b}}{c} = d",
     PASS,
     "b -> power; c -> power; power,vec:a -> multiply; "
     "multiply,power -> multiply; d,multiply -> equals",
     "b -> __power_4; c -> __power_5; __power_4,a -> __multiply_3; "
     "__multiply_3,__power_5 -> __multiply_2; __multiply_2,d -> __equals_1"),
]

# Expressions with only numeric literals — parser collapses to BooleanTrue
NUMERIC_EXPRESSIONS: list[tuple[str, str, object, str, str]] = [
    ("num_addition",       r"2 + 3 = 5",                                       PASS, "", ""),
    ("num_subtraction",    r"7 - 4 = 3",                                       PASS, "", ""),
    ("num_multiplication", r"3 \times 4 = 12",                                 PASS, "", ""),
    ("num_division",       r"\frac{10}{2} = 5",                                PASS, "", ""),
    ("num_order_of_ops",   r"2 + 3 \times 4 = 14",                             PASS, "", ""),
    ("num_exponents",      r"2^3 = 8",                                         PASS, "", ""),
    ("num_mixed_fracs",    r"\frac{1}{2} + \frac{3}{4} = \frac{5}{4}",         PASS, "", ""),
]

# Absolute value expressions
ABS_EXPRESSIONS: list[tuple[str, str, object, str, str]] = [
    ("abs_basic",
     r"|x - 3| = 5",
     PASS,
     "num,x -> add; add -> fn:Abs; fn:Abs,num -> equals",
     "__num_4,x -> __add_3; __add_3 -> __Abs_2; __Abs_2,__num_5 -> __equals_1"),

    ("abs_variable",
     r"|x| = y",
     PASS,
     "x -> fn:Abs; fn:Abs,y -> equals",
     "x -> __Abs_2; __Abs_2,y -> __equals_1"),
]


ALL_EXPRESSIONS = VARIABLE_EXPRESSIONS + NUMERIC_EXPRESSIONS + ABS_EXPRESSIONS


# ── Test collection ─────────────────────────────────────────────────────


def _build_params():
    """Build pytest parametrize params from the expression catalog."""
    params = []
    for test_id, latex, tag, sig_type, sig_id in ALL_EXPRESSIONS:
        marks = [tag] if tag is not None else []
        params.append(pytest.param(
            latex, sig_type, sig_id, id=test_id, marks=marks,
        ))
    return params


@pytest.mark.parametrize("latex, sig_type, sig_id", _build_params())
class TestArithmeticDomain:
    """Arithmetic domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id):
        graph = parse(latex)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id):
        graph = parse(latex)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id):
        graph = parse(latex)
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id):
        graph = parse(latex)
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)


# ── Extensibility: add regression cases here ────────────────────────────
#
# When a bug is discovered in arithmetic parsing, add the failing expression
# to the appropriate list above with tag=XFAIL. Once fixed, the strict xfail
# will fail CI, prompting removal of the mark.


class TestArithmeticRegressions:
    """Regression tests for specific arithmetic parsing issues."""

    def test_numeric_expression_has_classification(self, parse):
        """Even pure numeric expressions should have a classification."""
        g = parse(r"2 + 3 = 5")
        assert g.classification.kind == "algebraic"
