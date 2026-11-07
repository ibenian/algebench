"""What the comparer is told, and the structured diff and walk-through it answers with.

Every input is ``str`` (see ``handlers/code_compare/handler.py``). The ``desc``s are prompt surface, written for the model.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.modules.code_assist.canvas import CanvasMark


class CompareMatch(BaseModel):
    """One logical part: lines of the original and the lines of the learner's code doing that job, wherever they are."""

    model_config = ConfigDict(extra="ignore")

    original_from: int = Field(default=0, description="the first line of `original` in this part; 0 when the learner's lines match nothing there")
    original_to: int = Field(default=0, description="its last line; the same as `original_from` for one line")
    yours_from: int = Field(default=0, description="the first line of `typed` doing this job; 0 when their code has nothing for it")
    yours_to: int = Field(default=0, description="its last line; the same as `yours_from` for one line")
    verdict: str = Field(description='"exact": the same code. "equivalent": logically the same, written differently (their own '
                                     'names, an equal expression, an order that makes no difference). "alternate": a different way '
                                     'that also works, as part of another valid solution. "incorrect": it does not do what this part '
                                     'must. "missing": the original\'s lines have nothing doing their job in the learner\'s code. '
                                     '"extra": their lines have no job in the original')
    comment: str = Field(default="", description="on this part, about 15 words at most: what differs and why it matters. Empty for "
                                                 '"exact". Spoken to the learner: "you", never "the learner"')


class Pointing(BaseModel):
    """The laser: where to point while talking."""

    model_config = ConfigDict(extra="ignore")

    side: str = Field(default="yours", description='"yours" for the learner\'s code, "original" for the original')
    line: int = Field(default=0, description="the line on that side, numbered as in its input; 0 for none")
    text: str = Field(default="", description="the piece of that line to light, copied character for character; empty for the whole line")


class CompareStep(BaseModel):
    """One thing worth saying about the comparison."""

    model_config = ConfigDict(extra="ignore")

    say: str = Field(description="said aloud: one or two short sentences (about 30 words at most) on this one point")
    point: Pointing = Field(default_factory=Pointing, description="what to point at with the laser as you say it")


class CompareCanvasStep(CompareStep):
    """A step that can also draw. Without the code canvas the comparer isn't told of these."""

    draw: list[CanvasMark] = Field(default_factory=list, description="marks on the learner's code (right side), in their line numbers")
    draw_original: list[CanvasMark] = Field(default_factory=list, description="marks on the original (left side), in its line numbers; "
                                                                              "circle, underline, box, check, cross or arrow only")


class CodeCompareSig(dspy.Signature):
    """You compare a learner's code with the original it was written from, as a diff that understands code. The learner
    typed theirs from memory and now sees the two side by side, for the first time, with you talking them through it.

    Compare by meaning, not by characters. Work out the logical parts of each: what job each line or group of lines does
    in its program. Then match each part of theirs to the part of the original doing that job, wherever it is: lines
    may be in another order, several lines may do what one does, and one may do what several do. Consistent names of
    their own are fine. A different approach that works is not an error: mark it "alternate" and say so.

    `matches` is the diff. Each is one logical part: a run of lines on the original side and a run of lines on theirs. Keep
    parts small and local, so the learner sees many precise matches and not one big block. The function header is a part;
    so is each initialization, each loop header, each `if` or `else`, and each statement in a body. A loop's or a branch's
    header is apart from its body. Lines share a part only when they are one thought that can't be judged line by line
    (two or three at most, say a swap written over several lines), or when one side does in one line what the other does in
    several. Neighbours with the same verdict are still separate parts. Every non-blank line of `original` and of `typed` belongs to exactly one match. Parts may cross: the
    original's lines 2-3 can match their lines 7-9. A part out of order is judged by whether the order matters: where it
    makes no difference it is "equivalent", and where it changes the result it is "incorrect", the comment saying why. A
    part that is right but in the wrong block is "incorrect" too. A part doing two jobs, one right and one wrong, is split.

    `steps` walk through only the issues that matter most, most important first: a bug, a wrong bound, a step missing, an
    idea misunderstood. At most five, each on one point, each pointing at the code it is about. Naming and style don't
    earn a step, and the matches already say what each part is. When theirs does what the original does, set `same_behaviour`
    true and give no steps, or one step on an alternate approach that is worth seeing.

    `debrief` comes after the walk: two to four short points to take away from this comparison, about understanding rather
    than lines: the idea they have firmly, the idea they missed or half have, what to watch for next time. It doesn't
    repeat the steps, and it doesn't flatter.

    `summary` opens: one sentence on how close it is. `closing` ends: one sentence on what to do next, for instance
    what to go back and fix. Don't dictate the fixes line by line: they can now see the original.

    Everything you say is spoken: short plain sentences, "you" and "your code". Never read code out symbol by symbol."""

    language: str = dspy.InputField(desc="the programming language")
    original: str = dspy.InputField(desc="the original code, with line numbers")
    typed: str = dspy.InputField(desc="the learner's code, with line numbers")
    recent_turns: str = dspy.InputField(desc="the last few exchanges with the learner on this code, oldest first; may be empty")

    same_behaviour: bool = dspy.OutputField(desc="true when the learner's code does what the original does, for every input")
    summary: str = dspy.OutputField(desc="one sentence, said first, on how close their code is")
    matches: list[CompareMatch] = dspy.OutputField(desc="the logical parts, small and local, every non-blank line of both sides in exactly one")
    steps: list[CompareStep] = dspy.OutputField(desc="the issues that matter most, in order of importance")
    debrief: list[str] = dspy.OutputField(desc="two to four short points to take away, each one sentence of about 20 words at most")
    closing: str = dspy.OutputField(desc="one sentence, said last, handing the keyboard back")


