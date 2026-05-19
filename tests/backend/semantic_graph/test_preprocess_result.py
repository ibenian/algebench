"""Tests for PreprocessResult frozen dataclass."""

from __future__ import annotations

import pytest

from backend.semantic_graph.preprocess_result import PreprocessResult


class TestPreprocessResult:
    def test_creation(self):
        r = PreprocessResult(
            cleaned_latex="F = m a",
            dotted_vars={"m": 1},
            accent_map={"v": "\\vec"},
            subscript_map={"xi": "\\text{prop}"},
            annotations=[{"text": "constant"}],
        )
        assert r.cleaned_latex == "F = m a"
        assert r.dotted_vars == {"m": 1}
        assert r.accent_map == {"v": "\\vec"}
        assert r.subscript_map == {"xi": "\\text{prop}"}
        assert r.annotations == [{"text": "constant"}]

    def test_frozen(self):
        r = PreprocessResult(
            cleaned_latex="x = 1",
            dotted_vars={},
            accent_map={},
            subscript_map={},
            annotations=[],
        )
        with pytest.raises(AttributeError):
            r.cleaned_latex = "y = 2"

    def test_equality(self):
        kwargs = dict(
            cleaned_latex="a",
            dotted_vars={},
            accent_map={},
            subscript_map={},
            annotations=[],
        )
        assert PreprocessResult(**kwargs) == PreprocessResult(**kwargs)
