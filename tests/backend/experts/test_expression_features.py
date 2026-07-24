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


def test_relation_becomes_lhs_minus_rhs():
    # Same normalization as the chart pipeline: y = x² analyzes y − x².
    rep = analyze("y = x^2", variable="x")
    assert "error" not in rep
    assert set(rep["variables"]) == {"x", "y"}
    extrema = rep["features"]["extrema"]["points"]
    assert len(extrema) == 1
    assert extrema[0]["location"]["approx"] == 0.0
    assert extrema[0]["kind"] == "maximum"  # of y − x² along x
