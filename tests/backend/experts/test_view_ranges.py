"""A proposed sweep the curve is flat across gets widened before it reaches a chart.

The proposer picks ``x_min``/``x_max`` from a CAS report whose every numeric
``approx`` was computed with all non-swept parameters pinned to 1, then writes a
view carrying its OWN pinned values — the physical ones. Nothing reconciled the
two, so a sweep sized for a unit-scale parameter rendered at a physical one, and
the learner got a horizontal line where an exponential should be.

The correction only ever widens, and only when the curve genuinely does not read
across the proposed window. Every test below that asserts "unchanged" is guarding
that restraint: a range the proposer got right must survive untouched.
"""

from __future__ import annotations

import pytest

from backend.experts.modules.expression_analysis.view_ranges import (
    MIN_VARIATION, repair_view_ranges,
)

# The view from issue-report: barometric entry velocity, whose scale height H is
# 6360 while the proposed sweep spans 25.
ENTRY_LATEX = (r"V(h) = V_E \exp\left(-\frac{\rho_0 H}{2\beta\sin\gamma}"
               r"\,e^{-h/H}\right)")
ENTRY_PINNED = {"V_E": 11055.0, "H": 6360.0, "rho_0": 1.23,
                "beta": 10050.0, "gamma": 0.0877}


def _view(x_var, x_range, pinned=None):
    return {"x_var": x_var, "x_range": list(x_range),
            "pinned": dict(pinned or {}), "mark": []}


def _repaired(latex, view):
    views = [view]
    repair_view_ranges(latex, views)
    return views[0]


class TestWidensAFlatSweep:
    def test_the_entry_velocity_view_is_widened(self):
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        assert out.get("range_repaired"), "flat sweep was left alone"
        lo, hi = out["x_range"]
        # It has to reach the scale the exponent actually lives on — anything
        # short of a scale height still draws a straight line.
        assert (hi - lo) > 6360.0, out["x_range"]

    def test_the_widened_sweep_actually_shows_the_curve(self):
        """The point is not "bigger" but "informative" — assert the property."""
        import math
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        lo, hi = out["x_range"]
        k = (ENTRY_PINNED["rho_0"] * ENTRY_PINNED["H"]
             / (2 * ENTRY_PINNED["beta"] * math.sin(ENTRY_PINNED["gamma"])))
        V = lambda h: ENTRY_PINNED["V_E"] * math.exp(-k * math.exp(-h / ENTRY_PINNED["H"]))
        ys = [V(lo + i * (hi - lo) / 95) for i in range(96)]
        variation = (max(ys) - min(ys)) / max(abs(max(ys)), abs(min(ys)))
        assert variation >= MIN_VARIATION, variation

    def test_the_repair_is_recorded_not_silent(self):
        """An author reviewing the proposal must see that a range was changed."""
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        record = out["range_repaired"]
        assert record["from"] == [-5.0, 20.0]
        assert record["to"] == out["x_range"]
        assert record["reason"] == "widen"

    def test_a_left_edge_at_zero_stays_at_zero(self):
        """0 is the physical bound the prompt asks for on a non-negative
        quantity; widening must not invent altitudes below the ground."""
        out = _repaired(ENTRY_LATEX, _view("h", [0.0, 20.0], ENTRY_PINNED))
        assert out["x_range"][0] == 0.0, out["x_range"]

    def test_the_origin_keeps_its_relative_position(self):
        """``[-5, 20]`` is one fifth left of zero and stays one fifth left of
        zero — the proposer's call on how much negative side to show survives."""
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        lo, hi = out["x_range"]
        assert -lo / (hi - lo) == pytest.approx(0.2, abs=0.01), out["x_range"]


class TestLeavesAGoodSweepAlone:
    """Restraint: these are all ranges a proposer would be right to pick."""

    @pytest.mark.parametrize("latex, x_var, x_range, pinned", [
        (r"y = x^2 - 4", "x", [-5.0, 5.0], {}),                    # roots at ±2
        (r"y = \sin(x)", "x", [0.0, 6.283], {}),                   # one period
        (r"y = v_0 t - 5 t^2", "t", [0.0, 4.0], {"v_0": 20.0}),    # launch to landing
        (r"y = \frac{1}{x - 2}", "x", [-5.0, 5.0], {}),            # pole inside
        (r"y = e^{-t/\tau}", "t", [0.0, 5.0], {"tau": 1.0}),       # five time constants
        (ENTRY_LATEX, "h", [0.0, 40000.0], ENTRY_PINNED),          # already ~6 H
    ])
    def test_unchanged(self, latex, x_var, x_range, pinned):
        out = _repaired(latex, _view(x_var, x_range, pinned))
        assert "range_repaired" not in out
        assert out["x_range"] == x_range


