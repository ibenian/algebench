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

from backend.experts.modules.expression_analysis.build_log import note
from backend.experts.modules.expression_analysis.view_ranges import (
    MIN_VARIATION, repair_view_ranges,
)

# The view from issue-report: barometric entry velocity, whose scale height H is
# 6360 while the proposed sweep spans 25.
ENTRY_LATEX = (r"V(h) = V_E \exp\left(-\frac{\rho_0 H}{2\beta\sin\gamma}"
               r"\,e^{-h/H}\right)")
ENTRY_PINNED = {"V_E": 11055.0, "H": 6360.0, "rho_0": 1.23,
                "beta": 10050.0, "gamma": 0.0877}


def _view(x_var, x_range, pinned=None, vid=None):
    v = {"x_var": x_var, "x_range": list(x_range),
         "pinned": dict(pinned or {}), "mark": []}
    if vid:
        v["id"] = vid
    return v


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


class TestSweptVariableComesFromTheView:
    """Each view names the variable it sweeps; that is the one to sweep.

    The repair used to re-derive a single variable from the expression and apply
    it to every view. When that guess disagreed with the view, the view's OWN
    x-axis variable looked like an unpinned parameter — `no value pinned for h`,
    where h is the thing on the x-axis — and the repair refused to run at all.
    Found by the construction trail, which is the point of having one.
    """

    def test_the_swept_variable_is_never_demanded_as_a_pin(self):
        notes = []
        # `pinned` deliberately holds every parameter EXCEPT h, which is correct:
        # h is swept, not pinned.
        repair_view_ranges(ENTRY_LATEX,
                           [_view("h", [-5.0, 20.0], ENTRY_PINNED)], notes=notes)
        assert "unpinned:h" not in str(notes), notes
        assert notes[0].level == "changed", notes

    def test_two_views_may_sweep_different_variables(self):
        """One expression, two views, different x_var each — the second must not
        be judged against the first's variable."""
        notes = []
        pinned_for_H = {**ENTRY_PINNED}
        pinned_for_H.pop("H")            # H is swept here, so it is not pinned
        repair_view_ranges(ENTRY_LATEX, [
            _view("h", [0.0, 40000.0], ENTRY_PINNED),
            _view("H", [1000.0, 20000.0], {**pinned_for_H, "h": 10000.0}),
        ], notes=notes)
        assert len(notes) == 2
        assert "unpinned" not in str(notes), notes

    def test_an_unknown_x_var_falls_back_rather_than_failing(self):
        """A view naming a symbol the expression lacks still gets checked
        against the expression's own variable — degraded, not dead."""
        notes = []
        repair_view_ranges(ENTRY_LATEX,
                           [_view("nonsense", [-5.0, 20.0], ENTRY_PINNED)],
                           notes=notes)
        assert len(notes) == 1, notes


