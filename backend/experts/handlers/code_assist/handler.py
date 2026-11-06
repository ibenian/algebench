"""``POST /api/expert/code_assist``: the steps a pair programmer takes at Type along's keyboard.

Returns ``{"result": {plan, steps: [{say, code, explain}], closing}}``, or ``{"reason": ...}`` when the assistant
failed or has only words; pairing's last word adds ``"complete": true`` when the learner's code is done and right,
and a pairing turn with nothing to say at its hint level is ``{"quiet": true}``. Each step's ``code`` is the whole editor after it; the client types the difference, so a step may add,
change or remove lines anywhere.
"""
from __future__ import annotations

import difflib
import logging
import re

from backend.experts.handlers.code_practice.handler import _numbered
from backend.experts.handlers.code_practice.names import undefined_names
from backend.experts.modules.code_assist.intent import assist_code
from backend.experts.registry import register_handler

from .models import CodeAssistRequest

log = logging.getLogger(__name__)

LOG_TAG = "[code_assist]"
NO_STEPS = "I looked, but had nothing to type here: it may already be complete. Ask the coach to check it."
NOTHING_TO_FIX = "I don't see anything wrong in what you've typed so far. Keep going!"
ASK_FIRST = "Tell me what you'd like help with, then send it."
SHOWING = "Let me show you that on the scene."


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
        "cursor": f"line {req.cursor}" if req.cursor else "unknown",
        "presenter": "on" if req.present else "off",
        "hint_level": req.hint_level,
        "last_said": req.last_said.strip(),
        "recent_turns": req.recent_turns.strip(),
        "problems": "\n".join(f"line {line}: {msg}" for line, msg in undefined_names(req.typed, req.expected, req.language)),
        # The code canvas's one input; without it the expert isn't told of drawing at all.
        **({"canvas_marks": "\n".join(req.canvas_marks)} if req.canvas else {}),
    }


#: The start a pair-programming step may type of a line: its indentation and first word or two.
_START = re.compile(r"^(\s*)((?:[A-Za-z_][\w.]*|[\[\](){}]|\S)(?:\s*[\[(]|\s+(?=\S))?)")


def keep_their_lines(code: str, typed: str, erase: set[int]) -> tuple[str, set[str]]:
    """In pair programming a line the learner typed changes only on purpose: the lines ``erase`` lists (numbered from
    1, as in ``typed``) may go or be rewritten; any other the model changed comes back as they typed it. A listed line
    the step left alone stays too, so a wrong number changes nothing. Also returns the lines rewritten on purpose."""
    if not typed.strip():
        return code, set()
    old, new = typed.split("\n"), code.split("\n")
    out: list[str] = []
    rewritten: set[str] = set()
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if op == "equal":
            out += old[a1:a2]
        elif op == "insert":
            out += new[b1:b2]
        else:
            for k in range(max(a2 - a1, b2 - b1)):
                mine = old[a1 + k] if a1 + k < a2 else ""
                fresh = new[b1 + k] if b1 + k < b2 else None
                if mine.strip() and a1 + k + 1 not in erase:
                    out.append(mine)
                elif fresh is not None:
                    out.append(fresh)
                    if mine.strip():
                        rewritten.add(fresh.strip())
    return "\n".join(out), rewritten


def only_starts(code: str, typed: str, expected: str, rewritten: frozenset[str] | set[str] = frozenset()) -> str:
    """In pair programming the learner writes the lines: a step that types a line of the reference, or a long start
    of one, is cut to the line's start (indentation and first word), so there is still something for them to write.
    A line of theirs ``rewritten`` on purpose is whole: cut, it would lose what they had."""
    reference = {line.strip() for line in expected.split("\n") if line.strip()}
    have = {line.strip() for line in typed.split("\n")}
    out = []
    for line in code.split("\n"):
        text = line.strip()
        # A new line that is a reference line, or most of one: only its start stays.
        if text and text not in have and text not in rewritten and any(ref.startswith(text) for ref in reference):
            m = _START.match(line)
            start = (m.group(1) + m.group(2)) if m else line[:len(line) - len(line.lstrip())]
            # Already no more than a start (trailing space aside): left as it is.
            if len(line.rstrip()) > len(start.rstrip()):
                line = start
        out.append(line)
    return "\n".join(out)


