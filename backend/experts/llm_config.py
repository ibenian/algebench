"""DSPy language-model configuration.

Configures DSPy to talk to Gemini via litellm (``gemini/<model>``). Reads the
same ``GEMINI_API_KEY`` / ``GEMINI_MODEL`` env vars the rest of the project
uses, so no new configuration surface is introduced. The DSPy experts are an
independent stack from the pydantic-ai enricher; both can coexist.
"""

from __future__ import annotations

import contextlib
import os
from typing import Callable, ContextManager, Optional

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
    """True when DSPy is installed AND credentials for the model are present.

    For the default ``gemini/*`` model that means a ``GEMINI_API_KEY`` /
    ``GOOGLE_API_KEY`` (see :func:`_has_credentials`); a custom non-Gemini
    ``ALGEBENCH_LM_MODEL`` is trusted to carry its own provider auth and is not
    validated here. Gating on the key (not just ``dspy.configure`` having run) lets
    callers — domain rescue, ``describe_terms``, ``report.py`` — cleanly *skip* LM
    enrichment when no key is present (e.g. in CI) instead of attempting calls that
    fail with noisy ``Missing Gemini API key`` tracebacks.
    """
    return _configured and _has_credentials()


# --------------------------------------------------------------------------- #
# per-call-site LM overrides
# --------------------------------------------------------------------------- #

# Overrides that are provider-specific and must NOT be forced onto a provider
# that may reject them. ``reasoning_effort`` is litellm's GEMINI mapping for a
# thinkingBudget (minimal->128, low->1024, medium->2048, high->4096,
# disable/none->0 with includeThoughts off); another provider may reject the
# parameter outright, so a call site asking for one silently falls back to the
# globally configured LM rather than breaking a call the global LM handles fine.
_GEMINI_ONLY = ("reasoning_effort",)


def _build_scoped(overrides: dict) -> Optional[dspy.LM]:
    """The overridden LM, or None meaning "use the globally configured one"."""
    if not overrides:
        return None                      # no config → the default, by definition
    if (any(k in overrides for k in _GEMINI_ONLY)
            and not LM_MODEL.startswith("gemini/")):
        return None
    # The Gemini key is attached ONLY for a Gemini model. A provider-agnostic
    # override (``temperature``) is deliberately not gated above, so this is
    # reachable with ``ALGEBENCH_LM_MODEL=openai/…`` — and handing that provider
    # a ``GEMINI_API_KEY`` would override the auth it resolves for itself.
    # ``None`` means "resolve from the environment", which is what a non-Gemini
    # provider should be trusted to do (Copilot, #519).
    kwargs: dict = dict(temperature=0.7, max_tokens=32768)
    if LM_MODEL.startswith("gemini/"):
        kwargs["api_key"] = (os.environ.get("GEMINI_API_KEY")
                             or os.environ.get("GOOGLE_API_KEY"))
    kwargs.update(overrides)
    try:
        return dspy.LM(LM_MODEL, **kwargs)
    except Exception:
        return None


def scoped_lm(**overrides) -> Callable[[], ContextManager]:
    """An LM override for ONE call site, as a lazy context-manager factory.

    Several experts have been measured into a configuration that differs from the
    global LM — usually Gemini thinking disabled (issues #504, #509, #510). Doing
    that per module used to mean ~20 lines of identical boilerplate each: a
    cached builder with a Gemini guard and a swallowed exception, plus an
    ``if lm is not None: with dspy.context(...) else: ...`` fork at every call
    site. This collapses both to one line apiece::

        _LM = scoped_lm(reasoning_effort="disable")   # module-specific config
        ...
        with _LM():                                   # no-op when inapplicable
            pred = self.predict(**kwargs)

    ``overrides`` are ``dspy.LM`` kwargs layered over the project defaults
    (``temperature=0.7``, ``max_tokens=32768``, resolved Gemini key). **With no
    overrides the factory is a no-op** and the globally configured LM is used —
    so "no config" and "default" are the same thing, and a module opts in only to
    what it has actually measured.

    Scoping is the point: it confines a measured configuration to the one call it
    was measured on. The global ``ALGEBENCH_LM_REASONING`` knob would silence
    every expert at once, including ones never benchmarked.

    Construction is deferred to first use (these modules are imported before
    ``configure_dspy()`` runs) and then cached for the process. The returned
    factory is called fresh at each call site because a ``dspy.context`` manager
    is single-use.
    """
    built: list = []      # one-slot lazy cache; holds None for "use the global LM"

    def enter() -> ContextManager:
        if not built:
            built.append(_build_scoped(overrides))
        lm = built[0]
        return dspy.context(lm=lm) if lm is not None else contextlib.nullcontext()

    enter.reset = built.clear       # tests re-resolve after patching LM_MODEL
    enter.overrides = dict(overrides)
    return enter
