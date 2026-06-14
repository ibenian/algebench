"""Tests for the reusable inline-LaTeX delimiter scanner."""

from __future__ import annotations

from backend.util.latex import (
    braces_balanced,
    delimiters_balanced,
    math_segments,
    strip_math_delimiters,
)


# --------------------------------------------------------------------------- #
# delimiters_balanced — the unbalanced-$ defect (issue #372)
# --------------------------------------------------------------------------- #

def test_balanced_inline():
    assert delimiters_balanced("add $x$ to both sides")


def test_unbalanced_single_dollar_rejected():
    # the motivating defect: an opened $ that never closes
    assert not delimiters_balanced("and $V_{\\text{LEO}} = 7.8 \\text{ km/s}")


def test_prose_without_math_is_balanced():
    assert delimiters_balanced("just plain prose, no math here")


def test_escaped_dollar_is_not_a_delimiter():
    assert delimiters_balanced("it costs \\$5 in total")
    assert delimiters_balanced("\\$5 and \\$10")  # two escaped, zero delimiters


def test_balanced_display_math():
    assert delimiters_balanced("see $$x^2 + 1$$ above")


def test_unbalanced_display_rejected():
    assert not delimiters_balanced("see $$x^2 + 1$ above")  # opened $$, closed $


def test_triple_dollar_is_malformed():
    assert not delimiters_balanced("weird $$$x$$$")


def test_two_inline_segments_balanced():
    assert delimiters_balanced("$a$ then $b$")


def test_odd_number_of_dollars_rejected():
    assert not delimiters_balanced("$a$ then $b")


# --------------------------------------------------------------------------- #
# math_segments — locating the math
# --------------------------------------------------------------------------- #

def test_segments_inline_and_display():
    segs = math_segments("a $x$ and $$y^2$$ end")
    assert [(s.display, s.content) for s in segs] == [(False, "x"), (True, "y^2")]


def test_segment_offsets_round_trip():
    text = "go $x+1$ now"
    seg = math_segments(text)[0]
    assert text[seg.start:seg.end] == "$x+1$"
    assert seg.content == "x+1"


def test_segments_stop_at_unbalanced():
    # the first segment parses; the dangling $ yields nothing further
    segs = math_segments("$a$ and $b")
    assert [s.content for s in segs] == ["a"]


def test_delimiter_property():
    inline, display = math_segments("$a$ $$b$$")
    assert inline.delimiter == "$" and display.delimiter == "$$"


# --------------------------------------------------------------------------- #
# braces_balanced
# --------------------------------------------------------------------------- #

def test_braces_balanced():
    assert braces_balanced("\\frac{a}{b}")
    assert braces_balanced("no braces at all")


def test_braces_unbalanced_missing_close():
    assert not braces_balanced("\\frac{a}{b")


def test_braces_unbalanced_extra_close():
    assert not braces_balanced("a}b")


def test_braces_escaped_ignored():
    assert braces_balanced("\\{ literal \\}")  # escaped braces are not structural


# --------------------------------------------------------------------------- #
# strip_math_delimiters
# --------------------------------------------------------------------------- #

def test_strip_removes_delimiters_keeps_content():
    assert strip_math_delimiters("add $x$ now") == "add x now"
    assert strip_math_delimiters("a $$y^2$$ b") == "a y^2 b"


def test_strip_no_math_is_identity():
    assert strip_math_delimiters("plain text") == "plain text"


def test_strip_leaves_unbalanced_tail():
    # nothing complete to strip → returns the original
    assert strip_math_delimiters("dangling $x") == "dangling $x"
