r"""The input half of the scene builder's signature.

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

``intent.py`` subclasses this and adds the output fields and the instructions.
Importing this module pulls in dspy; ``models.py`` and ``format.py`` deliberately
do not, so the request path stays light.
"""
from __future__ import annotations

import dspy


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


#: The one list of field names. `scripts/show_build_context.py` renders these and
#: a test pins them to what the request can actually supply, so a field added
#: here without a formatter — or a formatter with no field — fails rather than
#: quietly producing a prompt with a hole in it.
INPUT_FIELDS = tuple(BuildSceneInputs.input_fields)
