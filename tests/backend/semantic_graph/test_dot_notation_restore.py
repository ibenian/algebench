"""Regression tests for ``server._restore_dot_notation`` and the underlying
``_re_sub_literal`` helper.

These cover issue #185: when the variable being differentiated carries a
``\\text{...}`` subscript (or any other LaTeX command starting with a
backslash-letter that re.sub's replacement-string mini-language would
interpret), the result must contain the *literal* LaTeX, never the C-style
escape (``\\t`` → TAB, ``\\n`` → newline, etc.).
"""

from __future__ import annotations

from backend.semantic_graph import SemanticGraphService
from backend.semantic_graph.postprocessor import (
    _re_sub_literal,
    _restore_dot_notation_str as _restore_dot_notation,
)
from backend.semantic_graph.preprocessor import LaTeXPreprocessor

_strip_accent_commands = LaTeXPreprocessor.strip_accent_commands
_svc = SemanticGraphService()
_derive_semantic_graph = _svc.derive


# ---------------------------------------------------------------------------
# Helper: _re_sub_literal — the general guard
# ---------------------------------------------------------------------------

class TestReSubLiteral:
    """Verify the helper bypasses re.sub's replacement mini-language for
    every backslash escape that's a known footgun, not just ``\\t``."""

    def test_text_subscript_does_not_become_tab(self):
        out = _re_sub_literal(r"XXX", r"q_{\text{LEO}}", "XXX")
        assert "\t" not in out
        assert out == r"q_{\text{LEO}}"

    def test_newline_escape_preserved_literally(self):
        out = _re_sub_literal(r"XXX", r"\nu", "XXX")
        assert "\n" not in out
        assert out == r"\nu"

    def test_carriage_return_escape_preserved_literally(self):
        out = _re_sub_literal(r"XXX", r"\rho", "XXX")
        assert "\r" not in out
        assert out == r"\rho"

    def test_back_reference_not_interpreted(self):
        # ``\1`` would normally be the first capture group's contents.
        out = _re_sub_literal(r"X(Y)X", r"\1", "XYX")
        assert out == r"\1"

    def test_double_backslash_not_collapsed(self):
        # Plain re.sub collapses ``\\\\`` to ``\\``; the literal helper does not.
        out = _re_sub_literal(r"XXX", r"\\dot{x}", "XXX")
        assert out == r"\\dot{x}"

    def test_no_match_returns_text_unchanged(self):
        assert _re_sub_literal(r"XXX", r"\dot{x}", "abc") == "abc"


# ---------------------------------------------------------------------------
# Direct: _restore_dot_notation — the original site
# ---------------------------------------------------------------------------

class TestRestoreDotNotation:
    """Drive the function with the exact LaTeX shapes SymPy emits, for the
    variable forms that triggered #185."""

    def test_text_subscript_round_trips_without_tab(self):
        # SymPy canonical form for d/dt of ``q_{\text{LEO}}``.
        sympy_form = r"\frac{d}{d t} q_{\text{LEO}}"
        out = _restore_dot_notation(sympy_form, {r"q_{\text{LEO}}": 1})
        assert "\t" not in out
        # Restored to ``\dot{q_{\text{LEO}}}`` — single backslash before each
        # LaTeX command, ``\text{...}`` intact inside the subscript.
        assert out == r"\dot{q_{\text{LEO}}}"

    def test_rewritten_form_also_restored(self):
        # The d-on-numerator shape that survives in equals-node subexprs.
        sympy_form = r"\frac{d q_{\text{lunar}}}{d t}"
        out = _restore_dot_notation(sympy_form, {r"q_{\text{lunar}}": 1})
        assert "\t" not in out
        assert out == r"\dot{q_{\text{lunar}}}"

    def test_second_order_text_subscript(self):
        sympy_form = r"\frac{d^{2}}{d t^{2}} x_{\text{cm}}"
        out = _restore_dot_notation(sympy_form, {r"x_{\text{cm}}": 2})
        assert "\t" not in out
        assert out == r"\ddot{x_{\text{cm}}}"

    def test_plain_variable_still_restored(self):
        # Sanity: the no-subscript case must still work.
        out = _restore_dot_notation(r"\frac{d}{d t} x", {"x": 1})
        assert out == r"\dot{x}"

    def test_multiple_dotted_vars_in_one_pass(self):
        sympy_form = (
            r"\frac{\frac{d q_{\text{lunar}}}{d t}}"
            r"{\frac{d q_{\text{LEO}}}{d t}}"
        )
        out = _restore_dot_notation(
            sympy_form,
            {r"q_{\text{lunar}}": 1, r"q_{\text{LEO}}": 1},
        )
        assert "\t" not in out
        assert r"\dot{q_{\text{lunar}}}" in out
        assert r"\dot{q_{\text{LEO}}}" in out


# ---------------------------------------------------------------------------
# End-to-end: the original repro from issue #185
# ---------------------------------------------------------------------------

class TestIssue185Repro:
    """The exact repro from issue #185. Builds the semantic graph for the
    user-facing LaTeX and asserts no node's ``subexpr`` carries a literal
    TAB byte."""

    LATEX = r"\frac{\dot{q}_{\text{lunar}}}{\dot{q}_{\text{LEO}}} = 2.81"

    def test_no_subexpr_carries_a_tab(self):
        g = _derive_semantic_graph(self.LATEX)
        for node in g.nodes:
            sub = node.subexpr or ""
            assert "\t" not in sub, (
                f"Node {node.id!r} subexpr still has TAB: {sub!r}"
            )

    def test_q_label_nodes_render_text_command_literally(self):
        g = _derive_semantic_graph(self.LATEX)
        # The id is an internal wiring key now (e.g. ``q_lunar``); the
        # ``\text{...}`` must survive in the DISPLAY latex so it renders
        # literally rather than getting corrupted (issue 185).
        latexes = [node.latex or "" for node in g.nodes]
        assert any(r"\text{lunar}" in lx for lx in latexes)
        assert any(r"\text{LEO}" in lx for lx in latexes)

    def test_accent_strip_prevents_token_concatenation(self):
        """``\\times\\vec{E}`` must strip to ``\\times E``, not ``\\timesE``."""
        result = _strip_accent_commands(r"\times\vec{E}")
        assert result == r"\times E"

    def test_accent_strip_no_space_after_non_alpha(self):
        """No extra space when preceding char is not alphabetic."""
        result = _strip_accent_commands(r"(\vec{F})")
        assert result == "(F)"

    def test_dotted_subexprs_use_dot_command(self):
        g = _derive_semantic_graph(self.LATEX)
        # The deriv-operator nodes' subexprs should contain ``\dot{...}``
        # with the original ``\text{...}`` subscript fully preserved.
        deriv_subs = [
            node.subexpr or ""
            for node in g.nodes
            if node.id.startswith("__deriv_")
        ]
        assert deriv_subs, "expected at least one __deriv_* node"
        for sub in deriv_subs:
            assert r"\dot{" in sub
            assert r"\text{" in sub
            assert "\t" not in sub
