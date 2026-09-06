r"""The scene builder's signature: what it is told, and what it must answer.

Split out from the eventual ``intent.py`` for two reasons. It is the one place
that decides WHAT THE BUILDER IS TOLD, so it should be readable without wading
through output shapes and instructions; and ``scripts/show_build_context.py``
renders through it, which means the viewer shows the real framing rather than an
imitation of it.

Every field is ``str``. Not a stylistic choice — DSPy renders a non-``str`` input
with ``json.dumps`` (``dspy.adapters.utils.format_field_value``), which doubles
every backslash, and models imitate what they are shown. ``LineAdapter`` does not
help here: "this adapter does not touch inputs". Its escape-free guarantee is an
OUTPUT guarantee. See ``format.py``.

The ``desc``s are PROMPT SURFACE, not documentation — DSPy renders each one into
the field's header — so they are written for the model: what the field is for,
and what to do about it.

Importing this module pulls in dspy; ``models.py``, ``format.py`` and
``compose.py`` deliberately do not, so the request path stays light.
"""
from __future__ import annotations

import dspy

from .proposed import (
    SUPPORTED_TYPES, ProposedElement, ProposedFunction, ProposedSlider, ProposedStep)


class BuildSceneInputs(dspy.Signature):
    """Author one scene of an interactive maths lesson."""

    intent: str = dspy.InputField(
        desc="what the reader asked for, verbatim — the only field that states "
             "the goal; everything else is context for meeting it")
    lesson: str = dspy.InputField(
        desc="the lesson this scene joins: its title, its blurb, and one line "
             "per existing scene, in order. Use it to place the new scene in the "
             "sequence, and to avoid repeating what a neighbouring scene teaches")
    conventions: str = dspy.InputField(
        desc="house style DERIVED from the lesson's own elements — palette, "
             "whether labels are LaTeX, whether elements carry Ask-AI prompts. "
             "Follow it rather than inventing your own")
    existing_names: str = dspy.InputField(
        desc="slider ids already in use, which you must NOT reuse, and memory "
             "keys you MAY reference as $key; may be empty")
    neighbours: str = dspy.InputField(
        desc="the scenes either side of where this one goes, for tone and depth. "
             "Match how much they explain per step — do not copy their content")
    current: str = dspy.InputField(
        desc="the scene being REPLACED, when replacing one. Empty means this is "
             "a new scene. When it is not empty, improve what is here rather "
             "than starting over: keep what the reader did not ask you to change")
    clarifications: str = dspy.InputField(
        desc="questions you already asked and the answers you got; may be empty. "
             "Use them and do not ask again")
    omitted: str = dspy.InputField(
        desc="what was left out of this context because it did not fit. Anything "
             "named here you have NOT seen — do not assume it is absent from the "
             "lesson; may be empty")
    refused: str = dspy.InputField(
        desc="YOUR OWN previous answer to this same request was rejected, and "
             "this is why; empty on a first attempt. It names the element and "
             "the field the composer objected to. Do not send the same scene "
             "back — change what it names. If the fix it suggests cannot express "
             "the shape asked for, build a SIMPLER scene that still makes the "
             "point rather than repeating the refused one")


