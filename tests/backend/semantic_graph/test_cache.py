"""Tests for backend.semantic_graph.cache.GraphCache."""

from __future__ import annotations

from backend.semantic_graph.cache import GraphCache, _MISS


class TestGraphCache:
    def test_miss_on_empty(self):
        cache = GraphCache()
        assert cache.get("x = 1") is _MISS

    def test_put_and_get_no_domain(self):
        cache = GraphCache()
        graph = {"nodes": [], "edges": []}
        cache.put("x = 1", None, graph)
        assert cache.get("x = 1") is graph

    def test_put_and_get_with_domain(self):
        cache = GraphCache()
        graph = {"nodes": [{"id": "x"}]}
        cache.put("F = ma", "physics", graph)
        assert cache.get("F = ma", "physics") is graph
        assert cache.get("F = ma") is _MISS

    def test_domain_isolation(self):
        cache = GraphCache()
        g1 = {"nodes": [{"id": "1"}]}
        g2 = {"nodes": [{"id": "2"}]}
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
        cache.put("x", None, {"nodes": []})
        cache.clear()
        assert cache.get("x") is _MISS

    def test_len(self):
        cache = GraphCache()
        assert len(cache) == 0
        cache.put("a", None, {"nodes": []})
        cache.put("b", "phys", {"nodes": []})
        assert len(cache) == 2

    def test_overwrite(self):
        cache = GraphCache()
        g1 = {"nodes": [{"id": "old"}]}
        g2 = {"nodes": [{"id": "new"}]}
        cache.put("x", None, g1)
        cache.put("x", None, g2)
        assert cache.get("x") is g2
        assert len(cache) == 1
