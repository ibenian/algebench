"""Tests for CAS behavior-feature detection (expression_analysis.features).

Pure-CAS layer only — the DSPy proposer needs an LM and is exercised
separately. The suite runs under thread isolation (tests/conftest.py), so
guarded ops execute in-process and stay assertable.
"""

from __future__ import annotations

from backend.experts.modules.expression_analysis.features import analyze


def _approxes(points):
    return sorted(p["approx"] for p in points if "approx" in p)


# ── projectile height: the proposal's running example ──────────────────

def test_projectile_zeros_and_peak():
    rep = analyze(r"v_0 t - \frac{1}{2} g t^2", variable="t")
    assert "error" not in rep
    assert rep["variable"] == "t"
    assert set(rep["variables"]) == {"g", "t", "v_0"}

    zeros = rep["features"]["zeros"]
    # t = 0 and t = 2·v₀/g  (approx with v₀ = g = 1 → 0 and 2)
    assert _approxes(zeros["points"]) == [0.0, 2.0]

    extrema = rep["features"]["extrema"]["points"]
    assert len(extrema) == 1
    peak = extrema[0]
    # symbolic-first: the peak's WHERE comes back as an expression
    assert peak["location"]["latex"] == r"\frac{v_{0}}{g}"
    # classification needed the representative-constant pinning (sign of
    # -g is symbolically undetermined) and must say so
    assert peak["kind"] == "maximum"
    assert peak["assumed"] == {"g": 1, "v_0": 1}

    sings = rep["features"]["singularities"]
    assert sings["points"] == [] and sings["family"] is None


def test_variable_inference_prefers_t_over_alphabetical():
    rep = analyze(r"v_0 t - \frac{1}{2} g t^2")
    assert rep["variable"] == "t"


def test_chart_script_is_evaluable_shape():
    rep = analyze(r"v_0 t - \frac{1}{2} g t^2", variable="t")
    cs = rep["chartScript"]
    assert cs["variables"] == ["g", "t", "v_0"]
    assert "v_0" in cs["script"] and "g" in cs["script"]

    # constants get one too (trivially)
    rep = analyze("42")
    assert rep["chartScript"]["variables"] == []


def test_variables_carry_latex_forms():
    rep = analyze(r"v_0 t - \frac{1}{2} g t^2", variable="t")
    assert rep["variables_latex"] == {"g": "g", "t": "t", "v_0": "v_{0}"}

    rep = analyze(r"e^{-b t} \cos{\omega t}", variable="t")
    assert rep["variables_latex"]["omega"] == r"\omega"

    # prime sanitization reverses back to prime marks
    rep = analyze(r"u' x", variable="x")
    assert rep["variables_latex"]["u_prime"] == "u'"


# ── 1/x: singularity, vertical + horizontal asymptotes ─────────────────

def test_reciprocal_singularity_and_asymptotes():
    rep = analyze(r"\frac{1}{x}")
    f = rep["features"]

    sing = f["singularities"]["points"]
    assert len(sing) == 1
    assert sing[0]["location"]["approx"] == 0.0
    assert sing[0]["vertical_asymptote"] is True

    for d in f["limits_at_infinity"]["directions"]:
        assert d["horizontal_asymptote"] is True
        assert d["limit"]["approx"] == 0.0

    assert f["parity"] == "odd"
    assert f["zeros"]["points"] == []


# ── x²−4: even parity, minimum, listable zeros ─────────────────────────

def test_parabola_features():
    rep = analyze("x^2 - 4")
    f = rep["features"]
    assert _approxes(f["zeros"]["points"]) == [-2.0, 2.0]
    mins = f["extrema"]["points"]
    assert len(mins) == 1 and mins[0]["kind"] == "minimum"
    # numerically determined sign → no representative-constant caveat
    assert "assumed" not in mins[0]
    assert mins[0]["value"]["approx"] == -4.0
    assert f["parity"] == "even"


# ── sin x: infinite zero family + periodicity ──────────────────────────

def test_sine_family_and_period():
    rep = analyze(r"\sin{x}")
    f = rep["features"]
    # zeros form an infinite family — described, never fake-enumerated
    assert f["zeros"]["points"] == []
    assert f["zeros"]["family"]
    assert f["periodicity"]["latex"] == r"2 \pi"
    assert f["parity"] == "odd"


# ── oblique asymptote ──────────────────────────────────────────────────

def test_oblique_asymptote():
    rep = analyze(r"x + \frac{1}{x}")
    for d in rep["features"]["limits_at_infinity"]["directions"]:
        ob = d.get("oblique_asymptote")
        assert ob is not None
        assert ob["slope"]["approx"] == 1.0
        assert ob["intercept"]["approx"] == 0.0


# ── degenerate inputs ──────────────────────────────────────────────────

def test_constant_expression():
    rep = analyze("42")
    assert rep["variable"] is None
    assert rep["features"]["constant"]["approx"] == 42.0


def test_unparseable_reports_error():
    rep = analyze(r"\frac{1}{")
    assert "error" in rep


def test_definition_reads_as_the_function_it_defines():
    # ``y = x²`` defines y, so it analyzes x² with y as the output — not
    # ``y − x²``, whose "maximum along x" told the learner nothing.
    rep = analyze("y = x^2", variable="x")
    assert "error" not in rep
    assert rep["dependent"] == "y"
    assert rep["variables"] == ["x"]
    extrema = rep["features"]["extrema"]["points"]
    assert len(extrema) == 1
    assert extrema[0]["location"]["approx"] == 0.0
    assert extrema[0]["kind"] == "minimum"   # the parabola's vertex


# ── definitions: y = f(x) rather than LHS − RHS ────────────────────────

def test_definition_analyzes_the_formula_and_names_the_output():
    """``g = \\omega^2 R`` should plot the formula, not hunt its zero."""
    rep = analyze(r"g_{feet} = \omega^2 (R - h)")
    assert rep["expression"] == r"\omega^{2} \left(R - h\right)"
    assert rep["dependent"] == "g_feet"
    assert rep["dependentLatex"] == "g_{feet}"
    # The defined symbol is the OUTPUT — never offered as an input slider.
    assert rep["variables"] == ["R", "h", "omega"]
    assert rep["chartScript"]["script"] == "pow(omega, 2)*(R - h)"


def test_equation_to_solve_still_collapses_to_lhs_minus_rhs():
    rep = analyze("x^2 = 4", variable="x")
    assert rep["dependent"] is None
    assert rep["expression"] == "x^{2} - 4"
    assert _approxes(rep["features"]["zeros"]["points"]) == [-2.0, 2.0]


def test_definition_needs_a_bare_symbol_side():
    # Both sides carry x — not a definition, so LHS − RHS as before.
    rep = analyze("x + y = 1", variable="x")
    assert rep["dependent"] is None


def test_function_definition_sweeps_its_argument():
    """``\\rho(h) = \\rho_0 e^{-h/H}`` is y = f(x) in its most literal form.

    Before, the unapplied ``rho(h)`` term survived into the chart script
    (unevaluable client-side) and the sweep variable fell to ``H`` by
    alphabetical order, so the page had nothing sensible to draw.
    """
    rep = analyze(r"\rho(h) = \rho_0 e^{-h/H}")
    assert rep["dependent"] == "rho"
    assert rep["dependentLatex"] == r"\rho(h)"
    assert rep["variable"] == "h"                  # the function's argument
    assert "rho(" not in rep["chartScript"]["script"]
    assert rep["chartScript"]["script"] == "rho_0*exp(-h/H)"
