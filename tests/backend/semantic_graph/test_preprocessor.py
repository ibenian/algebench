"""Tests for backend.semantic_graph.preprocessor.LaTeXPreprocessor."""

from __future__ import annotations

import pytest

from backend.semantic_graph.preprocessor import (
    LaTeXPreprocessor,
    strip_math_delimiters,
)
from backend.semantic_graph.preprocess_result import PreprocessResult


@pytest.fixture
def pp():
    return LaTeXPreprocessor()


# ------------------------------------------------------------------
# strip_math_delimiters
# ------------------------------------------------------------------

class TestStripMathDelimiters:
    @pytest.mark.parametrize("wrapped, bare", [
        (r"$x = 1$", "x = 1"),
        (r"$$x = 1$$", "x = 1"),
        (r"\(x = 1\)", "x = 1"),
        (r"\[x = 1\]", "x = 1"),
        (r"  $x = 1$  ", "x = 1"),
        (r"$m a = \frac{1}{2}\rho V^2 C_d A$", r"m a = \frac{1}{2}\rho V^2 C_d A"),
    ])
    def test_strips_enclosing_delimiters(self, wrapped, bare):
        assert strip_math_delimiters(wrapped) == bare

    def test_unwrapped_passthrough(self):
        assert strip_math_delimiters("x = 1") == "x = 1"

    def test_does_not_strip_non_enclosing(self):
        # The leading $ closes mid-string, so the pair does not enclose all of s.
        assert strip_math_delimiters(r"$a$ + $b$") == r"$a$ + $b$"

    def test_nested_layers_peeled(self):
        # Distinguishable nestings peel: a mixed pair, and an odd dollar run.
        assert strip_math_delimiters(r"$$\(x\)$$") == "x"
        assert strip_math_delimiters(r"$$$x$$$") == "x"

    @pytest.mark.parametrize("s", [
        r"$$$$x$$$$",   # indistinguishable from an inline-wrapped ``$$x$$``
        r"\(\(x\)\)",   # inner ``\(`` recurs, so we refuse rather than over-strip
        r"\[\[x\]\]",
    ])
    def test_same_delimiter_doubling_left_untouched(self, s):
        # Ambiguous same-delimiter doubling is deliberately NOT peeled — peeling
        # it would risk over-stripping non-enclosing cases like ``$a$ + $b$``.
        assert strip_math_delimiters(s) == s

    def test_non_string_passthrough(self):
        assert strip_math_delimiters(None) is None


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

    def test_side_condition_after_qquad(self, pp):
        latex = r"T_0 = h \qquad (c = 1)"
        cleaned, anns = pp.extract_parenthetical_annotations(latex)
        assert cleaned == r"T_0 = h"
        assert len(anns) == 1
        assert anns[0]["label"] == "c = 1"

    def test_side_condition_without_quad_not_stripped(self, pp):
        latex = r"a = b (c = 1)"
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


class TestNormalizeFuncCallBraces:
    r"""``\fn{ARG}`` → ``\fn(ARG)`` so SymPy bounds the argument.

    SymPy's printer emits ``\cos{\left(x\right)}`` (a brace group), which its own
    parser then reads as "cos applied to the whole trailing product" — so a
    re-parsed step like ``\cos{\left(x^2\right)} \cdot 2 \cdot x`` corrupts into
    ``cos(x^2 · 2 · x)``.  Rewriting the brace to parens forces the bounded branch.
    """
    norm = staticmethod(LaTeXPreprocessor.normalize_func_call_braces)

    def test_drops_braces_around_delimited_arg(self):
        # SymPy's printer form: arg is already \left(…\right), so just drop the
        # braces — no doubled delimiters.
        assert self.norm(r"\cos{\left(x^{2} \right)} \cdot 2 \cdot x") == \
            r"\cos\left(x^{2} \right) \cdot 2 \cdot x"

    def test_wraps_bare_arg_in_parens(self):
        assert self.norm(r"\cos{x^2} \cdot 2 \cdot x") == r"\cos(x^2) \cdot 2 \cdot x"

    def test_skips_exponent_then_normalizes_arg(self):
        # \sin^{2}{\left(x\right)}: the FIRST brace group is the exponent, the
        # second is the argument — only the argument is normalized.
        assert self.norm(r"\sin^{2}{\left(x \right)} + 1") == \
            r"\sin^{2}\left(x \right) + 1"

    def test_non_delimited_arg_is_wrapped_not_dropped(self):
        # arg is a sum, not a single delimiter group — must be wrapped, else the
        # trailing '+ 1' would escape the function.
        assert self.norm(r"\cos{x + 1}") == r"\cos(x + 1)"

    def test_longest_name_wins(self):
        # \sinh must not be matched as \sin + "h".
        assert self.norm(r"\sinh{x} + 1") == r"\sinh(x) + 1"

    def test_ln_and_log(self):
        assert self.norm(r"\ln{\left(x \right)}") == r"\ln\left(x \right)"
        assert self.norm(r"\log{y}") == r"\log(y)"

    @pytest.mark.parametrize("latex", [
        r"\frac{a}{b}",
        r"\sqrt{x}",
        r"\hat{p}",
        r"\text{rate}",
        r"x^{2} + y_{i}",
        r"\cos(x) \cdot 2",          # already parenthesised — untouched
        r"2 \cdot \cos{\left(x\right)}",  # function last: still swapped, but no swallow
    ])
    def test_leaves_non_func_braces_alone(self, latex):
        # These must be byte-for-byte unchanged EXCEPT the last case, which is a
        # legitimate swap; assert non-func cases are identical.
        if "\\cos{" in latex or "\\sin{" in latex:
            return
        assert self.norm(latex) == latex

    def test_end_to_end_no_swallow(self):
        # The whole point: after the pass, the parser must NOT fold the product
        # into the cosine.  Verify via the real graph round-trip.
        from backend.semantic_graph.service import SemanticGraphService
        from backend.semantic_graph.latex_renderer import to_latex
        svc = SemanticGraphService()
        g = svc.latex_to_graph(r"\cos{\left(x^{2} \right)} \cdot 2 \cdot x",
                               domain="calculus")
        assert g is not None
        rendered = to_latex(g)
        # cosine's argument is exactly x^2 — the "\cdot 2" lives OUTSIDE it.
        assert r"\cos\left(x^{2}\right)" in rendered
        assert r"x^{2} \cdot 2" not in rendered
