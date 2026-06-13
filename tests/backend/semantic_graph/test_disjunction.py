r"""Disjunction of equations/relations in the semantic-graph parser.

``\lor`` / ``\vee`` over **equations** — e.g. quadratic roots
``x = r_1 \lor x = r_2`` — must parse to a disjunction at the **root** with the
two equations as its children (``Or(Eq, Eq)``).

Today they don't. The infix-operator rewriter turns ``A \lor B`` into a
placeholder *function call* ``\Xi_N(A, B)`` for SymPy's ``parse_latex``; since a
call's arguments can't contain ``=``, relations are made *fences* that the
rewriter splits on first. So ``x = 2 \lor x = 3`` segments as ``x = [2 \lor x]
= 3`` and the disjunction gets trapped *inside* the equation — producing an
``equals``-rooted tree instead of ``Or(Eq, Eq)``.

The ``*_parses`` tests pass today (the parse succeeds and a disjunction node
exists). The structural tests pin the **correct** shape and are
``xfail(strict)`` until a dedicated logical-connective-over-relations path lands
(split on the top-level connective, parse each relation, join under the
disjunction node — mirroring ``equation_chain`` for ``a = b = c``).
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.service import SemanticGraphService
from tests.backend.semantic_graph.generators.invariants import (
    assert_universal_invariants,
    child_ops_of_op,
)

_SVC = SemanticGraphService()


def _graph(latex: str):
    return _SVC.latex_to_graph(latex)


TWO_ROOTS = r"x = 2 \lor x = 3"
TWO_ROOTS_VEE = r"x = 2 \vee x = 3"
QUADRATIC = (
    r"x = \frac{-b + \sqrt{b^2 - 4ac}}{2a} \lor "
    r"x = \frac{-b - \sqrt{b^2 - 4ac}}{2a}"
)


# --------------------------------------------------------------------------- #
# Pass today: it parses, stays well-formed, and a disjunction node exists.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("latex", [TWO_ROOTS, TWO_ROOTS_VEE, QUADRATIC])
def test_disjunction_parses_and_is_wellformed(latex):
    g = _graph(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    assert_universal_invariants(g, latex=latex)
    assert "disjunction" in {n.op for n in g.nodes}, (
        f"no disjunction node for: {latex!r}"
    )


# --------------------------------------------------------------------------- #
# The requirement (xfail until the relational-connective path lands):
# the disjunction must be the ROOT, with two equations as its branches.
# --------------------------------------------------------------------------- #

@pytest.mark.xfail(
    strict=True,
    reason=r"parser traps \lor inside the '=' fence: disjunction is nested "
           r"under equals instead of Or(Eq, Eq)",
)
@pytest.mark.parametrize("latex", [TWO_ROOTS, TWO_ROOTS_VEE])
def test_disjunction_root_over_two_equations(latex):
    g = _graph(latex)
    # both branches feeding the disjunction must themselves be equations
    assert child_ops_of_op(g, "disjunction") == {"equals"}, (
        f"disjunction branches should be equations for: {latex!r}"
    )
    assert sum(1 for n in g.nodes if n.op == "equals") == 2


@pytest.mark.xfail(
    strict=True,
    reason=r"quadratic roots `x = … \lor x = …` hit the same \lor-vs-'=' gap",
)
def test_quadratic_roots_is_disjunction_of_equations():
    g = _graph(QUADRATIC)
    assert child_ops_of_op(g, "disjunction") == {"equals"}
    # exactly the two root equations under the disjunction
    assert sum(1 for n in g.nodes if n.op == "equals") == 2
