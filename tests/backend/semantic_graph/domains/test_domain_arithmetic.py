"""Domain suite: Basic arithmetic.

Covers integer operations, order of operations, negation, absolute value,
fractions, exponents, and nested parentheses.  This is Phase 1 — the parser
is already strong here, so the goal is to lock in coverage and catch
regressions.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph
from tests.backend.semantic_graph.generators.invariants import (
    assert_universal_invariants,
    assert_operators_in,
    assert_has_operator,
    assert_classification_kind_is,
    assert_node_exists,
    find_nodes,
    has_operator,
    operator_ops,
)


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "less_than", "greater_than", "less_equal", "greater_equal",
    "sqrt", "Abs", "abs", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, expected_tag, extra_checks)
#   - expected_tag: "PASS" | "XFAIL" | "SKIP"
#   - extra_checks: callable(graph, latex) or None
#
# As the parser improves, move XFAIL → PASS and strict xfail catches the flip.

def _check_has_equals(graph, latex):
    assert_has_operator(graph, "equals", latex=latex)


def _check_has_add(graph, latex):
    assert_has_operator(graph, "add", latex=latex)


def _check_has_multiply(graph, latex):
    assert_has_operator(graph, "multiply", latex=latex)


def _check_has_power(graph, latex):
    assert_has_operator(graph, "power", latex=latex)


def _check_has_negation(graph, latex):
    assert_has_operator(graph, "negation", latex=latex)


# Expressions with symbolic variables (parser decomposes fully)
VARIABLE_EXPRESSIONS: list[tuple[str, str, str, object]] = [
    ("var_addition",
     r"x + y = z",
     "PASS", _check_has_add),

    ("var_subtraction",
     r"a - b = c",
     "PASS", _check_has_add),  # subtraction → negation + add

    ("var_multiplication",
     r"a \cdot b = c",
     "PASS", _check_has_multiply),

    ("var_times",
     r"a \times b = c",
     "PASS", _check_has_multiply),

    ("var_fraction",
     r"\frac{a}{b} = c",
     "PASS", _check_has_equals),

    ("var_power",
     r"x^2 + y^2 = z^2",
     "PASS", _check_has_power),

    ("var_nested_parens",
     r"((a + b) \cdot c) = ac + bc",
     "PASS", _check_has_multiply),

    ("var_negation",
     r"-x = y",
     "PASS", _check_has_negation),

    ("var_double_negation",
     r"-(-x) = x",
     "PASS", None),  # SymPy simplifies to True → single expression node (no decomposition)

    ("var_sqrt",
     r"\sqrt{x} = y",
     "PASS", _check_has_power),

    ("var_mixed_ops",
     r"a + b \cdot c = d",
     "PASS", _check_has_add),

    ("var_triple_add",
     r"a + b + c = d",
     "PASS", _check_has_add),

    ("var_negative_exponent",
     r"x^{-1} = y",
     "PASS", _check_has_power),

    ("var_frac_equation",
     r"\frac{x + y}{z} = w",
     "PASS", _check_has_equals),

    ("var_nested_frac",
     r"\frac{\frac{a}{b}}{c} = d",
     "PASS", _check_has_equals),
]

# Expressions with only numeric literals — parser collapses to expression node
NUMERIC_EXPRESSIONS: list[tuple[str, str, str, object]] = [
    ("num_addition",
     r"2 + 3 = 5",
     "PASS", None),

    ("num_subtraction",
     r"7 - 4 = 3",
     "PASS", None),

    ("num_multiplication",
     r"3 \times 4 = 12",
     "PASS", None),

    ("num_division",
     r"\frac{10}{2} = 5",
     "PASS", None),

    ("num_order_of_ops",
     r"2 + 3 \times 4 = 14",
     "PASS", None),

    ("num_exponents",
     r"2^3 = 8",
     "PASS", None),

    ("num_mixed_fracs",
     r"\frac{1}{2} + \frac{3}{4} = \frac{5}{4}",
     "PASS", None),
]

# Absolute value expressions
ABS_EXPRESSIONS: list[tuple[str, str, str, object]] = [
    ("abs_basic",
     r"|x - 3| = 5",
     "PASS", _check_has_equals),

    ("abs_variable",
     r"|x| = y",
     "PASS", _check_has_equals),
]


ALL_EXPRESSIONS = VARIABLE_EXPRESSIONS + NUMERIC_EXPRESSIONS + ABS_EXPRESSIONS


# ── Test collection ─────────────────────────────────────────────────────


def _build_params():
    """Build pytest parametrize params with proper marks."""
    params = []
    for test_id, latex, tag, extra in ALL_EXPRESSIONS:
        marks = []
        if tag == "XFAIL":
            marks.append(pytest.mark.xfail(strict=True, reason="Known parser limitation"))
        elif tag == "SKIP":
            marks.append(pytest.mark.skip(reason="Feature not yet implemented"))
        params.append(pytest.param(latex, extra, id=test_id, marks=marks))
    return params


@pytest.mark.parametrize("latex, extra_check", _build_params())
class TestArithmeticDomain:
    """Arithmetic domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, latex, extra_check):
        graph = latex_to_semantic_graph(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, latex, extra_check):
        graph = latex_to_semantic_graph(latex)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, latex, extra_check):
        graph = latex_to_semantic_graph(latex)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_suite_specific(self, latex, extra_check):
        if extra_check is None:
            pytest.skip("No suite-specific check for this expression")
        graph = latex_to_semantic_graph(latex)
        extra_check(graph, latex)


# ── Extensibility: add regression cases here ────────────────────────────
#
# When a bug is discovered in arithmetic parsing, add the failing expression
# to the appropriate list above (VARIABLE_EXPRESSIONS, NUMERIC_EXPRESSIONS,
# or ABS_EXPRESSIONS) with tag="XFAIL". Once fixed, flip to "PASS".
# The strict xfail ensures CI notices the fix.
#
# For targeted regression tests that need custom assertions beyond the
# universal + suite-specific invariants, add them below:


class TestArithmeticRegressions:
    """Regression tests for specific arithmetic parsing issues."""

    def test_subtraction_is_negation_plus_add(self):
        """Subtraction ``a - b`` should produce negation + add, not subtract."""
        g = latex_to_semantic_graph(r"a - b = c")
        ops = operator_ops(g)
        assert "add" in ops, f"Expected 'add' in ops, got {ops}"
        assert "negation" in ops, f"Expected 'negation' in ops, got {ops}"

    def test_fraction_produces_multiply_and_power(self):
        r"""``\frac{a}{b}`` decomposes to multiply + power (b^-1)."""
        g = latex_to_semantic_graph(r"\frac{a}{b} = c")
        ops = operator_ops(g)
        assert "multiply" in ops, f"Expected 'multiply' in ops, got {ops}"
        assert "power" in ops, f"Expected 'power' in ops, got {ops}"

    def test_numeric_expression_has_classification(self):
        """Even pure numeric expressions should have a classification."""
        g = latex_to_semantic_graph(r"2 + 3 = 5")
        assert g.classification.kind == "algebraic"

    def test_sqrt_becomes_power(self):
        r"""``\sqrt{x}`` should be represented as power (x^{1/2})."""
        g = latex_to_semantic_graph(r"\sqrt{x} = y")
        assert has_operator(g, "power"), (
            f"sqrt should produce power op, got {operator_ops(g)}"
        )