def at_cursor(code: str, typed: str, cursor: int) -> str:
    """Pairing starts a line where the learner is: the lines a step only adds go on the ``cursor`` line of ``typed``
    (in place of it when it is blank, else after it), wherever the model put them (it tends to add at the end)."""
    if not cursor or not typed.strip():
        return code
    old, new = typed.split("\n"), code.split("\n")
    added: list[str] = []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        if any(line.strip() for line in old[a1:a2]):
            return code   # it changed or dropped a line of theirs, not only added: as it is
        added += new[b1:b2]   # added, maybe on a blank line
    added = [line for line in added if line.strip()]
    if not added or cursor > len(old):
        return code
    blank = not old[cursor - 1].strip()
    lines = [line for line in old]
    lines[cursor - 1:cursor] = added if blank else [old[cursor - 1], *added]
    return "\n".join(lines).rstrip("\n ")


#: What starts a comment line, across the languages lessons use.
_COMMENT = ("#", "//", "--", "%", ";")


def only_comments_added(code: str, typed: str) -> bool:
    """Whether ``code`` is ``typed`` with comment lines added and nothing of the learner's changed."""
    old, new = typed.split("\n"), code.split("\n")
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        if any(line.strip() for line in old[a1:a2]):
            return False
        if any(line.strip() and not line.strip().startswith(_COMMENT) for line in new[b1:b2]):
            return False
    return True


def within_hint_level(step, level: str, typed: str) -> None:
    """A pair turn below "direct" writes no code, whatever the model sent: "point" may add a comment and points;
    "question" and "vague" are words alone."""
    if level == "point":
        if step.code and not only_comments_added(step.code, typed):
            step.code, step.cursor_line = "", 0
        return
    step.code, step.select, step.select_line, step.cursor_line, step.draw, step.erase_marks = "", "", 0, 0, [], []


@register_handler("code_assist", request_model=CodeAssistRequest, speaks=True)
def code_assist(req: CodeAssistRequest) -> dict:
    if req.scope == "ask" and not req.request.strip():
        return {"reason": ASK_FIRST}
    out = assist_code(req.scope, editor_text=req.typed, canvas=req.canvas, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    if out.show and req.present:
        # Shown on the view by the chat, not typed here: what was said, and the request for it.
        return {"reason": out.closing or SHOWING, "show": out.show}
    # The canvas is focus mode's alone.
    if not req.canvas:
        for step in out.steps:
            step.draw, step.erase_marks = [], []
    # An answer is judged, whatever the model sent with it: nothing is typed.
    answered = bool(req.scope == "ask" and req.last_said.strip() and out.answered)
    if answered:
        word = out.closing or " ".join(s.say for s in out.steps)
        return {"reason": word or NO_STEPS, "answered": True}
    hinting = req.scope == "pair" and req.hint_level != "direct"
    if hinting and not out.steps and not out.closing:
        return {"quiet": True}   # nothing to say at this level: the learner carries on
    if not out.steps:
        # A fix with nothing to fix, or a question with nothing to type: the answer is all there is.
        if req.scope in ("fix", "ask", "narrate", "pair") and out.closing:
            # Pairing's last word: whether the code is now done and right, for the editor to show.
            return {"reason": out.closing, **({"complete": True} if req.scope == "pair" and out.complete else {})}
        return {"reason": NOTHING_TO_FIX if req.scope == "fix" else NO_STEPS}
    if hinting:
        for step in out.steps:
            within_hint_level(step, req.hint_level, req.typed)
    elif req.scope == "pair":
        for step in out.steps:
            if step.code:
                code, rewritten = keep_their_lines(step.code, req.typed, set(step.erase))
                step.code = only_starts(at_cursor(code, req.typed, req.cursor), req.typed, req.expected, rewritten)
    log.info("%s %s: %d step(s)", LOG_TAG, req.scope, len(out.steps))
    return {"result": out.model_dump(exclude={"error"})}
