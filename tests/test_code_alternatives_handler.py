"""The code-alternatives handler: two of a lesson's alternative solutions compared; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.code_alternatives import handler as h
from backend.experts.handlers.code_alternatives.models import CodeAlternativesRequest
from backend.experts.modules.code_alternatives import intent
from backend.experts.modules.code_alternatives.signature import (ASK_FIELDS, COMPARE_FIELDS, AltCanvasStep, AltMatch, AltPointing, CompareAlternativesCanvasSig,
                                                                 CompareAlternativesSig)
from backend.experts.modules.code_assist.canvas import CanvasMark
from backend.experts.modules.code_compare.signature import CodeCompareSig

LEFT = "def dfs(u):\n    seen.add(u)\n    for v in adj[u]:\n        dfs(v)"
RIGHT = "def bfs(s):\n    queue = [s]\n    while queue:\n        u = queue.pop(0)"


def _req(**kw) -> CodeAlternativesRequest:
    return CodeAlternativesRequest(**{**dict(action="compare", language="python", left=LEFT, left_name="dfs", right=RIGHT, right_name="your code"), **kw})


def _m(a=0, b=0, c=0, d=0, verdict="same", comment=""):
    return AltMatch(left_from=a, left_to=b, right_from=c, right_to=d, verdict=verdict, comment=comment)


def test_it_is_its_own_comparison_not_a_check_of_the_learner():
    assert "original" not in CompareAlternativesSig.instructions.split("\n")[0]
    assert "hint_level" not in COMPARE_FIELDS and "hint_level" not in ASK_FIELDS
    assert CompareAlternativesSig.instructions != CodeCompareSig.instructions
    assert "draw" not in CompareAlternativesSig.instructions and "draw" in CompareAlternativesCanvasSig.instructions


def test_every_line_of_both_sides_is_placed_with_its_own_verdicts():
    out = intent.clean_matches([_m(1, 1, 1, 1, "different", "Queue, not stack."), _m(2, 2, 2, 2, "made up"), _m(3, 3, 0, 0, "same")], LEFT.split("\n"), RIGHT.split("\n"))
    got = [(m.left_from, m.left_to, m.right_from, m.right_to, m.verdict) for m in out]
    assert got == [(1, 1, 1, 1, "different"), (2, 2, 2, 2, "different"), (3, 3, 0, 0, "only_left"), (4, 4, 0, 0, "only_left"), (0, 0, 3, 4, "only_right")]


def test_steps_point_left_or_right_and_the_left_gets_no_words():
    step = AltCanvasStep(say="Look.", point=AltPointing(side="up", line=-1), draw=[CanvasMark(kind="note", line=1)],
                         draw_left=[CanvasMark(kind="circle", line=1), CanvasMark(kind="note", line=1)])
    out = intent.clean_steps([step] * 9)
    assert len(out) == intent.MAX_STEPS and (out[0].point.side, out[0].point.line) == ("right", 0)
    assert [m.kind for m in out[0].draw_left] == ["circle"]


def test_compare_answers_with_the_diff_or_a_reason(monkeypatch):
    seen = {}

    def model(**inputs):
        seen.update(inputs)
        return SimpleNamespace(summary="Two traversals.", matches=[_m(1, 1, 1, 1, "different")], steps=[], takeaways=[" A. ", "", "B", "C", "D"], closing="Ask away.")
    monkeypatch.setattr(intent, "_comparer", lambda canvas=False: model)
    out = h.code_alternatives(_req(focus=" Detect a cycle: stack against queue. "))["result"]
    assert set(seen) == set(COMPARE_FIELDS) and seen["right_name"] == "your code" and "  1 | def dfs(u):" in seen["left"]
    assert seen["focus"] == "Detect a cycle: stack against queue." 
    assert out["summary"] == "Two traversals." and out["takeaways"] == ["A.", "B", "C"]
    monkeypatch.setattr(h, "compare_alternatives", lambda *_, **__: intent.AltComparison(error="down"))
    assert h.code_alternatives(_req()) == {"reason": "down"}
    assert "reason" in h.code_alternatives(_req(right=" "))


def test_a_question_is_answered_about_the_two_on_screen(monkeypatch):
    seen = {}

    def model(**inputs):
        seen.update(inputs)
        return SimpleNamespace(steps=[AltCanvasStep(say="Here.")] * 5, answer="The queue.")
    monkeypatch.setattr(intent, "_answerer", lambda canvas=False: model)
    out = h.code_alternatives(_req(action="ask", question=" why? ", comparison="left 1, right 1: different"))["result"]
    assert set(seen) == set(ASK_FIELDS) and seen["question"] == "why?"
    assert out["closing"] == "The queue." and len(out["steps"]) == intent.MAX_ANSWER_STEPS
    assert "reason" in h.code_alternatives(_req(action="ask"))


def test_there_is_no_search_the_lesson_declares_alternatives():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        _req(action="find")
