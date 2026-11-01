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
    blank = {"part": "", "write": "", "write_near": "", "erase": False, "arrow_to": "", "arrow_from": "", "arrow_kind": "arrow", "slider": "", "slider_to": None, "board": [], "erase_notes": [], "erase_draw": [], "together": [], "draw": None, "color": ""}
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


def test_a_link_is_an_arrow_or_a_plain_line():
    raw = [PresentStep(say="Same value.", arrow_to="nums[2]", arrow_from="row:count", arrow_kind="line"),
           PresentStep(say="Goes there.", arrow_to="nums[2]", arrow_kind="zigzag")]
    beats = intent.clean_steps(raw, {"nums", "nums[2]", "row:count"}, 0)
    assert [b.arrow_kind for b in beats] == ["line", "arrow"]


def test_a_mark_is_one_of_the_known_marks():
    raw = [PresentStep(say=m.title(), target="nums[2]", mark=m) for m in ("check", "cross", "underline", "star")]
    assert [b.mark for b in intent.clean_steps(raw, {"nums", "nums[2]"}, 0)] == ["check", "cross", "underline", "point"]


def test_a_drawing_keeps_known_shapes_and_links_between_what_is_drawn_or_listed():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="A tree.", draw=Drawing(layout="tree", elements=[
               E(type="ellipse", id="root", label="8"), E(type="ellipse", id="l", label="3"),
               E(type="arrow", start="root", end="l"), E(type="arrow", start="root", end="ghost"),
               E(type="star", id="s"), E(type="rectangle", id="box!", label="cell", x=150, y=-4),
               E(type="arrow", start="box", end="nums[2]"), E(type="text", label="smaller", near="l")])),
           PresentStep(say="Its root.", target="draw:root", mark="circle", part="8"),
           PresentStep(say="Grow it.", draw=Drawing(layout="weird", elements=[E(type="ellipse", id="r", label="10"),
                                                                             E(type="line", start="root", end="r")]))]
    beats = intent.clean_steps(raw, {"nums", "nums[2]"}, 0)
    d = beats[0].draw
    assert d.layout == "tree"
    assert [(e.type, e.id, e.start, e.end) for e in d.elements] == [
        ("ellipse", "root", "", ""), ("ellipse", "l", "", ""), ("arrow", "root_l", "root", "l"),
        ("rectangle", "box", "", ""), ("arrow", "box_nums2", "box", "nums[2]"), ("text", "", "", "")]
    assert (d.elements[3].x, d.elements[3].y, d.elements[5].near) == (100.0, 0.0, "l")
    assert (beats[1].target, beats[1].part) == ("draw:root", "8")
    assert beats[2].draw.layout == "" and beats[2].draw.elements[1].start == "root"


def test_a_beat_repeating_the_drawing_so_far_adds_only_what_is_new():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    first = [E(type="ellipse", id="a", label="8")]
    raw = [PresentStep(say="Root.", draw=Drawing(layout="tree", elements=first)),
           PresentStep(say="Child.", draw=Drawing(layout="tree", elements=[*first, E(type="ellipse", id="b", label="3"),
                                                                           E(type="arrow", start="a", end="b")]))]
    beats = intent.clean_steps(raw, set(), 0)
    assert [e.id for e in beats[1].draw.elements] == ["b", "a_b"]


def test_rubbing_out_a_shape_takes_its_links_and_lets_it_be_drawn_again():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Tree.", draw=Drawing(layout="tree", elements=[E(type="ellipse", id="a", label="8"), E(type="ellipse", id="b", label="3"),
                                                                          E(type="arrow", start="a", end="b"), E(type="text", id="t", label="leaf", near="b")])),
           PresentStep(say="Gone.", erase_draw=["b", "nope"], target="draw:b"),
           PresentStep(say="Back.", draw=Drawing(elements=[E(type="ellipse", id="b", label="5")]), target="draw:b")]
    beats = intent.clean_steps(raw, set(), 0)
    assert beats[1].erase_draw == ["b"] and beats[1].target == ""
    assert [e.id for e in beats[2].draw.elements] == ["b"] and beats[2].target == "draw:b"
    assert intent.clean_steps([*raw[:1], PresentStep(say="All.", erase=True, draw=Drawing(elements=[E(type="ellipse", id="a", label="8")]))], set(), 0)[1].draw.elements[0].id == "a"


