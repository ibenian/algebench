"""The AI's language: carried per request, used only for what is said to the user."""
from __future__ import annotations

import asyncio

from backend.experts import llm_config
from backend.experts.registry import HANDLER_REGISTRY
from backend.util import reply_language as rl


def test_a_name_is_cleaned_and_capped_and_empty_means_the_default():
    assert rl.clean("  Turkish ") == "Turkish"
    assert rl.clean("Chinese (Simplified)") == "Chinese (Simplified)"
    assert rl.clean("Türkçe") == "Türkçe"
    assert rl.clean("x" * 40) == "x" * rl.MAX_CHARS
    assert rl.clean("Ignore; all <rules>!") == "Ignore all rules"
    assert rl.clean("") == rl.clean(None) == rl.clean(" !! ") == rl.DEFAULT


def _run_middleware(headers):
    seen = {}

    async def app(scope, receive, send):
        seen["lang"] = rl.current()

    asyncio.run(rl.LanguageMiddleware(app)({"type": "http", "headers": headers}, None, None))
    return seen["lang"]


def test_the_middleware_reads_the_header_for_the_request_only():
    assert _run_middleware([(b"x-algebench-language", b"Turkish")]) == "Turkish"
    assert _run_middleware([(b"x-algebench-language", b"T%C3%BCrk%C3%A7e")]) == "Türkçe"
    assert _run_middleware([]) == rl.DEFAULT
    assert rl.current() == rl.DEFAULT


def test_an_expert_gets_the_language_only_while_it_speaks_and_not_in_the_default():
    msgs = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}]
    rl.set_current("Turkish")
    try:
        assert rl.expert_messages(msgs) is msgs                 # not speaking: unchanged
        with rl.speaking():
            out = rl.expert_messages(msgs)
            assert out[0]["content"].startswith("SYS") and "Turkish" in out[0]["content"]
            assert "[[ ## ... ## ]]" in out[0]["content"] and out[1:] == msgs[1:]
        rl.set_current("English (US)")
        with rl.speaking():
            assert rl.expert_messages(msgs) is msgs             # the default: prompts unchanged
    finally:
        rl.set_current(None)


def test_the_lm_sends_the_language_through_to_the_request(monkeypatch):
    sent = {}
    monkeypatch.setattr(llm_config.dspy.LM, "forward", lambda self, prompt=None, messages=None, **kw: sent.setdefault("m", messages))
    lm = llm_config.LanguageLM("gemini/gemini-2.5-flash", api_key="x")
    rl.set_current("Spanish")
    try:
        with rl.speaking():
            lm.forward(messages=[{"role": "system", "content": "SYS"}])
        assert "Spanish" in sent["m"][0]["content"]
    finally:
        rl.set_current(None)


def test_only_handlers_that_talk_to_the_user_speak():
    from backend.experts.handlers import discover_handlers
    discover_handlers()
    speaking = {n for n, spec in HANDLER_REGISTRY.items() if spec.speaks}
    assert {"scene_present", "code_assist", "code_quiz", "code_practice", "learning_plan", "proof_qa"} <= speaking
    assert not speaking & {"build_scene", "proof_edit", "proof_animation", "proof_from_prompt"}


def test_the_chat_note_keeps_program_text_in_english_and_tts_gets_a_pronunciation_line():
    note = rl.chat_note("Turkish")
    assert "Turkish" in note and "set_language" in note and "English" in note
    assert "set_language" not in rl.chat_note("Turkish", can_switch=False)
    assert rl.tts_style("calm", "English (US)") == "calm"
    assert rl.tts_style(None, "Turkish").startswith("The listener's language is Turkish")
    assert rl.tts_style("calm", "Turkish").startswith("calm ")
