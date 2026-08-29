"""The acknowledgement the chat agent gets for a `build_scene` call.

Extracted from `call_gemini_chat` to be testable at all: that function needs a
live Gemini client, so every branch inside it — including this one — was
unreachable from a test.
"""
from __future__ import annotations

from backend.server import build_scene_tool_result


def test_a_usable_call_is_acknowledged_without_claiming_success():
    """The expert can still refuse or ask a question, and this is written before
    it has even been called. Claiming the scene exists would have the agent
    describe one the reader may never see."""
    out = build_scene_tool_result({"intent": "show the tangent plane"})
    assert out["status"] == "success" and out["initiated"] is True
    assert "started" in out["message"]
    assert "do NOT call" in out["message"], "the agent must not also navigate"


def test_a_missing_intent_is_a_structured_error():
    for args in ({}, {"intent": ""}, {"intent": "   "}):
        out = build_scene_tool_result(args)
        assert out["status"] == "error" and "`intent` is required" in out["error"]


def test_a_replace_without_a_scene_number_is_a_structured_error():
    out = build_scene_tool_result({"intent": "redo it", "op": "replace"})
    assert out["status"] == "error" and "needs `scene`" in out["error"]
    # …and naming one is fine.
    assert build_scene_tool_result({"intent": "redo it", "op": "replace",
                                    "scene": 2})["status"] == "success"


def test_a_non_string_intent_is_refused_not_coerced():
    """`intent` is declared STRING and required, so this is a schema violation
    rather than something a well-behaved model does — but the two ways of being
    defensive are not equal. Coercing with `str()` made `{'a': 1}` into the
    truthy text of its own repr, so the agent was told the build had started and
    the client, which accepts only a string, then refused it. Refusing here keeps
    the two ends saying the same thing."""
    for weird in ({"oops": 1}, ["a", "b"], 42, True):
        out = build_scene_tool_result({"intent": weird})
        assert out["status"] == "error", f"{weird!r} was acknowledged"
        assert "`intent` is required" in out["error"]


# ---- `scene` is declared INTEGER, so 0 and -1 are things a model may really send

def test_replace_accepts_scene_0_because_the_client_does():
    """The bug this pair exists for. `not tc_args.get('scene')` read a
    schema-VALID 0 as missing, while `sceneIndexFromArgs` deliberately reads it as
    a model that numbered from zero and meant the FIRST scene. The server refused
    a call the client would have run."""
    out = build_scene_tool_result({"intent": "redo it", "op": "replace", "scene": 0})
    assert out["status"] == "success", out.get("error")


def test_replace_refuses_a_negative_scene_because_the_client_does():
    """The other half: truthiness waved -1 through, so the agent was told the
    build had started and the client then refused it — leaving the agent
    describing a scene the reader never sees."""
    for bad in (-1, -5, "-2"):
        out = build_scene_tool_result({"intent": "redo it", "op": "replace", "scene": bad})
        assert out["status"] == "error", f"{bad!r} was acknowledged"
        assert "1-based number" in out["error"]
        assert repr(bad) in out["error"] or "-" in out["error"], "say what was wrong"


def test_replace_refuses_a_scene_that_is_not_a_number():
    for bad in ("two", {"n": 1}, ["1"], True):
        out = build_scene_tool_result({"intent": "redo it", "op": "replace", "scene": bad})
        assert out["status"] == "error", f"{bad!r} was acknowledged"


def test_replace_still_distinguishes_absent_from_invalid():
    """Two different mistakes deserve two different messages: nothing was named,
    versus something unusable was. Collapsing them would tell a model that wrote
    `scene: -1` that it forgot the field."""
    absent = build_scene_tool_result({"intent": "redo it", "op": "replace"})
    assert "needs `scene`" in absent["error"]
    invalid = build_scene_tool_result({"intent": "redo it", "op": "replace", "scene": -1})
    assert "needs `scene`" not in invalid["error"]


def test_an_insert_does_not_care_about_scene():
    """Only `replace` is destructive. An insert with no scene appends, which is
    a different instruction — not a missing one."""
    for args in ({}, {"scene": 0}, {"scene": -3}):
        out = build_scene_tool_result({"intent": "add one", **args})
        assert out["status"] == "success", out.get("error")
