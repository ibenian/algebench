"""``POST /api/expert/code_quiz``: an interviewer's question about the code the learner is typing, or its verdict.

``mode: "ask"`` returns ``{"result": {plan, steps, question, kind, answer_key}}``: the steps set the question up in
the editor (played like Help me's), ``kind`` says whether the learner answers by editing the code ("type") or in
words ("answer"). ``mode: "grade"`` returns ``{"result": {verdict, steps, feedback}}``. ``{"reason": ...}`` when the
model failed or there is nothing to judge.
"""
from __future__ import annotations

import logging

from backend.experts.handlers.code_assist.handler import render_inputs as assist_inputs
from backend.experts.handlers.code_assist.models import CodeAssistRequest
from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_quiz.intent import ask_question, grade_answer
from backend.experts.registry import register_handler

from .models import CodeQuizRequest

log = logging.getLogger(__name__)

LOG_TAG = "[code_quiz]"
NO_QUESTION = "I couldn't think of a good question here. Try again, or tell me what to ask about."
NO_ANSWER = "Write your answer first, then send it."


def ask_inputs(req: CodeQuizRequest) -> dict:
    base = assist_inputs(CodeAssistRequest(language=req.language, expected=req.expected, first_line=req.first_line,
                                           section=req.section, typed=req.typed))
    return {"language": base["language"], "expected": base["expected"], "section": base["section"],
            "typed": base["typed"], "request": req.request.strip(), "asked": "\n".join(q.strip() for q in req.asked)}


def grade_inputs(req: CodeQuizRequest) -> dict:
    answer = (_numbered(req.typed) if req.typed.strip() else "(empty)") if req.kind == "type" else req.answer.strip()
    return {"language": req.language or "unknown", "expected": _numbered(req.expected, req.first_line),
            "question": req.question, "kind": req.kind, "answer_key": req.answer_key,
            "setup": _numbered(req.setup) if req.setup.strip() else "(empty)", "answer": answer,
            "editor": _numbered(req.typed) if req.typed.strip() else "(empty)"}


@register_handler("code_quiz", request_model=CodeQuizRequest)
def code_quiz(req: CodeQuizRequest) -> dict:
    if req.mode == "grade":
        if req.kind == "answer" and not req.answer.strip():
            return {"reason": NO_ANSWER}
        out = grade_answer(**grade_inputs(req))
        if out.error:
            return {"reason": out.error}
        log.info("%s graded: %s", LOG_TAG, out.verdict)
        return {"result": out.model_dump(exclude={"error"})}
    out = ask_question(**ask_inputs(req))
    if out.error:
        return {"reason": out.error}
    if not out.question:
        return {"reason": NO_QUESTION}
    log.info("%s asked (%s): %s", LOG_TAG, out.kind, out.question[:80])
    return {"result": out.model_dump(exclude={"error"})}
