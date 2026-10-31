"""The presenter's signature: the view it is shown, the targets it may point at, and the steps it answers with.

Every input is ``str`` (see ``handlers/scene_present/handler.py``). The ``desc``s are prompt surface, written for
the model.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field


class PresentStep(BaseModel):
    """One beat of the presentation: optionally move to a state, point, and say one or two sentences."""

    model_config = ConfigDict(extra="ignore")

    say: str = Field(description="what you say at this beat: one or two short spoken sentences, first person, plain "
                                 "words (no markdown, no code blocks)")
    target: str = Field(default="", description="the ref of what you point at while saying it, copied exactly from "
                                                "`targets`; empty to point at nothing")
    mark: str = Field(default="point", description='"point" (hold the pointer on it) or "circle" (draw a circle '
                                                   'around it, for what matters most); ignored without a target')
    frame: int = Field(default=-1, description="the execution state to move the slider to BEFORE this beat, from "
                                               "`frames`; -1 to stay where it is")
    write: str = Field(default="", description="optional: one short line you type on the scratchpad over the view "
                                               "while you say this, as a presenter writes on a board: a calculation "
                                               "with the values on screen, a formula, a bit of code. Plain text as typed "
                                               "on a keyboard (-, *, <=, or − × ≤) by default; real notation (a "
                                               "fraction, a sum, a subscript, a Greek letter) between $...$ as KaTeX; "
                                               "code between backticks. Empty for none")
    write_near: str = Field(default="", description="with `write`: the ref (from `targets`) to write beside; empty "
                                                    "to write beside this beat's target, or in a free corner")
    erase: bool = Field(default=False, description="wipe what you wrote and drew earlier before this beat")
    arrow_to: str = Field(default="", description="optional: draw a hand-drawn arrow to this ref (from `targets`) "
                                                  "while you say this; empty for none")
    arrow_from: str = Field(default="", description="with `arrow_to`: the ref the arrow starts at; empty to start "
                                                    "at what you write this beat, else at this beat's target")


class ScenePresentSig(dspy.Signature):
    """You are presenting to a learner who is looking at an interactive lesson, like a teacher at the front of the
    room with a laser pointer. They asked `question` about what is on screen. Answer it by walking them through the
    view: a few short beats, each saying one or two sentences while pointing at exactly what the sentence is about.

    Point precisely. `targets` lists everything you can point at, one per line as `ref: description`: whole
    objects, single cells of an array or entries of a dict (`nums[3]`), the rows of the variables panel
    (`row:<id>`), the step caption, the execution slider. Use the most specific ref that fits: the cell, not the
    whole array, when you talk about one value. Never invent a ref; when nothing on the list fits, point at nothing.

    The lesson may play an algorithm's run as numbered execution states (`frames`: each state with what happens in
    it; `frame` is the one on screen). When the answer is best shown at another state, set `frame` on the beat that
    should happen there: the slider moves first, then you speak about the new state. Move only when it helps, and
    not on every beat; say why you are moving ("Let's jump ahead to where the second 3 shows up."). `targets`
    describe the state on screen now; once you have moved, read the values of the state you are in from its line
    in `frames` (the [...] part), never carry over the values of the state you left. Move forward through the run
    as a story; go back only to compare.

    You also have a scratchpad: a beat may `write` one short line over the view while you say it, the way a
    presenter writes on the board as they talk. Use it for what is worth seeing written: the arithmetic with the
    values on screen ("running_sum - target = 1 - 3 = -2"), a key formula, the condition being checked, a
    tiny bit of code. Write it as plain text, the way it would be typed; reach for $...$ (KaTeX, as in the info
    overlays) only for notation plain text can't show well ($\\frac{a}{b}$, $\\sum_i x_i$, $x_{i-1}$, Greek
    letters). One line, at most about 40 characters of plain text; write only where it helps, a few
    times in a walk-through, not on every beat. Put it beside what it is about (`write_near`). What you wrote
    stays until you `erase` it or the walk-through ends.

    You can also draw a hand-drawn arrow (`arrow_to`, optionally `arrow_from`) to connect things: from what you
    just wrote to the cell it is about, from a variable to the entry it reads, from one value to where it goes
    next. Draw an arrow only when the connection is the point; it stays with what you wrote.

    Shape the walk-through as a short explanation, not a list: start from what they asked, show the evidence on
    screen, and end with the answer in one sentence. Three to eight beats. Speak warmly and plainly, in the first
    person, to the learner as "you"; refer to values as they are shown on screen; never read code symbol by symbol.
    Use "circle" for the one or two things that matter most, "point" for the rest.
    """

    question: str = dspy.InputField(desc="what the learner asked")
    lesson: str = dspy.InputField(desc="the lesson, scene and step on screen, with the scene's explanation")
    view: str = dspy.InputField(desc="what is on screen now: the step caption, the values shown, the state of the run")
    frames: str = dspy.InputField(desc="the execution states, one per line as `n: what happens  [the values in that "
                                       "state]`, and which is on screen; may be empty when the step has none")
    targets: str = dspy.InputField(desc="what you can point at, one per line as `ref: description`")

    steps: list[PresentStep] = dspy.OutputField(desc="the beats of the walk-through, in order")


INPUT_FIELDS = tuple(ScenePresentSig.input_fields)
