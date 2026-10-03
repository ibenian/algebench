"""A text-only chat turn (``no_tools``) — the learning plan's guide.

The guide's prompt quotes plan text that may come from an imported file, so the
turn it starts must not be able to act on the app: no tools are offered, and the
message is never read as a navigation command.
"""
from __future__ import annotations

from types import SimpleNamespace

import backend.server as server


class _FakeModels:
    def __init__(self):
        self.configs = []

    def generate_content(self, model, contents, config):
        self.configs.append(config)
        part = SimpleNamespace(text="Here is what this step shows.", function_call=None)
        cand = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason="STOP")
        return SimpleNamespace(candidates=[cand], text=part.text, function_calls=None)


def _wire(monkeypatch):
    models = _FakeModels()
    monkeypatch.setattr(server, "get_gemini_client", lambda: SimpleNamespace(models=models))
    return models


def test_no_tools_offers_no_tools_and_skips_navigation(monkeypatch):
    models = _wire(monkeypatch)

    def nav_must_not_run(*_a, **_k):
        raise AssertionError("a text-only turn must not be read as navigation")

    monkeypatch.setattr(server, "_detect_navigation", nav_must_not_run)
    # Text that would read as a navigation command on a normal turn.
    text, tool_calls, _ = server.call_gemini_chat("next step please", [], {}, no_tools=True)
    assert tool_calls == []
    assert models.configs and not models.configs[0].tools
    assert "step" in text


def test_a_normal_turn_still_offers_tools(monkeypatch):
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)
    server.call_gemini_chat("what is drag?", [], {})
    assert models.configs and models.configs[0].tools


def test_no_tools_drops_a_tool_call_recovered_from_inline_json(monkeypatch):
    """With no tools offered, the model may write its preset prompts as inline
    JSON, which the server normally turns into a set_preset_prompts call."""
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)

    def inline(model, contents, config):
        models.configs.append(config)
        text = 'Sure. {"prompts": ["Next?", "Why?"]}'
        part = SimpleNamespace(text=text, function_call=None)
        cand = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason="STOP")
        return SimpleNamespace(candidates=[cand], text=text, function_calls=None)

    models.generate_content = inline
    text, tool_calls, _ = server.call_gemini_chat("explain", [], {}, no_tools=True)
    assert tool_calls == []
    assert "prompts" not in text


def test_no_tools_never_executes_a_function_call_in_the_reply(monkeypatch):
    """Even if the model returns a function call on a text-only turn, the tool
    executor must not run it (it would act before the result is discarded)."""
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)

    def with_call(model, contents, config):
        models.configs.append(config)
        call = SimpleNamespace(name="mem_set", args={"key": "k", "value": "v"})
        parts = [SimpleNamespace(text="Here you go.", function_call=None),
                 SimpleNamespace(text=None, function_call=call)]
        cand = SimpleNamespace(content=SimpleNamespace(parts=parts), finish_reason="STOP")
        return SimpleNamespace(candidates=[cand], text="Here you go.", function_calls=[call])

    models.generate_content = with_call
    text, tool_calls, _ = server.call_gemini_chat("explain", [], {}, no_tools=True)
    assert tool_calls == []
    assert "Here you go." in text
    assert len(models.configs) == 1, "no second turn to report a tool result"


def _replying(models, text):
    def reply(model, contents, config):
        models.configs.append(config)
        part = SimpleNamespace(text=text, function_call=None)
        cand = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason="STOP")
        return SimpleNamespace(candidates=[cand], text=text, function_calls=None)
    return reply


def test_a_tool_call_written_as_text_never_reaches_the_learner(monkeypatch):
    """Observed on a guide turn: with no tools offered, the model wrote the call
    out as a <tool_code> block, and the chat showed it verbatim."""
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)
    models.generate_content = _replying(models, (
        "The light cone splits spacetime into past, future and elsewhere.\n\n"
        "<tool_code> set_preset_prompts(prompts=[\"What is 'elsewhere'?\", "
        "\"Can a worldline cross the lightcone?\"]) </tool_code>"))
    text, tool_calls, _ = server.call_gemini_chat("explain", [], {}, no_tools=True)
    assert text == "The light cone splits spacetime into past, future and elsewhere."
    assert tool_calls == []


