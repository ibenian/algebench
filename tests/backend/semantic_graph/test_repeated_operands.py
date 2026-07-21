r"""A product of identical operands must keep every factor.

Regression for a silent, arity-losing bug: ``a \cdot a`` parsed to a multiply
node with a SINGLE operand edge and re-rendered as ``a``.

The cause was ``_dedupe_edges``, whose docstring assumed a repeated ``from→to``
edge is "pure redundancy" because the renderer keys edges by that pair. That
holds for metadata edges (``wrt`` and friends), but NOT for the operands of a
commutative n-ary operator, where multiplicity IS the arity: ``a \cdot a`` and
``a`` are different expressions.

This mattered well beyond rendering. ``graph_to_sympy`` consumes the same graph,
so a proof step written ``a \cdot a`` was CAS-verified as ``a`` — the confidence
badge was grading a different expression than the one on screen.
"""
from __future__ import annotations

import pytest

from backend.semantic_graph.latex_renderer import to_latex
from backend.semantic_graph.service import SemanticGraphService


@pytest.fixture(scope="module")
def svc() -> SemanticGraphService:
    return SemanticGraphService()


def _operand_edges(graph, node_id: str) -> list:
    """Operand (role-less) edges INTO ``node_id``."""
    return [e for e in graph.edges if e.to == node_id and not e.role]


@pytest.mark.parametrize("latex,expected", [
    (r"a \cdot a", r"a \cdot a"),
    (r"x \cdot x \cdot x", r"x \cdot x \cdot x"),
    (r"a \cdot a + a \cdot b + b \cdot a + b \cdot b",
     r"a \cdot a + a \cdot b + b \cdot a + b \cdot b"),
])
def test_repeated_operands_survive_a_round_trip(svc, latex, expected):
    """Parsing then re-rendering must not drop a repeated factor."""
    assert to_latex(svc.latex_to_graph(latex, domain="algebra")) == expected


def test_multiply_node_keeps_one_edge_per_occurrence(svc):
    """The graph itself carries the arity, not just the rendered string."""
    graph = svc.latex_to_graph(r"a \cdot a", domain="algebra")
    multiply = [n for n in graph.nodes if getattr(n, "op", None) == "multiply"]
    assert len(multiply) == 1
    assert len(_operand_edges(graph, multiply[0].id)) == 2


def test_repeated_operands_are_cas_convertible_as_written(svc):
    """The CAS must see the expression the reader sees.

    Without this, a step's confidence badge grades a DIFFERENT expression than
    the one rendered — the badge would look authoritative and be meaningless.
    """
    sp = pytest.importorskip("sympy")
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy

    expr = graph_to_sympy(svc.latex_to_graph(r"a \cdot a", domain="algebra"))
    assert expr is not None
    assert sp.simplify(expr - sp.Symbol("a") ** 2) == 0


def test_distinct_operands_are_unaffected(svc):
    """The narrow fix must not perturb the ordinary case."""
    graph = svc.latex_to_graph(r"a \cdot b", domain="algebra")
    multiply = [n for n in graph.nodes if getattr(n, "op", None) == "multiply"]
    assert len(_operand_edges(graph, multiply[0].id)) == 2
    assert to_latex(graph) == r"a \cdot b"
