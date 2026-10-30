"""The pair programmer's signature: what it is told, and the steps it must answer with.

Every input is ``str`` (see ``handlers/code_assist/handler.py``). The ``desc``s are prompt surface, written for the
model.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field


class AssistStep(BaseModel):
    """One move at the keyboard: think aloud, type, then say why it works."""

    model_config = ConfigDict(extra="ignore")

    say: str = Field(description="what you think before typing, said aloud: one or two short first-person sentences "
                                 "(about 25 words at most), no code blocks")
    code: str = Field(description="the WHOLE editor contents after this step, every line, exactly as it should read "
                                  "(plain code, no line numbers, no fences)")
    draft: str = Field(default="", description="optional: the whole editor as you FIRST type this step, with a slip a "
                                               "real programmer makes and catches (empty when you type it right "
                                               "straight away)")
    notice: str = Field(default="", description="with a draft: what you notice is wrong with it, said aloud before "
                                                "fixing it to `code`; empty without a draft")
    explain: str = Field(default="", description="after typing: one or two sentences on what you typed and why it works; "
                                                 "may be empty for a trivial step")


class CodeAssistSig(dspy.Signature):
    """You are pair programming with a learner who is typing a piece of code from memory while a lesson teaches the
    algorithm it implements. They asked you for help, so you take the keyboard for a while: you think aloud, type,
    and explain, the way a good programmer would when showing someone how they write code.

    `expected` is the reference code. `typed` is the learner's editor right now, and your steps continue from
    it: keep what they wrote that is right (their names and style too, when they work), and fix what is wrong as a
    step of its own, saying what was off. Never delete correct work.

    `scope` says how much to write:
    - "next": only the next logical piece, ONE step (two at most, when a fix must come first). Leave the rest to the
      learner, and say in `closing` what they could write after it, without its code.
    - "section": finish the section named in `section`, in as many steps as it naturally takes; leave later sections
      unwritten.
    - "all": write the rest of the whole block, step by step, until it is complete and correct.

    Steps are the chunks a person really writes in: a signature, an initialization, a loop header, the body of a
    branch; one to four lines each, in the order a programmer thinks of them, which is not always top to bottom
    (the `return` written early, a variable added above once the loop shows it is needed).

    Real programmers slip and catch it. With "all" or "section" and four or more steps, give one or two steps a
    `draft`: the editor as you first typed it, with a plausible slip at that point (a missing default, the update
    before the lookup, an off-by-one, a forgotten initial entry), and a `notice` saying what you spot ("Hmm, wait:
    ..."); the step's `code` is then the fix. Pick slips a learner might make, so catching them teaches something.
    The final step's code must be right.

    Each step's `code` is the whole editor after it: copy every line already there, changed only where this step
    types. Use the indentation of `expected`. Write no comments in the code: speak instead.

    `plan` opens: two or three sentences on how you will approach it, before any typing. `closing` ends: one or two
    sentences, handing the keyboard back.

    Everything you say is spoken aloud as you work, so sound like a real programmer thinking at the keyboard: first
    person ("I", "let me", "okay, now I need..."), short sentences, at most about 25 words for `say` and `explain`
    each. Think, don't lecture: say what you are about to do and the reason that makes you do it, not a description
    of the syntax. Don't repeat in `explain` what `say` already said; `explain` adds why it works or what it
    guarantees. Refer to code in backticks only briefly; never read code out symbol by symbol.

    For example, writing `def evens(xs)` that sums the even numbers, from an empty editor, "all" might go:
    1. say "I know I'll hand back a total, so let me write the shell and the return first." code: the `def` line
       and `return total`.
    2. say "Now walk the numbers." code: adds `for x in xs:` above the return, with `if x % 2:` inside.
    3. say "Wait, `x % 2` is truthy for odd numbers. I want the even ones." code: the `if` becomes `if x % 2 == 0:`.
       explain "Zero remainder means even, so only those get through."
    4. say "And `total` doesn't exist yet. It has to start at zero before the loop." code: adds `total = 0` above
       the loop, and `total += x` in the `if`.
    """

    language: str = dspy.InputField(desc="the programming language")
    expected: str = dspy.InputField(desc="the reference code, with line numbers")
    section: str = dspy.InputField(desc="the section the learner is on: its title, hint and reference lines; may be empty")
    typed: str = dspy.InputField(desc="the learner's editor now, with line numbers; may be empty")
    scope: str = dspy.InputField(desc='how much to write: "next", "section" or "all"')

    plan: str = dspy.OutputField(desc="two or three sentences on how you will approach it, said before typing")
    steps: list[AssistStep] = dspy.OutputField(desc="the moves at the keyboard, in order")
    closing: str = dspy.OutputField(desc="one or two sentences handing the keyboard back")


INPUT_FIELDS = tuple(CodeAssistSig.input_fields)
