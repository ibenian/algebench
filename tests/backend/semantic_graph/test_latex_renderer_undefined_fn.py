"""Structural LaTeX renderer (`to_latex`) — undefined function applications.

An unmodeled function name applied to arguments (``f(x)``, ``g(u, v)``) used to
raise ``StructuralRenderError: function 'f'`` — so ``to_latex(with_ids=True)``
failed and the proof-animation build fell back to raw LaTeX with NO ``data-n``
on the state (no FLIP morphing, no term highlighting). The canonical victim was
a derivation's finale that substitutes a derived constant back into a density's
general form, e.g. ``f(x) = 1/(σ√(2π))·e^{-(x-μ)²/(2σ²)}``. These tests lock
the undefined-function branch: it renders as a plain application, keeps ids,
and known single-arg functions are untouched.
"""

from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex

_svc = SemanticGraphService()


def _g(latex: str, domain: str = "statistics"):
    g = _svc.latex_to_graph(latex, domain=domain)
    assert g is not None, f"failed to parse: {latex!r}"
    return g


def test_undefined_function_renders_with_ids():
    """Previously raised StructuralRenderError -> raw fallback (no data-n)."""
    for ltx in [r"f(x) = x^2",
                r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}"]:
        out = to_latex(_g(ltx), with_ids=True)        # must not raise
        assert "htmlData{n=" in out, f"no ids emitted for {ltx!r}: {out!r}"


def test_undefined_function_name_is_one_tagged_unit():
    """The applied NAME gets its own ``<node>__name`` id (same treatment as
    ``\\sin``/``\\log``) so the morph engine moves it as a single glyph."""
    out = to_latex(_g(r"f(x) = x^2"), with_ids=True)
    assert "__name}{f}" in out, out


def test_known_functions_still_render_normally():
    """The undefined-function branch must not swallow modeled names."""
    out = to_latex(_g(r"\sin(x) + \sqrt{x}", domain="physics"), with_ids=True)
    assert r"\sin" in out and r"\sqrt" in out
