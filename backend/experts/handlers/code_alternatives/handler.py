"""``POST /api/expert/code_alternatives``: two solutions to the same problem compared. Which functions are alternatives
is declared by the lesson (``codeFiles[].alternatives``); the client sends the two and what the lesson says about them.

- ``action: "compare"`` returns ``{"result": {summary, matches: [{left_from, left_to, right_from, right_to, verdict, comment}],
  steps: [{say, point, draw, draw_left}], takeaways, closing}}``. Each line of both sides is in exactly one match.
- ``action: "ask"`` answers about the comparison on screen: only ``steps`` and ``closing``, the answer.

Any of them answers ``{"reason": ...}`` instead when it can't.
"""
from __future__ import annotations

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_alternatives.intent import answer_question, compare_alternatives
from backend.experts.registry import register_handler

from .models import CodeAlternativesRequest


def sides(req: CodeAlternativesRequest) -> dict:
    return {"language": req.language or "unknown", "focus": req.focus.strip(), "left_name": req.left_name.strip() or "the left one", "left": _numbered(req.left),
            "right_name": req.right_name.strip() or "the right one", "right": _numbered(req.right), "recent_turns": req.recent_turns.strip()}


@register_handler("code_alternatives", request_model=CodeAlternativesRequest, speaks=True)
def code_alternatives(req: CodeAlternativesRequest) -> dict:
    if not req.left.strip() or not req.right.strip():
        return {"reason": "Pick two pieces of code to compare."}
    if req.action == "ask":
        if not req.question.strip():
            return {"reason": "Ask a question about the two."}
        out = answer_question(canvas=req.canvas, **sides(req), comparison=req.comparison.strip(), about=req.about.strip(), question=req.question.strip())
    else:
        out = compare_alternatives(req.left, req.right, canvas=req.canvas, **sides(req))
    return {"reason": out.error} if out.error else {"result": out.model_dump(exclude={"error"})}
