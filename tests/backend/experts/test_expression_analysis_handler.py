"""Tests for the expression_analysis handler's mechanical layers.

LM-dependent paths (propose_views / propose_more_probes) degrade to
abstain/empty without credentials and are exercised live; everything here
is the pure machinery around them: verb dispatch, id generation, and the
LaTeX→script compilation that turns LM-proposed plots/annotations into
CAS-generated code.
"""

from __future__ import annotations

import re

from backend.experts.handlers.expression_analysis.handler import (
    ExpressionAnalysisRequest, _compile_view_extras, _flag_unknown_symbols,
    _make_id, expression_analysis,
)
from backend.experts.modules.expression_analysis.proposer import (
    ProposedAnnotation, ProposedPlot, ProposedView,
)


# ── artifact ids ───────────────────────────────────────────────────────

def test_make_id_slugs_title_with_unique_suffix():
    a = _make_id("Projectile Height vs Time")
    b = _make_id("Projectile Height vs Time")
    assert a.startswith("projectile_height_vs_time-")
    assert re.fullmatch(r"[a-z0-9_]+-[0-9a-f]{6}", a)
    assert a != b                     # suffix keeps repeats collision-free


def test_make_id_empty_title_falls_back():
    assert _make_id("").startswith("analysis-")
    assert _make_id("   ").startswith("analysis-")


# ── verb dispatch ──────────────────────────────────────────────────────

def test_unknown_verb_is_an_error():
    req = ExpressionAnalysisRequest(latex="x^2", verb="summarize")
    out = expression_analysis(req)
    assert "unknown verb" in out["error"]


def test_more_probes_requires_characteristics():
    req = ExpressionAnalysisRequest(latex="x^2", verb="more_probes")
    out = expression_analysis(req)
    assert "characteristics" in out["error"]


def test_analyze_root_shape_cas_only():
    req = ExpressionAnalysisRequest(latex="x^2 - 4", propose=False)
    out = expression_analysis(req)
    assert set(out) == {"id", "title", "characteristics", "proposal"}
    assert out["proposal"] is None
    assert out["id"].startswith("analysis-")     # no title to slug yet


def test_analyze_honors_caller_id():
    req = ExpressionAnalysisRequest(latex="x^2 - 4", propose=False, id="my-id")
    out = expression_analysis(req)
    assert out["id"] == "my-id"


# ── plot / annotation script compilation ───────────────────────────────

def _view(**kw) -> dict:
    base = ProposedView(x_var="t", pinned={"b": 0.5}).model_dump()
    base.update(kw)
    return base


def test_plots_get_cas_scripts_and_bad_ones_drop():
    proposal = {"views": [_view(plots=[
        {"latex": r"e^{-b t}", "label": "envelope"},       # valid
        {"latex": r"\frac{1}{", "label": "broken"},        # parse failure
        {"latex": r"q t", "label": "invented symbol"},     # q not in report
    ])]}
    _compile_view_extras(proposal, ["b", "t"])
    view = proposal["views"][0]
    assert len(view["plots"]) == 1
    plot = view["plots"][0]
    assert plot["label"] == "envelope"
    assert "exp" in plot["script"] and set(plot["variables"]) == {"b", "t"}
    assert view["dropped_plots"] == 2


def test_annotations_compile_positions_and_bands():
    proposal = {"views": [_view(annotations=[
        {"kind": "vline", "at": r"\frac{v_0}{g}", "label": "peak", "group": "flight"},
        {"kind": "band", "at": "0", "to": r"\frac{2 v_0}{g}", "label": "in air"},
        {"kind": "hline", "at": "Z", "label": "invented"},   # unknown symbol
        {"kind": "circle", "at": "1", "label": "bad kind"},
        {"kind": "band", "at": "0", "to": r"\frac{1}{", "label": "broken to"},
    ])]}
    _compile_view_extras(proposal, ["g", "t", "v_0"])
    view = proposal["views"][0]
    kept = view["annotations"]
    assert [a["label"] for a in kept] == ["peak", "in air"]
    # positions are {script, variables, latex} — evaluable AND displayable
    assert kept[0]["at"]["variables"] == ["g", "v_0"]
    assert kept[0]["at"]["latex"] == r"\frac{v_0}{g}"
    assert kept[1]["to"]["script"]
    assert "to" not in kept[0]                    # vline carries no band bound
    assert view["dropped_annotations"] == 3


def test_flag_unknown_symbols_marks_but_keeps_view():
    proposal = {"views": [_view(x_var="Delta t")]}
    _flag_unknown_symbols(proposal, ["b", "t"])
    assert proposal["views"][0]["unknown_symbols"] == ["Delta t"]


# ── proposer model nesting ─────────────────────────────────────────────

def test_proposed_view_coerces_nested_plots_and_annotations():
    v = ProposedView(
        plots=[{"latex": "x", "label": "p"}],
        annotations=[{"kind": "hline", "at": "1", "label": "a"}],
    )
    assert isinstance(v.plots[0], ProposedPlot)
    assert isinstance(v.annotations[0], ProposedAnnotation)


