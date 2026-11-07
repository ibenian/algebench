"""Inputs -> the pair programmer's steps. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import difflib
import logging
import re
import textwrap
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.util.model_errors import model_error_message

from .canvas import clean_marks
from .signature import AssistStep, CanvasStep, CodeAssistCanvasSig, CodeAssistSig

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")
_FENCE = re.compile(r"^\s*```[\w+-]*\n(.*?)\n?```\s*$", re.S)
#: The numbering the model is shown its inputs in ("  3 | code", "+   3 | code"), copied back by mistake.
_NUMBERED = re.compile(r"^[+ ]?\s*\d+ \| ?")

MAX_STEPS = 14
#: How many steps each scope may take: "next" is one move (and a fix before it).
STEP_LIMIT = {"next": 2, "section": MAX_STEPS, "all": MAX_STEPS, "fix": MAX_STEPS, "ask": MAX_STEPS, "narrate": MAX_STEPS, "pair": 1}

#: The learner waits with the keyboard handed over: answer quickly.
_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't take the keyboard this time. Try Help me again."


class CodeAssist(BaseModel):
    plan: str = ""
    steps: list[CanvasStep] = Field(default_factory=list)
    closing: str = ""
    #: The model's word that the learner's code is complete and correct.
    complete: bool = False
    #: The model's word that this pairing turn points at code to fix first: Finish does that fix before the line.
    needs_fix: bool = False
    #: The learner's words were their answer to what the assistant said: judged, nothing written.
    answered: bool = False
    #: The learner asked for a comparison with the reference: the editor's Compare does that, not these steps.
    compare: bool = False
    #: A request to the lesson's AI chat to show the idea on the scene or its scratchpad, instead of steps here.
    show: str = ""
    #: Set when the CALL failed, so a crash isn't played as help.
    error: str = ""


class Assistant(dspy.Module):
    def __init__(self, signature=CodeAssistSig):
        super().__init__()
        self.predict = dspy.Predict(signature)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter(restore_first_header=True)):
            return self.predict(**inputs)


@cache
def _assistant(canvas: bool = False) -> Assistant:
    return Assistant(CodeAssistCanvasSig if canvas else CodeAssistSig)


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def _request(text) -> str:
    """A request to another AI, empty when the model wrote a null for "no request" ("None", "null")."""
    text = _clean(text)
    return "" if text.casefold() in {"none", "null", "n/a"} else text


def clean_code(code: str) -> str:
    """A step's editor text: no fences, no line numbers copied from the inputs, no trailing spaces, no blank lines
    at the end."""
    code = _DSPY_MARKER.sub("", str(code or ""))
    m = _FENCE.match(code)
    if m:
        code = m.group(1)
    lines = code.split("\n")
    marks = [m for m in (_NUMBERED.match(line) for line in lines) if m]
    # Numbered 1, 2, 3... in order: the numbering was copied. The numbers go, and a line added without one (a
    # comment under them) loses as much indent.
    if marks and [int(m.group(0).strip(" +|")) for m in marks] == list(range(1, len(marks) + 1)):
        pad = " " * len(marks[0].group(0))
        code = "\n".join(_NUMBERED.sub("", line, count=1) if _NUMBERED.match(line)
                         else line[len(pad):] if line.startswith(pad) else line for line in lines)
        # A space too many after each "|" leaves every line indented by it: code has a line at the margin, so the
        # indent all lines share is the copy's, not the code's.
        code = textwrap.dedent(code)
    return "\n".join(line.rstrip() for line in code.replace("\t", "    ").split("\n")).strip("\n")


def keep_lines(code: str, before: str, erase: frozenset[int] | set[int] = frozenset()) -> str:
    """``code`` with every line that is, spacing aside, a line of ``before`` (in the same order) taken from
    ``before`` as it is. A step's code is the whole editor, copied by the model: copying, it may re-indent or
    re-space the learner's lines, which would then be erased and retyped. Only what it really changed is typed.

    But indentation is code: a line moved in or out of a block is a real change. It stays when the step lists it in
    ``erase``, or when only some lines moved. Most of them moved is the copy's doing, not a fix."""
    if not code or not before:
        return code
    new, old = code.split("\n"), before.split("\n")
    out = list(new)
    indent = lambda line: line[:len(line) - len(line.lstrip())]
    matcher = difflib.SequenceMatcher(None, [l.strip() for l in old], [l.strip() for l in new], autojunk=False)
    pairs = [(a + k, b + k) for a, b, size in matcher.get_matching_blocks() for k in range(size) if old[a + k].strip()]
    moved = {(a, b) for a, b in pairs if indent(old[a]) != indent(new[b])}
    meant = len(moved) * 2 <= len(pairs)
    for op, a1, _, b1, b2 in matcher.get_opcodes():
        if op == "equal":
            out[b1:b2] = old[a1:a1 + b2 - b1]
    for a, b in moved:
        if meant or a + 1 in erase:
            out[b] = new[b]
    return "\n".join(out)


