"""``POST /api/expert/code_assist``: the steps a pair programmer takes at Type along's keyboard.

Returns ``{"result": {plan, steps: [{say, code, explain}], closing}}``, or ``{"reason": ...}`` when the assistant
failed. Each step's ``code`` is the whole editor after it; the client types the difference, so a step may add,
change or remove lines anywhere.
"""
from __future__ import annotations

import logging

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_assist.intent import assist_code
from backend.experts.registry import register_handler

from .models import CodeAssistRequest

log = logging.getLogger(__name__)

LOG_TAG = "[code_assist]"
NO_STEPS = "I looked, but had nothing to type here: it may already be complete. Ask the coach to check it."


def render_inputs(req: CodeAssistRequest) -> dict:
    """The assistant's inputs, all ``str``, in the reference file's own line numbers."""
    lines = req.expected.split("\n")
    section = ""
    if req.section:
        s = req.section
        a, b = max(s.start, req.first_line), min(s.end, req.first_line + len(lines) - 1)
        body = _numbered("\n".join(lines[a - req.first_line:b - req.first_line + 1]), a) if a <= b else ""
        section = f"title: {s.title}\n" + (f"hint: {s.hint}\n" if s.hint else "") + f"lines {s.start}-{s.end}:\n{body}"
    return {
        "language": req.language or "unknown",
        "expected": _numbered(req.expected, req.first_line),
        "section": section,
        "typed": _numbered(req.typed) if req.typed.strip() else "(empty)",
    }


@register_handler("code_assist", request_model=CodeAssistRequest)
def code_assist(req: CodeAssistRequest) -> dict:
    out = assist_code(req.scope, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    if not out.steps:
        return {"reason": NO_STEPS}
    log.info("%s %s: %d step(s)", LOG_TAG, req.scope, len(out.steps))
    return {"result": out.model_dump(exclude={"error"})}
