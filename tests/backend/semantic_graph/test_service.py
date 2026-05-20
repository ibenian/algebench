"""Tests for backend.semantic_graph.SemanticGraphService."""

from __future__ import annotations

import pytest

from backend.semantic_graph import SemanticGraphService


@pytest.fixture
def svc():
    return SemanticGraphService()


class TestDerive:
    def test_simple_equation(self, svc):
        graph = svc.derive("F = m a")
        assert graph is not None
        assert graph.nodes is not None
        assert graph.edges is not None

    def test_returns_none_for_empty(self, svc):
        assert svc.derive("") is None

    def test_returns_none_for_none(self, svc):
        assert svc.derive(None) is None

    def test_domain_carried(self, svc):
        graph = svc.derive("F = ma", domain="physics")
        assert graph is not None
        assert graph.domain == "physics"

    def test_chained_equals(self, svc):
        graph = svc.derive("a = b = c")
        assert graph is not None
        eq_nodes = [n for n in graph.nodes if n.op == "equals"]
        assert len(eq_nodes) >= 1

    def test_statement_separator(self, svc):
        graph = svc.derive(r"a = 1 \\ b = 2")
        assert graph is not None

    def test_relation_approx(self, svc):
        graph = svc.derive(r"a \approx b")
        assert graph is not None

    def test_element_of(self, svc):
        graph = svc.derive(r"x \in \mathbb{R}")
        assert graph is not None
        rel_nodes = [n for n in graph.nodes if n.op == "element_of"]
        assert len(rel_nodes) == 1

    def test_annotation_preserved(self, svc):
        graph = svc.derive(r"F = ma \quad (v_e \text{ constant})")
        assert graph is not None
        ann_nodes = [n for n in graph.nodes
                     if n.id.startswith("__annotation_")]
        assert len(ann_nodes) >= 1

    def test_compound_symbol(self, svc):
        graph = svc.derive(r"\Delta t = 1")
        assert graph is not None

    def test_logical_connective(self, svc):
        graph = svc.derive(r"a = 1 \implies b = 2")
        assert graph is not None


class TestCaching:
    def test_cache_hit(self, svc):
        g1 = svc.derive("x = 1")
        g2 = svc.derive("x = 1")
        assert g1 is g2

    def test_domain_isolates_cache(self, svc):
        g1 = svc.derive("F = ma")
        g2 = svc.derive("F = ma", domain="physics")
        assert g1 is not g2

    def test_none_cached(self, svc):
        r1 = svc.derive("")
        r2 = svc.derive("")
        assert r1 is None
        assert r2 is None

    def test_clear_cache(self, svc):
        svc.derive("x = 1")
        svc.clear_cache()
        g2 = svc.derive("x = 1")
        assert g2 is not None
