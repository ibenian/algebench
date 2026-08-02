r"""A failed CAS computation must never be recorded as a finding (#532).

The bug: ``_op_limits_at_infinity`` caught every exception and wrote
``"limit": None`` — the same value the report would carry if a limit genuinely
did not exist. One field, two incompatible meanings, and nothing logged. SymPy
raises ``NotImplementedError`` whenever a limit depends on the sign of a free
parameter it cannot determine, which is most physics written symbolically.

Downstream, the proposer received a report with no findings, abstained (correct,
on that input) and confabulated a reason — "a single variable representing a
constant value … it has no independent variable to vary" — against a five-entry
``variables`` list in the same report.
"""

from __future__ import annotations

import json

import pytest
import sympy

import backend.experts.modules.expression_analysis.features as F
from backend.experts.modules.expression_analysis.features import (
    _op_limits_at_infinity, analyze,
)
from backend.experts.modules.expression_analysis.proposer import (
    _report_gave_nothing,
)

# The expression from the report: atmospheric-entry velocity.
ENTRY_VELOCITY = (r"v = v_{E} \cdot \frac{1}{e^{\frac{H \cdot \rho_{0}}"
                  r"{2 \cdot \beta \cdot \sin{(\gamma)}}}}")


def _dirs(report: dict) -> dict:
    return {d["direction"]: d for d in report["directions"]}


# ── the reported expression now resolves ──────────────────────────────

def test_symbolic_parameter_limits_resolve_via_pinning():
    r"""The reported case: ``v_E e^{-H\rho_0/(2\beta\sin\gamma)}`` swept in $H$.

    ``sympy.limit`` cannot sign the exponent with free parameters and raises.
    The representative-constant substitution — already computed in this function
    for display — gives them concrete signs, so the limit resolves.
    """
    H, rho0, beta, gamma, vE = sympy.symbols("H rho_0 beta gamma v_E")
    expr = vE * sympy.exp(-H * rho0 / (2 * beta * sympy.sin(gamma)))

    # precondition: the symbolic limit really does fail, or this proves nothing
    with pytest.raises(Exception):
        sympy.limit(expr, H, sympy.oo)

    got = _dirs(_op_limits_at_infinity(expr, H))
    assert got["+inf"]["limit"]["latex"] == "0"
    assert got["+inf"]["horizontal_asymptote"] is True
    assert got["-inf"]["limit"] == r"\infty"


def test_a_pinned_limit_is_labelled_as_pinned():
    """It holds for THOSE representative values, not universally.

    Flip a parameter's sign and decay becomes growth. Presenting a pinned
    result as the general limit would trade one silently-wrong report for
    another, which is the whole complaint in #532.
    """
    H, k, vE = sympy.symbols("H k v_E")
    got = _dirs(_op_limits_at_infinity(vE * sympy.exp(-k * H), H))
    assert all(d.get("pinned") is True for d in got.values())


def test_a_resolvable_limit_is_not_labelled_pinned():
    """The symbolic path is preferred, so an ordinary limit carries no label."""
    x = sympy.Symbol("x")
    got = _dirs(_op_limits_at_infinity((2 * x + 1) / (x - 3), x))
    assert got["+inf"]["limit"]["latex"] == "2"
    assert "pinned" not in got["+inf"]


def test_unresolvable_limits_say_unresolved_not_null(monkeypatch):
    """``None`` reads as a determination; ``unresolved`` reads as a failure.

    ``limit`` was only ever ``None`` in the old except-branch, so ``None`` was
    *always* a failure marker — it simply wasn't labelled as one. (SymPy reports
    a genuine no-limit as ``AccumBounds``, not by raising.)

    Both the symbolic and the pinned attempt are forced to fail here. Picking a
    real expression that defeats sympy twice would be a hostage to sympy's
    version; the branch under test is what matters.
    """
    def always_raises(*a, **k):
        raise NotImplementedError("cannot determine sign")

    monkeypatch.setattr(F, "limit", always_raises)
    x = sympy.Symbol("x")
    got = _dirs(F._op_limits_at_infinity(sympy.exp(-x), x))
    for d in got.values():
        assert d.get("status") == "unresolved"
        assert "limit" not in d, "a failure must not occupy the limit field"


def test_a_genuine_no_limit_is_still_reported():
    """``sin x`` has no limit at ±∞ — that is an ANSWER, not a failure."""
    x = sympy.Symbol("x")
    got = _dirs(_op_limits_at_infinity(sympy.sin(x), x))
    for d in got.values():
        assert d.get("status") != "unresolved"
        assert d.get("limit"), "AccumBounds is a real finding and must survive"


# ── regression controls: the fix must change nothing else ─────────────

@pytest.mark.parametrize("expr_fn,var,expect", [
    (lambda x: x**2 - 4, "x", r"\infty"),
    (lambda x: (x**2 + 1) / x, "x", r"\infty"),
])
def test_ordinary_limits_are_unchanged(expr_fn, var, expect):
    v = sympy.Symbol(var)
    got = _dirs(_op_limits_at_infinity(expr_fn(v), v))
    assert got["+inf"]["limit"] == expect


def test_oblique_asymptote_survives(  ):
    """The asymptote probe has its own ``try`` now — but must still work."""
    x = sympy.Symbol("x")
    got = _dirs(_op_limits_at_infinity((x**2 + 1) / x, x))
    assert got["+inf"]["oblique_asymptote"]["slope"]["latex"] == "1"


# ── the end-to-end consequence ────────────────────────────────────────

def test_the_reported_expression_no_longer_yields_an_empty_report():
    """Full pipeline: the case that produced 'a plot would teach nothing'."""
    report = analyze(ENTRY_VELOCITY)
    assert not report.get("error")
    assert len(report["variables"]) == 5          # it was never a bare constant
    got = _dirs(report["features"]["limits_at_infinity"])
    assert got["+inf"]["limit"]["latex"] == "0"
    assert not _report_gave_nothing(json.dumps(report))


# ── the proposer must not narrate an empty report ─────────────────────

def _report(features: dict) -> str:
    return json.dumps({"variables": ["H", "v_E"], "features": features})


def test_an_all_unresolved_report_is_a_failure_not_an_abstention():
    """With nothing to reason from, an abstention can only be confabulated.

    ``failed`` is the honest signal, and the UI already renders it as "the
    analysis failed" rather than "nothing interesting here".
    """
    assert _report_gave_nothing(_report({
        "zeros": {"points": [], "family": None},
        "limits_at_infinity": {"directions": [
            {"direction": "+inf", "status": "unresolved"},
            {"direction": "-inf", "status": "unresolved"}]},
    })) is True


def test_a_report_with_any_finding_still_goes_to_the_llm():
    """One resolved feature is enough to reason from — do not hijack that."""
    assert _report_gave_nothing(_report({
        "zeros": {"points": [{"latex": "2"}], "family": None},
        "limits_at_infinity": {"directions": [
            {"direction": "+inf", "status": "unresolved"}]},
    })) is False


def test_a_genuinely_featureless_report_still_goes_to_the_llm():
    """A bare constant has no features and no failures — abstaining is CORRECT.

    This is the case the guard must not steal: "nothing interesting here" is a
    true statement about a constant, and the learner deserves that answer.
    """
    assert _report_gave_nothing(_report({
        "zeros": {"points": [], "family": None},
        "periodicity": None,
        "parity": None,
    })) is False


def test_malformed_characteristics_do_not_hijack_the_call():
    """A parse failure here must fall through, not fabricate a verdict."""
    assert _report_gave_nothing("not json") is False
    assert _report_gave_nothing("{}") is False
