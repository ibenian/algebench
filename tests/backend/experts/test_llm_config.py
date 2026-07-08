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
