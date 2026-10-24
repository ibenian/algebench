"""The coach's signature: what it is told, and what it must answer.

Every input is ``str`` (see ``handlers/code_practice/handler.py``). The
``desc``s are prompt surface, written for the model.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field


class LineNote(BaseModel):
    """A remark on one line of what the learner typed."""

    model_config = ConfigDict(extra="ignore")

    line: int = Field(description="the line number in the learner's code, from 1")
    note: str = Field(description="one short sentence on what is wrong or missing on that line")


class CodePracticeSig(dspy.Signature):
    """Coach a learner who is typing a piece of code from memory, one section at
    a time, while a lesson teaches the algorithm it implements.

    `expected` is the code they are reproducing; `section` names the part they
    are working on now (or is empty, when the whole of `expected` is the
    target). `typed` is what they have written so far: judge the part that
    corresponds to `section`, and treat what follows it as not yet written,
    never as a mistake.

    Judge MEANING, not spelling: a different variable name, a different but
    equivalent loop, or a reordered independent statement can be fully correct.
    A missing step, a wrong condition, an off-by-one bound, or a bug the
    expected code avoids is not.

    Teach; don't hand over the answer. `direction` says what to think about or
    write next in words, and quotes code only when the learner has clearly
    stalled on the same line (`attempts` counts the reviews of this section).
    """

    language: str = dspy.InputField(desc="the programming language")
    expected: str = dspy.InputField(desc="the reference code, with line numbers")
    section: str = dspy.InputField(
        desc="the section being typed: its title, hint and reference lines; may be empty")
    typed: str = dspy.InputField(desc="what the learner has typed so far, with line numbers")
    match: str = dspy.InputField(
        desc="how closely each typed line matches the reference, measured by text alone")
    attempts: str = dspy.InputField(desc="how many times this section has been reviewed before")

    score: int = dspy.OutputField(
        desc="0 to 100: how correct and complete the typed code is for the section, by meaning")
    verdict: str = dspy.OutputField(
        desc="one of: correct, close, partial, off_track, empty")
    commentary: str = dspy.OutputField(
        desc="two or three sentences to the learner on what they got right and what is off; "
             "markdown, code in backticks")
    direction: str = dspy.OutputField(
        desc="one or two sentences on what to do next; empty when the section is correct")
    line_notes: list[LineNote] = dspy.OutputField(
        desc="remarks on specific typed lines that are wrong; empty when none are")


INPUT_FIELDS = tuple(CodePracticeSig.input_fields)
