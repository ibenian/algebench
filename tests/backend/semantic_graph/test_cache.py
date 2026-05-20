"""Tests for backend.semantic_graph.cache.GraphCache."""

from __future__ import annotations

from backend.model.semantic_graph import SemanticGraph, SemanticGraphNode
from backend.semantic_graph.cache import GraphCache, _MISS


def _graph(*nodes: dict) -> SemanticGraph:
    """Build a minimal SemanticGraph from node kwargs dicts."""
    return SemanticGraph(
        nodes=[SemanticGraphNode(type="scalar", **n) for n in nodes],
        edges=[],
    )


class TestGraphCache:
    def test_miss_on_empty(self):
        cache = GraphCache()
        assert cache.get("x = 1") is _MISS

    def test_put_and_get_no_domain(self):
        cache = GraphCache()
        graph = SemanticGraph(nodes=[], edges=[])
        cache.put("x = 1", None, graph)
        assert cache.get("x = 1") is graph

    def test_put_and_get_with_domain(self):
        cache = GraphCache()
        graph = _graph({"id": "x"})
        cache.put("F = ma", "physics", graph)
        assert cache.get("F = ma", "physics") is graph
        assert cache.get("F = ma") is _MISS

    def test_domain_isolation(self):
        cache = GraphCache()
        g1 = _graph({"id": "n1"})
        g2 = _graph({"id": "n2"})
        cache.put("x", "physics", g1)
        cache.put("x", "math", g2)
        assert cache.get("x", "physics") is g1
        assert cache.get("x", "math") is g2

    def test_none_graph_stored(self):
        cache = GraphCache()
        cache.put("bad", None, None)
        assert cache.get("bad") is None
        assert cache.get("bad") is not _MISS

    def test_clear(self):
        cache = GraphCache()
        cache.put("x", None, SemanticGraph(nodes=[], edges=[]))
        cache.clear()
        assert cache.get("x") is _MISS

    def test_len(self):
        cache = GraphCache()
        assert len(cache) == 0
        cache.put("a", None, SemanticGraph(nodes=[], edges=[]))
        cache.put("b", "phys", SemanticGraph(nodes=[], edges=[]))
        assert len(cache) == 2

    def test_overwrite(self):
        cache = GraphCache()
        g1 = _graph({"id": "old"})
        g2 = _graph({"id": "new"})
        cache.put("x", None, g1)
        cache.put("x", None, g2)
        assert cache.get("x") is g2
        assert len(cache) == 1
