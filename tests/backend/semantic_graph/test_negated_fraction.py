"""Structural round-trip — a NEGATED fraction stays a negated fraction.

``- \\frac{N}{D}`` used to reform awkwardly on the ``latex_to_graph`` →
``to_latex`` round-trip: the unary-negation branch of the walker rebuilt the
negated body with a plain ``Mul(*rest)``, which let SymPy *re-evaluate* the
product. Re-evaluation distributes a fraction's denominator constant into a
``Rational`` coefficient — e.g. ``1/(4a^2)`` becomes ``(1/4)·a^{-2}`` — so
``-\\frac{4ac}{4a^2}`` reformed as ``-4ac·\\frac{1/4}{a^2}``. The numerator
constant and denominator constant were pulled apart into a stray ``\\frac{1/4}{…}``
factor.

The un-negated fraction round-trips fine (SymPy leaves it as
``Mul(Pow(D,-1), N)``); only the NEGATION triggered the re-evaluation. Rebuilding
the body with ``evaluate=False`` preserves the original numerator/denominator
structure, so the term round-trips as ``-\\frac{N}{D}``.
"""

from __future__ import annotations

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import canonical_equal

_svc = SemanticGraphService()


def _g(latex: str):
    g = _svc.latex_to_graph(latex, domain="algebra")
    assert g is not None, f"failed to parse: {latex!r}"
    return g


# The exact motivating case from the bug report (quadratic-formula.json step 5).
def test_negated_fraction_does_not_split_constants():
    """``-\\frac{4ac}{4a^2}`` must NOT reform as ``-4ac·\\frac{1/4}{a^2}``."""
    ltx = r"- \frac{4 \cdot a \cdot c}{4 \cdot a^{2}}"
    out = to_latex(_g(ltx))
    assert out == ltx, f"negated fraction reformed: {out!r}"
    # Guard the specific corruption: no torn-apart ``1/4`` constant factor.
    assert "1/4" not in out, f"denominator constant was split out: {out!r}"


def test_negated_fraction_in_sum_round_trips():
    """The full two-term expression from the bug report round-trips verbatim.

    Only the FIRST (negated) term was reforming; the second, un-negated term
    always round-tripped. Both must now survive intact.
    """
    ltx = (
        r"- \frac{4 \cdot a \cdot c}{4 \cdot a^{2}}"
        r" + \frac{b^{2}}{4 \cdot a^{2}}"
    )
    assert to_latex(_g(ltx)) == ltx


def test_negated_fraction_shapes_round_trip():
    """A range of ``-\\frac{N}{D}`` shapes render back to themselves."""
    cases = [
        r"- \frac{4 \cdot a \cdot c}{4 \cdot a^{2}}",
        r"- \frac{2 \cdot x}{3 \cdot y}",
        r"- \frac{6 \cdot x}{2 \cdot y}",
        r"- \frac{a \cdot b}{c \cdot d}",
        r"- \frac{b^{2}}{4 \cdot a^{2}}",
    ]
    for ltx in cases:
        out = to_latex(_g(ltx))
        assert out == ltx, f"round-trip changed {ltx!r} -> {out!r}"


def test_negated_fraction_structurally_stable():
    """Re-parsing the rendered LaTeX yields a structurally identical graph.

    A stronger check than string equality: the graph the renderer produces must
    survive a full ``to_latex`` → ``latex_to_graph`` round-trip unchanged.
    """
    cases = [
        r"- \frac{4 \cdot a \cdot c}{4 \cdot a^{2}}",
        r"- \frac{4 \cdot a \cdot c}{4 \cdot a^{2}} + \frac{b^{2}}{4 \cdot a^{2}}",
        r"- \frac{2 \cdot x}{3 \cdot y}",
    ]
    for ltx in cases:
        g = _g(ltx)
        reparsed = _g(to_latex(g))
        assert canonical_equal(g, reparsed), (
            f"negated fraction round-trip changed structure: {ltx!r}"
        )


def test_unnegated_fraction_unaffected():
    """The un-negated fraction already round-tripped — keep it that way."""
    ltx = r"\frac{4 \cdot a \cdot c}{4 \cdot a^{2}}"
    assert to_latex(_g(ltx)) == ltx
