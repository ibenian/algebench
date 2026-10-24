"""``POST /api/expert/code_practice``: a coach's review of code the learner typed.

Returns ``{"result": {score, verdict, commentary, direction, line_notes}}``, or
``{"reason": ...}`` when there is nothing to review or the coach failed. The
text match the learner sees as they type is measured on the client; this adds
the judgement by meaning that text alone can't give.
"""
from __future__ import annotations

import logging
import re

from backend.experts.modules.code_practice.intent import review_code
from backend.experts.registry import register_handler

from .models import CodePracticeRequest

log = logging.getLogger(__name__)

LOG_TAG = "[code_practice]"
NOTHING_TYPED = "Type some code first, then ask for a review, or turn on hints for a start."


def _numbered(code: str, first: int = 1) -> str:
    return "\n".join(f"{first + i:>3} | {line}" for i, line in enumerate(code.split("\n")))


#: A comment: a line that is one (``# …``, ``// …``), or one after code, set off by a space.
_COMMENT = re.compile(r"(?:^|\s)(?:#|//)\s?(.*)$")


def learner_notes(typed: str) -> str:
    """The learner's comments, one per line, with the line they are on: what they say to the coach."""
    out = []
    for i, line in enumerate(typed.split("\n"), 1):
        m = _COMMENT.search(line)
        if m and m.group(1).strip():
            out.append(f"line {i}: {m.group(1).strip()}")
    return "\n".join(out)


def render_inputs(req: CodePracticeRequest) -> dict:
    """The coach's inputs, all ``str``, in the reference file's own line numbers."""
    lines = req.expected.split("\n")
    section = ""
    if req.section:
        s = req.section
        a, b = max(s.start, req.first_line), min(s.end, req.first_line + len(lines) - 1)
        body = _numbered("\n".join(lines[a - req.first_line:b - req.first_line + 1]), a) if a <= b else ""
        section = f"title: {s.title}\n" + (f"hint: {s.hint}\n" if s.hint else "") + f"lines {s.start}-{s.end}:\n{body}"
    match = "\n".join(
        f"typed line {m.typed}: " + (f"{m.score}% like reference line {m.reference}" if m.reference else "no matching reference line")
        for m in req.match)
    return {
        "language": req.language or "unknown",
        "expected": _numbered(req.expected, req.first_line),
        "section": section,
        "typed": _numbered(req.typed),
        "match": match or "not measured",
        "attempts": str(req.attempts),
        "hints": "on" if req.hints else "off",
        "notes": learner_notes(req.typed),
    }


@register_handler("code_practice", request_model=CodePracticeRequest)
def code_practice(req: CodePracticeRequest) -> dict:
    if not req.typed.strip() and not req.hints:
        return {"reason": NOTHING_TYPED}
    review = review_code(**render_inputs(req))
    if review.error:
        return {"reason": review.error}
    if not req.hints:
        # Asked for no guidance: what to write next is never shown, whatever the model said.
        review.direction = ""
    log.info("%s %s: %d%% (%s), %d note(s)", LOG_TAG, req.section.title if req.section else "whole block",
             review.score, review.verdict, len(review.line_notes))
    return {"result": review.model_dump(exclude={"error"})}
