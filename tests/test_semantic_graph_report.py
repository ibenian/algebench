"""The semantic-graph report's per-row panels.

The report (``scripts/semantic_graph_report.py``) is visual tooling, but the
SymPy panel grounds each expression through ``graph_to_sympy`` — these pin that
the button + grounded repr appear for a groundable expression, and that an
ungroundable construct degrades to a reason instead of crashing the row.
"""

from __future__ import annotations

from scripts.semantic_graph_report import _render_row

try:
    from graph_to_mermaid import load_theme
except ImportError:
    from scripts.graph_to_mermaid import load_theme

_THEME = load_theme("default-dark")


def test_sympy_panel_renders_grounded_expression():
    html, ok = _render_row("integral_indefinite", r"\int x^2 \, dx", _THEME)
    assert ok
    assert 'data-target="row-sympy"' in html        # the SymPy toggle button
    assert "Integral(x**2, x)" in html               # str() form
    assert "srepr" in html and "Pow(Symbol('x')" in html   # srepr tree


def test_sympy_panel_grounds_an_equation():
    html, ok = _render_row("newton", r"F = m a", _THEME)
    assert ok
    assert "Eq(F, a*m)" in html                      # sympy sorts factors a*m


def test_sympy_panel_reports_ungroundable_closed_integral():
    # A line integral has no plain antiderivative form — graph_to_sympy raises
    # UngroundableGraph, and the panel shows the reason rather than erroring.
    html, ok = _render_row("cauchy", r"\oint \vec{F} \cdot d\vec{r}", _THEME,
                           domain="calculus")
    assert ok                                         # the graph still renders
    assert "ungroundable" in html.lower()
    assert "closed_integral" in html


def test_js_panel_renders_mathjs_expression():
    # The JS panel uses the same ``latex_to_mathjs`` converter as ``chartScript``.
    html, ok = _render_row("pythagoras", r"\sqrt{a^2 + b^2}", _THEME)
    assert ok
    assert 'data-target="row-js"' in html             # the JS toggle button
    assert "sqrt(pow(a, 2) + pow(b, 2))" in html      # the math.js script
    assert ">math.js<" in html and ">variables<" in html


def test_js_panel_evaluates_definite_integral():
    # latex_to_mathjs evaluates the integral to a JS-computable form.
    html, ok = _render_row("definite", r"\int_0^1 x^2 \, dx", _THEME)
    assert ok
    assert "row-js" in html and "1/3" in html
