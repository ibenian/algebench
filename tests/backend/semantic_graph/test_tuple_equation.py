r"""Component-wise tuple equations in the semantic-graph parser.

``(x, y, z) = (\sin\theta\cos\phi, \sin\theta\sin\phi, \cos\theta)`` — common
for vector-valued results (coordinates, vector components, parametric forms) —
must parse to one ``equals`` root over two ordered ``tuple`` operator nodes
whose operands are the fully-derived component graphs.

This is handled by ``equation_chain._split_tuple_equation`` /
``_merge_tuple_equation``: sympy's LaTeX parser has no tuple syntax, so the
chain handler detects the shape (both sides parenthesized comma-lists of the
SAME arity) and builds the graph from per-component parses. Downstream, the
structural LaTeX renderer emits ``\left( a,\; b \right)`` and the grounding
walk expands the equation component-wise into ``And(Eq, Eq, …)``.

Surfaced by issue: an AI-tutor derivation targeting the Bloch vector components
failed with "Couldn't parse the target expression."
"""

from __future__ import annotations

import pytest
import sympy as sp

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.grounding import graph_to_sympy
from tests.backend.semantic_graph.generators.invariants import (
    assert_universal_invariants,
)

_SVC = SemanticGraphService()


def _graph(latex: str):
    return _SVC.latex_to_graph(latex)


BLOCH = r"(x, y, z) = (\sin\theta\cos\phi, \sin\theta\sin\phi, \cos\theta)"
POLAR = r"\left( x, y \right) = \left( r\cos\theta, r\sin\theta \right)"
PAIR = r"(a, b) = (b, a)"


# --------------------------------------------------------------------------- #
# Parse: equals root over two tuple nodes, well-formed.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("latex", [BLOCH, POLAR, PAIR])
def test_tuple_equation_parses_and_is_wellformed(latex):
    g = _graph(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    assert_universal_invariants(g, latex=latex)
    assert sum(1 for n in g.nodes if n.op == "tuple") == 2
    assert sum(1 for n in g.nodes if n.op == "equals") == 1


def test_tuple_components_stay_ordered():
    g = _graph(BLOCH)
    nodes = {n.id: n for n in g.nodes}
    incoming = {n.id: [] for n in g.nodes}
    for e in g.edges:
        incoming[e.to].append(e.from_)
    lhs = [nodes[c].latex for c in incoming["__tuple_1"]]
    assert lhs == ["x", "y", "z"]


# --------------------------------------------------------------------------- #
# Grouping parens and function calls must NOT become tuples.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("latex", [
    r"(x + 1)(x - 1) = x^2 - 1",   # grouping product
    r"f(x, y) = x + y",            # function application (lhs not a bare tuple)
    r"(x) = (y)",                  # 1-component parens are grouping, not tuples
])
def test_non_tuples_do_not_grow_tuple_nodes(latex):
    g = _graph(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    assert not any(n.op == "tuple" for n in g.nodes), latex


def test_mismatched_arity_is_not_a_tuple_equation():
    # (x, y, z) = (a, b) is not component-wise; must not half-parse
    g = _graph(r"(x, y, z) = (a, b)")
    assert g is None or not any(n.op == "tuple" for n in g.nodes)


# --------------------------------------------------------------------------- #
# Downstream: structural LaTeX render and CAS grounding.
# --------------------------------------------------------------------------- #

def test_tuple_equation_renders_structurally():
    g = _graph(BLOCH)
    out = to_latex(g)
    assert out.startswith(r"\left( x,\; y,\; z \right) =")
    assert out.count(r",\;") == 4  # two separators per 3-tuple


def test_tuple_equation_renders_with_ids():
    g = _graph(BLOCH)
    out = to_latex(g, with_ids=True)
    assert "htmlData" in out


def test_tuple_equation_grounds_component_wise():
    expr = graph_to_sympy(_graph(POLAR))
    x, y, r, theta = sp.Symbol("x"), sp.Symbol("y"), sp.Symbol("r"), sp.Symbol(r"\theta")
    assert expr == sp.And(sp.Eq(x, r * sp.cos(theta)), sp.Eq(y, r * sp.sin(theta)))
