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


def test_a_non_string_intent_does_not_crash_the_tool_loop():
    """`tc_args` comes from the model through proto conversion, so a truthy
    non-string is something it can produce. `.strip()` on a dict raises
    AttributeError, which would take down the WHOLE tool-call loop — every other
    tool in the same response with it — instead of returning an error the agent
    can read and correct."""
    for weird in ({"oops": 1}, ["a", "b"], 42, True):
        out = build_scene_tool_result({"intent": weird})
        assert out["status"] in ("success", "error"), f"{weird!r} crashed the branch"
