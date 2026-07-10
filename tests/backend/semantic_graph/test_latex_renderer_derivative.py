"""Structural LaTeX renderer (`to_latex`) — derivative glyph ids.

A derivative renders ``\\frac{d}{d<var>}``. The two ``d`` glyphs and the variable
were previously bare — no ``data-n`` — so the FLIP morph couldn't key off them and
a persisting derivative SNAPPED to its new spot while the operand around it glided
(most visibly the chain-rule step where ``d/dt`` splits into ``d/dh · dh/dt``).
These tests lock the fix: each glyph carries its own stable id, scoped to the
derivative node, and the no-id render (round-trip) is unchanged.
"""

from __future__ import annotations

import re

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import canonical_equal

_svc = SemanticGraphService()


def _g(latex: str):
    g = _svc.latex_to_graph(latex, domain="calculus")
    assert g is not None, f"failed to parse: {latex!r}"
    return g


def test_derivative_glyphs_carry_their_own_stable_ids():
    """The numerator ``d``, the differential ``d``, and the wrt variable each get a
    stable id derived from the derivative node id (``__d`` / ``__dd`` / ``__wrt``),
    so a persisting derivative morphs its ``d/d<var>`` instead of snapping."""
    out = to_latex(_g(r"\frac{d}{d t} v = -k v^2"), with_ids=True)
    assert re.search(r"htmlData\{n=[^}]*__d\}\{d\}", out), out        # numerator d
    assert re.search(r"htmlData\{n=[^}]*__dd\}\{d\}", out), out       # differential d
    assert re.search(r"htmlData\{n=[^}]*__wrt\}\{t\}", out), out      # wrt variable


def test_derivative_no_id_render_is_unchanged():
    """The plain (no-id) render still emits bare ``\\frac{d}{d t}`` so definite
    structure and round-trips are unaffected."""
    assert to_latex(_g(r"\frac{d}{d t} v = -k v^2")).startswith(r"\frac{d}{d t} v")


def test_derivative_round_trips_structurally():
    for ltx in [r"\frac{d}{d t} v",
                r"\frac{d}{d t} v = w",
                r"\frac{d}{dx} x^n = n x^{n-1}",
                r"\frac{d}{d t} v = \frac{d}{d h} v \cdot \frac{d}{d t} h"]:
        g = _g(ltx)
        reparsed = _svc.latex_to_graph(to_latex(g), domain="calculus")
        assert reparsed is not None, f"re-render did not parse: {ltx!r}"
        assert canonical_equal(g, reparsed), f"derivative round-trip changed structure: {ltx!r}"


def test_chain_rule_derivatives_get_distinct_scoped_ids():
    """``d/dt v = d/dh v · dh/dt`` has three derivatives; each one's d/d-var glyphs
    are scoped to that derivative's node id, so they don't collide (and each morphs
    on its own)."""
    out = to_latex(_g(r"\frac{d}{d t} v = \frac{d}{d h} v \cdot \frac{d}{d t} h"),
                   with_ids=True)
    ids = re.findall(r"n=([^}]*__(?:d|dd|wrt))\}", out)
    assert len(ids) == len(set(ids)), f"derivative glyph ids collided: {ids}"
    # three derivatives → three numerator-d ids
    assert len([i for i in ids if i.endswith("__d")]) == 3, ids
