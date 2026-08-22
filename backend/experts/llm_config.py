"""DSPy language-model configuration.

Configures DSPy to talk to Gemini via litellm (``gemini/<model>``). Reads the
same ``GEMINI_API_KEY`` / ``GEMINI_MODEL`` env vars the rest of the project
uses, so no new configuration surface is introduced. The DSPy experts are an
independent stack from the pydantic-ai enricher; both can coexist.
"""

from __future__ import annotations

import contextlib
import logging
import os
from typing import Any, Callable, ContextManager, Optional

import dspy
from dspy.adapters.chat_adapter import ChatAdapter
from dspy.utils.exceptions import AdapterParseError

from backend.experts.adapters import LineAdapter

log = logging.getLogger(__name__)

# The expert emits large structured trajectories, so it needs a model with a
# generous output-token budget (gemini-2.0-flash caps at 8192 and truncates).
# Default to gemini-2.5-flash; override with ALGEBENCH_LM_MODEL (a full litellm
# model string, e.g. ``gemini/gemini-2.5-pro``).
_DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
LM_MODEL = os.environ.get("ALGEBENCH_LM_MODEL") or f"gemini/{_DEFAULT_GEMINI_MODEL}"


def _cache_enabled() -> bool:
    """Whether DSPy may cache LM responses. **Off unless explicitly enabled.**

    DSPy's own default is ``cache=True``, which writes every prompt and
    completion to ``~/.dspy_cache`` as a pickle — the store CVE-2025-69872 is
    about. We do not inherit that default; caching is opted into per
    environment via ``ALGEBENCH_LM_CACHE``.

    Worth enabling for repeated-identical-prompt workloads, which is what pays
    for it: ``scripts/proof_completion/optimize.py`` (MIPROv2 re-runs
    overlapping prompts across a trainset) and eval sweeps. Set it there rather
    than globally, so an interactive session never silently serves a cached
    answer when ``temperature`` is non-zero and a fresh sample was intended
    (DSPy's ``rollout_id`` is the supported way to vary that — see dspy.LM).
    """
    return os.environ.get("ALGEBENCH_LM_CACHE", "").strip().lower() in {"1", "true", "yes", "on"}

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
    kwargs = dict(api_key=api_key, temperature=temperature, max_tokens=max_tokens,
                  cache=_cache_enabled())
    effort = os.environ.get("ALGEBENCH_LM_REASONING")
    if effort:
        kwargs["reasoning_effort"] = effort
    return dspy.LM(LM_MODEL, **kwargs)


def make_adapter(*, json_fallback: bool = False,
                 line_oriented: bool = False) -> ChatAdapter:
    r"""Build a DSPy adapter. **Both knobs default to the safe setting.**

    The single place adapters are constructed, so the project's two wire-format
    decisions are stated once instead of drifting apart in unrelated files.

    ``json_fallback`` — whether ``ChatAdapter`` may silently re-run a failed
    prediction through ``JSONAdapter``. **Off.** Its ``__call__`` wraps the work
    in a bare ``except Exception`` and, on *any* failure, re-asks as JSON and
    logs nothing. That is a trapdoor, not a safety net:

    * it costs **three** extra LM calls (``JSONAdapter`` retries internally) and
      the caller sees only a slightly slow success;
    * it hands every field back to the JSON escape layer. ``\r \n \t \f \b`` are
      valid JSON escapes *and* LaTeX command prefixes, so a model writing
      ``\right`` with one backslash yields valid JSON decoding to a carriage
      return plus ``ight`` — which parses as the product ``i·g·h·t`` (#517).
      Under ``ChatAdapter`` a flat ``str`` field never reaches a JSON decoder
      (``parse_value`` short-circuits on ``annotation is str``), so that
      corruption is reachable *only* down this path. Closing it makes the
      exposure structurally unreachable rather than merely unlikely.

    ``line_oriented`` — whether to use :class:`LineAdapter`, whose wire format
    has no escape layer at all, so backslashes survive verbatim (#522). It is
    the stronger guarantee but only accepts one-level-deep signatures, which is
    why it is opt-in per call site rather than the default.

    Refusing the fallback means a parse failure RAISES. Callers that already
    swallow exceptions (``proof_edit``, ``expression_analysis``, the judge,
    ``term_descriptions``) degrade exactly as before; ``prompt_endpoints``
    re-asks via :func:`retry_on_parse_error`, which is the resilience the
    fallback actually provided, without the escape layer.
    """
    cls = LineAdapter if line_oriented else ChatAdapter
    return cls(use_json_adapter_fallback=json_fallback)