class TestViewsAreNamedNotCounted:
    """Viewports carry an id, and everything referring to one uses it.

    The wire format has the LM address viewports by POSITION, which is right for
    the model — it can hardly get it wrong and cannot collide. But a position
    stops being true the moment a viewport is dropped or reordered, and the
    construction notes are read after every pass that might do either has run.
    """

    def test_the_proposer_mints_a_readable_id_per_view(self):
        from backend.experts.modules.expression_analysis.proposer import _view_id
        assert _view_id(1, "h") == "v1-h"
        assert _view_id(2, "t") == "v2-t"
        # Two views of the same variable is the COMMON case (one function at
        # several scales), so the ordinal has to survive in the id.
        assert _view_id(1, "h") != _view_id(2, "h")

    def test_a_latex_bearing_variable_still_yields_a_clean_id(self):
        from backend.experts.modules.expression_analysis.proposer import _view_id
        vid = _view_id(1, r"V_{\text{exit}}")
        assert vid.startswith("v1-")
        assert all(c.isalnum() or c == "_" for c in vid[3:]), vid

    def test_a_view_with_no_variable_still_gets_an_id(self):
        from backend.experts.modules.expression_analysis.proposer import _view_id
        assert _view_id(3, "") == "v3"
        assert _view_id(3, "   ") == "v3"

    def test_notes_carry_the_view_id_when_there_is_one(self):
        notes = []
        repair_view_ranges(ENTRY_LATEX, [
            _view("h", [-5.0, 20.0], ENTRY_PINNED, vid="v1-h"),
            _view("h", [0.0, 40000.0], ENTRY_PINNED, vid="v2-h"),
        ], notes=notes)
        assert [n.view for n in notes] == ["v1-h", "v2-h"]

    def test_an_id_less_view_falls_back_to_a_positional_handle(self):
        """A caller assembling a view by hand gets a usable handle rather than
        an anonymous note."""
        notes = []
        repair_view_ranges(ENTRY_LATEX,
                           [_view("h", [-5.0, 20.0], ENTRY_PINNED)], notes=notes)
        assert notes[0].view == "#1"

    def test_the_id_survives_the_assembly_that_builds_real_views(self):
        from backend.experts.modules.expression_analysis.proposer import (
            ViewPlan, _assemble_views,
        )
        built = _assemble_views(
            [ViewPlan(x_var="h", x_min=0.0, x_max=10.0),
             ViewPlan(x_var="h", x_min=0.0, x_max=99.0)], [], [])
        assert [v.id for v in built] == ["v1-h", "v2-h"]


class TestConstructionTrail:
    """The response says what the server changed about the model's answer.

    Several passes rewrite the proposal on its way out. Without a record the
    artifact arrives looking like something the proposer wrote, including the
    parts that are ours — so "why is this range not what the model asked for?"
    has to be answerable from the payload, not the server log.
    """

    def _notes(self, view):
        notes = []
        repair_view_ranges(ENTRY_LATEX, [view], notes=notes)
        return notes

    def test_a_widened_range_reports_both_ranges_and_the_measurement(self):
        n = self._notes(_view("h", [-5.0, 20.0], ENTRY_PINNED))[0]
        assert n.stage == "view-ranges" and n.level == "changed"
        assert n.view == "#1"      # no id on a hand-built view
        assert "[-5, 20]" in n.message, n.message
        assert "flat" in n.message and "widened to" in n.message, n.message
        # The numbers a client might want to render live in `detail`, so the
        # message stays prose and nobody has to parse it back out.
        assert n.detail["from"] == [-5.0, 20.0]
        assert n.detail["to"][1] > n.detail["from"][1]

    def test_an_untouched_range_is_recorded_as_ok_not_omitted(self):
        """The trail is a record of what happened, not a list of complaints —
        a missing entry would read as "this view was never looked at"."""
        n = self._notes(_view("h", [0.0, 40000.0], ENTRY_PINNED))[0]
        assert n.level == "ok"
        assert "already shows the curve moving" in n.message, n.message

    def test_an_unpinned_parameter_is_a_warning_in_plain_words(self):
        n = self._notes(_view("h", [0.0, 40000.0], {"H": 6360.0}))[0]
        assert n.level == "warning"
        assert "no value pinned for" in n.message, n.message
        # Worth a warning rather than a shrug: the sliders are built from
        # `pinned`, so this view cannot be plotted at all.
        assert "cannot be plotted" in n.message, n.message

    def test_one_note_per_view(self):
        notes = []
        repair_view_ranges(ENTRY_LATEX, [
            _view("h", [-5.0, 20.0], ENTRY_PINNED),
            _view("h", [0.0, 40000.0], ENTRY_PINNED),
            _view("h", [5.0, 5.0], ENTRY_PINNED)], notes=notes)
        assert len(notes) == 3
        assert [n.view for n in notes] == ["#1", "#2", "#3"]

    def test_notes_are_optional_so_every_pass_stays_callable_bare(self):
        views = [_view("h", [-5.0, 20.0], ENTRY_PINNED)]
        repair_view_ranges(ENTRY_LATEX, views)          # no sink — must not raise
        assert views[0]["x_range"] != [-5.0, 20.0]

    def test_the_summary_names_what_was_corrected(self):
        from backend.experts.modules.expression_analysis.build_log import (
            BuildNote, summarize)
        n = lambda level, stage="view-ranges": BuildNote(
            stage=stage, level=level, message="")
        assert summarize([]) == "returned as proposed"
        assert summarize([n("ok")]) == "returned as proposed"
        assert "view-ranges" in summarize([n("changed"), n("changed")])

    def test_the_summary_never_swallows_a_warning(self):
        """A proposal left untouched BECAUSE it could not be checked is not the
        same as one that came back clean — seen live, where two unplottable
        views were summarised as "returned as proposed"."""
        from backend.experts.modules.expression_analysis.build_log import (
            BuildNote, summarize)
        n = lambda level, stage="view-ranges": BuildNote(
            stage=stage, level=level, message="")
        warned = [n("warning"), n("warning")]
        assert summarize(warned) == "2 warnings"
        assert summarize(warned[:1]) == "1 warning"
        both = summarize([n("dropped", "extras")] + warned)
        assert "corrected" in both and "2 warnings" in both, both