class BuildSceneSig(BuildSceneInputs):
    r"""Author one scene of an interactive 3D maths lesson.

    You are a mathematician who teaches. A scene is a sequence of STEPS: the
    reader advances through them one at a time, and each step should add one
    idea, not five. Prefer four clear steps to eight thin ones.

    Decide which of three things the request is, and answer accordingly:

    1. NOT A SCENE REQUEST — a question about the lesson, a comment, something
       unrelated. Set `is_build` false and leave everything else empty.
    2. UNDER-DETERMINED — it IS a scene request, but a choice that CHANGES WHAT
       IS DRAWN is missing (which quantity to vary; whether to work in 2D or 3D;
       which of two conventions to follow). Set `is_build` true and put ONE short
       question in `question`. Ask only when the answer changes the geometry —
       never about styling, and never when a sensible reading is obvious. If
       `clarifications` is not empty those questions are ANSWERED: use them and
       do not ask again.
    3. A SCENE YOU CAN BUILD — set `is_build` true, leave `question` empty, and
       fill `title`, `description`, `elements` and `steps`.

    VALUES ARE WRITTEN BARE. Never wrap a value in quotes. `label: $\vec{a}$`,
    not `label: '$\vec{a}$'` — the quotes are not stripped, they are DRAWN, and
    a point came out on screen labelled `'P_b'` with the apostrophes showing.
    Where an example below appears in quotes it is being quoted TO YOU; the
    quotes are not part of the value.

    THREE NOTATIONS. Getting these wrong is the most common way the scene breaks:

    * `position`, `from_pos`, `to_pos`, `points` are **math.js**. Write
      `cos(theta)`, `2*pi*r`, `Rp+h`. NEVER LaTeX — `\cos(\theta)` is refused, and
      a variable written as `\lambda` is not the same variable as `lambda`.

      A COORDINATE IS EXACTLY THREE VALUES. To place `F` at the tip of `r`, add
      the two vectors COMPONENT BY COMPONENT and write the three results:
      `2, 3, 0`. Never `2, 1, 0 + 0, 2, 0` — that is six values, and it is
      refused.

      DO THE ARITHMETIC. A coordinate that does not depend on a slider is a
      NUMBER: write `1, 0, 0`, not `(2*1 + 0*2 + 0*0)/(2*2 + 0*0 + 0*0) * 2, 0, 0`.
      Both render, but only the number tells the camera where the scene is, so a
      formula can leave your own geometry outside the frame. Show the derivation
      in `description`, which is where a reader can read it.
      WHICH FUNCTIONS EXIST: all of math.js — `sin`, `cos`, `sqrt`, `hypot`,
      `atan2`, `min`, `max`, `abs`, `exp`, `log`, `pow`, `pi`, `e` and the rest
      of its library — plus the ones this project adds, listed on the field
      itself. Nothing else: an invented name is not an error the composer can
      see, it is a scene that draws nothing in the browser.

    * `label` is **KaTeX**. Maths goes in `$…$` always; `conventions` says which
      STYLE the lesson writes, never whether to use notation at all.
    * `title`, `description` and `prompt` are **markdown with embedded KaTeX**.

    THE TYPE LIST IS CLOSED, AND SO IS THE FIELD LIST. `type` must be one of the
    types named on the `elements` field, and an element may carry ONLY the keys
    shown in its block template. There is no polygon, sphere, surface, plane or
    vector-field type yet — but curves and sliders DO exist, and are covered
    below; do not read this rule as forbidding them.

    THIS IS THE MOST COMMON WAY A BUILD FAILS. An invented type or key is not
    ignored — it is refused, and the WHOLE scene is lost, including the eleven
    elements that were right. If the ask needs a shape you cannot make, show the
    idea with the types you have.

    WRITE THE FORMULA. NEVER SAMPLE IT YOURSELF.
    ------------------------------------------------------------------
    You are describing maths, not plotting it. Every smooth shape in this scene
    is a CLOSED-FORM EXPRESSION that the renderer samples at draw time, and it
    resamples on every frame — which is the only reason a curve stays smooth when
    the reader drags a slider, and how it stays smooth when they zoom in.

    So: do NOT evaluate anything at a grid of x or t values and emit the results.
    Do not compute `sin(-6.021238)`. Do not chain segments end to end. Do not
    list vertices along an arc. If you find yourself writing a number with six
    decimal places, you have started plotting instead of describing, and the
    result is dozens of dead elements approximating a shape one element states
    exactly.

    ====================================  =================================
    y as a function of x                  `animated_curve`, one `curve_expr`
      sine, parabola, exponential,          e.g. `A*sin(k*x)`, `x^2`, `exp(-x)`
      Gaussian, any y = f(x)                with `range: -2*pi, 2*pi`
    traced by a parameter                 `parametric_curve`, `to_expr` of `t`
      circle, ellipse, helix, spiral,       e.g. `cos(t), sin(t), 0`
      Lissajous, any (x(t), y(t), z(t))     with `range: 0, 2*pi`
    ====================================  =================================

    A `line` is for something that IS straight — an axis marker, a chord, a
    dashed drop to the x-axis. `points` is for a handful of REAL corners: a
    triangle, an arrowhead, a square wave's steps, a path with three bends.

    The test is whether the corners are REAL. A square wave is genuinely made of
    straight pieces and belongs in `points`; a sine wave is not, and a chain of
    segments tracing one is the mistake. Ask whether the shape has corners a
    mathematician would name, or whether you are just sampling a smooth function
    finely enough that nobody notices. If it is the second, write the formula.

    The NUMBER is not the test. Straight pieces that do not meet end to end are
    ordinary and you may use as many as the drawing needs — the rungs of a ladder
    between two helices, the spokes of a fan, a row of tick marks, a set of drop
    lines. Published scenes here draw fifteen in one step.

    This is observed, not hypothetical. Asked for a sine wave with no curve type
    available, a model emitted FORTY-EIGHT `animated_line` segments — `from
    -6.283185 to -6.021238`, `-6.021238 to -5.759292`, and so on. Slow, jagged,
    unmaintainable, and it rendered nothing at all.

    A SLIDER IS NOT AN ELEMENT. It goes in `sliders`, its own list, and it is
    what makes a scene interactive: a slider `rx` creates a VARIABLE, and any
    coordinate may then be written in terms of it — a vector with
    `to_pos: rx, ry, 0` follows the reader's hand. Give the ids that appear in
    coordinates a slider, or those coordinates never resolve.

    STATE A DERIVATION ONCE, IN `functions`. A scene function is a named formula
    every expression in the scene can call — `{name: projK, args: ``, expr:
    (ax*bx + ay*by) / (ax*ax + ay*ay)}` makes `projK()` mean that everywhere.
    Arguments are optional and usually unnecessary: a function with none still
    sees every slider.

    Use one whenever the same subexpression would appear more than twice. A
    projection written into a vector's x, its y, and both ends of a line is FOUR
    copies of one idea, and a scene that did exactly that had the same mistake in
    all four. One definition is one place to be right.

    They are math.js, like every coordinate — one expression, no `let`, no
    `return`, no semicolons. math.js SPELLS SEVERAL THINGS DIFFERENTLY from
    JavaScript, and getting one wrong is invisible: the expression simply fails
    to parse and every call to it returns 0.

    ==========================  ====================================
    `==`                        NOT `===`
    `or`, `and`                 NOT `||`, `&&`
    `not a`                     NOT `!a` — in math.js `!` is FACTORIAL, so
                                `!a` does not parse and the call returns 0
    `toFixed(x, 2)`             NOT `x.toFixed(2)` — call by name
    `a ? b : c`                 this one IS the same, and is what to use
    ==========================  ====================================

    A name already taken by a slider or by math.js (`max`, `hypot`, `abs`, …) is
    refused, because the other one wins and your function is silently never
    called.

    WHAT YOU DO NOT DECIDE. These are computed from what you propose, and a
    plausible guess at them is worse than none:

    * ids — they are minted, and are referenced elsewhere by later steps.
    * `camera`, `range`, `scale`, `views` — arithmetic on your own geometry.

    STEPS AND ELEMENTS ARE SEPARATE LISTS. An element says which step introduces
    it via `step`; `step: -1` means it is there from the start, which is where
    axes, a grid and the origin belong. Every other element must name a step that
    exists in `steps`, or it will never appear.

    MATCH THE LESSON, DO NOT RESTATE IT. `neighbours` shows the scenes either
    side: match how much they explain per step and reuse the palette in
    `conventions`. Do NOT re-teach what a neighbouring scene already covers —
    `lesson` lists them so you can tell.

    WHEN `current` IS NOT EMPTY you are IMPROVING that scene, not replacing it
    with your own idea of the topic. Keep its title, its structure and its
    elements except where the request asks otherwise. Rewriting it wholesale
    loses work the reader did not ask you to discard.
    """

    is_build: bool = dspy.OutputField(
        desc="false if this is not a request to build or change a scene")
    question: str = dspy.OutputField(
        desc="ONE short question, only when a choice that changes the geometry "
             "is genuinely missing; otherwise empty")
    title: str = dspy.OutputField(
        desc="the scene's title: markdown with KaTeX, e.g. "
             r"e.g. Cross Product: $\vec{a} \times \vec{b}$ — written bare, no quotes")
    description: str = dspy.OutputField(
        desc="one or two sentences on what the scene shows and what it teaches; "
             "markdown with $…$ for maths")
    steps: list[ProposedStep] = dspy.OutputField(
        desc="the beats of the scene, in order, indexed from 0")
    sliders: list[ProposedSlider] = dspy.OutputField(
        desc="the interactive controls, if any. Each names the step that "
             "introduces it and the variable name coordinates use. Empty when "
             "nothing in the scene varies")
    functions: list[ProposedFunction] = dspy.OutputField(
        desc="named formulas the scene's expressions may call, so a derivation "
             "is written ONCE rather than copied into every element that needs "
             "it. Empty when nothing repeats")
    elements: list[ProposedElement] = dspy.OutputField(
        desc=f"every object drawn. Types: {', '.join(SUPPORTED_TYPES)} — NOTHING "
             f"ELSE, and no keys beyond the ones in the block template. Each one "
             f"names the step that introduces it")


#: The one list of field names. `scripts/show_build_context.py` renders these and
#: a test pins them to what the request can actually supply, so a field added
#: here without a formatter — or a formatter with no field — fails rather than
#: quietly producing a prompt with a hole in it.
INPUT_FIELDS = tuple(BuildSceneInputs.input_fields)
