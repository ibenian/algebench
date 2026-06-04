"""DSPy language-model configuration.

Configures DSPy to talk to Gemini via litellm (``gemini/<model>``). Reads the
same ``GEMINI_API_KEY`` / ``GEMINI_MODEL`` env vars the rest of the project
uses, so no new configuration surface is introduced. The DSPy experts are an
independent stack from the pydantic-ai enricher; both can coexist.
"""

from __future__ import annotations

import os

import dspy

# The expert emits large structured trajectories, so it needs a model with a
# generous output-token budget (gemini-2.0-flash caps at 8192 and truncates).
# Default to gemini-2.5-flash; override with ALGEBENCH_LM_MODEL (a full litellm
# model string, e.g. ``gemini/gemini-2.5-pro``).
_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
LM_MODEL = os.environ.get("ALGEBENCH_LM_MODEL") or f"gemini/{_DEFAULT_GEMINI_MODEL}"

_configured = False


def make_lm(temperature: float = 0.7, max_tokens: int = 32768) -> dspy.LM:
    """Construct (but do not install) a DSPy LM for the configured Gemini model.

    ``ALGEBENCH_LM_REASONING`` (e.g. ``low`` / ``minimal`` / ``disable``) tunes
    the Gemini thinking budget via litellm's ``reasoning_effort`` — lowering it
    cuts per-call latency markedly, which matters during optimization.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    kwargs = dict(api_key=api_key, temperature=temperature, max_tokens=max_tokens)
    effort = os.environ.get("ALGEBENCH_LM_REASONING")
    if effort:
        kwargs["reasoning_effort"] = effort
    return dspy.LM(LM_MODEL, **kwargs)


def configure_dspy(force: bool = False, **kwargs) -> dspy.LM:
    """Install a global DSPy LM (idempotent unless ``force``)."""
    global _configured
    lm = make_lm(**kwargs)
    if not _configured or force:
        dspy.configure(lm=lm)
        _configured = True
    return lm


def is_configured() -> bool:
    return _configured
