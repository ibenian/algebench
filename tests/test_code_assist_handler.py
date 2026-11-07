"""The code-assist handler's routing, its inputs, and how steps are cleaned; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.code_assist import handler as h
from backend.experts.handlers.code_assist.models import CodeAssistRequest
from backend.experts.modules.code_assist import intent
from backend.experts.modules.code_assist.canvas import CanvasMark, clean_marks
from backend.experts.modules.code_assist.signature import INPUT_FIELDS, AssistStep, CanvasStep, CodeAssistCanvasSig, CodeAssistSig

EXPECTED = "def f(n):\n    total = 0\n    for i in range(n):\n        total += i\n    return total"


def _req(**kw) -> CodeAssistRequest:
    return CodeAssistRequest(**{**dict(language="python", expected=EXPECTED, first_line=10, typed="def f(n):"), **kw})


def test_inputs_cover_the_signature_and_number_the_reference_from_its_line():
    inputs = {**h.render_inputs(_req()), "scope": "next"}
    assert set(inputs) == set(INPUT_FIELDS)
    assert " 10 | def f(n):" in inputs["expected"]
    assert h.render_inputs(_req(typed=" \n"))["typed"] == "(empty)"
    assert h.render_inputs(_req(issues=[{"line": 2, "note": "never defined"}]))["issues"] == "line 2: never defined"


def _model(steps, plan="Plan.", closing="Over to you."):
    return lambda *_: (lambda **_: SimpleNamespace(plan=plan, steps=steps, closing=closing))


def test_steps_are_cleaned_merged_and_capped(monkeypatch):
    steps = [CanvasStep(say="Start", code="```python\ndef f(n):\n    total = 0   \n```", explain="A sum."),
             CanvasStep(say="Hmm", code="def f(n):\n    total = 0", explain="no change"),
             CanvasStep(say="Loop", code="def f(n):\n    total = 0\n    for i in range(n):", explain="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("all", language="python", expected="", section="", typed="")
    assert [s.code for s in out.steps] == ["def f(n):\n    total = 0", "def f(n):\n    total = 0\n    for i in range(n):"]
    assert out.steps[0].explain == "A sum. Hmm no change", "a step typing nothing joins the one before"
    assert len(intent.assist_code("next", language="", expected="", section="", typed="").steps) == 2
    monkeypatch.setattr(intent, "_assistant", _model(steps * 3))
    assert len(intent.assist_code("next", language="", expected="", section="", typed="").steps) <= intent.STEP_LIMIT["next"]


def test_a_failed_call_is_a_reason_and_no_steps_too(monkeypatch):
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(error="down"))
    assert h.code_assist(_req()) == {"reason": "down"}
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(plan="p"))
    assert h.code_assist(_req()) == {"reason": h.NO_STEPS}


def test_a_draft_is_kept_only_as_a_slip_caught(monkeypatch):
    fixed = "def f(n):\n    total = 0"
    steps = [CanvasStep(say="a", code=fixed, draft="def f(n):\n    total = 1", notice="Wait, it starts at zero."),
             CanvasStep(say="b", code=fixed + "\n    x", draft=fixed + "\n    x", notice="same as the fix"),
             CanvasStep(say="c", code=fixed + "\n    y", draft=fixed + "\n    z", notice="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("all", language="", expected="", section="", typed="")
    assert [(s.draft, s.notice) for s in out.steps] == [("def f(n):\n    total = 1", "Wait, it starts at zero."), ("", ""), ("", "")]


def test_a_fix_has_no_drafts_and_nothing_to_fix_says_so(monkeypatch):
    steps = [CanvasStep(say="a", code="x = 0", draft="x = 1", notice="Wait.")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    assert intent.assist_code("fix", language="", expected="", section="", typed="", issues="").steps[0].draft == ""
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing=""))
    assert h.code_assist(_req(scope="fix")) == {"reason": h.NOTHING_TO_FIX}
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="All good so far."))
    assert h.code_assist(_req(scope="fix")) == {"reason": "All good so far."}


def test_ask_needs_words_and_a_question_is_answered_without_typing(monkeypatch):
    assert h.code_assist(_req(scope="ask")) == {"reason": h.ASK_FIRST}
    assert h.render_inputs(_req(request="  write the loop "))["request"] == "write the loop"
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="Because the empty prefix counts."))
    assert h.code_assist(_req(scope="ask", request="why {0: 1}?")) == {"reason": "Because the empty prefix counts."}


def test_narrating_types_nothing_and_keeps_its_selections(monkeypatch):
    steps = [CanvasStep(say="The loop.", code="for x in xs:", select="for x in xs:", select_line=1),
             CanvasStep(say="Its target.", code="", select="xs", select_line=-3),
             CanvasStep(say="And that is all.", code="")]
    monkeypatch.setattr(intent, "_assistant", _model(steps))
    out = intent.assist_code("narrate", language="", expected="", section="", typed="", issues="", request="")
    assert [(s.code, s.select, s.select_line) for s in out.steps] == [("", "for x in xs:", 1), ("", "xs", 0)]
    assert out.steps[1].explain == "And that is all.", "talk with nothing selected joins the step before"


def test_line_numbers_copied_from_the_inputs_are_taken_off():
    assert intent.clean_code("  1 | def f(n):\n  2 |     return n  # 3 | not a number") == "def f(n):\n    return n  # 3 | not a number"
    assert intent.clean_code("  1 | def f(n):\n  2 |     return n\n      # f(2) is 2") == "def f(n):\n    return n\n# f(2) is 2", \
        "a line added without a number loses the numbering's width"
    many = "  1 | x = 1\n" + "\n".join(f"# note {k}" for k in range(5))
    assert intent.clean_code(many).startswith("x = 1\n# note 0"), "however many lines come unnumbered"
    assert intent.clean_code("x = a | b\ny = 1") == "x = a | b\ny = 1", "only when the lines are numbered"
    assert intent.clean_code("  3 | x\n  7 | y") == "  3 | x\n  7 | y", "not numbered from 1 in order: left as it is"


def test_a_numbered_copy_with_an_extra_space_after_the_bar_is_not_left_indented():
    # An unnumbered line (a comment the model added) lines up with the numbered lines' code.
    copied = "  1 |  def f(n):\n  2 |      total = 0\n           # a note\n  3 |      return total"
    assert intent.clean_code(copied) == "def f(n):\n    total = 0\n    # a note\n    return total"


def test_the_learners_lines_are_kept_as_typed_whatever_spacing_the_copy_gives_them():
    typed = "def f(n):\n    total=0   # mine\n    return total"
    copy = " def f(n):\n      total=0   # mine\n    # trace: total starts at 0\n     return total"
    assert intent.keep_lines(copy, typed) == "def f(n):\n    total=0   # mine\n    # trace: total starts at 0\n    return total"
    steps = [CanvasStep(say="a", code=copy), CanvasStep(say="b", code=copy + "\n# done")]
    out = intent.clean_steps(steps, editor=typed)
    assert out[0].code.startswith(typed.split("\n")[0]) and out[1].code.endswith("    return total\n# done")


def test_pairing_types_only_the_start_of_a_new_line():
    typed = "def f(n):\n    total = 0"
    full = typed + "\n    for i in range(n):"
    assert h.only_starts(full, typed, EXPECTED) == typed + "\n    for "
    assert h.only_starts(typed + "\n    return total", typed, EXPECTED) == typed + "\n    return "
    assert h.only_starts(typed + "\n    for ", typed, EXPECTED) == typed + "\n    for ", "a start is left as it is"
    assert h.only_starts(typed + "\n    # think", typed, EXPECTED) == typed + "\n    # think", "not a line of the code"


def test_pairing_cuts_a_long_start_too():
    typed = "def f(n):"
    assert h.only_starts(typed + "\n    total = ", typed, EXPECTED) == typed + "\n    total "


def test_pairing_done_says_whether_the_code_is_complete(monkeypatch):
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="Done: it returns the lone number.", complete=True))
    assert h.code_assist(_req(scope="pair")) == {"reason": "Done: it returns the lone number.", "complete": True}
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="Line 4 is off.", complete=False))
    assert h.code_assist(_req(scope="pair")) == {"reason": "Line 4 is off."}
    # Only pairing hands back that word: an answer to a question is just an answer.
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(closing="Yes.", complete=True))
    assert h.code_assist(_req(scope="ask", request="ok?")) == {"reason": "Yes."}


def test_a_step_sending_only_its_new_line_keeps_the_learners_code():
    typed = "def build_lps(text):\n    lps = [0] * len(text)\n    k = 0\n    for i in range(1, len(text)):\n        \n    "
    piece = "        while k and text[i] != text[k]:"
    out, = intent.clean_steps([CanvasStep(say="a", code=piece)], editor=typed)
    assert out.code == "\n".join(typed.split("\n")[:4] + [piece])


def test_a_line_is_erased_only_when_the_step_says_so():
    typed = "def f(n):\n    total = 0\n    print(n)\n    return total"
    dropped = "def f(n):\n    total = 0\n    return total"
    out, = intent.clean_steps([CanvasStep(say="a", code=dropped)], editor=typed)
    assert out.code == typed
    out, = intent.clean_steps([CanvasStep(say="a", code=dropped, erase=[3])], editor=typed)
    assert out.code == dropped
    # A line rewritten in place is a fix, not a loss.
    fixed = "def f(n):\n    total = 1\n    print(n)\n    return total"
    out, = intent.clean_steps([CanvasStep(say="a", code=fixed)], editor=typed)
    assert out.code == fixed


def test_pairing_starts_the_new_line_where_the_learner_is_not_at_the_end():
    typed = "def lps(text):\n    \n    while k and text[i] != text[k]:\n        k = lps[k - 1]\n"
    at_end = "def lps(text):\n    while k and text[i] != text[k]:\n        k = lps[k - 1]\n    lps"
    assert h.at_cursor(at_end, typed, 2) == "def lps(text):\n    lps\n    while k and text[i] != text[k]:\n        k = lps[k - 1]"
    # On a line with code, the new one goes after it; a step that changes a line is left as it is.
    assert h.at_cursor("a\nb\nc", "a\nb", 1) == "a\nc\nb"
    assert h.at_cursor("a\nB\nc", "a\nb", 1) == "a\nB\nc"



def test_a_step_sending_part_of_the_editor_is_caught_unless_it_erases_on_purpose():
    typed = "def f(n):\n    total = 0\n    return total"
    steps = [CanvasStep(say="a", code="    for i in range(n):"), CanvasStep(say="b", code="def f(n):\n    return total", erase=[2])]
    assert intent.partial_steps(steps[:1], typed) == [1]
    assert intent.partial_steps(steps[1:], typed) == []


def test_an_idea_to_draw_goes_to_the_chat_only_with_the_presenter_on(monkeypatch):
    req = dict(language="python", expected=EXPECTED, typed="", scope="ask", request="draw it")
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(
        closing="I'll show it on the scene.", show="On the scratchpad, draw the loop.", steps=[CanvasStep(say="a", code="x")]))
    assert h.code_assist(CodeAssistRequest(**req, present=True)) == {"reason": "I'll show it on the scene.", "show": "On the scratchpad, draw the loop."}
    assert "show" not in h.code_assist(CodeAssistRequest(**req))


def test_a_null_written_for_no_request_shows_nothing():
    assert intent._request("None") == "" and intent._request(" null ") == ""
    assert intent._request("Draw the loop.") == "Draw the loop."


def _stub_steps(monkeypatch, *steps, closing="", complete=False):
    out = intent.CodeAssist(steps=list(steps), closing=closing, complete=complete)
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: out)


def _hint(level):
    return _req(scope="pair", hint_level=level, typed="def f(n):\n    total = 1")


def test_hint_level_reaches_the_model_and_defaults_to_direct():
    assert h.render_inputs(_req())["hint_level"] == "direct"
    assert h.render_inputs(_hint("vague"))["hint_level"] == "vague"


def test_below_direct_nothing_to_say_is_quiet(monkeypatch):
    _stub_steps(monkeypatch)
    assert h.code_assist(_hint("question")) == {"quiet": True}
    # Direct keeps its old answer, and a last word at any level stays a word.
    assert "reason" in h.code_assist(_hint("direct"))
    _stub_steps(monkeypatch, closing="All done.", complete=True)
    assert h.code_assist(_hint("vague")) == {"reason": "All done.", "complete": True}


def test_question_and_vague_are_words_alone(monkeypatch):
    for level in ("question", "vague"):
        _stub_steps(monkeypatch, CanvasStep(say="Why 1?", code="def f(n):\n    total = 0", select="total", select_line=2, cursor_line=2))
        step = h.code_assist(_hint(level))["result"]["steps"][0]
        assert (step["say"], step["code"], step["select"], step["select_line"], step["cursor_line"]) == ("Why 1?", "", "", 0, 0)


def test_point_keeps_its_pointing_and_a_comment_but_no_code(monkeypatch):
    typed = "def f(n):\n    total = 1"
    comment = typed + "\n    # n = 0: what should it return?"
    _stub_steps(monkeypatch, CanvasStep(say="What does this start at?", code=comment, select="total = 1", select_line=2, cursor_line=2))
    step = h.code_assist(_hint("point"))["result"]["steps"][0]
    assert (step["code"], step["select"], step["cursor_line"]) == (comment, "total = 1", 2)
    # Code among the comment, or a change to their line: nothing is typed, and the pointing stays.
    for code in (typed + "\n    for i in range(n):", "def f(n):\n    total = 0\n    # try it"):
        _stub_steps(monkeypatch, CanvasStep(say="Look.", code=code, select="total = 1", select_line=2, cursor_line=2))
        step = h.code_assist(_hint("point"))["result"]["steps"][0]
        assert (step["code"], step["select"], step["cursor_line"]) == ("", "total = 1", 0)


def test_direct_still_only_starts_lines(monkeypatch):
    typed = "def f(n):\n    total = 0"
    _stub_steps(monkeypatch, CanvasStep(say="Next.", code=typed + "\n    for i in range(n):"))
    step = h.code_assist(_req(scope="pair", typed=typed))["result"]["steps"][0]
    assert step["code"] == typed + "\n    for "


def _pair_code(monkeypatch, typed, code, expected="def build(nums):\n    prefix = [0]\n    for x in nums:", erase=(), cursor=0):
    _stub_steps(monkeypatch, CanvasStep(say="Next.", code=code, erase=list(erase)))
    return h.code_assist(_req(scope="pair", expected=expected, typed=typed, cursor=cursor))["result"]["steps"][0]["code"]


def test_pairing_puts_back_a_line_it_changed_without_listing_it(monkeypatch):
    # The model renamed their parameter on its way to the next line: cut to a start, that left only "def ".
    typed = "def build(prerequisites):\n    prefix = [0]\n    "
    code = "def build(nums):\n    prefix = [0]\n    for x in nums:"
    assert _pair_code(monkeypatch, typed, code, cursor=3) == "def build(prerequisites):\n    prefix = [0]\n    for "
    # A line they only started stays as far as they got; a blank line can be filled.
    assert h.keep_their_lines("def f(n):\n    for i in range(n):", "def f(n):\n    for", set())[0] == "def f(n):\n    for"
    assert h.keep_their_lines("a\nb\nc", "a\n\nc", set())[0] == "a\nb\nc"
    assert h.keep_their_lines("a", " ", set())[0] == "a"


def test_pairing_deletes_exactly_the_lines_it_lists(monkeypatch):
    typed = "def build(nums):\n    junk = 1\n    prefix = [0]\n    other = 2"
    keep_two = "def build(nums):\n    prefix = [0]\n    other = 2"
    assert _pair_code(monkeypatch, typed, keep_two, erase=[2]) == keep_two
    # Dropping a line it didn't list, or listing a line it didn't touch: the line stays.
    assert _pair_code(monkeypatch, typed, keep_two) == typed
    assert _pair_code(monkeypatch, typed, keep_two, erase=[4]) == typed
    # Deleting a line and starting the next in one step.
    assert _pair_code(monkeypatch, "def build(nums):\n    junk = 1\n    prefix = [0]", "def build(nums):\n    prefix = [0]\n    for x in nums:",
                      erase=[2]) == "def build(nums):\n    prefix = [0]\n    for "


def test_pairing_types_a_listed_rewrite_whole(monkeypatch):
    typed = "def build(prerequisites):\n    prefix = [0]"
    code = "def build(nums):\n    prefix = [0]"
    assert _pair_code(monkeypatch, typed, code, erase=[1]) == code


def test_a_pairing_turn_says_when_it_proposes_a_fix(monkeypatch):
    out = intent.CodeAssist(steps=[CanvasStep(say="Line 2 has to go.", select="junk", select_line=2)], needs_fix=True)
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: out)
    assert h.code_assist(_req(scope="pair"))["result"]["needs_fix"] is True


def test_an_answer_to_what_it_said_is_judged_not_implemented(monkeypatch):
    said = dict(scope="ask", request="append the sum", last_said="What should each new entry hold?")
    assert h.render_inputs(_req(**said))["last_said"] == said["last_said"]
    # Whatever the model typed along with its word, nothing is typed.
    out = intent.CodeAssist(steps=[CanvasStep(say="Yes.", code="def f(n):\n    total = 0")], closing="Right: go ahead.", answered=True)
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: out)
    assert h.code_assist(_req(**said)) == {"reason": "Right: go ahead.", "answered": True}
    # Without anything said before, or when the model reads it as a request, it is done as asked.
    assert "result" in h.code_assist(_req(scope="ask", request="append the sum"))
    out.answered = False
    assert "result" in h.code_assist(_req(**said))


def test_the_code_canvas_is_for_focus_mode_and_the_levels_that_point(monkeypatch):
    mark = CanvasMark(kind="circle", line=1, text="n")
    drawn = lambda **kw: h.code_assist(_req(**kw))["result"]["steps"][0]["draw"]
    _stub_steps(monkeypatch, CanvasStep(say="Look.", draw=[mark]))
    assert drawn(scope="next", canvas=True)[0]["text"] == "n"
    _stub_steps(monkeypatch, CanvasStep(say="Look.", draw=[mark]))
    assert drawn(scope="next") == [], "not in focus mode"
    _stub_steps(monkeypatch, CanvasStep(say="Look.", draw=[mark]))
    assert drawn(scope="pair", hint_level="point", canvas=True)[0]["kind"] == "circle"
    for level in ("question", "vague"):
        _stub_steps(monkeypatch, CanvasStep(say="Why?", draw=[mark]))
        assert drawn(scope="pair", hint_level=level, canvas=True) == []


def test_marks_are_cleaned_and_a_drawing_step_stands_on_its_own():
    unknown = CanvasMark(kind="scribble", line=1)
    steps = intent.clean_steps([CanvasStep(say="One.", code="x"), CanvasStep(say="Look.", draw=[CanvasMark(kind="box", line=1), unknown])], editor="")
    assert [len(s.draw) for s in steps] == [0, 1], "talk with a drawing isn't joined to the step before"
    assert len(clean_marks([CanvasMark(kind="check", line=1)] * 40)) == 12


def test_a_line_moved_out_of_its_block_stays_moved():
    typed = "def f(n):\n    res = 1\n    while n > 0:\n        n //= 2\n        return res"
    fixed = "def f(n):\n    res = 1\n    while n > 0:\n        n //= 2\n    return res"
    assert intent.clean_steps([CanvasStep(say="Out of the loop.", code=fixed)], editor=typed)[0].code == fixed
    # Most lines moved is the copy re-indenting, not a fix; unless the step lists the line.
    assert intent.keep_lines("  a\n  b\n  c", "a\nb\nc") == "a\nb\nc"
    assert intent.keep_lines("  a\n  b\n  c", "a\nb\nc", {2}) == "a\n  b\nc"


def test_the_agent_sees_its_board_and_alone_takes_marks_off(monkeypatch):
    on = ["m1: circle line 4 \"half\""]
    assert h.render_inputs(_req(canvas=True, canvas_marks=on))["canvas_marks"] == on[0]
    assert "canvas_marks" not in h.render_inputs(_req(canvas_marks=on)), "off, it isn't told"
    cleared = lambda **kw: h.code_assist(_req(**kw))["result"]["steps"][0]["erase_marks"]
    step = lambda: CanvasStep(say="Moving on.", erase_marks=["m1"])
    _stub_steps(monkeypatch, step())
    assert cleared(scope="next", canvas=True) == ["m1"]
    _stub_steps(monkeypatch, step())
    assert cleared(scope="next") == []
    _stub_steps(monkeypatch, step())
    assert cleared(scope="pair", hint_level="vague", canvas=True) == []
    # Taking marks off is a move of its own: it isn't joined to the step before as talk.
    steps = intent.clean_steps([CanvasStep(say="One.", code="x"), CanvasStep(say="Clean.", erase_marks=["all", " "])], editor="")
    assert [s.erase_marks for s in steps] == [[], ["all"]]


def test_without_the_canvas_the_expert_is_not_told_of_drawing():
    plain = CodeAssistSig.instructions + str(CodeAssistSig.fields) + str(AssistStep.model_json_schema())
    for word in ("canvas", "`draw`", "erase_marks"):
        assert word not in plain
    drawing = CodeAssistCanvasSig.instructions + str(CodeAssistCanvasSig.fields["steps"].annotation)
    assert "code canvas" in drawing and "CanvasStep" in drawing
    assert "canvas_marks" in CodeAssistCanvasSig.input_fields
    assert set(h.render_inputs(_req(canvas=True))) | {"scope"} == set(CodeAssistCanvasSig.input_fields)


def test_each_mode_asks_its_own_signature(monkeypatch):
    used = []
    monkeypatch.setattr(intent, "_assistant", lambda canvas=False: used.append(canvas) or (lambda **_: SimpleNamespace(plan="", steps=[], closing="")))
    intent.assist_code("next", canvas=True, **{})
    intent.assist_code("next")
    assert used == [True, False]


def test_the_talk_so_far_reaches_the_model():
    assert h.render_inputs(_req(recent_turns=" Learner: why?\nYou: Because. "))["recent_turns"] == "Learner: why?\nYou: Because."
    assert h.render_inputs(_req())["recent_turns"] == ""



def test_a_request_for_a_comparison_goes_to_the_clients_compare(monkeypatch):
    monkeypatch.setattr(h, "assist_code", lambda scope, **_: intent.CodeAssist(compare=True, closing="words"))
    assert h.code_assist(_req(scope="ask", request="compare it with the original")) == {"compare": True}
    assert h.code_assist(_req(scope="pair", request="I just finished line 2: `# compare it`")) == {"compare": True}
    assert "compare" not in h.code_assist(_req(scope="next")), "only the learner's own words can ask for it"