def keep_unerased(code: str, before: str, erase: set[int]) -> str:
    """``code`` with the lines of ``before`` it drops put back, unless ``erase`` lists them (numbered from 1): a step
    sending only its new line (pairing's next line) must not wipe the learner's code, though a step may erase a line
    on purpose. A dropped line that a new line in its place resembles was rewritten, not dropped; a blank one goes."""
    if not code or not before:
        return code
    old, new = before.split("\n"), code.split("\n")
    out: list[str] = []
    matcher = difflib.SequenceMatcher(None, [l.strip() for l in old], [l.strip() for l in new], autojunk=False)
    for op, a1, a2, b1, b2 in matcher.get_opcodes():
        if op in ("delete", "replace"):
            out += [line for k, line in enumerate(old[a1:a2], a1 + 1) if line.strip() and k not in erase
                    and not any(difflib.SequenceMatcher(None, line.strip(), n.strip()).ratio() >= .6 for n in new[b1:b2])]
        if op != "delete":
            out += new[b1:b2]
    return "\n".join(out)


def clean_steps(raw, *, talk_only: bool = False, drafts: bool = True, editor: str = "") -> list[AssistStep]:
    """The model's steps made safe to play: code cleaned, the learner's lines kept as they typed them (``editor``,
    the editor before the first step), talk with nothing typed or pointed at joined to the step before, drafts kept
    only as slips caught. ``talk_only``: the steps type nothing (they select and talk)."""
    steps: list[AssistStep] = []
    before = editor
    for s in raw or []:
        if not isinstance(s, AssistStep):
            continue
        code, select = clean_code(s.code), str(s.select or "").strip("\n")
        if talk_only:
            code = ""
        erase = {int(k) for k in (s.erase or []) if str(k).lstrip("-").isdigit()}
        if code:
            code = keep_lines(keep_unerased(code, before, erase), before, erase)
        # Typing nothing and pointing at nothing is talk alone: it joins the step before.
        typed_nothing = not code or (steps and code == steps[-1].code)
        marks = clean_marks(getattr(s, "draw", None))
        gone = [str(name).strip() for name in (getattr(s, "erase_marks", None) or []) if str(name).strip()]
        if steps and typed_nothing and not select and not marks and not gone:
            steps[-1].explain = " ".join(filter(None, [steps[-1].explain, _clean(s.say), _clean(s.explain)]))
            continue
        draft = keep_lines(keep_unerased(clean_code(s.draft), before, erase), before, erase) if s.draft else ""
        if code:
            before = code
        # A draft is a slip caught: one that is the fix already, or comes with nothing noticed, is no draft.
        keep = drafts and code and draft and draft != code and _clean(s.notice)
        try:
            line = max(0, int(s.select_line or 0)) if select else 0
        except (TypeError, ValueError):
            line = 0
        steps.append(CanvasStep(say=_clean(s.say), code=code, draw=marks, erase_marks=gone, erase=sorted(erase), select=select, select_line=line, explain=_clean(s.explain),
                                cursor_line=max(0, int(s.cursor_line or 0)), draft=draft if keep else "", notice=_clean(s.notice) if keep else ""))
    return steps


def partial_steps(raw, editor: str) -> list[int]:
    """The steps (from 1) whose code leaves out lines of the editor before them that their ``erase`` doesn't list:
    part of the editor sent for the whole of it."""
    out, before = [], editor
    for k, s in enumerate(raw or [], 1):
        if not isinstance(s, AssistStep) or not clean_code(s.code):
            continue
        code = clean_code(s.code)
        erase = {int(n) for n in (s.erase or []) if str(n).lstrip("-").isdigit()}
        if keep_unerased(code, before, erase) != code:
            out.append(k)
        before = code
    return out


def assist_code(scope: str, editor_text: str = "", canvas: bool = False, **inputs) -> CodeAssist:
    """Ask the model for the steps; one more ask if the answer was malformed, or sent part of the editor for the
    whole of it (the code must stay whole: lines leave only when a step erases them on purpose)."""
    try:
        out = retry_on_parse_error(lambda: _assistant(canvas)(scope=scope, **inputs), label="code_assist")
        partial = [] if scope == "narrate" else partial_steps(out.steps, editor_text)
        if partial:
            log.info("code_assist: step(s) %s sent part of the editor; asking again", partial)
            again = {**inputs, "request": "\n".join(filter(None, [inputs.get("request", ""),
                     f"(Your last answer's step(s) {', '.join(map(str, partial))} left out lines of the editor without "
                     "listing them in `erase`. Each step's `code` must be the WHOLE editor: every line, changed only "
                     "where the step types.)"]))}
            out = retry_on_parse_error(lambda: _assistant(canvas)(scope=scope, **again), label="code_assist")
    except Exception as e:
        log.exception("code_assist: the model call failed")
        return CodeAssist(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    # Narrating types nothing; a fix shows the fix, not a new slip on the way to it.
    steps = clean_steps(out.steps, talk_only=scope == "narrate", drafts=scope not in ("fix", "narrate", "pair"), editor=editor_text)
    return CodeAssist(plan=_clean(out.plan), steps=steps[:STEP_LIMIT.get(scope, MAX_STEPS)], closing=_clean(out.closing),
                      complete=bool(getattr(out, "complete", False)), needs_fix=bool(getattr(out, "needs_fix", False)), answered=bool(getattr(out, "answered", False)), compare=getattr(out, "compare", False) is True, show=_request(getattr(out, "show", "")))
