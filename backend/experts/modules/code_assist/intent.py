"""Inputs -> the pair programmer's steps. The one place an LM is called.

Requires DSPy to be configured first (``init_experts()`` / ``configure_dspy()``).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from pydantic import BaseModel, Field

from backend.experts.llm_config import make_adapter, retry_on_parse_error, scoped_lm
from backend.util.model_errors import model_error_message

from .signature import AssistStep, CodeAssistSig

log = logging.getLogger(__name__)

_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")
_FENCE = re.compile(r"^\s*```[\w+-]*\n(.*?)\n?```\s*$", re.S)

MAX_STEPS = 14
#: How many steps each scope may take: "next" is one move (and a fix before it).
STEP_LIMIT = {"next": 2, "section": MAX_STEPS, "all": MAX_STEPS, "fix": MAX_STEPS, "ask": MAX_STEPS, "narrate": MAX_STEPS}

#: The learner waits with the keyboard handed over: answer quickly.
_LM = scoped_lm(reasoning_effort="low")

CALL_FAILED = "I couldn't take the keyboard this time. Try Help me again."


class CodeAssist(BaseModel):
    plan: str = ""
    steps: list[AssistStep] = Field(default_factory=list)
    closing: str = ""
    #: Set when the CALL failed, so a crash isn't played as help.
    error: str = ""


class Assistant(dspy.Module):
    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(CodeAssistSig)

    def forward(self, **inputs):
        with _LM(), dspy.context(adapter=make_adapter()):
            return self.predict(**inputs)


@cache
def _assistant() -> Assistant:
    return Assistant()


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def clean_code(code: str) -> str:
    """A step's editor text: no fences, no trailing spaces, no blank lines at the end."""
    code = _DSPY_MARKER.sub("", str(code or ""))
    m = _FENCE.match(code)
    if m:
        code = m.group(1)
    return "\n".join(line.rstrip() for line in code.replace("\t", "    ").split("\n")).strip("\n")


def assist_code(scope: str, **inputs) -> CodeAssist:
    """Ask the model for the steps; one more ask if the answer was malformed."""
    try:
        out = retry_on_parse_error(lambda: _assistant()(scope=scope, **inputs), label="code_assist")
    except Exception as e:
        log.exception("code_assist: the model call failed")
        return CodeAssist(error=model_error_message(e) or f"{CALL_FAILED} ({type(e).__name__})")
    steps = []
    for s in out.steps or []:
        if not isinstance(s, AssistStep):
            continue
        code, select = clean_code(s.code), str(s.select or "").strip("\n")
        # Narrating types nothing: its steps only select and talk.
        if scope == "narrate":
            code = ""
        # Typing nothing and pointing at nothing is talk alone: it joins the step before.
        typed_nothing = not code or (steps and code == steps[-1].code)
        if steps and typed_nothing and not select:
            steps[-1].explain = " ".join(filter(None, [steps[-1].explain, _clean(s.say), _clean(s.explain)]))
            continue
        draft = clean_code(s.draft) if s.draft else ""
        # A draft is a slip caught: one that is the fix already, or comes with nothing noticed, is no draft.
        # A fix shows the fix, not a new slip on the way to it.
        keep = scope not in ("fix", "narrate") and code and draft and draft != code and _clean(s.notice)
        try:
            line = max(0, int(s.select_line or 0)) if select else 0
        except (TypeError, ValueError):
            line = 0
        steps.append(AssistStep(say=_clean(s.say), code=code, select=select, select_line=line, explain=_clean(s.explain),
                                draft=draft if keep else "", notice=_clean(s.notice) if keep else ""))
    return CodeAssist(plan=_clean(out.plan), steps=steps[:STEP_LIMIT.get(scope, MAX_STEPS)], closing=_clean(out.closing))
