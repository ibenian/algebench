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
    """The two ``d`` glyphs are pure notation (no graph node) → a synthetic id
    scoped to the derivative (``__d`` numerator, ``__dd`` differential). The wrt
    VARIABLE is a real node, so its glyph links to that node's id, occurrence-
    scoped to the derivative (``<var>____deriv_N``, like the operand ``v____…``).
    Without these a persisting derivative morphs its ``d/d<var>`` instead of
    snapping."""
    out = to_latex(_g(r"\frac{d}{d t} v = -k v^2"), with_ids=True)
    assert re.search(r"htmlData\{n=[^}]*__d\}\{d\}", out), out         # numerator d (notation)
    assert re.search(r"htmlData\{n=[^}]*__dd\}\{d\}", out), out        # differential d (notation)
    # wrt variable → the node id `t`, occurrence-scoped to the derivative, so it
    # resolves back to the `t` term (id splits on `__`) and never bare-collides.
    assert re.search(r"htmlData\{n=t__[^}]*deriv[^}]*\}\{t\}", out), out


def test_wrt_variable_never_duplicates_operand_occurrence():
    """``d/dx x²`` — the ONE ``x`` node is both the operand's base and the wrt. The
    wrt glyph links to the node yet must not emit a second ``n=x`` (a duplicate
    data-n breaks the FLIP morph). It's occurrence-scoped, so it doesn't."""
    out = to_latex(_g(r"\frac{d}{dx} x^2"), with_ids=True)
    ids = re.findall(r"n=([^}]*)\}", out)
    assert len(ids) == len(set(ids)), f"duplicate data-n: {ids}"
    assert re.search(r"htmlData\{n=x__[^}]*deriv[^}]*\}\{x\}", out), out  # wrt x, scoped


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
    (both ``d`` notation ids and the wrt-variable node id) are scoped to that
    derivative, so nothing collides and each morphs on its own. The wrt ``t``
    appears in TWO derivatives — it stays distinct (``t____deriv_2`` vs
    ``t____deriv_5``) rather than a single ambiguous ``n=t``."""
    out = to_latex(_g(r"\frac{d}{d t} v = \frac{d}{d h} v \cdot \frac{d}{d t} h"),
                   with_ids=True)
    all_ids = re.findall(r"n=([^}]*)\}", out)
    assert len(all_ids) == len(set(all_ids)), f"data-n collided: {all_ids}"
    # three derivatives → three numerator-d ids
    assert len([i for i in all_ids if i.endswith("__d")]) == 3, all_ids
    # the shared wrt variable t stays per-derivative distinct
    t_wrt = sorted(i for i in all_ids if re.fullmatch(r"t__+deriv_\d+", i))
    assert len(t_wrt) == 2 and len(set(t_wrt)) == 2, t_wrt
