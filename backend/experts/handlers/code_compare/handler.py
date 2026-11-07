"""``POST /api/expert/code_compare``: the logical diff of Type along's code against the original.

Returns ``{"result": {summary, same_behaviour, matches: [{original_from, original_to, yours_from, yours_to, verdict, comment}],
steps: [{say, point, draw, draw_original}], debrief: [...], closing}}``, or ``{"reason": ...}`` when the comparer failed. Matches may cross; each
line of both sides is in exactly one. With ``question``, it answers about the comparison on screen: only ``steps`` and
``closing``, the answer.
"""
from __future__ import annotations

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_compare.intent import answer_question, compare_code
from backend.experts.registry import register_handler

from .models import CodeCompareRequest


def render_inputs(req: CodeCompareRequest) -> dict:
    return {"language": req.language or "unknown", "original": _numbered(req.expected), "typed": _numbered(req.typed), "recent_turns": req.recent_turns.strip()}


@register_handler("code_compare", request_model=CodeCompareRequest, speaks=True)
def code_compare(req: CodeCompareRequest) -> dict:
    if req.question.strip():
        out = answer_question(canvas=req.canvas, **{**render_inputs(req), "comparison": req.comparison.strip(), "about": req.about.strip(), "question": req.question.strip()})
        return {"reason": out.error} if out.error else {"result": out.model_dump(exclude={"error"})}
    out = compare_code(req.expected, req.typed, canvas=req.canvas, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    return {"result": out.model_dump(exclude={"error"})}