class TestRefusesRatherThanGuesses:
    def test_a_genuinely_constant_expression_is_left_alone(self):
        """No width makes a constant interesting; widening would just mislead."""
        out = _repaired(r"y = 7", _view("x", [-5.0, 5.0]))
        assert "range_repaired" not in out

    def test_an_unpinned_parameter_blocks_the_repair(self):
        """Without a value for every parameter there is no curve to sample, and
        substituting one of our own would be inventing the physics."""
        out = _repaired(r"y = a x + b", _view("x", [-5.0, 5.0], {"a": 2.0}))
        assert "range_repaired" not in out
        assert out["x_range"] == [-5.0, 5.0]

    @pytest.mark.parametrize("bad", [[], [1.0], [5.0, -5.0], [1.0, 1.0],
                                     ["x", "y"], [float("inf"), 1.0]])
    def test_a_malformed_range_is_left_alone(self, bad):
        out = _repaired(r"y = x^2", _view("x", bad))
        assert "range_repaired" not in out

    def test_unparseable_latex_is_survived(self):
        views = [_view("x", [-5.0, 5.0])]
        repair_view_ranges(r"\this{is(not", views)          # must not raise
        assert views[0]["x_range"] == [-5.0, 5.0]

    def test_no_views_is_a_no_op(self):
        repair_view_ranges(ENTRY_LATEX, [])                 # must not raise


class TestEveryViewIsAccountedFor:
    """A pass that only logs when it acts is indistinguishable from one that
    never ran — which is the first question anyone debugging a bad range asks.
    So every view gets a line naming its outcome."""

    def test_a_widened_view_says_so_with_the_measurement(self, caplog):
        with caplog.at_level("INFO"):
            _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        line = [r.message for r in caplog.records if "[view-ranges]" in r.message]
        assert len(line) == 1, caplog.text
        assert "widened" in line[0] and "variation was" in line[0], line[0]

    @pytest.mark.parametrize("view, why", [
        (_view("h", [0.0, 40000.0], ENTRY_PINNED), "already-reads"),
        (_view("h", [0.0, 40000.0], {"H": 6360.0}), "unpinned:"),
        (_view("h", [5.0, 5.0], ENTRY_PINNED), "malformed-range"),
    ])
    def test_a_view_left_alone_says_why(self, caplog, view, why):
        with caplog.at_level("INFO"):
            _repaired(ENTRY_LATEX, view)
        line = [r.message for r in caplog.records if "[view-ranges]" in r.message]
        assert len(line) == 1, caplog.text
        assert "left alone" in line[0] and why in line[0], line[0]

    def test_one_line_per_view_no_matter_the_mix(self, caplog):
        views = [_view("h", [-5.0, 20.0], ENTRY_PINNED),
                 _view("h", [0.0, 40000.0], ENTRY_PINNED),
                 _view("h", [5.0, 5.0], ENTRY_PINNED)]
        with caplog.at_level("INFO"):
            repair_view_ranges(ENTRY_LATEX, views)
        lines = [r.message for r in caplog.records if "[view-ranges]" in r.message]
        assert len(lines) == 3, caplog.text


class TestWidensFarEnough:
    """Scored by how much of the curve's total span the window shows, not by the
    relative variation that detected the flatness — that measure divides by the
    window's own largest value, so it saturates wherever the curve passes near
    zero and stops while most of the range is still off screen."""

    def test_the_window_covers_most_of_the_curves_range(self):
        import math
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        lo, hi = out["x_range"]
        k = (ENTRY_PINNED["rho_0"] * ENTRY_PINNED["H"]
             / (2 * ENTRY_PINNED["beta"] * math.sin(ENTRY_PINNED["gamma"])))
        V = lambda h: ENTRY_PINNED["V_E"] * math.exp(-k * math.exp(-h / ENTRY_PINNED["H"]))
        shown = [V(lo + i * (hi - lo) / 95) for i in range(96)]
        # V runs from ~0 at the surface to V_E far above; the window must show
        # most of that, not a low-altitude sliver that merely looks curved.
        assert (max(shown) - min(shown)) / ENTRY_PINNED["V_E"] >= 0.85, out["x_range"]

    def test_it_reaches_several_scale_heights(self):
        out = _repaired(ENTRY_LATEX, _view("h", [-5.0, 20.0], ENTRY_PINNED))
        lo, hi = out["x_range"]
        assert (hi - lo) / ENTRY_PINNED["H"] >= 4.0, out["x_range"]


class TestHandlerWiring:
    def test_the_handler_repairs_before_returning(self, monkeypatch):
        """The pass has to be wired into the analyze path — a correct module
        nobody calls fixes nothing."""
        from backend.experts.handlers.expression_analysis import handler as H

        seen = {}

        def fake_repair(expression_latex, views, timeout=None):
            seen["called"] = (expression_latex, views)

        monkeypatch.setattr(H, "repair_view_ranges", fake_repair)
        monkeypatch.setattr(H, "analyze", lambda *a, **k: {
            "expression": "x^{2}", "variables": ["x"], "variable": "x",
            "features": {}})

        class _Proposal:
            def model_dump(self):
                return {"title": "t", "views": [_view("x", [-5.0, 5.0])],
                        "variable_glossary": {}}

        monkeypatch.setattr(H, "propose_views", lambda **k: _Proposal())
        H._analyze(H.ExpressionAnalysisRequest(latex="x^2", propose=True))
        assert "called" in seen, "repair_view_ranges was never called"
        assert seen["called"][0] == "x^{2}"