class TestNotesAreTypedNotJustShaped:
    """``stage`` and ``level`` are switched on downstream, so they are a
    vocabulary rather than free text — the module declared one from the start
    and, as a plain dict, enforced none of it."""

    def test_a_bad_level_is_refused_not_silently_miscounted(self, caplog):
        from backend.experts.modules.expression_analysis.build_log import summarize
        sink = []
        with caplog.at_level("ERROR"):
            note(sink, "view-ranges", "warn", "typo in the level")   # not "warning"
        assert sink == [], "a malformed note was accepted"
        assert "refusing malformed note" in caplog.text
        # The failure this prevents: bucketed by neither branch of summarize(),
        # a typo'd warning would vanish from the headline entirely.
        assert summarize(sink) == "returned as proposed"

    def test_a_bad_stage_is_refused_too(self):
        sink = []
        note(sink, "viewranges", "ok", "typo in the stage")
        assert sink == []

    def test_a_malformed_note_never_fails_the_analysis(self):
        """It is an error in TELEMETRY. Losing the note beats 500-ing a request
        that otherwise produced a perfectly good artifact."""
        sink = []
        note(sink, "nonsense", "nonsense", "bad")        # must not raise
        note(sink, "view-ranges", "ok", "good")
        assert len(sink) == 1 and sink[0].message == "good"

    def test_the_wire_form_drops_empty_optionals(self):
        from backend.experts.modules.expression_analysis.build_log import serialize
        sink = []
        note(sink, "symbols", "dropped", "no view attached")
        note(sink, "view-ranges", "ok", "has one", view="v1-h", extra=1)
        wire = serialize(sink)
        assert "view" not in wire[0], wire[0]
        assert wire[1]["view"] == "v1-h"
        assert wire[1]["detail"] == {"extra": 1}

    def test_unknown_fields_are_refused(self):
        """extra='forbid': a note carrying a field nobody reads is a mistake at
        the call site, not a payload to pass along."""
        from pydantic import ValidationError
        from backend.experts.modules.expression_analysis.build_log import BuildNote
        with pytest.raises(ValidationError):
            BuildNote(stage="symbols", level="ok", message="m", typo="x")


class TestHandlerWiring:
    def test_the_handler_repairs_before_returning(self, monkeypatch):
        """The pass has to be wired into the analyze path — a correct module
        nobody calls fixes nothing."""
        from backend.experts.handlers.expression_analysis import handler as H

        seen = {}

        def fake_repair(expression_latex, views, timeout=None, notes=None):
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
