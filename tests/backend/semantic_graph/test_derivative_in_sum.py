r"""A derivative must never be silently evaluated to zero (#535).

``latex_to_sympy_defined`` recognised a derivative only when it sat ALONE on one
side. Written the standard way for a linear ODE — ``\frac{dv}{dt} + kv = 0`` —
it fell through to ``(lhs - rhs).doit()``, and::

    Derivative(Symbol('v'), t).doit()  ->  0

SymPy is right: a plain ``Symbol`` has no ``t``-dependence. The mismatch is that
the reader wrote ``dv/dt`` meaning an unknown function of ``t``. The term
vanished, the sign flipped, and the chart looked entirely plausible — a wrong
answer from a *successful* computation, with nothing failing to detect.
"""

from __future__ import annotations

import pytest
import sympy

from backend.experts.modules.expression_analysis.features import (
    _symbol_latex, analyze,
)
from backend.semantic_graph.mathjs_converter import latex_to_sympy_defined

k, v, b, m, F, x, t = sympy.symbols("k v b m F x t")


def _plots(latex: str):
    expr, dep, _, _ = latex_to_sympy_defined(latex)
    return expr, dep


# ── the two reported failures ─────────────────────────────────────────

def test_derivative_inside_a_sum_is_isolated_not_zeroed():
    r"""``dv/dt + kv = 0`` plotted ``k·v`` — the derivative gone, sign flipped."""
    expr, dep = _plots(r"\frac{dv}{dt} + k v = 0")
    assert sympy.simplify(expr - (-k * v)) == 0
    assert str(dep) == "dv_dt", "the derivative must become the dependent quantity"


def test_a_derivative_bearing_side_never_becomes_the_plotted_expression():
    r"""``m dv/dt + bv = F`` matched "F is defined by the left" and shipped
    SymPy's ``Derivative(v, t)`` repr to the browser as if it were mathjs."""
    expr, dep = _plots(r"m \frac{dv}{dt} + b v = F")
    assert sympy.simplify(expr - (F - b * v) / m) == 0
    assert str(dep) == "dv_dt"
    assert not expr.has(sympy.Derivative)


@pytest.mark.parametrize("latex", [
    r"\frac{dv}{dt} + k v = 0",
    r"m \frac{dv}{dt} + b v = F",
    r"\left(\frac{dv}{dt}\right)^{2} + v = 0",
    r"\frac{dv}{dt} + \frac{dx}{dt} = 0",
])
def test_no_chart_script_can_contain_a_sympy_derivative(latex):
    """The script is evaluated by mathjs, which has no ``Derivative``."""
    script = (analyze(latex).get("chartScript") or {}).get("script") or ""
    assert "Derivative(" not in script, f"SymPy repr leaked into mathjs: {script}"


# ── the already-correct spellings must not move ───────────────────────

@pytest.mark.parametrize("latex", [
    r"\frac{d}{dt} v = -k v",           # bare derivative, d/dt form
    r"\frac{dv}{dt} = -k v",            # bare derivative, dv/dt form
])
def test_bare_derivative_spellings_are_unchanged(latex):
    expr, dep = _plots(latex)
    assert sympy.simplify(expr - (-k * v)) == 0
    assert str(dep) == "dv_dt"


def test_a_genuinely_evaluable_derivative_is_still_evaluated():
    r"""``\frac{d}{dx} x^2 = 2x`` is real calculus — ``.doit()`` SHOULD run."""
    expr, _ = _plots(r"\frac{d}{dx} x^{2} = 2 x")
    assert sympy.simplify(expr - 2 * x) == 0


@pytest.mark.parametrize("latex,want", [
    (r"x^{2} - 4 = 0", x**2 - 4),
    (r"E = m c^{2}", m * sympy.Symbol("c")**2),
    (r"p V = n R T", (sympy.Symbol("p") * sympy.Symbol("V")
                      - sympy.Symbol("n") * sympy.Symbol("R") * sympy.Symbol("T"))),
])
def test_expressions_without_derivatives_are_unchanged(latex, want):
    expr, _ = _plots(latex)
    assert sympy.simplify(expr - want) == 0


# ── the flatten fallback ──────────────────────────────────────────────

@pytest.mark.parametrize("latex,expect_vars", [
    (r"\left(\frac{dv}{dt}\right)^{2} + v = 0", {"dv_dt", "v"}),
    (r"\frac{dv}{dt} + \frac{dx}{dt} = 0", {"dv_dt", "dx_dt"}),
])
def test_an_unisolatable_derivative_becomes_a_plain_symbol(latex, expect_vars):
    """Nonlinear in the derivative, or several of them — isolation must not guess.

    Flattening keeps the term instead of refusing OR zeroing it: the chart
    samples scalars, so there is no trajectory to differentiate and nothing to
    compute. The rate is an INPUT, and it gets its own slider.
    """
    report = analyze(latex)
    assert not report.get("error")
    assert set(report["variables"]) == expect_vars
    assert not sympy.sympify(0).has(sympy.Derivative)  # sanity
    expr, _ = _plots(latex)
    assert not expr.has(sympy.Derivative)


def test_flattening_does_not_drop_the_term():
    """The whole point: ``dv/dt`` must still be PRESENT after flattening."""
    expr, _ = _plots(r"\left(\frac{dv}{dt}\right)^{2} + v = 0")
    assert sympy.Symbol("dv_dt") in expr.free_symbols


# ── the slider label ──────────────────────────────────────────────────

@pytest.mark.parametrize("name,want", [
    ("dv_dt", r"\frac{d v}{d t}"),
    ("domega_dt", r"\frac{d \omega}{d t}"),
])
def test_a_flattened_derivative_renders_as_a_fraction(name, want):
    """Otherwise the slider reads ``dv_{dt}`` — a fix trading a broken chart
    for an ugly one."""
    assert _symbol_latex(name) == want


@pytest.mark.parametrize("name,want", [
    ("v_0", "v_{0}"),
    ("omega", r"\omega"),
    ("u_prime", "u'"),
    ("v", "v"),
    ("dt", "dt"),          # no underscore — not a flattened derivative
    ("d", "d"),
])
def test_ordinary_names_are_not_mistaken_for_derivatives(name, want):
    assert _symbol_latex(name) == want
