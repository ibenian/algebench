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
# Each entry: (test_id, latex, tag, expected_signature)
#   - tag: PASS | XFAIL | SKIP (imported from invariants)
#   - expected_signature: connectivity string ("" for collapsed expressions)
#
# XFAIL is strict — CI catches the fix and prompts mark removal.

# Expressions with symbolic variables (parser decomposes fully)
VARIABLE_EXPRESSIONS: list[tuple[str, str, object, str]] = [
    ("var_addition",
     r"x + y = z",
     PASS, "x,y -> add; add,z -> equals"),

    ("var_subtraction",
     r"a - b = c",
     PASS, "b -> negation; a,negation -> add; add,c -> equals"),

    ("var_multiplication",
     r"a \cdot b = c",
     PASS, "a,b -> multiply; c,multiply -> equals"),

    ("var_times",
     r"a \times b = c",
     PASS, "a,b -> multiply; c,multiply -> equals"),

    ("var_fraction",
     r"\frac{a}{b} = c",
     PASS, "b -> power; a,power -> multiply; c,multiply -> equals"),

    ("var_power",
     r"x^2 + y^2 = z^2",
     PASS, "x -> power; y -> power; z -> power; power,power -> add; add,power -> equals"),

    ("var_nested_parens",
     r"((a + b) \cdot c) = ac + bc",
     PASS,
     "a,b -> add; a,c -> multiply; b,c -> multiply; "
     "multiply,multiply -> add; add,c -> multiply; add,multiply -> equals"),

    ("var_negation",
     r"-x = y",
     PASS, "x -> negation; negation,y -> equals"),

    ("var_double_negation",
     r"-(-x) = x",
     PASS, ""),  # SymPy simplifies to BooleanTrue — single node, no edges

    ("var_sqrt",
     r"\sqrt{x} = y",
     PASS, "x -> power; power,y -> equals"),

    ("var_mixed_ops",
     r"a + b \cdot c = d",
     PASS, "b,c -> multiply; a,multiply -> add; add,d -> equals"),

    ("var_triple_add",
     r"a + b + c = d",
     PASS, "a,b -> add; add,c -> add; add,d -> equals"),

    ("var_negative_exponent",
     r"x^{-1} = y",
     PASS, "x -> power; power,y -> equals"),

    ("var_frac_equation",
     r"\frac{x + y}{z} = w",
     PASS, "x,y -> add; z -> power; add,power -> multiply; multiply,w -> equals"),

    ("var_nested_frac",
     r"\frac{\frac{a}{b}}{c} = d",
     PASS,
     "b -> power; c -> power; a,power -> multiply; "
     "multiply,power -> multiply; d,multiply -> equals"),
]

# Expressions with only numeric literals — parser collapses to BooleanTrue
NUMERIC_EXPRESSIONS: list[tuple[str, str, object, str]] = [
    ("num_addition",       r"2 + 3 = 5",                                       PASS, ""),
    ("num_subtraction",    r"7 - 4 = 3",                                       PASS, ""),
    ("num_multiplication", r"3 \times 4 = 12",                                 PASS, ""),
    ("num_division",       r"\frac{10}{2} = 5",                                PASS, ""),
    ("num_order_of_ops",   r"2 + 3 \times 4 = 14",                             PASS, ""),
    ("num_exponents",      r"2^3 = 8",                                         PASS, ""),
    ("num_mixed_fracs",    r"\frac{1}{2} + \frac{3}{4} = \frac{5}{4}",         PASS, ""),
]

# Absolute value expressions
ABS_EXPRESSIONS: list[tuple[str, str, object, str]] = [
    ("abs_basic",
     r"|x - 3| = 5",
     PASS, "num,x -> add; add -> Abs; Abs,num -> equals"),

    ("abs_variable",
     r"|x| = y",
     PASS, "x -> Abs; Abs,y -> equals"),
]


ALL_EXPRESSIONS = VARIABLE_EXPRESSIONS + NUMERIC_EXPRESSIONS + ABS_EXPRESSIONS


# ── Test collection ─────────────────────────────────────────────────────


def _build_params():
    """Build pytest parametrize params from the expression catalog."""
    params = []
    for test_id, latex, tag, expected_sig in ALL_EXPRESSIONS:
        marks = [tag] if tag is not None else []
        params.append(pytest.param(latex, expected_sig, id=test_id, marks=marks))
    return params


@pytest.mark.parametrize("latex, expected_sig", _build_params())
class TestArithmeticDomain:
    """Arithmetic domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, expected_sig):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, parse, latex, expected_sig):
        graph = parse(latex)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, expected_sig):
        graph = parse(latex)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity(self, parse, latex, expected_sig):
        graph = parse(latex)
        assert_signature(graph, expected_sig, latex=latex)


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