def test_a_path_keeps_its_points_on_the_grid_and_needs_two():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Smile.", draw=Drawing(elements=[
        E(type="ellipse", id="face", x=50, y=50, w=40, h=60),
        E(type="path", id="smile", points=[[35, 60], [50, 72], [65, 160], [1]], closed=True),
        E(type="path", id="dot", points=[[10, 10]]),
        E(type="line", start="face", end="face", points=[[1, 2], [3, 4]], closed=True)]))]
    els = intent.clean_steps(raw, set(), 0)[0].draw.elements
    assert [e.id for e in els] == ["face", "smile", "face_face"]
    assert els[1].points == [[35, 60], [50, 72], [65, 100]] and els[1].closed
    assert els[2].points == [] and not els[2].closed


def test_a_free_arrow_runs_through_its_points_and_a_bad_one_is_dropped():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Add.", draw=Drawing(elements=[
        E(type="arrow", id="a", label="a", points=[[10, 80], [50, 60]]),
        E(type="arrow", id="b", label="b", start="nowhere", points=[[50, 60], [70, 20]]),
        E(type="line", id="c", points=[[1, 1]])]))]
    els = intent.clean_steps(raw, set(), 0)[0].draw.elements
    assert [(e.id, e.start, e.label) for e in els] == [("a", "", "a"), ("b", "", "b")]
    assert els[1].points == [[50, 60], [70, 20]]


def test_what_an_earlier_walk_through_left_can_be_pointed_at_built_on_and_rubbed_out():
    from backend.experts.handlers.scene_present.handler import render_inputs
    from backend.experts.handlers.scene_present.models import ScenePresentRequest
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    req = ScenePresentRequest(question="and now?", on_view={"notes": ["x = 3"], "drawn": [
        {"id": "a", "type": "ellipse", "label": "8"}, {"id": "b", "type": "ellipse", "label": "3"},
        {"id": "a_b", "type": "arrow", "joins": ["a", "b"]}]})
    assert render_inputs(req)["on_view"].splitlines() == ["note: x = 3", "draw:a: ellipse '8'", "draw:b: ellipse '3'", "draw:a_b: arrow (a -> b)"]
    assert render_inputs(ScenePresentRequest(question="q"))["on_view"].startswith("(nothing")
    raw = [PresentStep(say="That root.", target="draw:a", part="8"),
           PresentStep(say="That note.", target="note:x = 3"),
           PresentStep(say="Child.", draw=Drawing(elements=[E(type="ellipse", id="c", label="10"), E(type="arrow", start="a", end="c"), E(type="ellipse", id="a")])),
           PresentStep(say="Go.", erase_draw=["b"], target="draw:a_b")]
    beats = intent.clean_steps(raw, set(), 0, req.on_view)
    assert (beats[0].target, beats[0].part, beats[1].target) == ("draw:a", "8", "note:x = 3")
    assert [e.id for e in beats[2].draw.elements] == ["c", "a_c"]
    assert beats[3].erase_draw == ["b"] and beats[3].target == ""      # its link went with it


def test_groups_hold_what_names_them_and_rubbing_one_out_takes_what_is_in_it():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Two parts.", draw=Drawing(layout="row", elements=[
               E(type="group", id="tree", layout="tree", label="BST", align="sideways"), E(type="ellipse", id="n8", label="8", group="tree"),
               E(type="group", id="flow", layout="nope"), E(type="rectangle", id="b", label="hash", group="flow"),
               E(type="rectangle", id="c", label="lost", group="nowhere"), E(type="group", label="no id"),
               E(type="arrow", start="n8", end="b"), E(type="arrow", start="tree", end="flow")])),
           PresentStep(say="Tree goes.", erase_draw=["tree"]),
           PresentStep(say="Back.", target="draw:n8", draw=Drawing(elements=[E(type="ellipse", id="n9", group="tree")]))]
    beats = intent.clean_steps(raw, set(), 0)
    els = {e.id: e for e in beats[0].draw.elements}
    assert list(els) == ["tree", "n8", "flow", "b", "c", "n8_b", "tree_flow"] and beats[0].draw.layout == "row"
    assert (els["tree"].layout, els["tree"].align, els["tree"].label, els["n8"].group) == ("tree", "", "BST", "tree")
    assert (els["flow"].layout, els["b"].group, els["c"].group) == ("", "flow", "")
    assert beats[1].erase_draw == ["tree"]
    assert beats[2].target == "" and beats[2].draw.elements[0].group == ""      # n8 and the group went with it