def retry_on_parse_error(call: Callable[[], Any], *,
                         attempts: int = 2, label: str = "") -> Any:
    r"""Run a DSPy prediction, re-asking if the response cannot be PARSED.

    The replacement for ``ChatAdapter``'s silent ``JSONAdapter`` fallback, which
    :func:`make_adapter` refuses. That fallback was doing two things at once and
    only one of them was wanted:

    * **wanted** — a second roll at a stochastic formatting slip;
    * **not wanted** — re-decoding every field through JSON escaping, the sole
      route by which a flat ``str`` LaTeX field can be silently corrupted
      (#517).

    This keeps the first and drops the second by re-asking in the SAME wire
    format. It is deliberately narrow:

    * Only ``AdapterParseError`` is retried. A network/transient failure is
      litellm's job (``dspy.LM(num_retries=3)``) and retrying it here would
      multiply, not add. A domain exception (``InvalidPromptError``) is a real
      answer and must propagate untouched.
    * It takes a zero-argument CALLABLE, not a signature, so it fits every
      predictor shape in the codebase — a cached ``_predictor(sig)(**kw)``, a
      module's ``self.predict(**kw)``, or a whole ``dspy.Module.__call__``.
    * The happy path costs exactly one call; nothing is paid unless a parse
      actually fails.

    Exhausting the attempts RAISES. Callers that already degrade on exception
    (``proof_edit``, ``expression_analysis``, the judge) keep doing so, one
    re-ask later than before; callers that do not (``prompt_endpoints``) surface
    a clean error rather than a quiet wrong answer.

    LIMITATION — this re-roll is BLIND
    ----------------------------------
    The model is not told that its previous response failed to parse. That is
    weaker than ``proof_completion.refine``, which threads
    ``_PARSE_FAILURE_FEEDBACK`` back into the next attempt, and it is the very
    thing that module's docstring criticises DSPy 2.6 for.

    It is blind because there is nowhere to put the feedback: none of the
    signatures behind these call sites has a free input field for it
    (``BothEndpointsSig`` takes only ``prompt``), so threading it would mean
    adding an input field to each — changing prompts that are load-bearing
    (the ``INVALID_PROMPT`` sentinel, the bare-LaTeX instructions).

    The cost of that is lower than it first looks: the output schema is in the
    prompt on *every* call, so — as ``refine.py`` notes about its own text — the
    feedback only flags the failure and deliberately does not restate the
    structure. Against a fresh sample of a stochastic formatting slip, a re-roll
    recovers most of what the nudge would. Worth revisiting if these signatures
    ever grow an instruction field for another reason.
    """
    for attempt in range(1, attempts + 1):
        try:
            return call()
        except AdapterParseError:
            if attempt == attempts:
                log.warning("%s: response still unparseable after %d attempt(s) "
                            "— giving up", label or "predict", attempts)
                raise
            log.warning("%s: unparseable response, re-asking (attempt %d/%d)",
                        label or "predict", attempt + 1, attempts)


def configure_dspy(force: bool = False, **kwargs) -> dspy.LM:
    """Install a global DSPy LM + adapter (idempotent unless ``force``)."""
    global _configured
    lm = make_lm(**kwargs)
    if not _configured or force:
        # The adapter is installed EXPLICITLY, and the flag is spelled out at
        # the one site where the guarantee actually takes effect. Left unset,
        # ``dspy.settings.adapter`` is None and DSPy supplies its own implicit
        # ``ChatAdapter()`` — with the JSON fallback ON. See :func:`make_adapter`.
        dspy.configure(lm=lm, adapter=make_adapter(json_fallback=False))
        # Harden the on-disk cache against CVE-2025-69872: diskcache deserializes
        # cached values with unrestricted pickle, so anything able to write into
        # the cache directory gets arbitrary code execution on the next read.
        # There is no fixed diskcache release — the flaw is its default
        # serializer, unchanged across all 76 versions — so DSPy's own
        # restriction is the only reachable mitigation. (JSONDisk, which the
        # advisory recommends generally, is not: DSPy exposes no way to swap the
        # disk backend, and it caches litellm ModelResponse objects that are not
        # JSON-serializable.)
        #
        # Applied unconditionally, not only when ALGEBENCH_LM_CACHE is set: the
        # cost is nil when caching is off, and this must not depend on
        # remembering to pair it with the opt-in. Verified that ModelResponse
        # still round-trips under the restricted unpickler, so no safe_types
        # entries are needed.
        dspy.configure_cache(restrict_pickle=True)
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
    kwargs: dict = dict(temperature=0.7, max_tokens=32768, cache=_cache_enabled())
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
