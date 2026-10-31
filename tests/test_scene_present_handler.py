"""The scene-present handler: its inputs, routing and cleaning; the LM is stubbed."""
from __future__ import annotations

from types import SimpleNamespace

from backend.experts.handlers.scene_present import handler as h
from backend.experts.handlers.scene_present.models import ScenePresentRequest
from backend.experts.modules.scene_present import intent
from backend.experts.modules.scene_present.signature import INPUT_FIELDS, PresentStep


def _req(**kw) -> ScenePresentRequest:
    base = dict(question="Why does count[1] become 2?", lesson="Hash map: subarray sum", view="count = {0: 1}",
                frames=[{"n": 0, "text": "start"}, {"n": 1, "text": "num = 1"}], frame=0,
                targets=[{"ref": "nums[2]", "about": "-2"}, {"ref": "row:count", "about": "count = {0: 1}"}, {"ref": "slider"}])
    return ScenePresentRequest(**{**base, **kw})


def test_inputs_cover_the_signature_and_list_targets_and_frames():
    inputs = h.render_inputs(_req())
    assert set(inputs) == set(INPUT_FIELDS)
    assert inputs["targets"].splitlines() == ["nums[2]: -2", "row:count: count = {0: 1}", "slider"]
    assert inputs["frames"].splitlines()[-1] == "on screen now: 0"
    assert h.render_inputs(_req(frames=[], frame=-1))["frames"] == ""
    with_state = h.render_inputs(_req(frames=[{"n": 0, "text": "start", "state": "running_sum=0, keys=[0]"}]))["frames"]
    assert with_state.splitlines()[0] == "0: start  [running_sum=0, keys=[0]]"


def test_beats_point_only_at_listed_refs_and_move_only_within_the_run(monkeypatch):
    raw = [PresentStep(say="Look at `this` cell.", target="nums[2]", mark="circle", frame=1),
           PresentStep(say="And this.", target="nums[9]", mark="zap", frame=7),
           PresentStep(say="  ", target="nums[2]")]
    monkeypatch.setattr(intent, "_presenter", lambda: (lambda **_: SimpleNamespace(steps=raw)))
    out = h.scene_present(_req())["result"]["steps"]
    blank = {"part": "", "write": "", "write_near": "", "erase": False, "arrow_to": "", "arrow_from": "", "slider": "", "slider_to": None, "board": [], "erase_notes": [], "color": ""}
    assert out == [{"say": "Look at this cell.", "target": "nums[2]", "mark": "circle", "frame": 1, **blank},
                   {"say": "And this.", "target": "", "mark": "point", "frame": -1, **blank}]


def test_failure_and_nothing_to_show_are_reasons(monkeypatch):
    monkeypatch.setattr(h, "present", lambda target_refs, frame_count, **_: intent.Presentation(error="down"))
    assert h.scene_present(_req()) == {"reason": "down"}
    monkeypatch.setattr(h, "present", lambda target_refs, frame_count, **_: intent.Presentation())
    assert h.scene_present(_req()) == {"reason": h.NOTHING}


def test_a_line_written_keeps_its_math_and_code_and_sits_only_beside_a_listed_ref(monkeypatch):
    raw = [PresentStep(say="So.", write="$1 - 3 = -2$ and `x`\nmore", write_near="row:count", erase=True),
           PresentStep(say="Then.", write="note", write_near="nowhere"),
           PresentStep(say="Done.", write_near="row:count")]
    monkeypatch.setattr(intent, "_presenter", lambda: (lambda **_: SimpleNamespace(steps=raw)))
    out = h.scene_present(_req())["result"]["steps"]
    assert [(s["write"], s["write_near"], s["erase"]) for s in out] == [
        ("$1 - 3 = -2$ and `x`", "row:count", True), ("note", "", False), ("", "", False)]


def test_an_arrow_runs_between_listed_refs_only(monkeypatch):
    raw = [PresentStep(say="This.", arrow_to="nums[2]", arrow_from="row:count"),
           PresentStep(say="That.", arrow_to="nowhere", arrow_from="nums[2]"),
           PresentStep(say="From here.", arrow_to="nums[2]", arrow_from="nowhere")]
    monkeypatch.setattr(intent, "_presenter", lambda: (lambda **_: SimpleNamespace(steps=raw)))
    out = h.scene_present(_req())["result"]["steps"]
    assert [(s["arrow_from"], s["arrow_to"]) for s in out] == [("row:count", "nums[2]"), ("", ""), ("", "nums[2]")]


