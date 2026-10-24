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

    `hints` says whether the learner wants that guidance. When it is "off",
    review only the lines already typed: leave `direction` empty, and in
    `commentary` never name what is missing, what comes next, or what the
    section still needs; say only what is right or wrong in what is there. When it is "on" and nothing is
    typed yet, `commentary` sets the learner off: what the code must achieve
    first, and how to begin, still without the code itself.

    `changes` is what the learner typed since your last review. On the first
    review, review everything typed. After that, review ONLY the changed lines,
    marked `+` in `typed`: `commentary` and `line_notes` are about them alone,
    in one or two sentences; never sum up the code as a whole. The rest was
    reviewed already, so don't praise, restate or re-check it; read it only
    for context (a changed line may fix or break what is around it). `score`
    still rates the whole section. When `changes` says nothing changed, the
    learner asked again: review the section as a whole.

    The learner talks to you through comments in their code (`notes`): they
    may explain their thinking, guess, or ask a question. `notes` holds only
    the NEW ones; other comments in `typed` were answered before, so leave
    them be. Answer each new note in `reply` (empty when `notes` is), as a patient tutor: confirm or gently correct an
    explanation, and answer a question so they understand WHY, with an
    example, an analogy, or a question that leads them to it. A question is
    a request for help, so answer it even with hints off, but explain the idea
    rather than writing their code for them. Never count a note as a mistake
    in the code.
    """

    language: str = dspy.InputField(desc="the programming language")
    expected: str = dspy.InputField(desc="the reference code, with line numbers")
    section: str = dspy.InputField(
        desc="the section being typed: its title, hint and reference lines; may be empty")
    typed: str = dspy.InputField(
        desc="what the learner has typed so far, with line numbers; on a follow-up review the lines "
             "changed since the last one are marked +, and only those are reviewed")
    match: str = dspy.InputField(
        desc="how closely each typed line matches the reference, measured by text alone")
    attempts: str = dspy.InputField(desc="how many times this section has been reviewed before")
    hints: str = dspy.InputField(desc="on: guide the next step; off: comment only on what is typed")
    changes: str = dspy.InputField(
        desc="what changed in the typed code since your last review, as + added and - removed lines; "
             "'first review' when there was none. After the first review, comment ONLY on these lines")
    notes: str = dspy.InputField(
        desc="the learner's new comments, by line (after the first review only those on changed lines): "
             "explanations or questions to you; may be empty")

    score: int = dspy.OutputField(
        desc="0 to 100: how correct and complete the typed code is for the section, by meaning")
    verdict: str = dspy.OutputField(
        desc="one of: correct, close, partial, off_track, empty")
    commentary: str = dspy.OutputField(
        desc="two or three sentences to the learner on what they got right and what is off (on a follow-up, "
             "one or two about the + lines only); "
             "with hints off, only about the typed lines, never what is still to write; "
             "markdown, code in backticks")
    direction: str = dspy.OutputField(
        desc="one or two sentences on what to do next; empty when the section is correct or hints are off")
    reply: str = dspy.OutputField(
        desc="your answer to the learner's notes, two to four sentences, addressing them directly; "
             "markdown, code in backticks; empty when there are no notes")
    line_notes: list[LineNote] = dspy.OutputField(
        desc="remarks on specific typed lines that are wrong; empty when none are")


INPUT_FIELDS = tuple(CodePracticeSig.input_fields)
