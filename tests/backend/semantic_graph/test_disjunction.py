r"""Disjunction of equations/relations in the semantic-graph parser.

``\lor`` / ``\vee`` over **equations** — e.g. quadratic roots
``x = r_1 \lor x = r_2`` — must parse to a disjunction at the **root** with the
two equations as its children (``Or(Eq, Eq)``).

This is handled by ``equation_chain._merge_under_connective``: a top-level
``\lor`` / ``\land`` whose operands contain relations is split, each operand is
parsed on its own, and the results are joined under a disjunction / conjunction
node — mirroring how ``a = b = c`` chains are merged under one ``equals`` node.
(Previously the chain handler split on ``=`` first and trapped the ``\lor``
inside the middle segment, producing an ``equals``-rooted tree.)
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
# The requirement: the disjunction is the ROOT, with two equations as branches.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("latex", [TWO_ROOTS, TWO_ROOTS_VEE])
def test_disjunction_root_over_two_equations(latex):
    g = _graph(latex)
    # both branches feeding the disjunction must themselves be equations
    assert child_ops_of_op(g, "disjunction") == {"equals"}, (
        f"disjunction branches should be equations for: {latex!r}"
    )
    assert sum(1 for n in g.nodes if n.op == "equals") == 2


def test_quadratic_roots_is_disjunction_of_equations():
    g = _graph(QUADRATIC)
    assert child_ops_of_op(g, "disjunction") == {"equals"}
    # exactly the two root equations under the disjunction
    assert sum(1 for n in g.nodes if n.op == "equals") == 2
