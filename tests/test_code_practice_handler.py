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
                          line_notes=[LineNote(line=2, note="fine")])

    monkeypatch.setattr(h, "review_code", stub)
    out = h.code_practice(_req())
    assert out == {"result": {"score": 40, "verdict": "partial", "commentary": "Good start.",
                              "direction": "Add the loop.", "line_notes": [{"line": 2, "note": "fine"}]}}
    assert set(seen) == set(INPUT_FIELDS)


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
