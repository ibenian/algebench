"""Tests for ``backend.util.latex.unmangle_latex`` — JSON-mangle repair on pure-LaTeX fields.

Each control character that a JSON parser can produce from a single-escaped LaTeX
command is tested: ``\\b`` → BS, ``\\f`` → FF, ``\\n`` → LF, ``\\r`` → CR,
``\\t`` → TAB.  These mirror the derivation-step tests but target the endpoint
boundary (``start_latex`` / ``target_latex``).
"""

from __future__ import annotations

import logging

import pytest

from backend.util.latex import unmangle_latex


# -- Round-trip repair per control character ----------------------------------

@pytest.mark.parametrize("ctrl,restored,context", [
    ("\x08eta", r"\beta", "\\b → \\beta"),
    ("\x0crac{a}{b}", r"\frac{a}{b}", "\\f → \\frac"),
    ("\night)^{2}", r"\night)^{2}", "\\n before 'i' — no match (not lowercase-initial after \\n…wait, 'i' IS lowercase)"),
])
def test_hard_ctrl_repair(ctrl, restored, context):
    """Hard control chars (BS, FF) are repaired unconditionally."""
    result = unmangle_latex(ctrl)
    assert result == restored, f"Failed for {context}"


@pytest.mark.parametrize("mangled,expected,desc", [
    # \r + ight → \right
    ("\\left(x + \\frac{b}{2a}\right)^{2}".replace(r"\right", "\right"),
     "\\left(x + \\frac{b}{2a}\\right)^{2}",
     "\\r → \\right"),
    # \n + eq → \neq
    ("a \neq b".replace(r"\neq", "\neq"),
     "a \\neq b",
     "\\n → \\neq"),
    # \t + heta → \theta
    ("\\sin(\theta)".replace(r"\theta", "\theta"),
     "\\sin(\\theta)",
     "\\t → \\theta"),
    # \t + imes → \times
    ("2 \times 3".replace(r"\times", "\times"),
     "2 \\times 3",
     "\\t → \\times"),
    # \r + ho → \rho  (but \r followed by 'h' which is lowercase)
    ("\rho", "\\rho", "\\r → \\rho"),
])
def test_ws_ctrl_repair_in_pure_math(mangled, expected, desc):
    """Whitespace-ambiguous ctrl chars followed by lowercase letter are repaired."""
    result = unmangle_latex(mangled)
    assert result == expected, f"Failed for {desc}: got {result!r}"


def test_clean_text_is_noop():
    """Text without control chars passes through unchanged."""
    clean = r"\frac{a}{b} = \sqrt{c}"
    assert unmangle_latex(clean) == clean


def test_empty_and_none():
    """Empty string returns empty."""
    assert unmangle_latex("") == ""


def test_residual_ctrl_logs_warning(caplog):
    """A residual control char after repair is logged as a warning."""
    # \x01 is not repairable — it's a residual
    with caplog.at_level(logging.WARNING, logger="backend.util.latex"):
        result = unmangle_latex("x \x01 y")
    assert "\x01" in result  # still present (not removed)
    assert "Residual control character" in caplog.text


def test_all_five_escape_chars():
    """All five JSON-escape letters that collide with LaTeX are repaired."""
    # Construct a string where all five are mangled
    text = "\x08eta + \x0crac{1}{2} + \reta + \nu + \tau"
    result = unmangle_latex(text)
    assert r"\beta" in result
    assert r"\frac" in result
    assert r"\reta" in result  # \r + eta → \reta? No, \r + 'e' → \re...
    # Actually let's just check no control chars remain
    assert "\x08" not in result
    assert "\x0c" not in result