def test_spoken_text_loses_math_code_and_emphasis_marks():
    assert intent._clean("so $1 - 3 = -2$ and it *does* matter, `x` **twice** 2 * 3") == "so 1 - 3 = -2 and it does matter, x twice 2 * 3"


def test_a_slider_move_needs_a_listed_slider_and_a_number(monkeypatch):
    raw = [PresentStep(say="Raise it.", slider="slider:theta", slider_to=1.2),
           PresentStep(say="Not a slider.", slider="nums[2]", slider_to=1),
           PresentStep(say="No value.", slider="slider:theta")]
    monkeypatch.setattr(intent, "_presenter", lambda: (lambda **_: SimpleNamespace(steps=raw)))
    targets = [{"ref": "slider:theta", "about": "angle"}, {"ref": "nums[2]", "about": "-2"}]
    out = h.scene_present(_req(targets=targets))["result"]["steps"]
    assert [(s["slider"], s["slider_to"]) for s in out] == [("slider:theta", 1.2), ("", None), ("", None)]


def test_notes_are_sent_to_the_board_or_wiped_by_their_text(monkeypatch):
    raw = [PresentStep(say="Write.", write="1 - 3 = -2"),
           PresentStep(say="Keep it.", board=["1 - 3 = -2", "  "], erase_notes=["old note"])]
    monkeypatch.setattr(intent, "_presenter", lambda: (lambda **_: SimpleNamespace(steps=raw)))
    out = h.scene_present(_req())["result"]["steps"]
    assert (out[1]["board"], out[1]["erase_notes"]) == (["1 - 3 = -2"], ["old note"])


def test_several_cells_are_a_slice_or_a_list_of_listed_cells_and_a_tensor_takes_any_index():
    refs = {"nums", "nums[0]", "nums[1]", "nums[2]", "nums[3]", "g", "g[0]", "g[1]", "g[2]", "T"}
    assert intent._ref("nums[1:4]", refs) == "nums[1:4]"
    assert intent._ref("nums[2:3]", refs) == "nums[2]"   # one cell is that cell
    assert intent._ref("nums[2:9]", refs) == ""          # runs past the array
    assert intent._ref("nums[3:1]", refs) == ""
    assert intent._ref("g[0, 2]", refs) == "g[0,2]"
    assert intent._ref("g[0,5]", refs) == ""
    assert intent._ref("other[0:2]", refs) == ""
    assert intent._ref("T[1, :]", refs) == "T[1, :]"
    assert intent._ref("T[0:2, 1:3]", refs) == "T[0:2, 1:3]"
    assert intent._ref("T[x]", refs) == ""


def test_a_beat_points_at_a_run_of_cells(monkeypatch):
    raw = [PresentStep(say="This window.", target="nums[1:3]", mark="circle", write="2 + -2 = 0", write_near="nums[0,2]")]
    beat, = intent.clean_steps(raw, {"nums", "nums[0]", "nums[1]", "nums[2]"}, 0)
    assert (beat.target, beat.write_near) == ("nums[1:3]", "nums[0,2]")


def test_ink_is_one_of_the_colours_or_green():
    raw = [PresentStep(say="a", color="Red"), PresentStep(say="b", color="gray"), PresentStep(say="c", color="green")]
    assert [b.color for b in intent.clean_steps(raw, set(), 0)] == ["red", "", ""]


def test_a_beat_points_at_a_note_written_before_it_and_at_words_in_it():
    raw = [PresentStep(say="Too early.", target="note:def build_lps(nums):"),
           PresentStep(say="Write.", write="def  build_lps(nums):"),
           PresentStep(say="This name.", target="note:def build_lps(nums):", part="build_lps", mark="underline"),
           PresentStep(say="Not in it.", target="note:def build_lps(nums):", part="kmp"),
           PresentStep(say="A part needs a note.", target="nums[2]", part="build_lps"),
           PresentStep(say="From the note.", arrow_to="nums[2]", arrow_from="note:def build_lps(nums):"),
           PresentStep(say="Never written.", target="note:x = 1")]
    beats = intent.clean_steps(raw, {"nums", "nums[0]", "nums[1]", "nums[2]"}, 0)
    assert [(b.target, b.part, b.mark) for b in beats] == [
        ("", "", "point"), ("", "", "point"), ("note:def build_lps(nums):", "build_lps", "underline"),
        ("note:def build_lps(nums):", "", "point"), ("nums[2]", "", "point"), ("", "", "point"), ("", "", "point")]
    assert (beats[5].arrow_from, beats[5].arrow_to) == ("note:def build_lps(nums):", "nums[2]")
