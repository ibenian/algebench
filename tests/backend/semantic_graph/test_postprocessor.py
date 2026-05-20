"""Tests for backend.semantic_graph.postprocessor.GraphPostprocessor."""

from __future__ import annotations

import copy

import pytest

from backend.model.semantic_graph import (
    SemanticGraph,
    SemanticGraphEdge,
    SemanticGraphNode,
)
from backend.semantic_graph.postprocessor import (
    GraphPostprocessor,
    _re_sub_literal,
    _restore_dot_notation_str,
)
from backend.semantic_graph.preprocess_result import PreprocessResult


@pytest.fixture
def pp():
    return GraphPostprocessor()


def _graph(nodes=(), edges=()):
    """Shorthand to build a ``SemanticGraph`` from node/edge lists."""
    return SemanticGraph(nodes=list(nodes), edges=list(edges))


def _node(**kwargs):
    """Shorthand to build a ``SemanticGraphNode`` with sensible defaults."""
    kwargs.setdefault("type", "scalar")
    return SemanticGraphNode(**kwargs)


def _edge(from_, to, **kwargs):
    """Shorthand to build a ``SemanticGraphEdge``."""
    return SemanticGraphEdge(from_=from_, to=to, **kwargs)


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
        graph = _graph(nodes=[_node(id="__expr_0", type="expression")])
        assert pp.reject_degenerate(graph) is True

    def test_normal_graph(self, pp):
        graph = _graph(nodes=[_node(id="F", type="scalar")])
        assert pp.reject_degenerate(graph) is False

    def test_empty_nodes(self, pp):
        assert pp.reject_degenerate(_graph()) is False

    def test_multiple_nodes(self, pp):
        graph = _graph(nodes=[
            _node(id="__expr_0", type="expression"),
            _node(id="x", type="scalar"),
        ])
        assert pp.reject_degenerate(graph) is False


# ------------------------------------------------------------------
# restore_dot_notation (graph-level)
# ------------------------------------------------------------------

class TestRestoreDotNotationGraph:
    def test_restores_subexpr(self, pp):
        graph = _graph(nodes=[
            _node(id="eq", subexpr=r"\frac{d}{d t} x = 0"),
        ])
        pp.restore_dot_notation(graph, {"x": 1})
        assert graph.nodes[0].subexpr == r"\dot{x} = 0"

    def test_no_frac_untouched(self, pp):
        graph = _graph(nodes=[_node(id="a", subexpr="a + b")])
        pp.restore_dot_notation(graph, {"a": 1})
        assert graph.nodes[0].subexpr == "a + b"

    def test_empty_dotted_vars(self, pp):
        graph = _graph(nodes=[_node(id="a", subexpr=r"\frac{d}{d t} a")])
        pp.restore_dot_notation(graph, {})
        assert graph.nodes[0].subexpr == r"\frac{d}{d t} a"

    def test_no_subexpr_field(self, pp):
        graph = _graph(nodes=[_node(id="x", latex="x")])
        pp.restore_dot_notation(graph, {"x": 1})
        assert graph.nodes[0].id == "x"
        assert graph.nodes[0].latex == "x"
        assert graph.nodes[0].subexpr is None


# ------------------------------------------------------------------
# restore_accents
# ------------------------------------------------------------------

class TestRestoreAccents:
    def test_bare_body_restored(self, pp):
        graph = _graph(nodes=[_node(id="F", type="scalar", latex="F")])
        pp.restore_accents(graph, {"F": "vec"})
        assert graph.nodes[0].latex == r"\vec{F}"
        assert graph.nodes[0].type == "vector"

    def test_subscripted_body(self, pp):
        graph = _graph(nodes=[_node(id="n_0", type="scalar", latex="n_0")])
        pp.restore_accents(graph, {"n": "hat"})
        assert graph.nodes[0].latex == r"\hat{n}_0"

    def test_already_accented_skip(self, pp):
        graph = _graph(nodes=[_node(id="F", type="scalar", latex=r"\vec{F}")])
        pp.restore_accents(graph, {"F": "vec"})
        assert graph.nodes[0].latex == r"\vec{F}"

    def test_operator_skipped(self, pp):
        graph = _graph(nodes=[_node(id="+", type="operator", latex="+")])
        pp.restore_accents(graph, {"+": "hat"})
        assert graph.nodes[0].latex == "+"

    def test_empty_accent_map(self, pp):
        graph = _graph(nodes=[_node(id="F", type="scalar", latex="F")])
        pp.restore_accents(graph, {})
        assert graph.nodes[0].latex == "F"

    def test_non_vec_accent(self, pp):
        graph = _graph(nodes=[_node(id="x", type="scalar", latex="x")])
        pp.restore_accents(graph, {"x": "hat"})
        assert graph.nodes[0].latex == r"\hat{x}"
        assert graph.nodes[0].type == "scalar"


