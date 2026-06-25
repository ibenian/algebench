"""Tests for proof-completion caption well-formedness (issue #372 §A)."""

from __future__ import annotations

import pytest

from backend.experts.modules.proof_completion.outputs import (
    DerivationStep,
    ProofTrajectory,
)
from backend.experts.modules.proof_completion.wellformed import (
    MalformedCaption,
    assert_well_formed,
    expr_issues,
    prose_issues,
    well_formed,
)


def _step(operation="add $4$ to both sides", expr_latex="x^2 = 4",
          justification="valid since $4 > 0$", change_type="rewrite"):
    return DerivationStep(operation=operation, expr_latex=expr_latex,
                          justification=justification, change_type=change_type)


def _traj(*steps, title=None):
    return ProofTrajectory(steps=list(steps), title=title)


# --------------------------------------------------------------------------- #
# prose fields
# --------------------------------------------------------------------------- #

def test_balanced_prose_has_no_issues():
    assert prose_issues("add $\\frac{c}{a}$ to both sides", where="op") == []


def test_unbalanced_dollar_flagged():
    issues = prose_issues("and $V = 7.8 \\text{ km/s}", where="step 1 operation")
    assert len(issues) == 1
    assert "unbalanced '$'" in issues[0]
    assert "step 1 operation" in issues[0]


def test_prose_dollar_free_is_accepted():
    # plain prose with no math: trivially well-formed
    assert prose_issues("move the term across the equals sign", where="op") == []


def test_empty_math_segment_flagged():
    # a balanced but empty display pair $$  $$ — well-delimited, no content
    issues = prose_issues("see $$  $$ here", where="op")
    assert any("empty math segment" in m for m in issues)


def test_unbalanced_braces_inside_segment_flagged():
    issues = prose_issues("use $\\frac{a}{b$ here", where="op")
    assert any("unbalanced" in m for m in issues)


def test_json_mangled_control_char_flagged():
    # ``\frac`` written with one backslash → JSON parse leaves a form feed where
    # the ``\f`` was. Delimiters/braces stay balanced, so this is caught only by
    # the control-char check (the parse-boundary repair normally fixes it first).
    issues = prose_issues("substitute $F_D = \x0crac{1}{2} \rho A$", where="step 1 operation")
    assert any("control character" in m for m in issues)
    assert any("step 1 operation" in m for m in issues)


def test_real_whitespace_in_prose_not_flagged_as_mangled():
    # a genuine line break in prose — even right before a lowercase word, and
    # even with a CR inside it — is whitespace, not mangling: only control chars
    # INSIDE $…$ are flagged, so this must NOT raise a false positive.
    assert prose_issues("first line\nthen more, see $x = 2$", where="op") == []


# --------------------------------------------------------------------------- #
# expr_latex (raw math — no delimiters allowed)
# --------------------------------------------------------------------------- #

def test_clean_expr_has_no_issues():
    assert expr_issues("x^2 + 2x + 1", where="step 1 expr_latex") == []


def test_dollar_in_expr_flagged():
    issues = expr_issues("$x^2$", where="step 1 expr_latex")
    assert any("must not contain '$'" in m for m in issues)


def test_unbalanced_braces_in_expr_flagged():
    issues = expr_issues("\\frac{a}{b", where="step 1 expr_latex")
    assert any("unbalanced" in m for m in issues)


# --------------------------------------------------------------------------- #
# trajectory-level verdict + the two surfaces
# --------------------------------------------------------------------------- #

def test_well_formed_trajectory_passes():
    v = well_formed(_traj(_step(), _step(expr_latex="x = 2", change_type="solve")))
    assert v.ok and v.issues == [] and v.factor == 1.0


def test_malformed_trajectory_reports_step_and_field():
    bad = _step(operation="and $V = 7.8 km/s", expr_latex="x = 2")
    v = well_formed(_traj(_step(), bad))
    assert not v.ok and v.factor == 0.0
    assert any("step 2 operation" in m for m in v.issues)


def test_assert_well_formed_raises_on_malformed():
    bad = _traj(_step(justification="because $a"))
    with pytest.raises(MalformedCaption):
        assert_well_formed(bad)


def test_assert_well_formed_silent_on_clean():
    assert_well_formed(_traj(_step()))  # no raise


def test_title_is_checked():
    v = well_formed(_traj(_step(), title="solve $x"))
    assert not v.ok and any("title" in m for m in v.issues)
