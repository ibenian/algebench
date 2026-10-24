"""``POST /api/expert/code_practice``: a coach's review of code the learner typed.

Returns ``{"result": {score, verdict, commentary, direction, line_notes}}``, or
``{"reason": ...}`` when there is nothing to review or the coach failed. The
text match the learner sees as they type is measured on the client; this adds
the judgement by meaning that text alone can't give.
"""
from __future__ import annotations

import difflib
import logging
import re

from backend.experts.modules.code_practice.intent import review_code
from backend.experts.registry import register_handler

from backend.experts.modules.code_practice.signature import LineNote

from .models import CodePracticeRequest
from .names import undefined_names

log = logging.getLogger(__name__)

LOG_TAG = "[code_practice]"
NOTHING_TYPED = "Type some code first, then ask for a review, or turn on hints for a start."


def _numbered(code: str, first: int = 1, marked: set[int] | None = None) -> str:
    """Numbered lines; with ``marked``, those lines carry ``+`` and the rest a space (a follow-up's focus)."""
    def mark(n: int) -> str:
        return "" if marked is None else ("+ " if n in marked else "  ")
    return "\n".join(f"{mark(first + i)}{first + i:>3} | {line}" for i, line in enumerate(code.split("\n")))


#: A comment: a line that is one (``# …``, ``// …``), or one after code, set off by a space.
_COMMENT = re.compile(r"(?:^|\s)(?:#|//)\s?(.*)$")


def learner_notes(typed: str, only: set[int] | None = None) -> str:
    """The learner's comments, one per line, with the line they are on: what they say to the coach.
    ``only``: just those lines (the ones changed since the last review, so an answered note isn't answered again)."""
    out = []
    for i, line in enumerate(typed.split("\n"), 1):
        if only is not None and i not in only:
            continue
        m = _COMMENT.search(line)
        if m and m.group(1).strip():
            out.append(f"line {i}: {m.group(1).strip()}")
    return "\n".join(out)


FIRST_REVIEW = "first review"
NOTHING_CHANGED = "nothing changed since your last review: review the section as a whole again"


def diff_lines(previous: str, typed: str) -> tuple[list[str], set[int]]:
    """The change since the last review as ``- line n: …`` / ``+ line n: …`` rows (whitespace-only lines
    left out, trailing spaces ignored), and the typed line numbers that are new or changed."""
    before = [t.rstrip() for t in previous.split("\n")]
    after = [t.rstrip() for t in typed.split("\n")]
    rows, added = [], set()
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        if op in ("replace", "delete"):
            rows += [f"- line {a1 + k + 1}: {t}" for k, t in enumerate(before[a1:a2]) if t.strip()]
        if op in ("replace", "insert"):
            for k, t in enumerate(after[b1:b2]):
                if t.strip():
                    rows.append(f"+ line {b1 + k + 1}: {t}")
                    added.add(b1 + k + 1)
    return rows, added


def carried_notes(previous: str | None, typed: str, notes) -> list[LineNote]:
    """The last review's notes still open: on lines unchanged since, renumbered to where those lines are now.
    A note on a changed line is dropped: that line is reviewed afresh."""
    if previous is None or not notes:
        return []
    before = [t.rstrip() for t in previous.split("\n")]
    after = [t.rstrip() for t in typed.split("\n")]
    moved = {}
    for op, a1, a2, b1, _ in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        if op == "equal":
            moved.update({a1 + k + 1: b1 + k + 1 for k in range(a2 - a1)})
    return [LineNote(line=moved[n.line], note=n.note) for n in notes if n.line in moved]


def changes_since(previous: str | None, typed: str) -> str:
    """What changed since the last review, in the typed code's own line numbers."""
    if previous is None:
        return FIRST_REVIEW
    rows, _ = diff_lines(previous, typed)
    return "\n".join(rows) or NOTHING_CHANGED


def changed_lines(previous: str | None, typed: str) -> set[int] | None:
    """The typed lines a follow-up review is about; None when the review covers everything (the first,
    or a re-check with nothing changed)."""
    if previous is None:
        return None
    rows, added = diff_lines(previous, typed)
    return added if rows else None


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
        "typed": _numbered(req.typed, marked=changed_lines(req.previous, req.typed)),
        "match": match or "not measured",
        "attempts": str(req.attempts),
        "hints": "on" if req.hints else "off",
        "notes": learner_notes(req.typed, changed_lines(req.previous, req.typed)),
        "changes": changes_since(req.previous, req.typed),
        "name_issues": "\n".join(f"line {line}: {msg}" for line, msg in undefined_names(req.typed, req.expected, req.language)),
        "open_issues": "\n".join(f"line {n.line}: {n.note}" for n in carried_notes(req.previous, req.typed, req.open_notes)),
    }


@register_handler("code_practice", request_model=CodePracticeRequest)
def code_practice(req: CodePracticeRequest) -> dict:
    if not req.typed.strip() and not req.hints:
        return {"reason": NOTHING_TYPED}
    inputs = render_inputs(req)
    review = review_code(**inputs)
    if review.error:
        return {"reason": review.error}
    if not inputs["notes"]:
        # No new note: comments already answered are not answered again.
        review.reply = ""
    focus = changed_lines(req.previous, req.typed)
    if focus is not None:
        # A follow-up is about what changed: remarks on lines already reviewed are dropped, and the issues
        # still open there are carried over (kept on their lines, hinted at in `reminder`).
        # A name left undefined breaks its line wherever the change was (a parameter renamed above it).
        broken = {line for line, _ in undefined_names(req.typed, req.expected, req.language)}
        fresh = [n for n in review.line_notes if n.line in focus or n.line in broken]
        still = [n for n in carried_notes(req.previous, req.typed, req.open_notes) if n.line not in focus and n.line not in broken]
        review.line_notes = sorted(fresh + still, key=lambda n: n.line)
    if not inputs["open_issues"]:
        review.reminder = ""
    if not req.hints:
        # Asked for no guidance: what to write next is never shown, whatever the model said.
        review.direction = ""
    log.info("%s %s: %d%% (%s), %d note(s)", LOG_TAG, req.section.title if req.section else "whole block",
             review.score, review.verdict, len(review.line_notes))
    return {"result": review.model_dump(exclude={"error"})}
