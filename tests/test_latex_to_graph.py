"""Tests for scripts/latex_to_graph.py"""

from __future__ import annotations

import sys
import os
import pytest

# Allow importing from scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.latex_to_graph import (
    latex_to_semantic_graph,
    parse_var_overrides,
    _preprocess_latex,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_node(graph, **attrs):
    """Find a node in the graph matching all given attrs."""
    for node in graph["nodes"]:
        if all(node.get(k) == v for k, v in attrs.items()):
            return node
    return None


def _find_nodes(graph, **attrs):
    """Find all nodes matching given attrs."""
    return [n for n in graph["nodes"]
            if all(n.get(k) == v for k, v in attrs.items())]


def _has_edge(graph, src, dst):
    """Check if an edge exists from src to dst."""
    return {"from": src, "to": dst} in graph["edges"]


# ---------------------------------------------------------------------------
# Graph structure
# ---------------------------------------------------------------------------

class TestGraphStructure:
    def test_returns_nodes_and_edges(self):
        g = latex_to_semantic_graph("x + y")
        assert "nodes" in g
        assert "edges" in g
        assert "classification" in g

    def test_simple_addition(self):
        g = latex_to_semantic_graph("x + y")
        assert _find_node(g, id="x", type="scalar")
        assert _find_node(g, id="y", type="scalar")
        assert _find_node(g, type="operator", op="add")

    def test_simple_multiplication(self):
        g = latex_to_semantic_graph("m \\cdot a")
        assert _find_node(g, id="m", label="mass")
        assert _find_node(g, id="a", label="acceleration")
        assert _find_node(g, type="operator", op="multiply")

    def test_equation(self):
        g = latex_to_semantic_graph("F = m \\cdot a")
        assert _find_node(g, id="F", label="force")
        assert _find_node(g, type="operator", op="equals")

    def test_power(self):
        g = latex_to_semantic_graph("x^2")
        assert _find_node(g, id="x")
        assert _find_node(g, type="operator", op="power")

    def test_edges_connect_operands_to_operator(self):
        g = latex_to_semantic_graph("x + y")
        add_node = _find_node(g, type="operator", op="add")
        assert add_node is not None
        assert _has_edge(g, "x", add_node["id"])
        assert _has_edge(g, "y", add_node["id"])


# ---------------------------------------------------------------------------
# Known variables & metadata
# ---------------------------------------------------------------------------

class TestKnownVariables:
    def test_known_variable_gets_metadata(self):
        g = latex_to_semantic_graph("F")
        node = _find_node(g, id="F")
        assert node["label"] == "force"
        assert node["type"] == "vector"
        assert node["emoji"] == "\U0001f3f9"

    def test_unknown_variable_gets_defaults(self):
        g = latex_to_semantic_graph("Q")
        node = _find_node(g, id="Q")
        assert node["label"] == "Q"
        assert node["type"] == "scalar"

    def test_symbol_deduplication(self):
        g = latex_to_semantic_graph("x + x")
        x_nodes = _find_nodes(g, id="x")
        assert len(x_nodes) == 1


# ---------------------------------------------------------------------------
# Numbers and constants
# ---------------------------------------------------------------------------

class TestNumbersAndConstants:
    def test_integer(self):
        g = latex_to_semantic_graph("2 x")
        assert _find_node(g, type="number")

    def test_fraction(self):
        g = latex_to_semantic_graph("\\frac{1}{2}")
        # Should produce a number node or a division
        assert len(g["nodes"]) > 0


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

class TestFunctions:
    def test_sin(self):
        g = latex_to_semantic_graph("\\sin(x)")
        assert _find_node(g, type="function", op="sin")
        assert _find_node(g, id="x")

    def test_cos(self):
        g = latex_to_semantic_graph("\\cos(\\theta)")
        assert _find_node(g, type="function", op="cos")

    def test_sqrt(self):
        g = latex_to_semantic_graph("\\sqrt{x}")
        assert _find_node(g, type="operator", op="power") or \
               _find_node(g, type="function", op="sqrt")


# ---------------------------------------------------------------------------
# Calculus (Integrals, Sums, Derivatives)
# ---------------------------------------------------------------------------

