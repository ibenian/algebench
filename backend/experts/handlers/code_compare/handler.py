"""``POST /api/expert/code_compare``: the logical diff of Type along's code against the original.

Returns ``{"result": {summary, same_behaviour, matches: [{original_from, original_to, yours_from, yours_to, verdict, comment}],
steps: [{say, point, draw, draw_original}], debrief: [...], closing}}``, or ``{"reason": ...}`` when the comparer failed. Matches may cross; each
line of both sides is in exactly one. With ``question``, it answers about the comparison on screen: only ``steps`` and
``closing``, the answer.
"""
from __future__ import annotations

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_compare.intent import answer_question, compare_code
from backend.experts.modules.code_compare.signature import Pointing
from backend.experts.registry import register_handler

from .models import CodeCompareRequest


def render_inputs(req: CodeCompareRequest) -> dict:
    return {"language": req.language or "unknown", "original": _numbered(req.expected), "typed": _numbered(req.typed), "recent_turns": req.recent_turns.strip(),
            "hint_level": req.hint_level}


def within_hint_level(out, req: CodeCompareRequest) -> None:
    """"question" and "vague" are words alone, whatever the model sent: nothing points or marks
    where the trouble is, a part's verdict says all its row may (the split is drawn from it), and each level says only
    as much as it is for: one question, or an example or two to try."""
    if req.hint_level in ("direct", "point"):
        return
    out.steps = out.steps[:1 if req.hint_level == "question" else 2]
    for step in out.steps:
        step.point, step.draw, step.draw_original = Pointing(), [], []
    for match in out.matches:
        if match.verdict in ("incorrect", "missing"):
            match.comment = ""


@register_handler("code_compare", request_model=CodeCompareRequest, speaks=True)
def code_compare(req: CodeCompareRequest) -> dict:
    if req.question.strip():
        out = answer_question(canvas=req.canvas, **{**render_inputs(req), "comparison": req.comparison.strip(), "about": req.about.strip(), "question": req.question.strip()})
        if out.error:
            return {"reason": out.error}
        within_hint_level(out, req)
        return {"result": out.model_dump(exclude={"error"})}
    out = compare_code(req.expected, req.typed, canvas=req.canvas, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    within_hint_level(out, req)
    return {"result": out.model_dump(exclude={"error"})}
