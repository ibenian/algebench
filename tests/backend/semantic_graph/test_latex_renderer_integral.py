"""Structural LaTeX renderer (`to_latex`) — integral support.

The structural renderer is the inverse of the parser used by the proof-animation
engine: every node must render 1:1 so each glyph traces back to a node id
(``data-n``). Integrals were previously unmodeled — they raised
``StructuralRenderError`` and the animation fell back to raw LaTeX (no ``data-n``
at all, so a whole integral state crossfaded instead of morphing). These tests
lock the integral branch: it renders with ids, round-trips structurally, and the
differential variable carries its own id so it can morph across states.
"""

from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex, StructuralRenderError
from backend.experts.modules.proof_completion.graph_ops import canonical_equal

_svc = SemanticGraphService()


def _g(latex: str):
    g = _svc.latex_to_graph(latex, domain="calculus")
    assert g is not None, f"failed to parse: {latex!r}"
    return g


def test_indefinite_integral_renders_with_ids():
    """Previously raised StructuralRenderError -> raw fallback (no data-n)."""
    g = _g(r"\int \frac{1}{v} dv")
    out = to_latex(g, with_ids=True)        # must not raise
    assert "\\int" in out and "htmlData{n=" in out


def test_integral_round_trips_structurally():
    for ltx in [r"\int \frac{1}{v} dv",
                r"\int_0^1 x \, dx",
                r"\int x^2 dx + 5",
                r"\int \frac{1}{v} dv = \int \frac{\rho}{2\beta} dh"]:
        g = _g(ltx)
        reparsed = _svc.latex_to_graph(to_latex(g), domain="calculus")
        assert reparsed is not None, f"re-render did not parse: {ltx!r}"
        assert canonical_equal(g, reparsed), f"integral round-trip changed structure: {ltx!r}"


def test_definite_integral_bounds_render():
    g = _g(r"\int_0^1 x \, dx")
    out = to_latex(g)
    assert out.startswith("\\int_{") and "}^{" in out, out


def test_closed_integral_uses_oint():
    g = _g(r"\oint \vec{F} \cdot d\vec{r}")
    assert "\\oint" in to_latex(g)


def test_integration_variable_keeps_one_stable_id_and_no_duplicates():
    """The integration variable is the SAME node as the integrand's variable
    (``∫ 1/v dv``: the ``v`` in ``1/v`` and the ``v`` in ``dv``). It must keep ONE
    bare, stable id on the integrand occurrence — not a per-occurrence DAG id like
    ``v__power_…`` — so it morphs to/from non-integral states (where the same
    variable is just ``v``). The differential is therefore drawn as text, so the
    id isn't duplicated."""
    import re
    g = _g(r"\int \frac{1}{v} dv")
    out = to_latex(g, with_ids=True)
    # the integrand's v carries the bare, stable id (morphable)
    assert "htmlData{n=v}" in out, out
    # the trailing differential is plain text, not a second tagged occurrence
    assert "\\,dv" in out and "\\,d\\htmlData" not in out, out
    # no duplicate data-n (the wrt edge must not emit a second v span)
    ids = re.findall(r"n=([^}]*)\}", out)
    assert len(ids) == len(set(ids)), f"duplicate data-n: {ids}"


def test_integrand_keeps_its_own_ids():
    """The integrand (``1/v``) renders nested ids, so it morphs through the ∫."""
    g = _g(r"\int \frac{1}{v} dv")
    out = to_latex(g, with_ids=True)
    assert "\\frac{" in out and out.count("htmlData{n=") >= 3
