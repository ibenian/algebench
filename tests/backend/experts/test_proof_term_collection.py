"""Tests for proof-animation term collection (``data["terms"]``).

``build()`` collects the derivation's describable symbols into ``data["terms"]``
(keyed by node id) for the per-term tooltips. The collection filters out numeric
literals/fractions and keeps named symbols (including Greek with digit subscripts
like ``\\rho_0``) and unary composites (``V^{2}``). These tests lock that in.
"""

import pytest

from backend.experts.handlers.proof_animation.animation import _collect_terms, _is_numeric
from backend.semantic_graph.service import SemanticGraphService


@pytest.mark.parametrize("sym, numeric", [
    # purely numeric — excluded
    ("2", True),
    ("1.5", True),
    ("1/2", True),
    ("-2", True),
    (r"\frac{1}{2}", True),
    ("2^{3}", True),
    # named symbols / sub-expressions — kept (a Greek command + digit subscript is
    # a SYMBOL, not a number; this is the \rho_0 regression)
    ("V", False),
    (r"\rho", False),
    (r"\rho_0", False),
    (r"\Delta t", False),
    ("C_{d}", False),
    ("V^{2}", False),
    (r"\frac{d}{dt}V", False),
])
def test_is_numeric(sym, numeric):
    assert _is_numeric(sym) is numeric


def test_collect_terms_keeps_symbols_and_powers_excludes_numbers():
    g = SemanticGraphService().latex_to_graph(
        r"F = \frac{1}{2} \rho A C_d V^2", domain="classical_mechanics")
    terms: dict = {}
    _collect_terms(g, terms)
    latexes = {v["latex"] for v in terms.values()}

    # named leaf symbols kept
    assert {"F", r"\rho", "A", "C_{d}", "V"} <= latexes
    # the squared velocity kept (a unary composite, described via its subexpr)
    assert "V^{2}" in latexes
    # nothing numeric slipped in (no bare "2", no "\frac{1}{2}")
    assert r"\frac{1}{2}" not in latexes
    assert not any(_is_numeric(v["latex"]) for v in terms.values())


def test_collect_terms_keeps_greek_with_subscript():
    # \rho_0 (reference density) must survive — it used to be dropped as "numeric".
    # (The parser normalizes the subscript to \rho_{0}.)
    g = SemanticGraphService().latex_to_graph(
        r"\rho = \rho_0 H", domain="classical_mechanics")
    terms: dict = {}
    _collect_terms(g, terms)
    assert r"\rho_{0}" in {v["latex"] for v in terms.values()}
