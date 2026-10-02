"""The planner's signature: what it is told, and what it must answer.

Every input is ``str`` (see ``handlers/learning_plan/format.py``). The
``desc``s are prompt surface, written for the model.
"""
from __future__ import annotations

import dspy
from pydantic import BaseModel, ConfigDict, Field


class PlanPick(BaseModel):
    """One step of the plan: a catalog handle and why it's there."""

    model_config = ConfigDict(extra="ignore")

    handle: str = Field(description="a handle from the catalog, exactly as shown, e.g. L1.S2.T3")
    why: str = Field(description="one sentence, to the learner, on what this step gives them "
                                 "toward the target; markdown with $…$ for maths")


class LearningPlanSig(dspy.Signature):
    """Plan a short path through existing AlgeBench lessons to a concept the
    learner doesn't understand yet.

    You CHOOSE content; you never write it. Every step is a handle from
    `catalog`, copied exactly. A handle that isn't in the catalog is dropped,
    and so is the step that used it.

    Decide which of these the request is:

    1. NOT A REQUEST TO LEARN SOMETHING (a greeting, a command, an unrelated
       task): set `is_plan` false and leave the rest empty.
    2. TOO VAGUE TO PLAN, where the answer changes which lessons you'd pick
       ("explain it" with nothing to say what "it" is): set `is_plan` true and
       ask ONE short question. Never ask when `clarifications` already answers
       it, and never ask when a sensible reading is obvious.
    3. NOT COVERED: the catalog has nothing that genuinely builds toward the
       target. Set `is_plan` true, leave `steps` empty, and say so in `reason`,
       e.g. "AlgeBench doesn't cover the chemistry of ablation yet." Don't pad
       a plan with steps that are only loosely related.
    4. A PLAN: set `is_plan` true and give 2 to 8 steps, in the order to take
       them. Start from what the target rests on and end at the target itself.
       If coverage is partial, plan what is covered and name the gap in
       `reason`.

    Choosing steps:
    - Prefer the most specific entry that teaches the idea: a step over its
      whole scene, a proof step over its whole proof, when the step alone is
      enough. Use a scene or a proof when the learner should work through all
      of it.
    - A glossary term ([term]) is good for a definition the learner needs on
      the way, not for the target itself.
    - Skip what `known` says they have already covered, and don't send them
      to `where` (they're already there) unless it's the right first step.
    - Steps can come from different lessons; follow the ideas, not the files.
    """

    target: str = dspy.InputField(desc="what the learner wants to understand, in their words")
    where: str = dspy.InputField(desc="where the learner is now; may be empty")
    known: str = dspy.InputField(desc="what the learner has already covered; may be empty")
    clarifications: str = dspy.InputField(
        desc="questions you already asked and the learner's answers; may be empty. Use them "
             "and don't ask again")
    catalog: str = dspy.InputField(
        desc="the lessons you may choose from: one line per entry, `handle [kind] title — "
             "description`, indented under its scene or proof")
    omitted: str = dspy.InputField(
        desc="catalog entries left out because they didn't fit; may be empty")
    refused: str = dspy.InputField(
        desc="YOUR previous answer to this request was rejected, and why; empty on a first "
             "attempt. Fix what it names: use handles exactly as the catalog shows them")

    is_plan: bool = dspy.OutputField(desc="false if this is not a request to learn something")
    question: str = dspy.OutputField(desc="ONE short question when the target is too vague to plan; "
                                          "otherwise empty")
    reason: str = dspy.OutputField(desc="what the catalog doesn't cover, when it falls short; "
                                        "otherwise empty")
    title: str = dspy.OutputField(desc="a short title for the plan, e.g. Understand terminal "
                                       "velocity; written bare, no quotes")
    steps: list[PlanPick] = dspy.OutputField(desc="the plan, in order; empty when there is none")


INPUT_FIELDS = tuple(LearningPlanSig.input_fields)
