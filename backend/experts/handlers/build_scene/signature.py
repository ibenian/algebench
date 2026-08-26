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

from .proposed import SUPPORTED_TYPES, ProposedElement, ProposedStep


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

    THREE NOTATIONS. Getting these wrong is the most common way the scene breaks:

    * `position`, `tail`, `head`, `points` are **math.js**. Write `cos(theta)`,
      `2*pi*r`, `Rp+h`. NEVER LaTeX — `\cos(\theta)` is refused, and a variable
      written as `\lambda` is not the same variable as `lambda`.
    * `label` is **KaTeX** — `$\vec{a}$`, `$\theta$` — and only wraps in `$…$`
      when `conventions` says labels are LaTeX.
    * `title`, `description` and `prompt` are **markdown with embedded KaTeX**.

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
             r"'Cross Product: $\vec{a} \times \vec{b}$'")
    description: str = dspy.OutputField(
        desc="one or two sentences on what the scene shows and what it teaches; "
             "markdown with $…$ for maths")
    steps: list[ProposedStep] = dspy.OutputField(
        desc="the beats of the scene, in order, indexed from 0")
    elements: list[ProposedElement] = dspy.OutputField(
        desc=f"every object drawn. Types: {', '.join(SUPPORTED_TYPES)}. Each one "
             f"names the step that introduces it")


#: The one list of field names. `scripts/show_build_context.py` renders these and
#: a test pins them to what the request can actually supply, so a field added
#: here without a formatter — or a formatter with no field — fails rather than
#: quietly producing a prompt with a hole in it.
INPUT_FIELDS = tuple(BuildSceneInputs.input_fields)
