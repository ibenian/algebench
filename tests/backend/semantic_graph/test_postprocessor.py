"""Tests for backend.semantic_graph.postprocessor.GraphPostprocessor."""

from __future__ import annotations

import copy

import pytest

from backend.semantic_graph.postprocessor import (
    GraphPostprocessor,
    _re_sub_literal,
    _restore_dot_notation_str,
)
from backend.semantic_graph.preprocess_result import PreprocessResult


@pytest.fixture
def pp():
    return GraphPostprocessor()


# ------------------------------------------------------------------
# _re_sub_literal
# ------------------------------------------------------------------

class TestReSubLiteral:
    def test_literal_backslash_replacement(self):
        result = _re_sub_literal(r"foo", r"\text{bar}", "foo baz")
        assert result == r"\text{bar} baz"


# ------------------------------------------------------------------
# _restore_dot_notation_str
# ------------------------------------------------------------------

class TestRestoreDotNotationStr:
    def test_first_order_frac_form(self):
        result = _restore_dot_notation_str(r"\frac{d x}{d t}", {"x": 1})
        assert result == r"\dot{x}"

    def test_second_order(self):
        result = _restore_dot_notation_str(
            r"\frac{d^{2}}{d t^{2}} x", {"x": 2}
        )
        assert result == r"\ddot{x}"

    def test_no_frac_passthrough(self):
        assert _restore_dot_notation_str("x + y", {"x": 1}) == "x + y"

    def test_empty_dotted_vars(self):
        assert _restore_dot_notation_str(r"\frac{d}{d t} x", {}) == r"\frac{d}{d t} x"


# ------------------------------------------------------------------
# reject_degenerate
# ------------------------------------------------------------------

class TestRejectDegenerate:
    def test_single_expr_node(self, pp):
        graph = {"nodes": [{"id": "__expr_0", "type": "expression"}]}
        assert pp.reject_degenerate(graph) is True

    def test_normal_graph(self, pp):
        graph = {"nodes": [{"id": "F", "type": "variable"}]}
        assert pp.reject_degenerate(graph) is False

    def test_empty_nodes(self, pp):
        assert pp.reject_degenerate({"nodes": []}) is False

    def test_multiple_nodes(self, pp):
        graph = {"nodes": [
            {"id": "__expr_0", "type": "expression"},
            {"id": "x", "type": "variable"},
        ]}
        assert pp.reject_degenerate(graph) is False


# ------------------------------------------------------------------
# restore_dot_notation (graph-level)
# ------------------------------------------------------------------

class TestRestoreDotNotationGraph:
    def test_restores_subexpr(self, pp):
        graph = {"nodes": [
            {"id": "eq", "subexpr": r"\frac{d}{d t} x = 0"},
        ]}
        pp.restore_dot_notation(graph, {"x": 1})
        assert graph["nodes"][0]["subexpr"] == r"\dot{x} = 0"

    def test_no_frac_untouched(self, pp):
        graph = {"nodes": [{"id": "a", "subexpr": "a + b"}]}
        pp.restore_dot_notation(graph, {"a": 1})
        assert graph["nodes"][0]["subexpr"] == "a + b"

    def test_empty_dotted_vars(self, pp):
        graph = {"nodes": [{"id": "a", "subexpr": r"\frac{d}{d t} a"}]}
        pp.restore_dot_notation(graph, {})
        assert graph["nodes"][0]["subexpr"] == r"\frac{d}{d t} a"

    def test_no_subexpr_field(self, pp):
        graph = {"nodes": [{"id": "x", "latex": "x"}]}
        pp.restore_dot_notation(graph, {"x": 1})
        assert graph["nodes"][0] == {"id": "x", "latex": "x"}


# ------------------------------------------------------------------
# restore_accents
# ------------------------------------------------------------------

class TestRestoreAccents:
    def test_bare_body_restored(self, pp):
        graph = {"nodes": [{"id": "F", "type": "variable", "latex": "F"}]}
        pp.restore_accents(graph, {"F": "vec"})
        assert graph["nodes"][0]["latex"] == r"\vec{F}"
        assert graph["nodes"][0]["type"] == "vector"

    def test_subscripted_body(self, pp):
        graph = {"nodes": [{"id": "n_0", "type": "variable", "latex": "n_0"}]}
        pp.restore_accents(graph, {"n": "hat"})
        assert graph["nodes"][0]["latex"] == r"\hat{n}_0"

    def test_already_accented_skip(self, pp):
        graph = {"nodes": [{"id": "F", "type": "variable", "latex": r"\vec{F}"}]}
        pp.restore_accents(graph, {"F": "vec"})
        assert graph["nodes"][0]["latex"] == r"\vec{F}"

    def test_operator_skipped(self, pp):
        graph = {"nodes": [{"id": "+", "type": "operator", "latex": "+"}]}
        pp.restore_accents(graph, {"+": "hat"})
        assert graph["nodes"][0]["latex"] == "+"

    def test_empty_accent_map(self, pp):
        graph = {"nodes": [{"id": "F", "type": "variable", "latex": "F"}]}
        pp.restore_accents(graph, {})
        assert graph["nodes"][0]["latex"] == "F"

    def test_non_vec_accent(self, pp):
        graph = {"nodes": [{"id": "x", "type": "variable", "latex": "x"}]}
        pp.restore_accents(graph, {"x": "hat"})
        assert graph["nodes"][0]["latex"] == r"\hat{x}"
        assert graph["nodes"][0]["type"] == "variable"


# ------------------------------------------------------------------
# restore_subscripts
# ------------------------------------------------------------------

