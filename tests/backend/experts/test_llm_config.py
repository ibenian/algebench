"""is_configured() must reflect whether the LM is actually callable.

Regression: in CI (no GEMINI_API_KEY) is_configured() used to return True as soon
as dspy.configure had run, so domain-rescue / describe_terms / report.py attempted
LM calls that failed mid-request with noisy `Missing Gemini API key` tracebacks
instead of cleanly skipping enrichment.
"""

from __future__ import annotations

import pytest

import backend.experts.llm_config as C


@pytest.fixture
def clear_keys(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)


def test_gemini_model_needs_a_key(monkeypatch, clear_keys):
    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    monkeypatch.setattr(C, "_configured", True)
    assert C.is_configured() is False          # configured but no key → not usable


@pytest.mark.parametrize("key", ["GEMINI_API_KEY", "GOOGLE_API_KEY"])
def test_gemini_model_with_key_is_configured(monkeypatch, clear_keys, key):
    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    monkeypatch.setattr(C, "_configured", True)
    monkeypatch.setenv(key, "test-key")
    assert C.is_configured() is True


def test_not_configured_is_false_even_with_key(monkeypatch, clear_keys):
    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    monkeypatch.setattr(C, "_configured", False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    assert C.is_configured() is False          # dspy.configure never ran


def test_non_gemini_model_is_trusted(monkeypatch, clear_keys):
    # A custom provider carries its own auth; don't gate it on the Gemini keys.
    monkeypatch.setattr(C, "LM_MODEL", "openai/gpt-4o-mini")
    monkeypatch.setattr(C, "_configured", True)
    assert C.is_configured() is True


# ── scoped_lm: per-call-site overrides ───────────────────────────────────────
#
# Three experts have been measured into a non-default LM configuration (#504,
# #509, #510). These tests cover the shared mechanism once, at its source, rather
# than once per module.

def test_no_config_falls_back_to_the_global_lm():
    """No config and the default are the same thing.

    A module that has measured nothing must not get a second LM object built for
    it — it should use whatever ``configure_dspy()`` installed.
    """
    assert C._build_scoped({}) is None


def test_gemini_only_override_is_skipped_for_another_provider(monkeypatch):
    """`reasoning_effort` is litellm's GEMINI mapping for a thinkingBudget.

    Forcing it onto another provider would hand it a parameter it may reject,
    breaking a call the globally configured LM handles fine. None means "use the
    global LM", which is the right fallback. (Originally two per-module tests
    from a Copilot review on #509; the behavior is shared now, so is the test.)
    """
    monkeypatch.setattr(C, "LM_MODEL", "openai/gpt-4o")
    assert C._build_scoped({"reasoning_effort": "disable"}) is None


def test_gemini_only_override_is_built_for_gemini(monkeypatch, clear_keys):
    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    assert C._build_scoped({"reasoning_effort": "disable"}) is not None


def test_a_provider_agnostic_override_is_not_gated(monkeypatch):
    """Only the provider-specific knobs are gated.

    ``temperature`` means the same thing everywhere, so a call site asking for a
    deterministic sample must still get one on a non-Gemini model — gating it
    would silently ignore the request.
    """
    monkeypatch.setattr(C, "LM_MODEL", "openai/gpt-4o")
    assert C._build_scoped({"temperature": 0.0}) is not None


def test_the_gemini_key_is_not_handed_to_another_provider(monkeypatch, clear_keys):
    """A non-Gemini model must resolve its OWN auth (Copilot, #519).

    This is reachable precisely because the test above leaves provider-agnostic
    overrides ungated: an `openai/*` model with a `temperature` override does
    build a scoped LM, and passing it `GEMINI_API_KEY` would override the
    credential litellm would otherwise resolve for that provider.
    """
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-only-key")

    monkeypatch.setattr(C, "LM_MODEL", "openai/gpt-4o")
    other = C._build_scoped({"temperature": 0.0})
    assert other is not None
    assert other.kwargs.get("api_key") is None      # left to the provider

    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    gemini = C._build_scoped({"temperature": 0.0})
    assert gemini.kwargs.get("api_key") == "gemini-only-key"


def test_the_context_is_a_noop_when_inapplicable(monkeypatch):
    """An inapplicable override must yield a usable, do-nothing context.

    This is precisely what lets every call site drop its ``if lm is not None``
    fork and become one unconditional ``with``.
    """
    monkeypatch.setattr(C, "LM_MODEL", "openai/gpt-4o")
    factory = C.scoped_lm(reasoning_effort="disable")
    with factory():
        pass                                   # no LM installed, no exception
    factory.reset()


def test_it_builds_once_and_stays_re_enterable(monkeypatch, clear_keys):
    """Deferred to first use, then cached — and still callable repeatedly.

    Deferred because these modules import before ``configure_dspy()`` runs;
    cached because a fresh ``dspy.LM`` per call is pure overhead. The factory has
    to stay re-enterable because a ``dspy.context`` manager is single-use, so it
    is called again at every call site.
    """
    monkeypatch.setattr(C, "LM_MODEL", "gemini/gemini-2.5-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    seen = []
    real = C._build_scoped
    monkeypatch.setattr(C, "_build_scoped", lambda o: (seen.append(o), real(o))[1])

    factory = C.scoped_lm(reasoning_effort="disable")
    with factory():
        pass
    with factory():
        pass
    assert len(seen) == 1
    factory.reset()


# ── the measured configurations themselves ───────────────────────────────────

@pytest.mark.parametrize("module_path", [
    "backend.experts.modules.proof_edit.intent",              # #509
    "backend.experts.modules.expression_analysis.proposer",   # #504
    "backend.experts.modules.proof_completion.module",        # #510
])
def test_measured_modules_still_request_thinking_disabled(module_path):
    """Guards the refactor that generalized this mechanism.

    Each of these three configurations is the published conclusion of a
    benchmark, and the failure mode of collapsing them onto a shared helper is
    silent: a module that stops asking for ``reasoning_effort="disable"`` simply
    gets slower with nothing to show it. Assert the override survived, per
    module, rather than trusting that the call sites still read correctly.
    """
    import importlib

    mod = importlib.import_module(module_path)
    assert mod._LM.overrides == {"reasoning_effort": "disable"}
