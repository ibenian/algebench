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
    blank = {"write": "", "write_near": "", "erase": False, "arrow_to": "", "arrow_from": ""}
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
