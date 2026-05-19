"""Tests for backend.semantic_graph.preprocessor.LaTeXPreprocessor."""

from __future__ import annotations

import pytest

from backend.semantic_graph.preprocessor import LaTeXPreprocessor
from backend.semantic_graph.preprocess_result import PreprocessResult


@pytest.fixture
def pp():
    return LaTeXPreprocessor()


# ------------------------------------------------------------------
# rewrite_dot_derivatives
# ------------------------------------------------------------------

class TestRewriteDotDerivatives:
    def test_single_dot(self, pp):
        result = pp.rewrite_dot_derivatives(r"\dot{x}")
        assert result == r"\frac{d}{d t} x"

    def test_ddot(self, pp):
        result = pp.rewrite_dot_derivatives(r"\ddot{x}")
        assert r"\frac{d}{d t} \frac{d}{d t} x" == result

    def test_captures_order(self, pp):
        captured: dict[str, int] = {}
        pp.rewrite_dot_derivatives(r"\ddot{x}", captured)
        assert captured == {"x": 2}

    def test_trailing_subscript_absorbed(self, pp):
        captured: dict[str, int] = {}
        result = pp.rewrite_dot_derivatives(r"\dot{m}_{exhaust}", captured)
        assert "m_{exhaust}" in result
        assert "m_{exhaust}" in captured

    def test_no_dot_passthrough(self, pp):
        assert pp.rewrite_dot_derivatives("x + y") == "x + y"

    def test_non_string(self, pp):
        assert pp.rewrite_dot_derivatives("") == ""

    def test_no_backslash(self, pp):
        assert pp.rewrite_dot_derivatives("abc") == "abc"


# ------------------------------------------------------------------
# normalize_frac_derivatives
# ------------------------------------------------------------------

class TestNormalizeFracDerivatives:
    def test_basic_rewrite(self, pp):
        result = pp.normalize_frac_derivatives(r"\frac{dx}{dt}")
        assert result == r"\frac{d}{d t} x"

    def test_subscripted_var(self, pp):
        result = pp.normalize_frac_derivatives(r"\frac{dm_{exhaust}}{dt}")
        assert result == r"\frac{d}{d t} m_{exhaust}"

    def test_non_derivative_frac_untouched(self, pp):
        result = pp.normalize_frac_derivatives(r"\frac{a}{b}")
        assert result == r"\frac{a}{b}"

    def test_no_frac_passthrough(self, pp):
        assert pp.normalize_frac_derivatives("x + y") == "x + y"

    def test_nested_recursion(self, pp):
        result = pp.normalize_frac_derivatives(r"\frac{a}{\frac{dx}{dt}}")
        assert r"\frac{d}{d t} x" in result


# ------------------------------------------------------------------
# strip_accent_commands
# ------------------------------------------------------------------

class TestStripAccentCommands:
    def test_vec(self, pp):
        assert pp.strip_accent_commands(r"\vec{F}") == "F"

    def test_hat(self, pp):
        assert pp.strip_accent_commands(r"\hat{n}") == "n"

    def test_nested(self, pp):
        assert pp.strip_accent_commands(r"\vec{\hat{F}}") == "F"

    def test_accent_map_populated(self, pp):
        amap: dict[str, str] = {}
        pp.strip_accent_commands(r"\vec{F}", amap)
        assert amap == {"F": "vec"}

    def test_token_separation(self, pp):
        result = pp.strip_accent_commands(r"\times\vec{E}")
        assert "times E" in result or "timesE" not in result

    def test_no_backslash_passthrough(self, pp):
        assert pp.strip_accent_commands("abc") == "abc"

    def test_operatorname_stripped(self, pp):
        assert pp.strip_accent_commands(r"\operatorname{div}") == "div"

    def test_mathbf_not_in_accent_map(self, pp):
        amap: dict[str, str] = {}
        pp.strip_accent_commands(r"\mathbf{v}", amap)
        assert "v" not in amap


# ------------------------------------------------------------------
# substitute_multichar_subscripts
# ------------------------------------------------------------------

class TestSubstituteMulticharSubscripts:
    def test_text_body(self, pp):
        result, mapping = pp.substitute_multichar_subscripts(r"I_{\text{sp}}")
        assert "\\text{sp}" not in result
        assert len(mapping) == 1
        original = list(mapping.values())[0]
        assert original == r"\text{sp}"

    def test_multi_alpha(self, pp):
        result, mapping = pp.substitute_multichar_subscripts(r"v_{exhaust}")
        assert "exhaust" not in result
        assert any(v == "exhaust" for v in mapping.values())

    def test_single_char_untouched(self, pp):
        result, mapping = pp.substitute_multichar_subscripts(r"x_{i}")
        assert result == r"x_{i}"
        assert len(mapping) == 0

    def test_numeric_untouched(self, pp):
        result, mapping = pp.substitute_multichar_subscripts(r"x_{12}")
        assert result == r"x_{12}"
        assert len(mapping) == 0

    def test_repeated_body_reuses_placeholder(self, pp):
        result, mapping = pp.substitute_multichar_subscripts(
            r"v_{\text{prop}} + a_{\text{prop}}"
        )
        assert len(mapping) == 1


# ------------------------------------------------------------------
# extract_parenthetical_annotations
# ------------------------------------------------------------------

class TestExtractParentheticalAnnotations:
    def test_trailing_annotation(self, pp):
        latex = r"F = ma \quad (v_e \text{ constant})"
        cleaned, anns = pp.extract_parenthetical_annotations(latex)
        assert r"\quad" not in cleaned
        assert len(anns) == 1
        assert anns[0]["type"] == "annotation"

    def test_no_annotation(self, pp):
        cleaned, anns = pp.extract_parenthetical_annotations("x = 1")
        assert cleaned == "x = 1"
        assert anns == []

    def test_plain_parens_not_stripped(self, pp):
        latex = r"(a + b) = c"
        cleaned, anns = pp.extract_parenthetical_annotations(latex)
        assert cleaned == latex
        assert anns == []


# ------------------------------------------------------------------
# Full pipeline (preprocess)
# ------------------------------------------------------------------

class TestPreprocess:
    def test_returns_preprocess_result(self, pp):
        result = pp.preprocess(r"\dot{x} = \vec{F}")
        assert isinstance(result, PreprocessResult)
        assert "x" in result.dotted_vars
        assert "F" in result.accent_map

    def test_empty_input(self, pp):
        result = pp.preprocess("")
        assert result.cleaned_latex == ""
        assert result.dotted_vars == {}
        assert result.accent_map == {}
        assert result.subscript_map == {}
        assert result.annotations == []