class TestCalculus:
    def test_integral_with_limits(self):
        g = latex_to_semantic_graph("\\int_0^1 x^2 dx")
        integral_node = _find_node(g, type="operator", op="integral")
        assert integral_node is not None
        assert _find_node(g, id="x") is not None
        assert _find_node(g, label="0") is not None
        assert _find_node(g, label="1") is not None

    def test_sum_with_limits(self):
        g = latex_to_semantic_graph("\\sum_{n=1}^\\infty n")
        sum_node = _find_node(g, type="operator", op="sum")
        assert sum_node is not None
        assert _find_node(g, id="n") is not None
        assert _find_node(g, label="1") is not None
        assert _find_node(g, label="infinity") is not None

class TestDerivatives:
    def test_first_order_derivative(self):
        g = latex_to_semantic_graph("\\frac{d v}{d t}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "t" in deriv.get("with_respect_to", "")

    def test_dot_notation_preprocessed(self):
        result = _preprocess_latex(r"\dot{x}")
        assert r"\frac" in result
        assert "d t" in result or "dt" in result

    def test_dot_notation_graph(self):
        g = latex_to_semantic_graph(r"\dot{x}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "t" in deriv.get("with_respect_to", "")

    def test_ddot_notation_preprocessed(self):
        result = _preprocess_latex(r"\ddot{x}")
        assert result.count(r"\frac") == 2

    def test_ddot_notation_graph(self):
        g = latex_to_semantic_graph(r"\ddot{x}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        # SymPy collapses nested derivatives; ddot produces Derivative(x, t, t)
        assert "t" in deriv.get("with_respect_to", "")

    def test_higher_order_derivative(self):
        result = _preprocess_latex(r"\frac{d^2 y}{dy^2}")
        assert result.count(r"\frac") == 2

    def test_higher_order_derivative_graph(self):
        g = latex_to_semantic_graph(r"\frac{d^2 y}{d y^2}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "y" in deriv.get("with_respect_to", "")

    def test_higher_order_derivative_braced(self):
        result = _preprocess_latex(r"\frac{d^{2} y}{dy^{2}}")
        assert result.count(r"\frac") == 2

    def test_higher_order_partial_braced(self):
        result = _preprocess_latex(r"\frac{\partial^{3} u}{\partial x^{3}}")
        assert result.count(r"\frac") == 3


# ---------------------------------------------------------------------------
# Relation operators (proportional, implies, iff, maps_to, approximately)
# ---------------------------------------------------------------------------

class TestRelations:
    """Relations that SymPy's parse_latex cannot handle natively."""

    def test_proportional(self):
        g = latex_to_semantic_graph(r"F \propto m a")
        rel = _find_node(g, type="relation", op="proportional")
        assert rel is not None
        assert rel["label"] == "proportional to"
        assert rel["emoji"] == "∝"
        assert _find_node(g, id="F")
        assert _find_node(g, type="operator", op="multiply")

    def test_implies(self):
        g = latex_to_semantic_graph(r"x > 0 \implies x^2 > 0")
        rel = _find_node(g, type="relation", op="implies")
        assert rel is not None
        assert rel["label"] == "implies"
        assert rel["emoji"] == "⇒"

    def test_rightarrow_implies(self):
        g = latex_to_semantic_graph(r"x > 0 \Rightarrow x^2 > 0")
        rel = _find_node(g, type="relation", op="implies")
        assert rel is not None
        assert rel["emoji"] == "⇒"

    def test_iff(self):
        g = latex_to_semantic_graph(r"x = 0 \iff x^2 = 0")
        rel = _find_node(g, type="relation", op="iff")
        assert rel is not None
        assert rel["label"] == "if and only if"
        assert rel["emoji"] == "⇔"

    def test_leftrightarrow_iff(self):
        g = latex_to_semantic_graph(r"A \Leftrightarrow B")
        rel = _find_node(g, type="relation", op="iff")
        assert rel is not None
        assert rel["emoji"] == "⇔"
        assert _find_node(g, id="A")
        assert _find_node(g, id="B")

    def test_approximately(self):
        g = latex_to_semantic_graph(r"\pi \approx 3.14")
        rel = _find_node(g, type="relation", op="approximately")
        assert rel is not None
        assert rel["label"] == "approximately equal"
        assert rel["emoji"] == "≈"
        assert _find_node(g, type="constant", label="pi")

    def test_maps_to(self):
        g = latex_to_semantic_graph(r"x \to y")
        rel = _find_node(g, type="relation", op="maps_to")
        assert rel is not None
        assert rel["label"] == "maps to"
        assert rel["emoji"] == "→"
        assert _find_node(g, id="x")
        assert _find_node(g, id="y")

    def test_maps_to_function(self):
        g = latex_to_semantic_graph(r"f(x) \to f(x+1)")
        rel = _find_node(g, type="relation", op="maps_to")
        assert rel is not None

    def test_relation_has_two_edges(self):
        """Every relation node should connect LHS and RHS."""
        g = latex_to_semantic_graph(r"F \propto m a")
        rel = _find_node(g, type="relation", op="proportional")
        incoming = [e for e in g["edges"] if e["to"] == rel["id"]]
        assert len(incoming) == 2


# ---------------------------------------------------------------------------
# Complex real-world formulas
# ---------------------------------------------------------------------------

class TestComplexFormulas:
    """Parse real physics/math formulas and verify the graph captures key
    structural features (node types, operators, symbols, classification)."""

    def test_euler_identity(self):
        """e^{i pi} + 1 = 0 — symbols, constants, power, addition, equality.
        Note: parse_latex treats 'e' and 'i' as plain symbols; pi is a constant."""
        g = latex_to_semantic_graph(r"e^{i \pi} + 1 = 0")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="e")
        assert _find_node(g, type="constant", label="pi")
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, type="operator", op="add")
        assert g["classification"]["kind"] == "algebraic"

    def test_kinetic_energy(self):
        """K = 1/2 m v^2 — equation with fraction, multiplication, power."""
        g = latex_to_semantic_graph(r"K = \frac{1}{2} m v^2")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="K")
        assert _find_node(g, id="m", label="mass")
        assert _find_node(g, id="v", label="velocity")
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, type="operator", op="multiply")

    def test_gaussian_integral(self):
        """integral from -inf to inf of e^{-x^2} dx = sqrt(pi) —
        definite integral, exponential, constant, equality."""
        g = latex_to_semantic_graph(
            r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}"
        )
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, type="operator", op="integral")
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, id="x")
        assert g["classification"]["kind"] == "algebraic"

    def test_wave_equation_pde(self):
        """u_tt = c^2 u_xx — second-order PDE, partial derivatives."""
        g = latex_to_semantic_graph(
            r"\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}"
        )
        derivs = _find_nodes(g, type="operator", op="derivative")
        assert len(derivs) == 2
        wrt_vars = {d["with_respect_to"] for d in derivs}
        assert "t" in wrt_vars
        assert "x" in wrt_vars
        c = g["classification"]
        assert c["kind"] == "PDE"
        assert c["order"] == 2
        assert set(c["independent_variables"]) == {"t", "x"}

    def test_harmonic_oscillator_ode(self):
        """x'' + omega^2 x = 0 — second-order linear ODE."""
        g = latex_to_semantic_graph(
            r"\frac{d^2 x}{dt^2} + \omega^2 x = 0"
        )
        assert _find_node(g, type="operator", op="derivative")
        assert _find_node(g, id="omega", label="angular velocity")
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 2
        assert c.get("linear") is True

    def test_schrodinger_time_independent(self):
        """E psi = -(h^2/2m) psi'' + V psi — ODE with many operators."""
        g = latex_to_semantic_graph(
            r"E \psi = -\frac{h^2}{2m} \frac{d^2 \psi}{dx^2} + V \psi"
        )
        assert _find_node(g, id="psi", label="wave function")
        assert _find_node(g, id="h", label="Planck constant")
        assert _find_node(g, type="operator", op="derivative")
        assert _find_node(g, type="operator", op="equals")
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 2

    def test_coulomb_law(self):
        """F = k q1 q2 / r^2 — subscripted variables, fractions."""
        g = latex_to_semantic_graph(r"F = k \frac{q_1 q_2}{r^2}")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="F", label="force")
        assert _find_node(g, id="r", label="radius")
        assert _find_node(g, type="operator", op="power")
        # q_1 and q_2 are distinct symbols
        nodes = g["nodes"]
        q_nodes = [n for n in nodes if n["id"].startswith("q_")]
        assert len(q_nodes) == 2

    def test_taylor_series_sin(self):
        """sin(x) = sum — function, summation, factorial, power."""
        g = latex_to_semantic_graph(
            r"\sin(x) = \sum_{n=0}^{\infty} \frac{(-1)^n}{(2n+1)!} x^{2n+1}"
        )
        assert _find_node(g, type="function", op="sin")
        assert _find_node(g, type="operator", op="sum")
        assert _find_node(g, type="operator", op="equals")
        # Should have factorial node
        assert _find_node(g, op="factorial")
        assert g["classification"]["kind"] == "algebraic"

    def test_lorentz_factor(self):
        """gamma = 1/sqrt(1 - v^2/c^2) — nested fractions, sqrt via power."""
        g = latex_to_semantic_graph(
            r"\gamma = \frac{1}{\sqrt{1 - \frac{v^2}{c^2}}}"
        )
        assert _find_node(g, id="gamma")
        assert _find_node(g, id="v", label="velocity")
        assert _find_node(g, id="c", label="speed of light")
        assert _find_node(g, type="operator", op="equals")
        assert g["classification"]["kind"] == "algebraic"

    def test_quadratic_formula(self):
        """x = (-b +/- sqrt(b^2 - 4ac)) / 2a — covers many node types."""
        g = latex_to_semantic_graph(
            r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
        )
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="x")
        assert _find_node(g, id="a")
        assert _find_node(g, id="b")
        assert _find_node(g, id="c")
        # Must have both addition and multiplication
        assert _find_node(g, type="operator", op="add")
        assert _find_node(g, type="operator", op="multiply")
        assert _find_node(g, type="operator", op="power")
        # Graph should be non-trivial
        assert len(g["nodes"]) >= 10
        assert len(g["edges"]) >= 10


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