def test_a_text_only_turn_is_told_it_has_no_tools(monkeypatch):
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)
    server.call_gemini_chat("explain", [], {}, no_tools=True)
    server.call_gemini_chat("explain", [], {})
    guide, normal = models.configs
    assert server.NO_TOOLS_NOTE in guide.system_instruction
    assert server.NO_TOOLS_NOTE not in normal.system_instruction


def _strip(text):
    calls = []
    return server._strip_written_tool_calls(text, calls), calls


def test_written_tool_calls_are_stripped_and_prose_is_kept():
    assert _strip("Hi.\n```tool_code\nnavigate_to(scene=2, step=1)\n```") == ("Hi.", [])
    assert _strip("Hi.\n<tool_code>set_camera(view='top')")[0] == "Hi."   # unclosed tag
    prose = "Call set_preset_prompts(prompts) to change the chips, as described above."
    assert _strip(prose) == (prose, [])   # mentioned, not written as a call: kept, never run
    assert _strip("Nothing to strip.") == ("Nothing to strip.", [])


def test_a_written_preset_prompts_call_becomes_the_real_call():
    """Like inline JSON: the chips still appear instead of just vanishing."""
    # The reply that was observed, shape for shape.
    written = """<tool_code> set_preset_prompts(prompts=["What is 'elsewhere'?", "Why 45°?"]) </tool_code>"""
    text, calls = _strip("Light is the limit.\n" + written)
    assert text == "Light is the limit."
    assert [c["name"] for c in calls] == ["set_preset_prompts"]
    assert calls[0]["args"] == {"prompts": ["What is 'elsewhere'?", "Why 45°?"]}
    _, calls = _strip("Hi.\nprint(default_api.set_preset_prompts(['a (b)', 'c']))")
    assert calls[0]["args"] == {"prompts": ["a (b)", "c"]}


def test_only_literal_string_lists_are_recovered():
    for written in ("set_preset_prompts(prompts=make_prompts())", "set_preset_prompts(prompts=[1, 2])",
                    "set_preset_prompts(prompts=[])", "set_preset_prompts(prompts=['a'"):
        text, calls = _strip(f"Hi.\n<tool_code>{written}</tool_code>")
        assert (text, calls) == ("Hi.", []), written


def test_a_normal_turn_gets_the_recovered_chips(monkeypatch):
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: None)
    models.generate_content = _replying(models, (
        "The cone is the speed limit.\n<tool_code>set_preset_prompts(prompts=['Why a cone?'])</tool_code>"))
    text, tool_calls, _ = server.call_gemini_chat("explain", [], {})
    assert text == "The cone is the speed limit."
    assert [(c["name"], c["args"]) for c in tool_calls] == [("set_preset_prompts", {"prompts": ["Why a cone?"]})]


def test_the_next_step_shortcut_reply_is_cleaned_too(monkeypatch):
    """`next` takes the navigation shortcut, which has its own model call and
    return; that reply gets the same cleanup and preset recovery."""
    models = _wire(monkeypatch)
    monkeypatch.setattr(server, "_detect_navigation", lambda *_a, **_k: (1, 2, "next"))
    models.generate_content = _replying(models, (
        "Now the light clock ticks.\n<tool_code>set_preset_prompts(prompts=['Why slower?'])</tool_code>"))
    text, tool_calls, _ = server.call_gemini_chat("next", [], {"currentScene": {"steps": [{}, {}]}})
    assert text == "Now the light clock ticks."
    assert ("set_preset_prompts", {"prompts": ["Why slower?"]}) in [(c["name"], c.get("args")) for c in tool_calls]
