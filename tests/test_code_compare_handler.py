"""The code-compare handler's inputs, and how the model's matches and steps are made safe to draw; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.code_compare import handler as h
from backend.experts.handlers.code_compare.models import CodeCompareRequest
from backend.experts.modules.code_assist.canvas import CanvasMark
from backend.experts.modules.code_compare import intent
from backend.experts.modules.code_compare.signature import ASK_FIELDS, INPUT_FIELDS, CompareCanvasStep, CompareMatch, CodeCompareCanvasSig, CodeCompareSig, Pointing

ORIGINAL = "def f(n):\n    total = 0\n    return total"
TYPED = "def f(m):\n    return 0"


def _req(**kw) -> CodeCompareRequest:
    return CodeCompareRequest(**{**dict(language="python", expected=ORIGINAL, typed=TYPED), **kw})


def test_inputs_cover_the_signature_numbered_from_one():
    inputs = h.render_inputs(_req())
    assert set(inputs) == set(INPUT_FIELDS)
    assert "  1 | def f(n):" in inputs["original"] and "  2 |     return 0" in inputs["typed"]


def test_only_the_canvas_signature_hears_of_drawing():
    assert "draw" not in CodeCompareSig.instructions
    assert "draw" in CodeCompareCanvasSig.instructions


def _m(a=0, b=0, c=0, d=0, verdict="exact", comment=""):
    return CompareMatch(original_from=a, original_to=b, yours_from=c, yours_to=d, verdict=verdict, comment=comment)


def spans(matches):
    return [(m.original_from, m.original_to, m.yours_from, m.yours_to, m.verdict) for m in matches]


def test_matches_may_cross_and_group_lines():
    a, b = ["a", "b", "c", "d"], ["x", "y", "z"]
    out = intent.clean_matches([_m(3, 4, 1, 1, "equivalent", "Fine."), _m(1, 2, 2, 3, "alternate")], a, b)
    assert spans(out) == [(3, 4, 1, 1, "equivalent"), (1, 2, 2, 3, "alternate")]
    assert out[0].comment == "Fine."


def test_a_line_is_in_one_match_and_every_line_is_placed():
    a, b = ["a", "b", "c"], ["x", "y"]
    out = intent.clean_matches([_m(1, 2, 1, 1), _m(2, 2, 1, 1, "exact"), _m(9, 9, 9, 9)], a, b)
    covered = lambda lo, hi: [k for m in out for k in range(getattr(m, lo), getattr(m, hi) + 1) if getattr(m, lo)]
    assert sorted(covered("original_from", "original_to")) == [1, 2, 3]
    assert sorted(covered("yours_from", "yours_to")) == [1, 2]
    assert spans(intent.clean_matches([], a, b)) == [(1, 3, 0, 0, "missing"), (0, 0, 1, 2, "extra")]


def test_a_run_has_no_holes():
    out = intent.clean_matches([_m(2, 2, 1, 1), _m(1, 3, 2, 2)], ["a", "b", "c"], ["x", "y"])
    assert spans(out)[1][:2] == (1, 1), "a run stops at a line another match holds"
    assert spans(out)[2][:2] == (3, 3)


def test_a_verdict_fits_its_match():
    a, b = ["a", "b"], ["x", "y"]
    out = intent.clean_matches([_m(1, 1, 1, 1, "missing"), _m(2, 2, verdict="exact"), _m(c=2, d=2, verdict="made up")], a, b)
    assert spans(out) == [(1, 1, 1, 1, "incorrect"), (2, 2, 0, 0, "missing"), (0, 0, 2, 2, "extra")]


def test_blank_lines_on_their_own_are_not_judged():
    assert spans(intent.clean_matches([_m(1, 1, 1, 1)], ["a", ""], ["a"])) == [(1, 1, 1, 1, "exact"), (2, 2, 0, 0, "exact")]


def test_steps_are_capped_and_the_left_side_gets_no_words_or_shapes():
    step = CompareCanvasStep(say="Look.", point=Pointing(side="elsewhere", line=-3), draw=[CanvasMark(kind="note", line=1, label="n = 2")],
                             draw_original=[CanvasMark(kind="circle", line=1), CanvasMark(kind="note", line=1), CanvasMark(kind="shape", id="s")])
    out = intent.clean_steps([step] * 9 + [CompareCanvasStep(say="  ")])
    assert len(out) == intent.MAX_STEPS
    assert (out[0].point.side, out[0].point.line) == ("yours", 0)
    assert [m.kind for m in out[0].draw] == ["note"] and [m.kind for m in out[0].draw_original] == ["circle"]


def test_the_handler_answers_with_the_diff_or_a_reason(monkeypatch):
    answer = SimpleNamespace(summary="Close.", same_behaviour=False, matches=[_m(1, 3, 1, 2, "incorrect")], steps=[], closing="Over to you.")
    monkeypatch.setattr(intent, "_comparer", lambda canvas=False: (lambda **_: answer))
    out = h.code_compare(_req())["result"]
    assert out["summary"] == "Close." and len(out["matches"]) == 1
    monkeypatch.setattr(h, "compare_code", lambda *_, **__: intent.CodeCompare(error="down"))
    assert h.code_compare(_req()) == {"reason": "down"}


def test_a_debrief_is_cleaned_and_capped(monkeypatch):
    answer = SimpleNamespace(summary="", same_behaviour=False, matches=[], steps=[], closing="", debrief=[" One. ", "", "Two.", "3", "4", "5"])
    monkeypatch.setattr(intent, "_comparer", lambda canvas=False: (lambda **_: answer))
    assert h.code_compare(_req())["result"]["debrief"] == ["One.", "Two.", "3", "4"]


def test_a_question_is_answered_about_the_comparison_on_screen(monkeypatch):
    seen = {}

    def model(**inputs):
        seen.update(inputs)
        return SimpleNamespace(steps=[CompareCanvasStep(say="Look.")] * 5, answer="Because of the bound.")
    monkeypatch.setattr(intent, "_answerer", lambda canvas=False: model)
    out = h.code_compare(_req(question=" why? ", about="original 2, yours 1", comparison="original 1 ~ yours 1: exact"))["result"]
    assert set(seen) == set(ASK_FIELDS) and seen["question"] == "why?"
    assert out["closing"] == "Because of the bound." and len(out["steps"]) == intent.MAX_ANSWER_STEPS and out["matches"] == []
