"""Tests for scripts/graph_to_mermaid.py"""

from __future__ import annotations

import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.graph_to_mermaid import (
    semantic_graph_to_mermaid,
    load_style,
    list_styles,
    _format_label,
    _sanitize_id,
    _wrap_shape,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

F_MA_GRAPH = {
    "nodes": [
        {"id": "m", "label": "mass", "emoji": "⚖️", "type": "scalar", "latex": "m"},
        {"id": "a", "label": "acceleration", "emoji": "🧭", "type": "vector", "latex": "a"},
        {"id": "__multiply_1", "type": "operator", "op": "multiply"},
        {"id": "F", "label": "force", "emoji": "🏹", "type": "vector", "latex": "F"},
        {"id": "__equals_1", "type": "operator", "op": "equals"},
    ],
    "edges": [
        {"from": "m", "to": "__multiply_1"},
        {"from": "a", "to": "__multiply_1"},
        {"from": "__multiply_1", "to": "__equals_1"},
        {"from": "F", "to": "__equals_1"},
    ],
}

SIMPLE_GRAPH = {
    "nodes": [
        {"id": "x", "label": "x", "emoji": "📍", "type": "scalar", "latex": "x"},
        {"id": "__num_1", "label": "2", "emoji": "🔢", "type": "number"},
        {"id": "__multiply_1", "type": "operator", "op": "multiply"},
    ],
    "edges": [
        {"from": "x", "to": "__multiply_1"},
        {"from": "__num_1", "to": "__multiply_1"},
    ],
}


# ---------------------------------------------------------------------------
# Style loading
# ---------------------------------------------------------------------------

class TestStyleLoading:
    def test_load_default_style(self):
        style = load_style("default")
        assert style["name"] == "default"
        assert "nodeStyles" in style
        assert "direction" in style

    def test_list_styles_returns_all_builtin(self):
        names = list_styles()
        assert "default" in names
        assert "minimal-flat" in names
        assert "role-colored" in names
        assert "power-direction" in names
        assert "power-flow" in names
        assert "minimal-dark" in names
        assert "linalg-dark" in names

    def test_load_nonexistent_style_raises(self):
        with pytest.raises(FileNotFoundError, match="not found"):
            load_style("nonexistent-style-xyz")

    def test_load_custom_style_from_dir(self, tmp_path):
        custom = {"name": "test", "direction": "TB", "nodeStyles": {}, "edgeStyle": {}}
        (tmp_path / "test.json").write_text(json.dumps(custom))
        style = load_style("test", styles_dir=tmp_path)
        assert style["name"] == "test"


# ---------------------------------------------------------------------------
# Label formatting
# ---------------------------------------------------------------------------

class TestLabelFormatting:
    def test_emoji_mode_variable(self):
        node = {"id": "m", "label": "mass", "emoji": "⚖️", "type": "scalar"}
        assert _format_label(node, "emoji") == "⚖️ mass (m)"

    def test_emoji_mode_operator(self):
        node = {"id": "__mul_1", "type": "operator", "op": "multiply"}
        assert _format_label(node, "emoji") == "×"

    def test_latex_mode_variable(self):
        node = {"id": "F", "label": "force", "emoji": "🏹", "type": "vector", "latex": "F"}
        assert _format_label(node, "latex") == "$$F$$"

    def test_latex_mode_operator(self):
        node = {"id": "__mul_1", "type": "operator", "op": "multiply"}
        assert _format_label(node, "latex") == r"$$\times$$"

    def test_plain_mode(self):
        node = {"id": "m", "label": "mass", "emoji": "⚖️", "type": "scalar"}
        assert _format_label(node, "plain") == "m (mass)"

    def test_plain_mode_label_equals_id(self):
        node = {"id": "x", "label": "x", "emoji": "📍", "type": "scalar"}
        assert _format_label(node, "plain") == "x"

    def test_emoji_mode_no_emoji(self):
        node = {"id": "z", "label": "z", "type": "scalar"}
        assert _format_label(node, "emoji") == "z"


# ---------------------------------------------------------------------------
# ID sanitization
# ---------------------------------------------------------------------------

class TestSanitizeId:
    def test_basic(self):
        assert _sanitize_id("hello") == "hello"

    def test_dashes(self):
        assert _sanitize_id("my-node") == "my_node"

    def test_dots(self):
        assert _sanitize_id("node.1") == "node_1"


# ---------------------------------------------------------------------------
# Shape wrapping
# ---------------------------------------------------------------------------

class TestWrapShape:
    def test_rect(self):
        assert _wrap_shape("m", "mass", "rect") == 'm["mass"]'

    def test_circle(self):
        assert _wrap_shape("op", "×", "circle") == 'op(("×"))'

    def test_stadium(self):
        assert _wrap_shape("F", "force", "stadium") == 'F(["force"])'

    def test_hexagon(self):
        assert _wrap_shape("op", "+", "hexagon") == 'op{{"#43;"}}'

    def test_diamond(self):
        assert _wrap_shape("r", "=", "diamond") == 'r{"="}'

    def test_unknown_shape_defaults_to_rect(self):
        assert _wrap_shape("n", "test", "unknown") == 'n["test"]'


# ---------------------------------------------------------------------------
# Full rendering
# ---------------------------------------------------------------------------

class TestSemanticGraphToMermaid:
    def test_default_style_produces_valid_flowchart(self):
        result = semantic_graph_to_mermaid(F_MA_GRAPH)
        assert result.startswith("flowchart LR\n")
        assert "__multiply_1" in result
        assert "__equals_1" in result
        assert "-->" in result

    def test_node_definitions_present(self):
        result = semantic_graph_to_mermaid(SIMPLE_GRAPH)
        assert 'x[' in result or 'x(' in result
        assert '__multiply_1' in result

    def test_edges_present(self):
        result = semantic_graph_to_mermaid(SIMPLE_GRAPH)
        assert "x -->" in result or "x --" in result
        assert "__num_1 -->" in result or "__num_1 --" in result

    def test_style_directives_present(self):
        result = semantic_graph_to_mermaid(SIMPLE_GRAPH)
        assert "classDef scalar " in result
        assert "fill:" in result
        assert ":::scalar" in result

    def test_custom_direction(self):
        style = load_style("role-colored")
        result = semantic_graph_to_mermaid(SIMPLE_GRAPH, style=style)
        assert result.startswith("flowchart TB\n")

    def test_label_mode_override(self):
        result = semantic_graph_to_mermaid(F_MA_GRAPH, label_mode="latex")
        assert "$$m$$" in result
        assert "$$F$$" in result

    def test_plain_label_mode(self):
        result = semantic_graph_to_mermaid(F_MA_GRAPH, label_mode="plain")
        assert "⚖️" not in result
        assert "$$" not in result

    def test_empty_graph(self):
        result = semantic_graph_to_mermaid({"nodes": [], "edges": []})
        assert result.startswith("flowchart")

    def test_link_style_directives(self):
        style = load_style("minimal-dark")
        graph = {
            "nodes": [
                {"id": "a", "label": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "add"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1", "semantic": "neutral"},
            ],
        }
        result = semantic_graph_to_mermaid(graph, style=style)
        assert "linkStyle 0" in result

    def test_edge_labels(self):
        graph = {
            "nodes": [
                {"id": "a", "label": "a", "type": "scalar"},
                {"id": "b", "label": "b", "type": "scalar"},
            ],
            "edges": [
                {"from": "a", "to": "b", "label": "connects"},
            ],
        }
        result = semantic_graph_to_mermaid(graph)
        assert "|connects|" in result


# ---------------------------------------------------------------------------
# End-to-end with latex_to_graph
# ---------------------------------------------------------------------------

class TestEndToEnd:
    def test_latex_to_mermaid_pipeline(self):
        from scripts.latex_to_graph import latex_to_semantic_graph

        graph = latex_to_semantic_graph(r"F = m \cdot a")
        result = semantic_graph_to_mermaid(graph)
        assert result.startswith("flowchart")
        assert "classDef" in result
        lines = result.strip().split("\n")
        assert len(lines) >= 3

    def test_emc2_pipeline(self):
        from scripts.latex_to_graph import latex_to_semantic_graph

        graph = latex_to_semantic_graph("E = mc^2")
        for style_name in list_styles():
            style = load_style(style_name)
            result = semantic_graph_to_mermaid(graph, style=style)
            assert result.startswith("flowchart")

    def test_all_label_modes(self):
        from scripts.latex_to_graph import latex_to_semantic_graph

        graph = latex_to_semantic_graph(r"F = m \cdot a")
        for mode in ("emoji", "latex", "plain"):
            result = semantic_graph_to_mermaid(graph, label_mode=mode)
            assert result.startswith("flowchart")
