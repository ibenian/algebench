"""What the alternatives expert is told: two solutions to the same problem, compared side by side. Which functions are
alternatives is the lesson's to say (``codeFiles[].alternatives``), with what to bring out in comparing them (`focus`).

Unlike ``code_compare`` (the learner's code against the original it was typed from, a check of their work), nothing
here is being marked: two working solutions, or a learner's own version, are set side by side to see how the approaches
differ, and when each is the better choice. Every input is ``str``. The ``desc``s are prompt surface.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.code_assist.canvas import CanvasMark


class AltMatch(BaseModel):
    """One logical part: the lines on the left doing a job and the lines on the right doing that job, or its counterpart."""

    model_config = ConfigDict(extra="ignore")

    left_from: int = Field(default=0, description="the first line of `left` in this part; 0 when only the right has this part")
    left_to: int = Field(default=0, description="its last line; the same as `left_from` for one line")
    right_from: int = Field(default=0, description="the first line of `right` in this part; 0 when only the left has this part")
    right_to: int = Field(default=0, description="its last line; the same as `right_from` for one line")
    verdict: str = Field(description='"same": the same code. "equivalent": the same thing written differently (other names, an '
                                     'equal expression). "different": the same job done another way, where the two approaches part. '
                                     '"only_left": a job only the left one has. "only_right": a job only the right one has')
    comment: str = Field(default="", description="on this part, about 15 words at most: how the two differ here and what that "
                                                 'buys or costs. Empty for "same"')


class AltPointing(BaseModel):
    """The laser: where to point while talking."""

    model_config = ConfigDict(extra="ignore")

    side: str = Field(default="right", description='"left" or "right"')
    line: int = Field(default=0, description="the line on that side, numbered as in its input; 0 for none")
    text: str = Field(default="", description="the piece of that line to light, copied character for character; empty for the whole line")


class AltStep(BaseModel):
    """One thing worth saying about the two approaches."""

    model_config = ConfigDict(extra="ignore")

    say: str = Field(description="said aloud: one or two short sentences (about 30 words at most) on this one point")
    point: AltPointing = Field(default_factory=AltPointing, description="what to point at with the laser as you say it")


class AltCanvasStep(AltStep):
    """A step that can also draw. Without the code canvas the comparer isn't told of these."""

    draw: list[CanvasMark] = Field(default_factory=list, description="marks on the right side, in its line numbers")
    draw_left: list[CanvasMark] = Field(default_factory=list, description="marks on the left side, in its line numbers; "
                                                                          "circle, underline, box, check, cross or arrow only")


_SIDES = """The two sides are named. One may be "your code", the learner's own version: talk to them as "you". If a side has a
bug, say so plainly where it matters, but the comparison is about the approaches, not a mark for their work."""


class CompareAlternativesSig(dspy.Signature):
    """You set two alternative solutions side by side for a learner, as a diff that understands code, and talk them
    through how the approaches differ. Neither is the original and neither is being checked: both are ways to do the job.

    `focus` is what the lesson says about these approaches and what it wants brought out: let it steer which differences
    you walk through, but judge the code as it is written.

    Compare by meaning, not by characters. Work out the logical parts of each: what job each line or group of lines does.
    Then match each part of the left to the part of the right doing that job, or its counterpart in the other approach
    (a recursive call against a push onto a stack, a visited set against a colour array), wherever it is.

    `matches` is the diff. Each is one logical part: a run of lines on the left and a run on the right. Keep parts small
    and local: the function header, each initialization, each loop header, each `if` or `else`, each statement in a body.
    Lines share a part only when they are one thought, or when one side does in one line what the other does in several.
    Every non-blank line of both sides belongs to exactly one match. Parts may cross.

    `steps` walk through the differences that matter, most important first: the core idea each one rests on, where the
    approaches part, what each costs in time and space, what each handles that the other doesn't. At most four, each on
    one point, each pointing at the code it is about. Naming and style don't earn a step.

    `takeaways` come after the walk: two or three short points on when to reach for which. `summary` opens with one
    sentence on how the two relate. `closing` ends with one sentence handing over to the learner's questions.

    Everything you say is spoken: short plain sentences. Never read code out symbol by symbol."""

    language: str = dspy.InputField(desc="the programming language")
    focus: str = dspy.InputField(desc="from the lesson: the problem both solve, each side's approach, and what to bring out; may be empty")
    left_name: str = dspy.InputField(desc="what the left side is")
    left: str = dspy.InputField(desc="the left side's code, with line numbers")
    right_name: str = dspy.InputField(desc="what the right side is")
    right: str = dspy.InputField(desc="the right side's code, with line numbers")
    recent_turns: str = dspy.InputField(desc="the last few exchanges with the learner, oldest first; may be empty")

    summary: str = dspy.OutputField(desc="one sentence, said first, on how the two approaches relate")
    matches: list[AltMatch] = dspy.OutputField(desc="the logical parts, small and local, every non-blank line of both sides in exactly one")
    steps: list[AltStep] = dspy.OutputField(desc="the differences that matter, in order of importance")
    takeaways: list[str] = dspy.OutputField(desc="two or three short points on when to choose which, each one sentence of about 20 words at most")
    closing: str = dspy.OutputField(desc="one sentence, said last, inviting questions")


