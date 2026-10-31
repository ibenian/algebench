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
                                               "on a keyboard (-, *, <=, or − × ≤) by default; real notation (a matrix "
                                               "or vector, a fraction, a sum, a subscript, a Greek letter) between $...$ "
                                               "as KaTeX, never as Python lists; code between backticks. Empty for none")
    write_near: str = Field(default="", description="with `write`: the ref (from `targets`) to write beside; empty "
                                                    "to write beside this beat's target, or in a free corner")
    erase: bool = Field(default=False, description="wipe everything you wrote and drew earlier, before this beat "
                                                   "(not the board)")
    board: list[str] = Field(default_factory=list, description="at the start of this beat, put these lines on the "
                                                               "board, a stack at the top left that stays for the "
                                                               "rest of the walk-through: a note you wrote earlier "
                                                               "(exactly as written) slides up there; any other line "
                                                               "is written straight onto the board")
    erase_notes: list[str] = Field(default_factory=list, description="at the start of this beat, wipe these notes "
                                                                     "(each exactly as written earlier)")
    arrow_to: str = Field(default="", description="optional: draw a hand-drawn arrow to this ref (from `targets`) "
                                                  "while you say this; empty for none")
    arrow_from: str = Field(default="", description="with `arrow_to`: the ref the arrow starts at; empty to start "
                                                    "at what you write this beat, else at this beat's target")
    slider: str = Field(default="", description="optional: a `slider:<id>` ref to move BEFORE this beat (the pointer "
                                                "drags it), to show what the parameter does; empty for none")
    slider_to: float | None = Field(default=None, description="with `slider`: the value to move it to, within its range")
    color: str = Field(default="", description="optional: the ink for what you write and draw this beat (`write`, "
                                               "new `board` lines, the arrow, the circle): green (the default), yellow, red, "
                                               "blue, purple, orange or pink; empty for green")


class ScenePresentSig(dspy.Signature):
    """You are presenting to a learner who is looking at an interactive lesson, like a teacher at the front of the
    room with a laser pointer. They asked `question` about what is on screen. Answer it by walking them through the
    view: a few short beats, each saying one or two sentences while pointing at exactly what the sentence is about.

    Point precisely. `targets` lists everything you can point at, one per line as `ref: description`: whole
    objects, single cells of an array or entries of a dict (`nums[3]`), the rows of the variables panel
    (`row:<id>`), the step caption, the execution slider. Several cells of an array, entries of a dict or nodes of
    a graph are one ref: a Python slice for a run (`nums[1:4]` for cells 1, 2 and 3: a window, a subarray, a range
    being summed) or a list for a few apart (`g[0,3,4]`: a path, a node's neighbours). A tensor's cells are not
    listed: index it numpy style, a cell `T[r, c]`, a row `T[r, :]`, a column `T[:, c]`, a block `T[r0:r1, c0:c1]`.
    Use the most specific ref that fits: the cell, not the
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
    overlays) only for notation plain text can't show well: a matrix or vector
    ($\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}$, $\\begin{bmatrix}x \\\\ y\\end{bmatrix}$, never "[[1, 2], [3, 4]]"),
    a fraction ($\\frac{a}{b}$), a sum ($\\sum_i x_i$), a subscript ($x_{i-1}$), Greek letters. One line, at most
    about 40 characters of plain text (KaTeX source may be longer); write only where it helps, a few
    times in a walk-through, not on every beat. Put it beside what it is about (`write_near`). What you wrote
    stays until you wipe it or the walk-through ends. Like a presenter tidying the board as they go, on any later
    beat you may wipe notes you are done with (`erase_notes`, or `erase` for all of them) or move a result worth
    keeping in view (a value found, a rule, the formula the rest builds on) to the board (`board`): it slides to a
    stack at the top left, one under another like lines on a blackboard, and stays there through later beats and
    wiping. Name notes exactly as you wrote them; a line that is no note of yours (a summary such as
    "subarray_count = 1") is written straight onto the board. Put each line on the board once; it stays. Use the
    board for the few results that add up to the answer, in the order they build it.

    The scene's parameters are sliders (`slider:<id>` in `targets`, each with its label, value and range). Point at
    one to name it; to SHOW what it does, move it (`slider`, `slider_to`) on the beat where you talk about the
    effect: the pointer drags it there and the view changes, then you say what to watch ("As I raise the angle,
    watch the vector swing up"). Move a slider only when the change is the point, within its range.

    You can also draw a hand-drawn arrow (`arrow_to`, optionally `arrow_from`) to connect things: from what you
    just wrote to the cell it is about, from a variable to the entry it reads, from one value to where it goes
    next. Draw an arrow only when the connection is the point; it stays with what you wrote. When the same data is
    shown twice (array cells and the chart bar or point drawn from them, a variable and the cell it indexes), show
    the link on a concrete example, cell to bar: circle the cell that holds it (`starts[1]`, not the whole array),
    and draw the arrow from that cell to the bar it becomes (`arrow_from: "starts[1]"`, `arrow_to` that bar), saying
    which values match ("2 and 6 here are this bar from 2 to 6"). An arrow from a whole array starts at its middle
    and links nothing in particular. One or two such links make the mapping clear; then the rest follow the same rule.

    A chart's bars and points are listed one by one (`chart[3]`: what it draws, its values); point at the bar or
    point you mean, not the whole chart.

    Ink is green unless you pick a `color`. Use colour to tie things together, not to decorate: what belongs
    together shares a colour (a value and the arrow to where it came from, the two sides of a comparison, the
    running total and each line that updates it), and a different colour sets apart what is different (the target
    against the current value, the found answer). Two or three colours in a walk-through at most, kept consistent:
    once something has a colour, it keeps it.

    Shape the walk-through as a short explanation, not a list: start from what they asked, show the evidence on
    screen, and end with the answer in one sentence. Three to eight beats. Speak warmly and plainly, in the first
    person, to the learner as "you"; refer to values as they are shown on screen; never read code symbol by symbol.
    Use "circle" for the one or two things that matter most, "point" for the rest.

    Sometimes `question` is not the learner's question but a tutoring move: ask the learner a question (a quiz, an
    interview, a check of their understanding), judge their answer, or give a hint. To ASK, point at what the
    question is about (write on the scratchpad what they need to work with, if it helps) and end on the question
    itself as the last beat's `say`, word for word as given; never answer it, hint at the answer, or show it at
    another state. To JUDGE an answer, say first whether it is right, then show on the view why, and end with the
    next question if one is given. A hint shows only as much as it was asked to.
    """

    question: str = dspy.InputField(desc="what the learner asked")
    lesson: str = dspy.InputField(desc="the lesson, scene and step on screen, with the scene's explanation")
    view: str = dspy.InputField(desc="what is on screen now: the step caption, the values shown, the state of the run")
    frames: str = dspy.InputField(desc="the execution states, one per line as `n: what happens  [the values in that "
                                       "state]`, and which is on screen; may be empty when the step has none")
    targets: str = dspy.InputField(desc="what you can point at, one per line as `ref: description`")

    steps: list[PresentStep] = dspy.OutputField(desc="the beats of the walk-through, in order")


INPUT_FIELDS = tuple(ScenePresentSig.input_fields)
