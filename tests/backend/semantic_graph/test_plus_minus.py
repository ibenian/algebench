r"""``\pm`` / ``\mp`` as a first-class unary operator (issue #369).

Three things have to hold together, and the interesting failures are where they
meet:

* **parse** — ``±`` is an operator over the term it governs, so the surrounding
  SUM survives. This is the part that was broken in a non-obvious way: ``±`` fell
  through to a free symbol, and because that symbol became a *multiplicand*,
  implicit multiplication swallowed the addition. The bug was never really "an
  unknown symbol"; it was ``-b + (±√Δ)`` silently becoming ``-b·(±)·√Δ``.
* **ground** — the state means BOTH sign readings, so it expands to a
  disjunction and the CAS rules on the real solution set.
* **display** — the reader still sees the compact ``±`` they wrote. Expansion is
  for grounding only; if it ever reaches the page, derivations turn into
  two-branch disjunctions.
"""

from __future__ import annotations

import pytest
import sympy as sp

from backend.experts.modules.proof_completion.grounding import (
    graph_to_latex, graph_to_sympy, has_plus_minus,
)
from backend.semantic_graph.latex_renderer import to_latex
from backend.semantic_graph.service import SemanticGraphService

_SVC = SemanticGraphService()


def _graph(latex: str):
    return _SVC.latex_to_graph(latex, domain="algebra")


# ── parse: the operator exists, and the sum survives ─────────────────────────

@pytest.mark.parametrize("latex", [
    r"x = \pm 3",
    r"x = \pm\sqrt{\Delta}",
    r"y = \pm x",
    r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
])
def test_pm_becomes_an_operator_node(latex):
    g = _graph(latex)
    assert has_plus_minus(g), f"no plus_minus node for {latex}"
    ops = {n.op for n in g.nodes if n.type == "operator"}
    assert "plus_minus" in ops


def test_no_pseudo_symbol_survives_anywhere():
    r"""The old failure mode: a free symbol literally named ``\pm``.

    Asserted on ``free_symbols`` rather than on the node list because that is
    where it did real damage — it leaked into every downstream solve, compare
    and fingerprint as an unknown variable.
    """
    grounded = graph_to_sympy(_graph(r"x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}"))
    names = {str(s).lstrip("\\") for s in grounded.free_symbols}
    assert "pm" not in names and "mp" not in names, names
    assert names == {"a", "b", "c", "x"}


def test_the_governed_term_does_not_swallow_the_sum():
    r"""``-b \pm √Δ`` must stay an ADDITION of two terms.

    The regression this guards is subtle: everything still "parses", and the
    graph is still well-formed — it is just a product where a sum belongs, which
    silently makes the expression a different one.
    """
    g = _graph(r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}")
    parents = {e.to: e.from_ for e in g.edges}
    pm = next(n for n in g.nodes if n.op == "plus_minus")
    numerator = next(n for n in g.nodes
                     if n.id == parents.get(pm.id) or
                     any(e.from_ == pm.id and e.to == n.id for e in g.edges))
    assert numerator.op == "add", (
        f"± should sit inside an add, not {numerator.op!r} — the sum was eaten")


# ── ground: both readings, and the coupling rule ─────────────────────────────

def test_a_relation_grounds_to_both_sign_readings():
    grounded = graph_to_sympy(_graph(r"x = \pm 3"))
    assert isinstance(grounded, sp.Or)
    x = sp.Symbol("x")
    assert set(grounded.args) == {sp.Eq(x, 3), sp.Eq(x, -3)}


def test_a_bare_expression_grounds_to_a_finite_set():
    grounded = graph_to_sympy(_graph(r"\pm\sqrt{9}"))
    assert isinstance(grounded, sp.FiniteSet)
    assert set(grounded) == {3, -3}


def test_mp_is_coupled_to_pm_not_independent():
    r"""``a ± b ∓ c`` is TWO readings, not four.

    One shared sign governs the state: every ``±`` takes the same choice and
    every ``∓`` the opposite. Treating the sites as independent would admit
    ``a + b + c``, which the notation does not mean.
    """
    grounded = graph_to_sympy(_graph(r"a \pm b \mp c"))
    a, b, c = sp.symbols("a b c")
    assert isinstance(grounded, sp.FiniteSet)
    assert set(grounded) == {a + b - c, a - b + c}
    assert len(grounded) == 2, "coupled signs must not enumerate 2^k"


def test_many_pm_sites_stay_two_branches():
    """The shared-sign rule is what removes any need for a 2^k cap."""
    grounded = graph_to_sympy(_graph(r"\pm a \pm b \pm c"))
    assert len(grounded) == 2


# ── display: the compact form survives ───────────────────────────────────────

@pytest.mark.parametrize("latex,expected", [
    (r"x = \pm 3", r"x = \pm 3"),
    (r"y = \pm x", r"y = \pm x"),
    (r"a \pm b \mp c", r"a \pm b \mp c"),
])
def test_latex_round_trips(latex, expected):
    assert to_latex(_graph(latex)) == expected


def test_display_never_shows_the_expansion():
    r"""``graph_to_latex`` must not route a ``±`` graph through sympy.

    It renders via ``sp.latex(graph_to_sympy(...))``, and ``graph_to_sympy`` now
    expands — so without an explicit structural path every derivation would show
    ``x = √Δ ∨ x = −√Δ`` instead of what the author wrote.
    """
    out = graph_to_latex(_graph(r"x = \pm\sqrt{\Delta}"))
    assert r"\pm" in out
    assert r"\lor" not in out and "∨" not in out


def test_the_sign_is_not_doubled_up_after_a_term():
    r"""``- b \pm √Δ``, never ``- b + \pm √Δ``.

    ``±`` carries its own sign, so the ``add`` renderer must suppress the ``+``
    exactly as it does for ``negation``.
    """
    out = to_latex(_graph(r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"))
    assert r"+ \pm" not in out
    assert r"\pm" in out
