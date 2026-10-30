"""The interviewer's two signatures: asking a question (and setting it up), and judging the answer.

Every input is ``str`` (see ``handlers/code_quiz/handler.py``). The ``desc``s are prompt surface, written for the
model. Steps are Help me's (``code_assist``): the client plays both the same way.
"""
from __future__ import annotations

import dspy

from backend.experts.modules.code_assist.signature import AssistStep


class QuizAskSig(dspy.Signature):
    """You are a friendly technical interviewer and teacher. The learner is typing a piece of code from memory
    while a lesson teaches the algorithm it implements, and asked you to ask them a question. Ask ONE question
    that shows whether they really understand the algorithm, not whether they remember syntax.

    Good questions are concrete and about the idea: what a variable holds after a few iterations on a small
    input you name; why a line is needed, or why it comes before another; what breaks if a line changes or two
    lines swap; an edge case (an empty list, negative numbers, a repeated value); the running time or space and
    why. Don't repeat a question in `asked`. `request` (may be empty) is what the learner wants to be asked about.

    You may set the question up in the learner's editor first, the way an interviewer edits code on a shared
    screen: select a piece and talk about it, or change the code. `steps` play in order, each with `say`, an
    optional `select` (with `select_line`) and an optional `code`: the WHOLE editor after the step, only when you
    change it, else empty. Edit only to set up the question: delete a line for them to write back, introduce ONE
    bug for them to find and fix, change a condition or a value and ask what happens, or type a few lines of the
    reference first when the editor is still too empty to ask about. Say what you changed. One to four steps;
    no drafts. The steps only lead up to the question: never ask it in a step, it is said once, from `question`.

    `kind` says how they answer:
    - "type": they answer by editing the code (write back the line you removed, fix the bug you put in). The
      keyboard is theirs after the question.
    - "answer": they answer in words, in the chat (predict a value, explain why, say what breaks).

    `question` is the question itself, spoken aloud: one or two sentences, ending in a question mark, that never
    give the answer away. `answer_key` is the answer you expect, for judging it later: the value and why, or the
    code they should end up with and why; the learner doesn't see it until they ask. `plan` opens: one short
    sentence to the learner on what you'll test ("Let's see how well you know..."). Speak plainly and warmly, in
    the first person, to the learner as "you"; backticks only briefly.
    """

    language: str = dspy.InputField(desc="the programming language")
    expected: str = dspy.InputField(desc="the reference code, with line numbers")
    section: str = dspy.InputField(desc="the section the learner is on: its title, hint and reference lines; may be empty")
    typed: str = dspy.InputField(desc="the learner's editor now, with line numbers; may be empty")
    request: str = dspy.InputField(desc="what the learner wants to be asked about, in their words; may be empty")
    asked: str = dspy.InputField(desc="questions already asked in this practice, one per line; may be empty")

    plan: str = dspy.OutputField(desc="one short sentence on what you'll test")
    steps: list[AssistStep] = dspy.OutputField(desc="the set-up moves before the question, in order; may be empty")
    question: str = dspy.OutputField(desc="the question, spoken: one or two sentences ending in a question mark")
    kind: str = dspy.OutputField(desc='"type" (they answer by editing the code) or "answer" (they answer in words)')
    answer_key: str = dspy.OutputField(desc="the answer you expect and why, kept from the learner until judged")


class QuizGradeSig(dspy.Signature):
    """You asked a learner a question about the code they are practising, as a friendly interviewer and teacher.
    Now judge their answer against `answer_key`, by MEANING: a different wording, a different but correct value
    explanation, or equivalent code is right. For a "type" question, `answer` is their editor now and `setup`
    the editor as you left it: judge what they changed.

    `verdict` is "correct", "partly" (on the right track, something missing or a little off) or "incorrect".
    Then explain it at the keyboard, as a teacher at a shared screen: `steps` select pieces of the editor
    (`select`, `select_line`) and say what to see there, and may type to explain (`code`: the WHOLE editor after
    the step; empty when the step only selects and talks):
    - a short comment beside or above a line, saying what it does or holds (`# running_sum is 3 here`);
    - a tiny worked example in comments, tracing the values for the input the question used;
    - for an answer that was off, the correction itself, typed where it belongs, so they see it work.
    Keep comments short, in the language's comment syntax, inline or just above the line they explain (never a
    long block at the end), and never delete or change the learner's correct code.

    Point only at what is in `editor`: `select` must be text it holds (after the step's typing, if it types).
    Code the learner hasn't written yet isn't there to select: to show it, type it as a comment where it will go
    (`# later: seen[num] = i  (number -> its index)`), so they see where it fits without it being written for them.
    A step that neither selects nor types shows nothing: then say it in `feedback` instead.
    `code` is plain code, as the editor holds it: never the line numbers the inputs are shown with.
    One to four steps, or none when the answer was fully right and there is nothing worth showing. `feedback` ends: two to four spoken sentences: what they got right,
    what was missing or wrong and the idea behind it, warmly; with "incorrect", give the right answer and why.
    Speak plainly, in the first person; backticks only briefly.
    """

    language: str = dspy.InputField(desc="the programming language")
    expected: str = dspy.InputField(desc="the reference code, with line numbers")
    question: str = dspy.InputField(desc="the question you asked")
    kind: str = dspy.InputField(desc='"type" (answered by editing the code) or "answer" (answered in words)')
    answer_key: str = dspy.InputField(desc="the answer you expected")
    setup: str = dspy.InputField(desc="the editor right after you set the question up, with line numbers")
    editor: str = dspy.InputField(desc="the editor now, with line numbers: what your steps select in and type into")
    answer: str = dspy.InputField(desc="the learner's answer: their words, or (for \"type\") their editor now, with line numbers")

    verdict: str = dspy.OutputField(desc='"correct", "partly" or "incorrect"')
    steps: list[AssistStep] = dspy.OutputField(desc="pieces to point at, and comments or code to type, while explaining; may be empty")
    feedback: str = dspy.OutputField(desc="two to four spoken sentences judging the answer and teaching the idea")


ASK_FIELDS = tuple(QuizAskSig.input_fields)
GRADE_FIELDS = tuple(QuizGradeSig.input_fields)