def test_an_arrow_keeps_known_heads_and_a_beat_arrow_may_point_both_ways():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Swap.", arrow_to="row:count", arrow_kind="both", draw=Drawing(elements=[
        E(type="rectangle", id="a", label="a"), E(type="rectangle", id="b", label="b"),
        E(type="arrow", start="a", end="b", heads="both"), E(type="arrow", start="b", end="a", heads="sideways"),
        E(type="line", id="l", start="a", end="b", heads="both")]))]
    beat = intent.clean_steps(raw, {"row:count"}, 0)[0]
    assert [e.heads for e in beat.draw.elements[2:]] == ["both", "", ""]
    assert beat.arrow_kind == "both"


def test_an_outline_round_drawn_things_keeps_only_them_and_goes_with_them():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Leaves.", draw=Drawing(layout="tree", elements=[
               E(type="ellipse", id="r", label="20"), E(type="ellipse", id="a", label="10"), E(type="ellipse", id="b", label="30"),
               E(type="outline", id="sel", label="leaves", around=["a", "b", "ghost"]),
               E(type="outline", id="none", around=["ghost"]), E(type="arrow", id="x", start="r", end="a", around=["b"])])),
           PresentStep(say="One goes.", erase_draw=["a"], target="draw:sel")]
    beats = intent.clean_steps(raw, set(), 0)
    els = {e.id: e for e in beats[0].draw.elements}
    assert els["sel"].around == ["a", "b"] and "none" not in els and els["x"].around == []
    assert beats[1].target == ""            # the outline went with what it held


def test_ids_named_as_targets_with_draw_in_front_still_count():
    from backend.experts.handlers.scene_present.models import ScenePresentRequest
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    left = ScenePresentRequest(question="q", on_view={"drawn": [{"id": "n10", "type": "ellipse", "label": "10"},
                                                                {"id": "n30", "type": "ellipse", "label": "30"}]}).on_view
    raw = [PresentStep(say="Both.", draw=Drawing(elements=[E(type="outline", id="s", around=["draw:n10", "draw:n30"]),
                                                           E(type="arrow", start="draw:n10", end="draw:n30")])),
           PresentStep(say="Gone.", erase_draw=["draw:s"])]
    beats = intent.clean_steps(raw, set(), 0, left)
    els = beats[0].draw.elements
    assert els[0].around == ["n10", "n30"] and (els[1].start, els[1].end) == ("n10", "n30")
    assert beats[1].erase_draw == ["s"]


def test_a_mark_can_take_more_refs_together_and_a_bare_drawn_id_counts():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="Tree.", draw=Drawing(layout="tree", elements=[E(type="ellipse", id="n10", label="10"), E(type="ellipse", id="n30", label="30")])),
           PresentStep(say="Both.", target="draw:n10", mark="circle", together=["n30", "draw:n10", "ghost", "row:count"]),
           PresentStep(say="None.", together=["n30"])]
    beats = intent.clean_steps(raw, {"row:count"}, 0)
    assert beats[1].together == ["draw:n30", "row:count"]
    assert beats[2].together == []          # nothing to go with


def test_an_array_is_drawn_as_a_row_of_cells_each_its_own_thing():
    from backend.experts.modules.scene_present.signature import DrawElement as E, Drawing
    raw = [PresentStep(say="The table.", draw=Drawing(elements=[E(type="array", id="lps", label="lps", values=["0", "0", "1", "2"], color="yellow")])),
           PresentStep(say="This one.", target="draw:lps_2", mark="circle")]
    beats = intent.clean_steps(raw, set(), 0)
    els = beats[0].draw.elements
    assert [(e.type, e.id, e.group) for e in els] == [("group", "lps", ""), ("text", "lps_name", "lps")] + [("rectangle", f"lps_{i}", "lps") for i in range(4)]
    assert els[0].layout == "cells" and [e.label for e in els[2:]] == ["0", "0", "1", "2"] and els[2].color == "yellow"
    assert beats[1].target == "draw:lps_2"
