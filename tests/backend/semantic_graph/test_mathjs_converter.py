"""Tests for backend.semantic_graph.mathjs_converter — LaTeX → mathjs pipeline."""

from __future__ import annotations

import pytest

from backend.semantic_graph.mathjs_converter import jscode_to_mathjs, latex_to_mathjs


# ── jscode → mathjs string conversion ─────────────────────────────────

class TestJscodeToMathjs:
    """Unit tests for the regex-based jscode → mathjs conversion."""

    # -- Function prefix stripping --

    def test_sin(self):
        assert jscode_to_mathjs("Math.sin(x)") == "sin(x)"

    def test_cos(self):
        assert jscode_to_mathjs("Math.cos(x)") == "cos(x)"

    def test_tan(self):
        assert jscode_to_mathjs("Math.tan(x)") == "tan(x)"

    def test_sqrt(self):
        assert jscode_to_mathjs("Math.sqrt(x)") == "sqrt(x)"

    def test_abs(self):
        assert jscode_to_mathjs("Math.abs(x)") == "abs(x)"

    def test_exp(self):
        assert jscode_to_mathjs("Math.exp(x)") == "exp(x)"

    def test_log(self):
        assert jscode_to_mathjs("Math.log(x)") == "log(x)"

    def test_pow(self):
        assert jscode_to_mathjs("Math.pow(x, 2)") == "pow(x, 2)"

    def test_floor(self):
        assert jscode_to_mathjs("Math.floor(x)") == "floor(x)"

    def test_ceil(self):
        assert jscode_to_mathjs("Math.ceil(x)") == "ceil(x)"

    def test_sign(self):
        assert jscode_to_mathjs("Math.sign(x)") == "sign(x)"

    def test_asin(self):
        assert jscode_to_mathjs("Math.asin(x)") == "asin(x)"

    def test_atan2(self):
        assert jscode_to_mathjs("Math.atan2(y, x)") == "atan2(y, x)"

    # -- Constants --

    def test_pi(self):
        assert jscode_to_mathjs("Math.PI") == "pi"

    def test_euler_e(self):
        assert jscode_to_mathjs("Math.E") == "e"

    def test_ln2(self):
        assert jscode_to_mathjs("Math.LN2") == "ln2"

    # -- Nested / composite expressions --

    def test_nested(self):
        assert jscode_to_mathjs("Math.sin(Math.pow(x, 2))") == "sin(pow(x, 2))"

    def test_complex_expression(self):
        result = jscode_to_mathjs("Math.pow(x, 2) + Math.sin(x)")
        assert result == "pow(x, 2) + sin(x)"

    def test_expression_with_pi(self):
        result = jscode_to_mathjs("Math.sin(Math.PI*x)")
        assert result == "sin(pi*x)"

    # -- Passthrough (no Math. prefix) --

    def test_bare_variable(self):
        assert jscode_to_mathjs("x + y") == "x + y"

    def test_negation(self):
        assert jscode_to_mathjs("-x") == "-x"

    def test_division(self):
        assert jscode_to_mathjs("x/y") == "x/y"

    def test_integer_literal(self):
        assert jscode_to_mathjs("42") == "42"

    # -- Comment stripping (jscode strict=False output) --

    def test_strips_comment_lines(self):
        js = "// Not supported in JavaScript:\n// factorial\nfactorial(x)"
        assert jscode_to_mathjs(js) == "factorial(x)"

    def test_strips_inline_comment(self):
        js = "x + y // some comment\n"
        result = jscode_to_mathjs(js)
        assert "//" not in result
        assert "x + y" in result


# ── Full LaTeX → mathjs pipeline ──────────────────────────────────────