class TestRestoreSubscripts:
    def test_text_placeholder(self, pp):
        graph = {
            "nodes": [{"id": "alpha", "label": "alpha", "latex": r"\alpha", "subexpr": ""}],
            "edges": [],
        }
        pp.restore_subscripts(graph, {"alpha": r"\text{sp}"})
        assert graph["nodes"][0]["id"] == "sp"
        assert graph["nodes"][0]["label"] == "sp"
        assert graph["nodes"][0]["latex"] == r"\text{sp}"
        assert graph["nodes"][0]["type"] == "text"

    def test_plain_subscript(self, pp):
        graph = {
            "nodes": [{"id": "alpha", "label": "alpha", "latex": r"\alpha", "subexpr": ""}],
            "edges": [],
        }
        pp.restore_subscripts(graph, {"alpha": "exhaust"})
        assert graph["nodes"][0]["id"] == "exhaust"
        assert graph["nodes"][0]["label"] == "exhaust"
        assert graph["nodes"][0]["latex"] == "exhaust"

    def test_edge_refs_remapped(self, pp):
        graph = {
            "nodes": [
                {"id": "F", "label": "F", "latex": "F"},
                {"id": "alpha", "label": "alpha", "latex": r"\alpha", "subexpr": ""},
            ],
            "edges": [{"from": "F", "to": "alpha"}],
        }
        pp.restore_subscripts(graph, {"alpha": r"\text{prop}"})
        assert graph["edges"][0]["to"] == "prop"

    def test_inline_replacement(self, pp):
        graph = {
            "nodes": [{"id": "v_alpha", "label": "v_alpha", "latex": r"v_{\alpha}", "subexpr": r"v_{\alpha}"}],
            "edges": [],
        }
        pp.restore_subscripts(graph, {"alpha": "exhaust"})
        assert "exhaust" in graph["nodes"][0]["id"]
        assert r"\alpha" not in graph["nodes"][0]["latex"]

    def test_empty_mapping(self, pp):
        graph = {"nodes": [{"id": "x", "label": "x", "latex": "x"}], "edges": []}
        original = copy.deepcopy(graph)
        pp.restore_subscripts(graph, {})
        assert graph == original

    def test_text_pollution_keys_removed(self, pp):
        graph = {
            "nodes": [{
                "id": "alpha", "label": "alpha", "latex": r"\alpha",
                "subexpr": "", "emoji": "α", "quantity": "angle",
                "dimension": "rad", "unit": "rad", "value": None, "role": "variable",
            }],
            "edges": [],
        }
        pp.restore_subscripts(graph, {"alpha": r"\text{const}"})
        node = graph["nodes"][0]
        for k in ("emoji", "quantity", "dimension", "unit", "value", "role"):
            assert k not in node


# ------------------------------------------------------------------
# inject_annotations
# ------------------------------------------------------------------

class TestInjectAnnotations:
    def test_appends_nodes(self, pp):
        graph = {"nodes": [{"id": "x"}]}
        pp.inject_annotations(graph, [{"type": "annotation", "label": "constant"}])
        assert len(graph["nodes"]) == 2
        assert graph["nodes"][1]["id"] == "__annotation_0"
        assert graph["nodes"][1]["type"] == "annotation"

    def test_multiple_annotations(self, pp):
        graph = {"nodes": []}
        anns = [
            {"type": "annotation", "label": "a"},
            {"type": "annotation", "label": "b"},
        ]
        pp.inject_annotations(graph, anns)
        assert len(graph["nodes"]) == 2
        assert graph["nodes"][0]["id"] == "__annotation_0"
        assert graph["nodes"][1]["id"] == "__annotation_1"

    def test_creates_nodes_key(self, pp):
        graph: dict = {}
        pp.inject_annotations(graph, [{"type": "annotation", "label": "note"}])
        assert "nodes" in graph
        assert len(graph["nodes"]) == 1


# ------------------------------------------------------------------
# Full pipeline (postprocess)
# ------------------------------------------------------------------

class TestPostprocess:
    def _make_result(self, **overrides):
        defaults = dict(
            cleaned_latex="",
            dotted_vars={},
            accent_map={},
            subscript_map={},
            annotations=[],
        )
        defaults.update(overrides)
        return PreprocessResult(**defaults)

    def test_none_graph(self, pp):
        result = self._make_result()
        assert pp.postprocess(None, result) is None

    def test_degenerate_graph(self, pp):
        graph = {"nodes": [{"id": "__expr_0"}]}
        result = self._make_result()
        assert pp.postprocess(graph, result) is None

    def test_full_pipeline(self, pp):
        graph = {
            "nodes": [
                {"id": "F", "type": "variable", "latex": "F"},
                {"id": "eq", "type": "relation", "latex": "=", "subexpr": r"\frac{d}{d t} x = F"},
            ],
            "edges": [],
        }
        result = self._make_result(
            dotted_vars={"x": 1},
            accent_map={"F": "vec"},
        )
        out = pp.postprocess(graph, result)
        assert out is not None
        assert out["nodes"][0]["latex"] == r"\vec{F}"
        assert r"\dot{x}" in out["nodes"][1]["subexpr"]

    def test_annotations_injected(self, pp):
        graph = {"nodes": [{"id": "x", "type": "variable", "latex": "x"}], "edges": []}
        result = self._make_result(
            annotations=[{"type": "annotation", "label": "constant"}],
        )
        out = pp.postprocess(graph, result)
        assert out is not None
        assert any(n["id"] == "__annotation_0" for n in out["nodes"])
