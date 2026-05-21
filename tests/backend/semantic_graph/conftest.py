"""Shared fixtures and helpers for semantic graph tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from hypothesis import settings

from backend.model.semantic_graph import SemanticGraph
from backend.semantic_graph.sympy_translator import latex_to_semantic_graph

# ── Hypothesis profiles ────────────────────────────────────────────────

settings.register_profile("ci", max_examples=200, deadline=None)
settings.register_profile("local", max_examples=20, deadline=None)
settings.load_profile("local")

# ── Fixtures ───────────────────────────────────────────────────────────

GOLDEN_DIR = Path(__file__).parent / "golden"


@pytest.fixture
def parse():
    """Return a parser callable for use in tests.

    Usage::

        def test_something(parse):
            graph = parse(r"x + y = z")
            assert graph is not None
    """
    def _parse(latex: str, *, domain: str | None = None) -> SemanticGraph:
        return latex_to_semantic_graph(latex, domain=domain)
    return _parse


@pytest.fixture
def load_golden():
    """Return a loader that reads a golden JSON file and returns the dict."""
    def _load(category: str, name: str) -> dict:
        path = GOLDEN_DIR / category / f"{name}.json"
        return json.loads(path.read_text())
    return _load