class TestLatexToMathjs:
    """End-to-end tests for the LaTeX → mathjs conversion pipeline."""

    # -- Basic expressions --

    def test_polynomial(self):
        script, variables = latex_to_mathjs(r"x^2 + 3x + 1")
        assert "pow(x, 2)" in script
        assert "3*x" in script
        assert variables == ["x"]

    def test_single_variable(self):
        script, variables = latex_to_mathjs(r"x")
        assert script == "x"
        assert variables == ["x"]

    def test_constant_number(self):
        script, variables = latex_to_mathjs(r"42")
        assert script == "42"
        assert variables == []

    # -- Trigonometric --

    def test_sin(self):
        script, variables = latex_to_mathjs(r"\sin(x)")
        assert script == "sin(x)"
        assert variables == ["x"]

    def test_cos(self):
        script, variables = latex_to_mathjs(r"\cos(x)")
        assert script == "cos(x)"
        assert variables == ["x"]

    def test_sin_squared(self):
        script, variables = latex_to_mathjs(r"\sin^2(x) + \cos^2(x)")
        assert "pow(sin(x), 2)" in script
        assert "pow(cos(x), 2)" in script
        assert variables == ["x"]

    # -- Exponential / logarithmic --

    def test_exp(self):
        script, variables = latex_to_mathjs(r"\exp(x)")
        assert script == "exp(x)"
        assert variables == ["x"]

    def test_e_to_x(self):
        """``e^{x}`` — Symbol('e') should become Euler's number."""
        script, variables = latex_to_mathjs(r"e^{x}")
        assert script == "exp(x)"
        assert variables == ["x"]  # 'e' should NOT appear as a variable

    def test_ln(self):
        script, variables = latex_to_mathjs(r"\ln(x)")
        assert script == "log(x)"
        assert variables == ["x"]

    def test_log_base_10(self):
        script, variables = latex_to_mathjs(r"\log_{10}(x)")
        assert variables == ["x"]
        # jscode emits log(x)/log(10) which is valid in mathjs
        assert "log" in script

    # -- Constants --

    def test_pi_constant(self):
        """``\\pi`` should be treated as the constant π, not a variable."""
        script, variables = latex_to_mathjs(r"\sin(\pi x)")
        assert "sin(pi*x)" in script or "sin(x*pi)" in script
        assert "pi" not in variables  # pi should NOT be a free variable

    # -- Fractions / division --

    def test_fraction(self):
        script, variables = latex_to_mathjs(r"\frac{x}{y}")
        assert variables == ["x", "y"]
        assert "x" in script and "y" in script

    # -- Square root --

    def test_sqrt(self):
        script, variables = latex_to_mathjs(r"\sqrt{x}")
        assert script == "sqrt(x)"
        assert variables == ["x"]

    # -- Multiple variables --

    def test_multivar(self):
        script, variables = latex_to_mathjs(r"x^2 + y^2")
        assert "x" in variables
        assert "y" in variables
        assert len(variables) == 2

    # -- Relations → LHS − RHS --

    def test_equality(self):
        """``x = y`` should produce ``x - y``."""
        script, variables = latex_to_mathjs(r"x = y")
        assert script == "x - y"
        assert sorted(variables) == ["x", "y"]

    def test_equation_with_subexprs(self):
        """``x^2 + y^2 = r^2`` should produce ``x^2 + y^2 - r^2``."""
        script, variables = latex_to_mathjs(r"x^2 + y^2 = r^2")
        assert "pow(x, 2)" in script
        assert "pow(y, 2)" in script
        assert "pow(r, 2)" in script
        assert sorted(variables) == ["r", "x", "y"]

    def test_inequality_gt(self):
        script, variables = latex_to_mathjs(r"x > y")
        assert script == "x - y"

    def test_inequality_leq(self):
        script, variables = latex_to_mathjs(r"x \leq y")
        assert script == "x - y"

    # -- Error handling --

    def test_invalid_latex_raises(self):
        """Malformed LaTeX that parse_latex cannot handle."""
        # parse_latex is lenient — unknown commands become Symbols.
        # Structurally broken input triggers LaTeXParsingError → ValueError.
        with pytest.raises((ValueError, Exception)):
            latex_to_mathjs(r"\frac{}")  # incomplete fraction

    def test_empty_string(self):
        """Empty LaTeX should raise rather than silently succeed."""
        with pytest.raises((ValueError, Exception)):
            latex_to_mathjs("")
