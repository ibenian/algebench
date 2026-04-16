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
    SemanticGraphBuilder,
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
# Derivatives
# ---------------------------------------------------------------------------

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

    def test_ddot_notation_preprocessed(self):
        result = _preprocess_latex(r"\ddot{x}")
        assert result.count(r"\frac") == 2

    def test_higher_order_derivative(self):
        result = _preprocess_latex(r"\frac{d^2 y}{dy^2}")
        assert result.count(r"\frac") == 2


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
