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
