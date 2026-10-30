"""The code-quiz handler: its inputs, routing and cleaning; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.code_quiz import handler as h
from backend.experts.handlers.code_quiz.models import CodeQuizRequest
from backend.experts.modules.code_assist.signature import AssistStep
from backend.experts.modules.code_quiz import intent
from backend.experts.modules.code_quiz.signature import ASK_FIELDS, GRADE_FIELDS

EXPECTED = "def f(xs):\n    total = 0\n    for x in xs:\n        total += x\n    return total"


def _req(**kw) -> CodeQuizRequest:
    return CodeQuizRequest(**{**dict(language="python", expected=EXPECTED, first_line=10, typed=EXPECTED), **kw})


def test_inputs_cover_both_signatures():
    assert set(h.ask_inputs(_req(asked=["Why zero?"]))) == set(ASK_FIELDS)
    assert h.ask_inputs(_req(asked=["Why zero?", "What if empty?"]))["asked"] == "Why zero?\nWhat if empty?"
    grade = h.grade_inputs(_req(mode="grade", kind="type", setup="def f(xs):"))
    assert set(grade) == set(GRADE_FIELDS)
    assert "  1 | def f(xs):" in grade["answer"], "a typed answer is the editor, numbered"
    assert h.grade_inputs(_req(mode="grade", answer=" 6 ")) ["answer"] == "6"


def test_a_question_is_cleaned_and_an_unknown_kind_is_answered_in_words(monkeypatch):
    out = SimpleNamespace(plan="Let's test the sum.", question="What is total after [1, 2]?", kind="Essay",
                          answer_key="3", steps=[AssistStep(say="Look here.", select="total += x", select_line=4,
                                                            code="", draft="x", notice="y")] * 6)
    monkeypatch.setattr(intent, "_asker", lambda: (lambda **_: out))
    q = intent.ask_question(language="", expected="", section="", typed="", request="", asked="")
    assert q.kind == "answer" and q.question.endswith("?")
    assert len(q.steps) == intent.MAX_SETUP and not q.steps[0].draft


def test_grading_may_type_comments_without_drafts_and_needs_an_answer(monkeypatch):
    out = SimpleNamespace(verdict="Correct", feedback="Yes.",
                          steps=[AssistStep(say="See.", code="x = 1  # one", select="x", draft="x = 2", notice="oops")])
    monkeypatch.setattr(intent, "_grader", lambda: (lambda **_: out))
    v = intent.grade_answer(**{f: "" for f in GRADE_FIELDS})
    assert v.verdict == "correct" and v.steps[0].code == "x = 1  # one" and not v.steps[0].draft
    assert h.code_quiz(_req(mode="grade", kind="answer", answer="  ")) == {"reason": h.NO_ANSWER}


def test_no_question_is_a_reason(monkeypatch):
    monkeypatch.setattr(h, "ask_question", lambda **_: intent.QuizQuestion(plan="p"))
    assert h.code_quiz(_req()) == {"reason": h.NO_QUESTION}


def test_a_long_answer_key_comes_back_capped_and_is_accepted_when_sent_back(monkeypatch):
    out = SimpleNamespace(plan="", question="Why?", kind="answer", answer_key="x" * 9000, steps=[])
    monkeypatch.setattr(intent, "_asker", lambda: (lambda **_: out))
    q = intent.ask_question(language="", expected="", section="", typed="", request="", asked="")
    assert len(q.answer_key) == intent.MAX_TEXT
    _req(mode="grade", question=q.question, answer_key=q.answer_key, answer="2")   # no validation error