class TestClassification:
    def test_algebraic_expression(self):
        g = latex_to_semantic_graph("x^2 + y^2")
        assert g["classification"]["kind"] == "algebraic"

    def test_ode_detected(self):
        g = latex_to_semantic_graph("\\frac{d v}{d t} = a")
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 1

    def test_algebraic_equation(self):
        g = latex_to_semantic_graph("E = m c^2")
        assert g["classification"]["kind"] == "algebraic"


# ---------------------------------------------------------------------------
# Variable overrides
# ---------------------------------------------------------------------------

class TestOverrides:
    def test_parse_var_overrides_single(self):
        result = parse_var_overrides(["m:unit=kg,tooltip=Mass"])
        assert result == {"m": {"unit": "kg", "tooltip": "Mass"}}

    def test_parse_var_overrides_multiple(self):
        result = parse_var_overrides([
            "m:unit=kg",
            "a:unit=m/s²",
        ])
        assert result["m"]["unit"] == "kg"
        assert result["a"]["unit"] == "m/s²"

    def test_parse_var_overrides_none(self):
        assert parse_var_overrides(None) == {}

    def test_parse_var_overrides_invalid_format(self):
        with pytest.raises(ValueError, match="Invalid --var format"):
            parse_var_overrides(["bad"])

    def test_parse_var_overrides_invalid_property(self):
        with pytest.raises(ValueError, match="Invalid property"):
            parse_var_overrides(["m:noequalssign"])

    def test_overrides_applied_to_graph(self):
        g = latex_to_semantic_graph("F = m \\cdot a", overrides={
            "m": {"unit": "kg", "tooltip": "Inertial mass"},
        })
        m_node = _find_node(g, id="m")
        assert m_node["unit"] == "kg"
        assert m_node["tooltip"] == "Inertial mass"
        assert m_node["label"] == "mass"  # default still present


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestErrors:
    def test_invalid_latex_raises(self):
        with pytest.raises(ValueError, match="Failed to parse"):
            latex_to_semantic_graph("\\frac{}")
