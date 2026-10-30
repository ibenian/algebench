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
