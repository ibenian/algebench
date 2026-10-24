"""The code-practice handler's routing and the inputs it renders; the LM is stubbed."""
from __future__ import annotations

import subprocess
import sys

from backend.experts.handlers.code_practice import handler as h
from backend.experts.handlers.code_practice.models import CodePracticeRequest
from backend.experts.modules.code_practice.intent import CodeReview
from backend.experts.modules.code_practice.signature import INPUT_FIELDS, LineNote

EXPECTED = "def f(n):\n    total = 0\n    for i in range(n):\n        total += i\n    return total"


def _req(**kw) -> CodePracticeRequest:
    base = dict(language="python", expected=EXPECTED, first_line=10, typed="def f(n):\n    total = 0")
    return CodePracticeRequest(**{**base, **kw})


def test_the_endpoint_exists_via_discovery():
    out = subprocess.run(
        [sys.executable, "-c",
         "from backend.experts.handlers import discover_handlers;"
         "discover_handlers();"
         "from backend.experts.registry import HANDLER_REGISTRY;"
         "print('code_practice' in HANDLER_REGISTRY)"],
        capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "True"


def test_nothing_typed_is_not_sent_to_the_model(monkeypatch):
    monkeypatch.setattr(h, "review_code", lambda **_: (_ for _ in ()).throw(AssertionError("called")))
    assert h.code_practice(_req(typed="  \n")) == {"reason": h.NOTHING_TYPED}


def test_a_review_is_returned_without_its_error_field(monkeypatch):
    seen = {}

    def stub(**inputs):
        seen.update(inputs)
        return CodeReview(score=40, verdict="partial", commentary="Good start.", direction="Add the loop.",
                          reply="", line_notes=[LineNote(line=2, note="fine")])

    monkeypatch.setattr(h, "review_code", stub)
    out = h.code_practice(_req(hints=True))
    assert out == {"result": {"score": 40, "verdict": "partial", "commentary": "Good start.",
                              "direction": "Add the loop.", "reply": "", "line_notes": [{"line": 2, "note": "fine"}]}}
    assert set(seen) == set(INPUT_FIELDS)


def test_without_hints_there_is_no_direction_and_nothing_typed_is_refused(monkeypatch):
    monkeypatch.setattr(h, "review_code", lambda **kw: CodeReview(score=10, verdict="partial", commentary="ok",
                                                                    direction="Write the loop."))
    assert h.code_practice(_req())["result"]["direction"] == ""
    assert h.code_practice(_req(hints=True))["result"]["direction"] == "Write the loop."


def test_with_hints_an_empty_editor_gets_a_start(monkeypatch):
    seen = {}
    monkeypatch.setattr(h, "review_code", lambda **kw: seen.update(kw) or CodeReview(verdict="empty", commentary="Begin by…"))
    out = h.code_practice(_req(typed="", hints=True))
    assert out["result"]["commentary"] == "Begin by…" and seen["hints"] == "on"


def test_the_learners_comments_are_notes_to_the_coach():
    typed = "def f(n):  # takes the count\n    # why start at zero?\n    s = '#x'\n    #"
    assert h.learner_notes(typed) == "line 1: takes the count\nline 2: why start at zero?"
    assert h.render_inputs(_req(typed=typed))["notes"].startswith("line 1:")


def test_changes_since_the_last_review_are_marked():
    assert h.changes_since(None, "x = 1") == "first review"
    assert h.changes_since("a = 1\nb = 2", "a = 1\nb = 2   ") == h.NOTHING_CHANGED
    assert h.changes_since("a = 1\nb = 2", "a = 1\nb = 3\nc = 4") == "- line 2: b = 2\n+ line 2: b = 3\n+ line 3: c = 4"
    assert h.render_inputs(_req(previous="def f(n):"))["changes"] == "+ line 2:     total = 0"


def test_a_follow_up_is_about_the_changed_lines(monkeypatch):
    previous = "def f(n):  # what is n?"
    typed = "def f(n):  # what is n?\n    total = 0  # start empty\n    x"
    assert h.changed_lines(previous, typed) == {2, 3}
    assert h.changed_lines(previous, previous) is None and h.changed_lines(None, typed) is None
    inputs = h.render_inputs(_req(typed=typed, previous=previous))
    assert inputs["notes"] == "line 2: start empty", "an answered note isn't asked again"
    assert [l[:2] for l in inputs["typed"].splitlines()] == ["  ", "+ ", "+ "]
    assert h.render_inputs(_req(typed=typed))["typed"].startswith("  1 |"), "a first review marks nothing"
    monkeypatch.setattr(h, "review_code", lambda **_: CodeReview(score=30, verdict="partial", commentary="c",
                                                                 line_notes=[LineNote(line=1, note="old"), LineNote(line=3, note="new")]))
    assert h.code_practice(_req(typed=typed, previous=previous))["result"]["line_notes"] == [{"line": 3, "note": "new"}]
    monkeypatch.setattr(h, "review_code", lambda **_: CodeReview(commentary="c", reply="u is the node"))
    assert h.code_practice(_req(typed=previous + "\nx = 1", previous=previous))["result"]["reply"] == "", "no new note, no reply"


def test_a_failed_call_is_a_reason(monkeypatch):
    monkeypatch.setattr(h, "review_code", lambda **_: CodeReview(error="nope"))
    assert h.code_practice(_req()) == {"reason": "nope"}


def test_inputs_use_the_files_line_numbers_and_name_the_section():
    inputs = h.render_inputs(_req(section={"title": "Sum the range", "hint": "add each i", "start": 12, "end": 13},
                                  match=[{"typed": 1, "reference": 10, "score": 100}, {"typed": 2, "score": 0}]))
    assert inputs["expected"].splitlines()[0] == " 10 | def f(n):"
    assert inputs["section"].splitlines() == ["title: Sum the range", "hint: add each i", "lines 12-13:",
                                              " 12 |     for i in range(n):", " 13 |         total += i"]
    assert inputs["match"] == "typed line 1: 100% like reference line 10\ntyped line 2: no matching reference line"
    assert inputs["typed"].splitlines()[1] == "  2 |     total = 0"