class CompareAskSig(dspy.Signature):
    """A learner is looking at their code beside the original it was written from, with your comparison of the two, and asks
    you about it. Answer what they ask, and no more, in the terms of these two pieces of code. The original is on their
    screen, so you can talk about it freely.

    `about`, when not empty, is the part they pressed the AI button on: their question is about that part. Words that
    refer back ("why not?") mean what `recent_turns` was about. Asked to explain a difference, explain your verdict on that part:
    what the original's lines do there, what theirs do, and why that makes it the verdict it is, not its comment said again.

    When pointing at the code helps, `steps` say the answer piece by piece, each pointing at what it is about; at most three.
    A short answer needs no steps: `answer` holds it all. With steps, `answer` is one sentence that finishes it.

    Everything you say is spoken: short plain sentences, "you" and "your code". Never read code out symbol by symbol."""

    language: str = dspy.InputField(desc="the programming language")
    original: str = dspy.InputField(desc="the original code, with line numbers")
    typed: str = dspy.InputField(desc="the learner's code, with line numbers")
    comparison: str = dspy.InputField(desc="your comparison: each logical part, its lines on both sides, its verdict and comment")
    about: str = dspy.InputField(desc="the part they asked about; may be empty")
    question: str = dspy.InputField(desc="what they asked")
    recent_turns: str = dspy.InputField(desc="the last few exchanges with the learner on this code, oldest first; may be empty")

    steps: list[CompareStep] = dspy.OutputField(desc="the answer said piece by piece, each pointing at its code; may be empty")
    answer: str = dspy.OutputField(desc="the answer, or with steps one sentence finishing it")


CANVAS_RULES = """You can also draw on the code as you talk, as a teacher at a board: `draw` on their code, `draw_original` on the
original. Each step that is about particular code draws on it: ring the name or expression that differs on both sides,
box the lines of a block that belongs elsewhere, a cross on what is wrong, a check on what is right, an arrow from a line
to the line it needs, a few words beside a line of their code (a value at that point). A few marks that say one thing. A
step's marks replace the last step's, so draw again what you still mean."""

#: The same comparer with the code canvas: only this one hears of drawing.
CodeCompareCanvasSig = (CodeCompareSig.with_instructions(f"{CodeCompareSig.instructions}\n\n{CANVAS_RULES}")
                        .with_updated_fields("steps", type_=list[CompareCanvasStep]))

CompareAskCanvasSig = (CompareAskSig.with_instructions(f"{CompareAskSig.instructions}\n\n{CANVAS_RULES}")
                       .with_updated_fields("steps", type_=list[CompareCanvasStep]))

INPUT_FIELDS = tuple(CodeCompareSig.input_fields)
ASK_FIELDS = tuple(CompareAskSig.input_fields)
