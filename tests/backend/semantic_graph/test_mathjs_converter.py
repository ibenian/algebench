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

    # -- Subscript brace stripping --

    def test_strips_subscript_braces(self):
        assert jscode_to_mathjs("p_{i}*x_{i}") == "p_i*x_i"

    def test_strips_nested_subscript_braces(self):
        assert jscode_to_mathjs("a_{ij} + b_{12}") == "a_ij + b_12"


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

    # -- Primed variable sanitization --

    def test_prime_variable(self):
        """``u'`` should be sanitized to ``u_prime``."""
        script, variables = latex_to_mathjs(r"u'")
        assert script == "u_prime"
        assert variables == ["u_prime"]

    def test_prime_product(self):
        """``u' \\cdot v`` should produce ``u_prime*v``."""
        script, variables = latex_to_mathjs(r"u' \cdot v")
        assert "u_prime" in script
        assert "v" in script
        assert sorted(variables) == ["u_prime", "v"]

    def test_double_prime(self):
        """``u''`` should be sanitized to ``u_dprime``."""
        script, variables = latex_to_mathjs(r"u''")
        assert script == "u_dprime"
        assert variables == ["u_dprime"]

    def test_multiple_primed_vars(self):
        """Multiple primed variables in one expression."""
        script, variables = latex_to_mathjs(r"x' + y'")
        assert "x_prime" in script
        assert "y_prime" in script
        assert sorted(variables) == ["x_prime", "y_prime"]

    def test_prime_in_fraction(self):
        """Primed variable inside a fraction — the velocity addition formula."""
        script, variables = latex_to_mathjs(
            r"\frac{u' + v}{1 + \frac{u' v}{c^2}}"
        )
        assert "u_prime" in script
        assert "'" not in script
        assert sorted(variables) == ["c", "u_prime", "v"]

    # -- Subscript brace sanitization --

    def test_subscripted_variable(self):
        """``x_i`` should not have LaTeX braces in the output."""
        script, variables = latex_to_mathjs(r"x_i")
        assert "{" not in script
        assert "}" not in script
        assert variables == ["x_i"]

    def test_subscripted_product(self):
        """``x_i p_i`` — subscripted variables in a product."""
        script, variables = latex_to_mathjs(r"x_i p_i")
        assert "{" not in script
        assert "}" not in script
        assert sorted(variables) == ["p_i", "x_i"]

    def test_subscript_in_equation(self):
        """Subscripted variables in an equation."""
        script, variables = latex_to_mathjs(r"a_1 + a_2 = b")
        assert "{" not in script
        assert "}" not in script
        assert "b" in variables


# ── accents and greedy function arguments ──────────────────────────────

def test_accent_commands_do_not_become_variables():
    """``\\hat{n}`` must not yield a phantom ``hat`` variable (and slider)."""
    from backend.semantic_graph.mathjs_converter import latex_to_sympy
    got = {str(s) for s in latex_to_sympy(r"a \cdot \hat{n}").free_symbols}
    assert got == {"a", "n"}
    got = {str(s) for s in latex_to_sympy(r"\vec{F} = m \vec{a}").free_symbols}
    assert got == {"F", "a", "m"}


def test_function_argument_does_not_swallow_the_product():
    """``\\cos\\phi \\cdot a`` is ``a·cos(φ)``, not ``cos(a·φ)``.

    parse_latex absorbs the whole trailing product into the argument for
    both the bare and braced forms — a silently different function.
    """
    from backend.semantic_graph.mathjs_converter import latex_to_sympy
    import sympy
    a, phi, b, c, theta = sympy.symbols("a phi b c theta")
    assert latex_to_sympy(r"\cos\phi \cdot a") == a * sympy.cos(phi)
    assert latex_to_sympy(r"\cos{\phi} \cdot a") == a * sympy.cos(phi)
    assert latex_to_sympy(r"\sin\theta \cdot b \cdot c") == b * c * sympy.sin(theta)
    # already-correct forms are left alone
    assert latex_to_sympy(r"\cos(\phi) \cdot a") == a * sympy.cos(phi)
    assert latex_to_sympy(r"\cos^2\phi") == sympy.cos(phi) ** 2
    # a genuine multi-factor argument stays intact
    b_, t, omega = sympy.symbols("b t omega")
    assert latex_to_sympy(r"e^{-b t} \cos{\omega t}") == (
        sympy.exp(-b_ * t) * sympy.cos(omega * t))


# ── compound Δ-symbols (issue #531) ────────────────────────────────────

class TestCompoundDeltaSymbols:
    r"""``\Delta v`` is one symbol, not the product ``Delta * v``.

    Left split, the phantom ``Delta`` gets its own slider and the chart
    sweeps ``v`` — a different expression than the one on screen.
    """

    def test_tsiolkovsky_residual_has_no_phantom_delta(self):
        script, variables = latex_to_mathjs(r"\Delta v - v_e \log(m_0/m_f)")
        assert variables == ["Delta_v", "m_0", "m_f", "v_e"]
        assert "Delta*v" not in script

    def test_upper_and_lowercase_delta(self):
        _, variables = latex_to_mathjs(r"\Delta t + \delta x")
        assert variables == ["Delta_t", "delta_x"]

    def test_subscripted_operand_stays_whole(self):
        script, variables = latex_to_mathjs(r"\Delta v_e = a t")
        assert variables == ["Delta_v_e", "a", "t"]
        assert "Delta" not in script.replace("Delta_v_e", "")

    @pytest.mark.parametrize("latex", [
        r"\Delta v = v_e \log(m_0/m_f)",
        # Runs of non-identifier characters: a per-character substitution
        # yields ``Delta_v_a__b`` here where the graph says ``Delta_v_a_b``,
        # and a name that disagrees is dropped by _compile_view_extras.
        r"\Delta v_{a, b} = c",
        r"\Delta v_{(n)} = c",
        r"\Delta v_e = a t",
    ])
    def test_name_matches_semantic_graph_node_id(self, latex):
        """The two LaTeX→SymPy paths must agree on the identifier."""
        from backend.semantic_graph.service import SemanticGraphService
        graph = SemanticGraphService().latex_to_graph(latex)
        node_ids = {n.id for n in graph.nodes}
        _, variables = latex_to_mathjs(latex)
        assert set(variables) <= node_ids

    def test_literal_theta_placeholder_does_not_collide(self):
        r"""A source ``\Theta_{0}`` must not be absorbed by the collapser."""
        _, variables = latex_to_mathjs(r"\Theta_{0} + \Delta v")
        assert variables == ["Delta_v", "Theta_0"]


def test_sizing_command_is_not_read_as_a_function_argument():
    r"""``\log\left(...\right)`` must not become ``\log(\left)(...)``.

    The bare-argument branch of ``_parenthesize_function_args`` used to
    match any ``\cmd``, so it grabbed the sizing command and produced
    LaTeX that does not parse — dropping an expression the reader can
    see on screen. Found while fixing #531.
    """
    script, variables = latex_to_mathjs(
        r"\Delta v = v_e \cdot \log\left(\frac{m_0}{m_f}\right)")
    assert variables == ["Delta_v", "m_0", "m_f", "v_e"]
    assert "log(m_0 / m_f)" in script.replace("m_0/m_f", "m_0 / m_f")
    # the genuine bare-argument case still works
    from backend.semantic_graph.mathjs_converter import latex_to_sympy
    import sympy
    a, phi = sympy.symbols("a phi")
    assert latex_to_sympy(r"\cos\phi \cdot a") == a * sympy.cos(phi)
