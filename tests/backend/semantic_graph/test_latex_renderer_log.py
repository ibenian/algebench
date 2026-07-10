"""Structural LaTeX renderer (`to_latex`) — logarithm support.

The parser splits a logarithm's base into its own ``base``-role operand: ``\\log``
and ``\\ln`` get an implicit base ``e``, ``\\log_b`` an explicit base node. That
makes a log node arity-2, which the renderer's function branch used to reject
(``StructuralRenderError: function 'log' arity 2``) — so ``to_latex(with_ids=True)``
raised and the proof-animation build fell back to raw LaTeX with NO ``data-n`` on
any log step. Term highlighting therefore died from the first log step onward, in
both the app and the /renderproof embed. These tests lock the log branch: it
renders base-aware, keeps ids, and round-trips structurally.
"""

from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import canonical_equal

_svc = SemanticGraphService()


def _g(latex: str):
    g = _svc.latex_to_graph(latex, domain="physics")
    assert g is not None, f"failed to parse: {latex!r}"
    return g


def test_log_renders_with_ids():
    """Previously raised StructuralRenderError (arity 2) -> raw fallback (no data-n)."""
    for ltx in [r"\log{\left(x \right)}", r"\ln{\left(x \right)}",
                r"\log_{10}{\left(x \right)}"]:
        out = to_latex(_g(ltx), with_ids=True)        # must not raise
        assert "htmlData{n=" in out, f"no ids emitted for {ltx!r}: {out!r}"


def test_function_name_is_one_tagged_unit():
    """The function NAME (``\\log``/``\\ln``/``\\sin``…) is wrapped in its own id
    (``<node>__name``) so the morph treats it as a single glyph. KaTeX otherwise
    splits e.g. ``\\log`` into a bare "lo" text node + a separate "g" span, and the
    FLIP engine caught only the "g" — the name flashed "lo"→"log" on appearance.
    The wrapper must hold the WHOLE command and leave the plain render untouched."""
    import re
    for ltx, name in [(r"\log{\left(x \right)}", r"\\log"),
                      (r"\ln{\left(x \right)}", r"\\ln"),
                      (r"\sin{\left(x \right)}", r"\\sin"),
                      (r"\log_{2}{\left(x \right)}", r"\\log")]:
        out = to_latex(_g(ltx), with_ids=True)
        assert re.search(rf"htmlData\{{n=[^}}]*__name\}}\{{{name}\}}", out), out
        # plain render carries no name wrapper (round-trip / no-id path unchanged)
        assert "__name" not in to_latex(_g(ltx))


def test_log_round_trips_structurally():
    for ltx in [
        r"\log{\left(x \right)}",
        r"\ln{\left(x \right)}",
        r"\log_{10}{\left(x \right)}",
        r"\log_{2}{\left(x \right)}",
        r"\log{\left(\frac{m_{0}}{m_{f}} \right)}",
        # the Tsiolkovsky evaluate-integral step that regressed highlighting:
        r"v_{f} - v_{0} = - v_{e} \cdot \left(\log{\left(m_{f} \right)} - \log{\left(m_{0} \right)}\right)",
    ]:
        g = _g(ltx)
        reparsed = _svc.latex_to_graph(to_latex(g), domain="physics")
        assert reparsed is not None, f"re-render did not parse: {ltx!r}"
        assert canonical_equal(g, reparsed), f"log round-trip changed structure: {ltx!r}"


def test_natural_base_stays_implicit_explicit_base_is_subscript():
    # \log / \ln keep their glyph and hide the implicit base e.
    assert to_latex(_g(r"\log{\left(x \right)}")) == r"\log\left(x\right)"
    assert to_latex(_g(r"\ln{\left(x \right)}")) == r"\ln\left(x\right)"
    # A non-e base renders as a subscript, showing the base value (not a blank).
    assert to_latex(_g(r"\log_{10}{\left(x \right)}")) == r"\log_{10}\left(x\right)"
