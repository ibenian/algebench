"""``POST /api/expert/code_assist``: the steps a pair programmer takes at Type along's keyboard.

Returns ``{"result": {plan, steps: [{say, code, explain}], closing}}``, or ``{"reason": ...}`` when the assistant
failed or has only words; pairing's last word adds ``"complete": true`` when the learner's code is done and right. Each step's ``code`` is the whole editor after it; the client types the difference, so a step may add,
change or remove lines anywhere.
"""
from __future__ import annotations

import logging
import re

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.modules.code_assist.intent import assist_code
from backend.experts.registry import register_handler

from .models import CodeAssistRequest

log = logging.getLogger(__name__)

LOG_TAG = "[code_assist]"
NO_STEPS = "I looked, but had nothing to type here: it may already be complete. Ask the coach to check it."
NOTHING_TO_FIX = "I don't see anything wrong in what you've typed so far. Keep going!"
ASK_FIRST = "Tell me what you'd like help with, then send it."


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
        "issues": "\n".join(f"line {n.line}: {n.note}" for n in req.issues),
        "request": req.request.strip(),
    }


#: The start a pair-programming step may type of a line: its indentation and first word or two.
_START = re.compile(r"^(\s*)((?:[A-Za-z_][\w.]*|[\[\](){}]|\S)(?:\s*[\[(]|\s+(?=\S))?)")


def only_starts(code: str, typed: str, expected: str) -> str:
    """In pair programming the learner writes the lines: a step that types a line of the reference, or a long start
    of one, is cut to the line's start (indentation and first word), so there is still something for them to write."""
    reference = {line.strip() for line in expected.split("\n") if line.strip()}
    have = {line.strip() for line in typed.split("\n")}
    out = []
    for line in code.split("\n"):
        text = line.strip()
        # A new line that is a reference line, or most of one: only its start stays.
        if text and text not in have and any(ref.startswith(text) for ref in reference):
            m = _START.match(line)
            start = (m.group(1) + m.group(2)) if m else line[:len(line) - len(line.lstrip())]
            # Already no more than a start (trailing space aside): left as it is.
            if len(line.rstrip()) > len(start.rstrip()):
                line = start
        out.append(line)
    return "\n".join(out)


@register_handler("code_assist", request_model=CodeAssistRequest)
def code_assist(req: CodeAssistRequest) -> dict:
    if req.scope == "ask" and not req.request.strip():
        return {"reason": ASK_FIRST}
    out = assist_code(req.scope, editor_text=req.typed, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    if not out.steps:
        # A fix with nothing to fix, or a question with nothing to type: the answer is all there is.
        if req.scope in ("fix", "ask", "narrate", "pair") and out.closing:
            # Pairing's last word: whether the code is now done and right, for the editor to show.
            return {"reason": out.closing, **({"complete": True} if req.scope == "pair" and out.complete else {})}
        return {"reason": NOTHING_TO_FIX if req.scope == "fix" else NO_STEPS}
    if req.scope == "pair":
        for step in out.steps:
            if step.code:
                step.code = only_starts(step.code, req.typed, req.expected)
    log.info("%s %s: %d step(s)", LOG_TAG, req.scope, len(out.steps))
    return {"result": out.model_dump(exclude={"error"})}