# ------------------------------------------------------------------
# restore_subscripts
# ------------------------------------------------------------------

class TestRestoreSubscripts:
    def test_text_placeholder(self, pp):
        graph = _graph(
            nodes=[_node(id="alpha", label="alpha", latex=r"\alpha", subexpr="")],
            edges=[],
        )
        pp.restore_subscripts(graph, {"alpha": r"\text{sp}"})
        assert graph.nodes[0].id == "sp"
        assert graph.nodes[0].label == "sp"
        assert graph.nodes[0].latex == r"\text{sp}"
        assert graph.nodes[0].type == "text"

    def test_plain_subscript(self, pp):
        graph = _graph(
            nodes=[_node(id="alpha", label="alpha", latex=r"\alpha", subexpr="")],
            edges=[],
        )
        pp.restore_subscripts(graph, {"alpha": "exhaust"})
        assert graph.nodes[0].id == "exhaust"
        assert graph.nodes[0].label == "exhaust"
        assert graph.nodes[0].latex == "exhaust"

    def test_edge_refs_remapped(self, pp):
        graph = _graph(
            nodes=[
                _node(id="F", label="F", latex="F"),
                _node(id="alpha", label="alpha", latex=r"\alpha", subexpr=""),
            ],
            edges=[_edge("F", "alpha")],
        )
        pp.restore_subscripts(graph, {"alpha": r"\text{prop}"})
        assert graph.edges[0].to == "prop"

    def test_inline_replacement(self, pp):
        graph = _graph(
            nodes=[_node(id="v_alpha", label="v_alpha", latex=r"v_{\alpha}", subexpr=r"v_{\alpha}")],
            edges=[],
        )
        pp.restore_subscripts(graph, {"alpha": "exhaust"})
        assert "exhaust" in graph.nodes[0].id
        assert r"\alpha" not in graph.nodes[0].latex

    def test_empty_mapping(self, pp):
        graph = _graph(
            nodes=[_node(id="x", label="x", latex="x")],
            edges=[],
        )
        original = copy.deepcopy(graph)
        pp.restore_subscripts(graph, {})
        assert graph == original

    def test_text_pollution_keys_removed(self, pp):
        graph = _graph(
            nodes=[_node(
                id="alpha", label="alpha", latex=r"\alpha",
                subexpr="", emoji="α", quantity="angle",
                dimension="rad", unit="rad", value=None, role="parameter",
            )],
            edges=[],
        )
        pp.restore_subscripts(graph, {"alpha": r"\text{const}"})
        node = graph.nodes[0]
        for k in ("emoji", "quantity", "dimension", "unit", "value", "role"):
            assert getattr(node, k) is None


# ------------------------------------------------------------------
# inject_annotations
# ------------------------------------------------------------------

class TestInjectAnnotations:
    def test_appends_nodes(self, pp):
        graph = _graph(nodes=[_node(id="x")])
        pp.inject_annotations(graph, [{"type": "annotation", "label": "constant"}])
        assert len(graph.nodes) == 2
        assert graph.nodes[1].id == "__annotation_0"
        assert graph.nodes[1].type == "annotation"

    def test_multiple_annotations(self, pp):
        graph = _graph()
        anns = [
            {"type": "annotation", "label": "a"},
            {"type": "annotation", "label": "b"},
        ]
        pp.inject_annotations(graph, anns)
        assert len(graph.nodes) == 2
        assert graph.nodes[0].id == "__annotation_0"
        assert graph.nodes[1].id == "__annotation_1"

    def test_creates_nodes_on_empty_graph(self, pp):
        graph = _graph()
        pp.inject_annotations(graph, [{"type": "annotation", "label": "note"}])
        assert len(graph.nodes) == 1


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
        graph = _graph(nodes=[_node(id="__expr_0", type="expression")])
        result = self._make_result()
        assert pp.postprocess(graph, result) is None

    def test_full_pipeline(self, pp):
        graph = _graph(
            nodes=[
                _node(id="F", type="scalar", latex="F"),
                _node(id="eq", type="relation", latex="=", subexpr=r"\frac{d}{d t} x = F"),
            ],
            edges=[],
        )
        result = self._make_result(
            dotted_vars={"x": 1},
            accent_map={"F": "vec"},
        )
        out = pp.postprocess(graph, result)
        assert out is not None
        assert out.nodes[0].latex == r"\vec{F}"
        assert r"\dot{x}" in out.nodes[1].subexpr

    def test_annotations_injected(self, pp):
        graph = _graph(
            nodes=[_node(id="x", type="scalar", latex="x")],
            edges=[],
        )
        result = self._make_result(
            annotations=[{"type": "annotation", "label": "constant"}],
        )
        out = pp.postprocess(graph, result)
        assert out is not None
        assert any(n.id == "__annotation_0" for n in out.nodes)
