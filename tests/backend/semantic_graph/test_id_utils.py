"""Unit tests for the node-id slug helper.

``_slug_id`` turns a possibly-LaTeX-bearing symbol name into a clean
``[A-Za-z0-9_]`` node id (display lives in ``latex``/``subexpr``; the id is only
a wiring key). See ``backend/semantic_graph/id_utils.py``.
"""

from __future__ import annotations

import re

import pytest

from backend.semantic_graph.id_utils import _CLEAN_ID_RE, _slug_id


@pytest.mark.parametrize(
    "raw, expected",
    [
        # Already-clean ids are returned verbatim — plain symbols, subscripts
        # the author already wrote flat, and operator counter ids.
        ("V", "V"),
        ("delta", "delta"),
        ("V_E", "V_E"),
        ("k_B", "k_B"),
        ("x_0", "x_0"),
        ("__multiply_2", "__multiply_2"),
        ("__annotation_0", "__annotation_0"),
        ("c0___equals_1", "c0___equals_1"),
        # \text{...} subscripts: unwrap the body.
        (r"V_{\text{exit}}", "V_exit"),
        (r"F_{\text{net}}", "F_net"),
        (r"\text{exit}", "exit"),
        # Greek / command backslashes are stripped.
        (r"\gamma_{\alpha}", "gamma_alpha"),
        (r"\epsilon_{0}", "epsilon_0"),
        (r"\rho_{0}", "rho_0"),
        # Braces drop; the subscript stays.
        ("I_{sp}", "I_sp"),
        ("rho_{0}", "rho_0"),
        ("a_{n - 1}", "a_n_1"),
        # Spaces and other separators collapse to a single underscore.
        (r"\Delta \gamma", "Delta_gamma"),
        (r"\text{larger nose}", "larger_nose"),
        # Primes / stray punctuation are dropped (collision suffixing, which the
        # builder applies separately, keeps such symbols distinct).
        ("u'", "u"),
        ("y''", "y"),
    ],
)
def test_slug_id_examples(raw: str, expected: str) -> None:
    assert _slug_id(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        r"V_{\text{exit}}", r"\gamma_{\alpha}", "I_{sp}", r"\Delta \gamma",
        "u'", "V", "__multiply_2", r"\text{x}",
    ],
)
def test_slug_id_output_is_always_clean(raw: str) -> None:
    """Every slug is a valid node id matching the clean-id invariant."""
    assert _CLEAN_ID_RE.fullmatch(_slug_id(raw))


@pytest.mark.parametrize("raw", [r"V_{\text{exit}}", r"\gamma_{\alpha}", "I_{sp}", "u'"])
def test_slug_id_is_idempotent(raw: str) -> None:
    """Slugging an already-slugged id is a no-op."""
    once = _slug_id(raw)
    assert _slug_id(once) == once


@pytest.mark.parametrize("raw", ["\\", "{}", r"{\,}", "()", "\\\\"])
def test_slug_id_falls_back_to_sym_when_nothing_survives(raw: str) -> None:
    """Input with no identifier characters degrades to the ``sym`` sentinel,
    never an empty id (which would be an invalid node id)."""
    assert _slug_id(raw) == "sym"


def test_slug_id_is_deterministic() -> None:
    raw = r"\beta_{\text{eff}}"
    assert _slug_id(raw) == _slug_id(raw) == "beta_eff"


def test_distinct_dirty_names_can_collapse_to_same_slug() -> None:
    """``_slug_id`` does not itself de-collide — that is the builder's job via a
    numeric suffix. Two different raw names may slug identically."""
    assert _slug_id("V_E") == _slug_id(r"V_{E}") == "V_E"
