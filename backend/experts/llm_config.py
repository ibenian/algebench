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
    ``ALGEBENCH_LM_TEMPERATURE`` overrides sampling temperature (set ``0`` for
    deterministic, reproducible eval).
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    env_temp = os.environ.get("ALGEBENCH_LM_TEMPERATURE")
    if env_temp is not None:
        temperature = float(env_temp)
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


def _has_credentials() -> bool:
    """Whether a usable API key exists for the configured model.

    A ``gemini/*`` model (the default) needs ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY``;
    without it every litellm call raises ``Missing Gemini API key`` mid-request.
    A custom ``ALGEBENCH_LM_MODEL`` (e.g. ``openai/*``) is trusted to carry its own
    provider auth, so it is not gated here.
    """
    if LM_MODEL.startswith("gemini/"):
        return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    return True


def is_configured() -> bool:
    """True only when DSPy is installed AND the LM is actually callable.

    Gating on credentials (not just ``dspy.configure`` having run) lets callers —
    domain rescue, ``describe_terms``, ``report.py`` — cleanly *skip* LM enrichment
    when no key is present (e.g. in CI) instead of attempting calls that fail with
    noisy ``Missing Gemini API key`` tracebacks.
    """
    return _configured and _has_credentials()
