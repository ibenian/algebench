"""The language the AI speaks to the user in, carried per request.

The client picks it (a setting in the chat toolbar, or the chat agent's ``set_language`` tool) and sends it on every
API request in the ``X-AlgeBench-Language`` header; the server keeps no state for it. :func:`language_middleware`
reads the header into a context variable for the request, so every AI call made while serving it can ask
:func:`current`.

The language is for **communication only**: what the user reads or hears (chat replies, hints, questions, spoken
lines). Everything a program reads stays exactly as it was, in English: tool calls and their arguments, ids, refs,
code, expressions, LaTeX, structured fields, and content that is saved or shared (scenes, proofs, graph metadata).
So the chat agents always get :func:`chat_note`, but a DSPy expert gets :func:`expert_note` only inside
:func:`speaking`, which the expert service enters for the handlers registered as speaking to the user.
"""
from __future__ import annotations

import contextlib
import contextvars
import functools
import re
from urllib.parse import unquote
from typing import Callable, Iterator, TypeVar

DEFAULT = "English (US)"
HEADER = "X-AlgeBench-Language"
MAX_CHARS = 20

_language: contextvars.ContextVar[str] = contextvars.ContextVar("reply_language", default=DEFAULT)
_speaking: contextvars.ContextVar[bool] = contextvars.ContextVar("reply_language_speaking", default=False)

# Letters of any script, digits, spaces and the punctuation a language name uses ("Chinese (Simplified)",
# "Portuguese - Brazil", "Norsk bokmål"). Anything else is dropped, so a header can't carry an instruction.
_NOT_ALLOWED = re.compile(r"[^\w\s().,'\-]", re.UNICODE)

T = TypeVar("T")


def clean(raw: str | None) -> str:
    """The language named by ``raw``, at most :data:`MAX_CHARS` characters; :data:`DEFAULT` when it names none."""
    text = " ".join(_NOT_ALLOWED.sub("", raw or "").replace("_", " ").split())[:MAX_CHARS].strip()
    return text or DEFAULT


def current() -> str:
    """The language of the request being served (:data:`DEFAULT` outside one)."""
    return _language.get()


def set_current(raw: str | None) -> str:
    """Make ``raw`` (cleaned) the language for the rest of this context, as when the user asks the chat to switch."""
    lang = clean(raw)
    _language.set(lang)
    return lang


def is_default(lang: str | None = None) -> bool:
    return (lang or current()).casefold() in {DEFAULT.casefold(), "english"}


def in_context(fn: Callable[[], T]) -> Callable[[], T]:
    """``fn`` bound to a copy of the current context, for ``loop.run_in_executor`` (which, unlike
    ``asyncio.to_thread``, does not carry context variables into the worker thread)."""
    return functools.partial(contextvars.copy_context().run, fn)


class LanguageMiddleware:
    """ASGI middleware: read the request's language header into the context for the rest of the request.

    Plain ASGI rather than ``BaseHTTPMiddleware``, so a streamed response (TTS) and ``request.is_disconnected()``
    behave exactly as without it."""

    _HEADER = HEADER.lower().encode()

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        raw = next((v for k, v in scope.get("headers") or [] if k == self._HEADER), b"")
        token = _language.set(clean(unquote(raw.decode("latin-1"))))   # the client percent-encodes it (headers are Latin-1)
        try:
            await self.app(scope, receive, send)
        finally:
            _language.reset(token)


@contextlib.contextmanager
def speaking(on: bool = True) -> Iterator[None]:
    """Within this block, DSPy calls write their user-facing text in the request's language (see ``LanguageLM``)."""
    token = _speaking.set(on)
    try:
        yield
    finally:
        _speaking.reset(token)


def chat_note(lang: str | None = None, *, can_switch: bool = True) -> str:
    """The system-prompt section telling a chat agent which language to talk to the user in; ``can_switch`` when it
    has the ``set_language`` tool."""
    lang = lang or current()
    return (
        "\n## Language\n"
        f"The user's language is {lang}. Write everything addressed to the user in {lang}: your replies, questions, "
        f"hints, info overlay text and suggested prompts, even when the user or the lesson writes in another language. "
        "Everything a program reads stays exactly as it is, in English: tool names, argument names and values that "
        "name things (ids, refs, slider ids, scene and step numbers), code and its identifiers, expressions and "
        "LaTeX, and names quoted from the lesson. A tool argument that hands a request to another AI (such as "
        "`question`, `intent` or `prompt`) is written in English."
        + (" When the user asks to talk in another language, call `set_language` with it." if can_switch else "")
        + "\n"
    )


def expert_note(lang: str | None = None) -> str:
    """The instruction a speaking DSPy expert gets, after its own system prompt."""
    lang = lang or current()
    return (
        f"\n\nLanguage: write the text meant for the learner to read or hear (spoken lines, explanations, hints, "
        f"questions, feedback) in {lang}. Everything else stays exactly as specified, in English: the field names "
        "and their [[ ## ... ## ]] markers, values chosen from a fixed set, refs and ids, code and its comments and "
        "identifiers, expressions, LaTeX and JSON."
    )


def expert_messages(messages: list[dict]) -> list[dict]:
    """``messages`` with :func:`expert_note` added to the system message, when speaking in a language other than
    the default; otherwise ``messages`` unchanged (so the default keeps the experts' prompts byte for byte)."""
    if not _speaking.get() or is_default() or not messages:
        return messages
    note = expert_note()
    if messages[0].get("role") == "system" and isinstance(messages[0].get("content"), str):
        return [{**messages[0], "content": messages[0]["content"] + note}, *messages[1:]]
    return [{"role": "system", "content": note.strip()}, *messages]


def tts_style(style: str | None, lang: str | None = None) -> str | None:
    """The TTS ``style`` with a pronunciation line for the request's language added (``style`` as it is for the
    default). The TTS library has no language parameter yet, so the voice is told in its style guidance."""
    lang = lang or current()
    if is_default(lang):
        return style
    note = f"The listener's language is {lang}: read the words in {lang} with native {lang} pronunciation."
    return f"{style} {note}" if style else note