class AltAskSig(dspy.Signature):
    """A learner is looking at two alternative solutions side by side, with your comparison of them, and asks you about
    them. Answer what they ask, and no more, in the terms of these two pieces of code.

    `about`, when not empty, is the part they pressed the AI button on: their question is about that part. Words that
    refer back ("why not?") mean what `recent_turns` was about.

    When pointing at the code helps, `steps` say the answer piece by piece, each pointing at what it is about; at most three.
    A short answer needs no steps: `answer` holds it all. With steps, `answer` is one sentence that finishes it.

    Everything you say is spoken: short plain sentences. Never read code out symbol by symbol."""

    language: str = dspy.InputField(desc="the programming language")
    focus: str = dspy.InputField(desc="from the lesson: the problem both solve, each side's approach, and what to bring out; may be empty")
    left_name: str = dspy.InputField(desc="what the left side is")
    left: str = dspy.InputField(desc="the left side's code, with line numbers")
    right_name: str = dspy.InputField(desc="what the right side is")
    right: str = dspy.InputField(desc="the right side's code, with line numbers")
    comparison: str = dspy.InputField(desc="your comparison: each logical part, its lines on both sides, its verdict and comment")
    about: str = dspy.InputField(desc="the part they asked about; may be empty")
    question: str = dspy.InputField(desc="what they asked")
    recent_turns: str = dspy.InputField(desc="the last few exchanges with the learner, oldest first; may be empty")

    steps: list[AltStep] = dspy.OutputField(desc="the answer said piece by piece, each pointing at its code; may be empty")
    answer: str = dspy.OutputField(desc="the answer, or with steps one sentence finishing it")


NO_RUNNING = "Code can't be run here: never suggest running, executing or testing it. To check code, trace it by hand."

CANVAS_RULES = """You can also draw on the code as you talk, as a teacher at a board: `draw` on the right side, `draw_left` on the
left. Each step that is about particular code draws on it: ring the counterpart pieces on both sides, box a block, an
arrow from a line to the line it leads to, a few words beside a line of the right side (a value at that point). A few
marks that say one thing. A step's marks replace the last step's, so draw again what you still mean."""

CompareAlternativesSig = CompareAlternativesSig.with_instructions(f"{CompareAlternativesSig.instructions}\n\n{_SIDES}\n\n{NO_RUNNING}")
AltAskSig = AltAskSig.with_instructions(f"{AltAskSig.instructions}\n\n{_SIDES}\n\n{NO_RUNNING}")

#: The same comparer with the code canvas: only this one hears of drawing.
CompareAlternativesCanvasSig = (CompareAlternativesSig.with_instructions(f"{CompareAlternativesSig.instructions}\n\n{CANVAS_RULES}")
                                .with_updated_fields("steps", type_=list[AltCanvasStep]))
AltAskCanvasSig = (AltAskSig.with_instructions(f"{AltAskSig.instructions}\n\n{CANVAS_RULES}")
                   .with_updated_fields("steps", type_=list[AltCanvasStep]))

COMPARE_FIELDS = tuple(CompareAlternativesSig.input_fields)
ASK_FIELDS = tuple(AltAskSig.input_fields)