# ── flat wire shapes re-nest into the API shape (#543) ─────────────────
#
# The LM writes flat blocks so its LaTeX never reaches a JSON decoder; the
# nesting the handler and the page expect is rebuilt here. These tests pin the
# join, because a wrong one attaches a curve to the wrong chart — a
# mathematically false picture presented as a proposal.

def test_wire_views_renest_by_index():
    from backend.experts.modules.expression_analysis.proposer import (
        AnnotationPlan, PlotPlan, ViewPlan, _assemble_views,
    )
    views = _assemble_views(
        [ViewPlan(kind="plane-2d", x_var="t", x_min=0, x_max=4,
                  pinned="v_0=20, g=9.8", mark="peak, landing",
                  rationale="the arc"),
         ViewPlan(x_var="v_0", x_min=-1, x_max=1)],
        [PlotPlan(view=2, latex=r"e^{-\beta t}", label="envelope"),
         PlotPlan(view=9, latex="x", label="addressed to nothing")],
        [AnnotationPlan(view=1, kind="vline", at=r"\frac{v_0}{g}", label="peak")],
    )
    assert views[0].x_range == [0.0, 4.0]
    assert views[0].pinned == {"v_0": 20.0, "g": 9.8}
    assert views[0].mark == ["peak", "landing"]
    assert [a.at for a in views[0].annotations] == [r"\frac{v_0}{g}"]
    assert views[0].plots == []
    # The join is by index, not by order of arrival.
    assert [p.label for p in views[1].plots] == ["envelope"]
    # A plot naming a view that does not exist is DROPPED, never reassigned.
    assert sum(len(v.plots) for v in views) == 1


def test_wire_view_pins_survive_a_malformed_entry():
    """One unparseable pin must not cost the learner the other pins.

    ``pinned`` is a delimited leaf because it holds only names and numbers —
    but the model still writes it, so a stray entry has to be survivable.
    """
    from backend.experts.modules.expression_analysis.proposer import _parse_pinned
    assert _parse_pinned("v_0=20, nonsense, g=9.8, h=tall") == {
        "v_0": 20.0, "g": 9.8}


def test_wire_probe_options_and_index_convert():
    """Options come back in numbered slots and the index is 1-based on the wire.

    Getting the base wrong marks a *different* option correct, which
    ``_usable_probes`` cannot catch — the index is still in range.
    """
    from backend.experts.modules.expression_analysis.proposer import ProbePlan
    p = ProbePlan(question="where is the peak?", option_1="$t=0$",
                  option_2=r"$t=\frac{v_0}{g}$", correct_index=2,
                  explanation="velocity vanishes there", feature="max").as_probe()
    assert p.options == ["$t=0$", r"$t=\frac{v_0}{g}$"]
    assert p.correct_index == 1
    assert p.options[p.correct_index] == r"$t=\frac{v_0}{g}$"


# ── probe validation (structurally unusable probes are dropped) ─────────

def test_only_answerable_probes_survive():
    """A probe needs 2-4 options and an in-range ``correct_index``.

    The signature asks the model to verify the index, but asking is not
    enforcing: out of range marks no option correct and tells the tutor
    the correct answer is the empty string.
    """
    from backend.experts.modules.expression_analysis.proposer import (
        ProposedProbe, _usable_probes,
    )
    probes = [
        ProposedProbe(question="ok", options=["a", "b"], correct_index=1),
        ProposedProbe(question="index past the end", options=["a", "b"],
                      correct_index=2),
        ProposedProbe(question="no options", options=[], correct_index=0),
        ProposedProbe(question="single option", options=["a"], correct_index=0),
        ProposedProbe(question="too many", options=list("abcde"), correct_index=0),
        ProposedProbe(question="also ok", options=["a", "b", "c", "d"],
                      correct_index=3),
    ]
    kept = [p.question for p in _usable_probes(probes)]
    assert kept == ["ok", "also ok"]


# ── failure is not abstention ───────────────────────────────────────────

def test_lm_failure_sets_failed_not_a_bare_abstain(monkeypatch):
    """A failed proposal must be distinguishable from "nothing to show".

    The UI only renders the retry path when ``failed`` is set; without it a
    request that errored is reported to the learner as a fact about their
    mathematics. This assignment was lost once already — the field shipped
    while nothing set it, leaving the UI branch unreachable.
    """
    from backend.experts.modules.expression_analysis import proposer

    def boom(**_kwargs):
        raise RuntimeError("no LM configured")

    monkeypatch.setattr(proposer, "_proposer", lambda: boom)
    out = proposer.propose_views(expression="x^2", characteristics="{}")
    assert out.abstain is True
    assert out.failed is True


def test_parse_failure_still_returns_an_id():
    """The response root shape is a contract; clients attach by id."""
    req = ExpressionAnalysisRequest(latex=r"\frac{1}{")
    out = expression_analysis(req)
    assert out["characteristics"].get("error")
    assert out["id"]                       # generated, not None
    assert set(out) == {"id", "title", "characteristics", "proposal"}
