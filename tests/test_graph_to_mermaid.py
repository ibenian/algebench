"""Tests for scripts/graph_to_mermaid.py"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.graph_to_mermaid import (
    semantic_graph_to_mermaid,
    load_theme,
    list_themes,
    _escape_mermaid_label,
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
# Theme loading
# ---------------------------------------------------------------------------

class TestThemeLoading:
    def test_load_default_theme(self):
        theme = load_theme("default-light")
        assert theme["name"] == "default-light"
        assert "nodeStyles" in theme
        assert "direction" in theme

    def test_list_themes_returns_all_builtin(self):
        names = list_themes()
        # Every theme filename ends in ``-light`` or ``-dark`` so the
        # opposite-mode variant is immediately discoverable.
        assert "default-light" in names
        assert "minimal-flat-light" in names
        assert "role-colored-light" in names
        assert "power-direction-light" in names
        assert "power-direction-dark" in names
        assert "power-flow-light" in names
        assert "minimal-dark" in names
        assert "linalg-dark" in names
        for name in names:
            assert name.endswith("-light") or name.endswith("-dark"), (
                f"Theme {name!r} must end with '-light' or '-dark'"
            )

    def test_load_nonexistent_theme_raises(self):
        with pytest.raises(FileNotFoundError, match="not found"):
            load_theme("nonexistent-theme-xyz")

    def test_load_custom_theme_from_dir(self, tmp_path):
        custom = {"name": "test", "direction": "TB", "nodeStyles": {}, "edgeStyle": {}}
        (tmp_path / "test.json").write_text(json.dumps(custom))
        theme = load_theme("test", theme_dir=tmp_path)
        assert theme["name"] == "test"


# ---------------------------------------------------------------------------
# Label formatting
# ---------------------------------------------------------------------------

class TestLabelFormatting:
    def test_emoji_mode_variable(self):
        node = {"id": "m", "label": "mass", "emoji": "⚖️", "type": "scalar"}
        # Symbol nodes are now always wrapped in single-``$`` inline math so
        # the post-Mermaid KaTeX pass can render them uniformly.
        assert _format_label(node, "emoji") == "⚖️ $m$"

    def test_emoji_mode_operator(self):
        node = {"id": "__mul_1", "type": "operator", "op": "multiply"}
        # Operators use single-``$`` inline math so the post-Mermaid KaTeX
        # pass renders them with HTML (TeX-quality) output. Double-``$$``
        # is intercepted by Mermaid's own KaTeX → MathML path, which has
        # worse accent placement and no stretchy decorations.
        assert _format_label(node, "emoji") == r"$\times$"

    def test_latex_mode_variable(self):
        node = {"id": "F", "label": "force", "emoji": "🏹", "type": "vector", "latex": "F"}
        assert _format_label(node, "latex") == "$F$"

    def test_latex_mode_operator(self):
        node = {"id": "__mul_1", "type": "operator", "op": "multiply"}
        assert _format_label(node, "latex") == r"$\times$"

    def test_plain_mode(self):
        node = {"id": "m", "label": "mass", "emoji": "⚖️", "type": "scalar"}
        assert _format_label(node, "plain") == "$m$"

    def test_plain_mode_label_equals_id(self):
        node = {"id": "x", "label": "x", "emoji": "📍", "type": "scalar"}
        assert _format_label(node, "plain") == "$x$"

    def test_emoji_mode_no_emoji(self):
        node = {"id": "z", "label": "z", "type": "scalar"}
        assert _format_label(node, "emoji") == "$z$"


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
# Mermaid escaping
# ---------------------------------------------------------------------------

class TestEscapeMermaidLabel:
    def test_plain_text_escapes_plus_and_minus(self):
        assert _escape_mermaid_label("a + b") == "a #43; b"
        assert _escape_mermaid_label("a - b") == "a #45; b"
        assert _escape_mermaid_label("+ -") == "#43; #45;"

    def test_inline_math_span_preserved(self):
        # Operator labels — the case the original bug broke.
        assert _escape_mermaid_label("$-$") == "$-$"
        assert _escape_mermaid_label("$-1$") == "$-1$"
        assert _escape_mermaid_label("$a + b$") == "$a + b$"

    def test_display_math_span_preserved(self):
        assert _escape_mermaid_label("$$-$$") == "$$-$$"
        assert _escape_mermaid_label("$$a+b$$") == "$$a+b$$"

    def test_mixed_math_and_plain(self):
        # +/- inside the span stays raw, +/- outside gets escaped.
        assert (
            _escape_mermaid_label("a + b $-$ c + d")
            == "a #43; b $-$ c #43; d"
        )

    def test_inline_math_with_trailing_text(self):
        assert (
            _escape_mermaid_label("$-$<br/>desc")
            == "$-$<br/>desc"
        )
        assert (
            _escape_mermaid_label("$-$<br/>a - b")
            == "$-$<br/>a #45; b"
        )

    def test_empty_label(self):
        assert _escape_mermaid_label("") == ""

    def test_no_math_no_specials(self):
        assert _escape_mermaid_label("hello world") == "hello world"

    def test_unterminated_math_falls_through(self):
        # Lone ``$`` isn't a real span, so +/- still escape around it.
        assert _escape_mermaid_label("$a+b") == "$a#43;b"


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
        theme = load_theme("role-colored-light")
        result = semantic_graph_to_mermaid(SIMPLE_GRAPH, theme=theme)
        assert result.startswith("flowchart TB\n")

    def test_label_mode_override(self):
        result = semantic_graph_to_mermaid(F_MA_GRAPH, label_mode="latex")
        # All labels (symbol and operator) use single-``$`` inline math so
        # the post-Mermaid KaTeX pass renders them uniformly with HTML
        # output.
        assert "$m$" in result
        assert "$F$" in result

    def test_plain_label_mode(self):
        result = semantic_graph_to_mermaid(F_MA_GRAPH, label_mode="plain")
        assert "⚖️" not in result

    def test_empty_graph(self):
        result = semantic_graph_to_mermaid({"nodes": [], "edges": []})
        assert result.startswith("flowchart")

    def test_operator_variant_styling(self):
        """``node.variant`` + theme.operatorVariants drives a per-variant class."""
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "a", "label": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "divide",
                 "variant": "inverse"},
                {"id": "__op_2", "type": "operator", "op": "multiply"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1"},
                {"from": "__op_1", "to": "__op_2"},
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        # Variant classDefs are emitted for every operatorVariants entry.
        assert "classDef opv_direct " in result
        assert "classDef opv_inverse " in result
        assert "classDef opv_neutral " in result
        # The tagged operator uses the variant class, not the plain type class.
        assert ":::opv_inverse" in result
        # The untagged operator still uses the plain type class.
        assert "__op_2" in result
        # Sanity: untagged operator not mislabeled as variant.
        assert "__op_2{{\"" in result
        for line in result.splitlines():
            if line.strip().startswith("__op_2"):
                assert ":::opv_" not in line, line

    def test_variant_ignored_on_non_operator_nodes(self):
        """``variant`` on a scalar/relation node should not override its class."""
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                # Pathological: scalar with a variant should still render as
                # scalar, since operatorVariants is scoped to operator-like
                # types.
                {"id": "x", "label": "x", "type": "scalar",
                 "variant": "inverse"},
            ],
            "edges": [],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        # Scalar keeps its type-based styling.
        for line in result.splitlines():
            if line.strip().startswith("x"):
                assert ":::scalar" in line
                assert ":::opv_" not in line

    def test_no_operator_variants_section(self):
        """Themes without ``operatorVariants`` still render fine."""
        # ``default-light`` doesn't define operatorVariants.
        theme = load_theme("default-light")
        assert "operatorVariants" not in theme  # guard against theme drift
        graph = {
            "nodes": [
                {"id": "__op_1", "type": "operator", "op": "add",
                 "variant": "direct"},
            ],
            "edges": [],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        # No opv_ classes emitted; node falls back to the type class.
        assert "classDef opv_" not in result
        assert ":::operator" in result

    def test_link_style_directives(self):
        theme = load_theme("minimal-dark")
        graph = {
            "nodes": [
                {"id": "a", "label": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "add"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1", "semantic": "neutral"},
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        assert "linkStyle 0" in result

    def test_edge_weight_scales_width(self):
        # ``weight`` multiplies the semantic's base strokeWidth. With
        # the power-direction-dark theme, ``direct`` has base 4; a
        # weight of 1.5 should produce 6px.
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "power", "exponent": "3"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1", "semantic": "direct", "weight": 1.5},
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        assert "stroke-width:6px" in result

    def test_edge_weight_clamped_to_max(self):
        # An ``x^100`` edge would naively produce 400px — clamp to 8px.
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "power", "exponent": "100"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1", "semantic": "direct", "weight": 100.0},
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        assert "stroke-width:8px" in result
        assert "stroke-width:400px" not in result

    def test_power_edge_semantic_inferred_at_render(self):
        # The proportionality lives on the *outgoing* edge from a
        # power node — that's where the squared/cubed/inverse
        # relationship is actually carried into the rest of the
        # expression. The renderer reads ``exponent`` off the source
        # power node and tags the downstream edge accordingly.
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "c", "type": "scalar"},
                {"id": "__p_1", "type": "operator", "op": "power", "exponent": "2"},
                {"id": "__m_1", "type": "operator", "op": "multiply"},
            ],
            "edges": [
                {"from": "c", "to": "__p_1"},        # base → power: stays plain
                {"from": "__p_1", "to": "__m_1"},    # power → next: gets ``direct``
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        link_lines = [
            line for line in result.splitlines()
            if line.strip().startswith("linkStyle")
        ]
        # Index 0 — base → power: should be neutral fallback (no direct red).
        in_line = next((l for l in link_lines if "linkStyle 0 " in l), None)
        assert in_line is not None, "expected a linkStyle for the incoming edge"
        assert "stroke:#aaa" in in_line, f"incoming edge should be neutral: {in_line!r}"
        # Index 1 — power → multiply: should be direct + width = 4*2 = 8 (clamped).
        out_line = next((l for l in link_lines if "linkStyle 1 " in l), None)
        assert out_line is not None, "expected a linkStyle for the outgoing edge"
        assert "stroke:#ef5350" in out_line  # direct
        assert "stroke-width:8px" in out_line

    def test_explicit_edge_tag_wins_over_inference(self):
        # An explicit semantic on the *outgoing* edge from a power
        # node should not be overridden by the renderer's structural
        # inference (which would otherwise tag it ``direct`` for
        # ``exponent=2``).
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "c", "type": "scalar"},
                {"id": "__p_1", "type": "operator", "op": "power", "exponent": "2"},
                {"id": "__m_1", "type": "operator", "op": "multiply"},
            ],
            "edges": [
                {"from": "c", "to": "__p_1"},
                {"from": "__p_1", "to": "__m_1", "semantic": "neutral"},
            ],
        }
        result = semantic_graph_to_mermaid(graph, theme=theme)
        # Check only the linkStyle for the explicitly-tagged outgoing
        # edge — the direct stroke colour appears elsewhere in classDefs
        # for the operator-variant styling.
        out_line = next(
            (l for l in result.splitlines()
             if l.strip().startswith("linkStyle 1 ")),
            None,
        )
        assert out_line is not None, "expected a linkStyle for the outgoing edge"
        assert "stroke:#aaa" in out_line       # neutral
        assert "stroke:#ef5350" not in out_line  # NOT direct

    def test_edge_weight_clamped_to_min(self):
        # Tiny weights still yield visible edges (MIN = 1px).
        theme = load_theme("power-direction-dark")
        graph = {
            "nodes": [
                {"id": "a", "type": "scalar"},
                {"id": "__op_1", "type": "operator", "op": "power", "exponent": "0.1"},
            ],
            "edges": [
                {"from": "a", "to": "__op_1", "semantic": "inverse", "weight": 0.1},
            ],
        }
        # inverse base = 1; 1*0.1 = 0.1 → floored to 1.
        result = semantic_graph_to_mermaid(graph, theme=theme)
        assert "stroke-width:1px" in result

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
        for theme_name in list_themes():
            theme = load_theme(theme_name)
            result = semantic_graph_to_mermaid(graph, theme=theme)
            assert result.startswith("flowchart")

    def test_all_label_modes(self):
        from scripts.latex_to_graph import latex_to_semantic_graph

        graph = latex_to_semantic_graph(r"F = m \cdot a")
        for mode in ("emoji", "latex", "plain"):
            result = semantic_graph_to_mermaid(graph, label_mode=mode)
            assert result.startswith("flowchart")
