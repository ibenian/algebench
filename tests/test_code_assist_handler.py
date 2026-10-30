"""The code-assist handler's routing, its inputs, and how steps are cleaned; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.code_assist import handler as h
from backend.experts.handlers.code_assist.models import CodeAssistRequest
from backend.experts.modules.code_assist import intent
from backend.experts.modules.code_assist.signature import INPUT_FIELDS, AssistStep

EXPECTED = "def f(n):\n    total = 0\n    for i in range(n):\n        total += i\n    return total"


def _req(**kw) -> CodeAssistRequest:
    return CodeAssistRequest(**{**dict(language="python", expected=EXPECTED, first_line=10, typed="def f(n):"), **kw})


def test_inputs_cover_the_signature_and_number_the_reference_from_its_line():
    inputs = {**h.render_inputs(_req()), "scope": "next"}
    assert set(inputs) == set(INPUT_FIELDS)
    assert " 10 | def f(n):" in inputs["expected"]
    assert h.render_inputs(_req(typed=" \n"))["typed"] == "(empty)"
    assert h.render_inputs(_req(issues=[{"line": 2, "note": "never defined"}]))["issues"] == "line 2: never defined"


def _model(steps, plan="Plan.", closing="Over to you."):
    return lambda: (lambda **_: SimpleNamespace(plan=plan, steps=steps, closing=closing))


def test_steps_are_cleaned_merged_and_capped(monkeypatch):
    steps = [AssistStep(say="Start", code="```python\ndef f(n):\n    total = 0   \n```", explain="A sum."),
             AssistStep(say="Hmm", code="def f(n):\n    total = 0", explain="no change"),
             AssistStep(say="Loop", code="def f(n):\n    total = 0\n    for i in range(n):", explain="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("all", language="python", expected="", section="", typed="")
    assert [s.code for s in out.steps] == ["def f(n):\n    total = 0", "def f(n):\n    total = 0\n    for i in range(n):"]
    assert out.steps[0].explain == "A sum. Hmm no change", "a step typing nothing joins the one before"
    assert len(intent.assist_code("next", language="", expected="", section="", typed="").steps) == 2
    monkeypatch.setattr(intent, "_assistant", _model(steps * 3))
    assert len(intent.assist_code("next", language="", expected="", section="", typed="").steps) <= intent.STEP_LIMIT["next"]


def test_a_failed_call_is_a_reason_and_no_steps_too(monkeypatch):
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(error="down"))
    assert h.code_assist(_req()) == {"reason": "down"}
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(plan="p"))
    assert h.code_assist(_req()) == {"reason": h.NO_STEPS}


def test_a_draft_is_kept_only_as_a_slip_caught(monkeypatch):
    fixed = "def f(n):\n    total = 0"
    steps = [AssistStep(say="a", code=fixed, draft="def f(n):\n    total = 1", notice="Wait, it starts at zero."),
             AssistStep(say="b", code=fixed + "\n    x", draft=fixed + "\n    x", notice="same as the fix"),
             AssistStep(say="c", code=fixed + "\n    y", draft=fixed + "\n    z", notice="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("all", language="", expected="", section="", typed="")
    assert [(s.draft, s.notice) for s in out.steps] == [("def f(n):\n    total = 1", "Wait, it starts at zero."), ("", ""), ("", "")]


def test_a_fix_has_no_drafts_and_nothing_to_fix_says_so(monkeypatch):
    steps = [AssistStep(say="a", code="x = 0", draft="x = 1", notice="Wait.")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    assert intent.assist_code("fix", language="", expected="", section="", typed="", issues="").steps[0].draft == ""
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing=""))
    assert h.code_assist(_req(scope="fix")) == {"reason": h.NOTHING_TO_FIX}
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="All good so far."))
    assert h.code_assist(_req(scope="fix")) == {"reason": "All good so far."}


def test_ask_needs_words_and_a_question_is_answered_without_typing(monkeypatch):
    assert h.code_assist(_req(scope="ask")) == {"reason": h.ASK_FIRST}
    assert h.render_inputs(_req(request="  write the loop "))["request"] == "write the loop"
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="Because the empty prefix counts."))
    assert h.code_assist(_req(scope="ask", request="why {0: 1}?")) == {"reason": "Because the empty prefix counts."}


def test_narrating_types_nothing_and_keeps_its_selections(monkeypatch):
    steps = [AssistStep(say="The loop.", code="for x in xs:", select="for x in xs:", select_line=1),
             AssistStep(say="Its target.", code="", select="xs", select_line=-3),
             AssistStep(say="And that is all.", code="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("narrate", language="", expected="", section="", typed="", issues="", request="")
    assert [(s.code, s.select, s.select_line) for s in out.steps] == [("", "for x in xs:", 1), ("", "xs", 0)]
    assert out.steps[1].explain == "And that is all.", "talk with nothing selected joins the step before"


def test_line_numbers_copied_from_the_inputs_are_taken_off():
    assert intent.clean_code("  1 | def f(n):\n  2 |     return n  # 3 | not a number") == "def f(n):\n    return n  # 3 | not a number"
    assert intent.clean_code("  1 | def f(n):\n  2 |     return n\n      # f(2) is 2") == "def f(n):\n    return n\n# f(2) is 2", \
        "a line added without a number loses the numbering's width"
    many = "  1 | x = 1\n" + "\n".join(f"# note {k}" for k in range(5))
    assert intent.clean_code(many).startswith("x = 1\n# note 0"), "however many lines come unnumbered"
    assert intent.clean_code("x = a | b\ny = 1") == "x = a | b\ny = 1", "only when the lines are numbered"
    assert intent.clean_code("  3 | x\n  7 | y") == "  3 | x\n  7 | y", "not numbered from 1 in order: left as it is"
