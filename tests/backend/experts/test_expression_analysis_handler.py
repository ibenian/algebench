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
