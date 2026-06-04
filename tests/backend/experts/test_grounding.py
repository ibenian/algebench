"""Tests for sympy grounding + trajectory consistency."""

from __future__ import annotations

import sympy as sp
import pytest

from backend.semantic_graph.service import SemanticGraphService
from backend.experts.proof_completion import dataset as D
from backend.experts.proof_completion.graph_ops import apply
from backend.experts.proof_completion.grounding import (
    graph_to_sympy,
    is_grounded,
    sympy_equiv,
    trajectory_consistent,
)

SVC = SemanticGraphService()
x, a, b, n = sp.symbols("x a b n")

ROUNDTRIP = [
    (r"x^2 + 2 x + 1", x ** 2 + 2 * x + 1),
    (r"(x+1)^2", (x + 1) ** 2),
    (r"a^2 - b^2", a ** 2 - b ** 2),
    (r"(a-b)(a+b)", (a - b) * (a + b)),
    (r"\frac{d}{dx} x^3", sp.Derivative(x ** 3, x)),
    (r"\frac{a}{b}", a / b),
    (r"x^{n}", x ** n),
]


@pytest.mark.parametrize("latex,expected", ROUNDTRIP)
def test_graph_grounds_to_source_expression(latex, expected):
    g = SVC.derive(latex)
    assert sympy_equiv(graph_to_sympy(g), expected)
    assert is_grounded(g, expected) is True


def test_grounding_rejects_wrong_expression():
    g = SVC.derive(r"x^2 + 2 x + 1")
    assert is_grounded(g, x ** 2 + 3 * x + 1) is False


def test_equations_ground_up_to_sign():
    g = SVC.derive(r"F = m a")
    F, m, aa = sp.symbols("F m a")
    assert is_grounded(g, sp.Eq(F, m * aa)) is True
    assert is_grounded(g, sp.Eq(m * aa, F)) is True  # sides swapped


def test_expanded_and_factored_forms_are_equivalent():
    # different graphs, same math: factored vs expanded both ground equal
    factored = SVC.derive(r"(a-b)(a+b)")
    assert is_grounded(factored, a ** 2 - b ** 2) is True


def test_trajectory_consistent_on_gold():
    exs = D.generate(n=6, seed=99, max_steps=1)
    assert exs
    for ex in exs:
        assert trajectory_consistent(ex.context.start, ex.gold_ops, ex.context.target)


def test_trajectory_inconsistent_when_ops_missing():
    exs = D.generate(n=3, seed=1, max_steps=1)
    ex = exs[0]
    # dropping the last op should break the reconstruction
    assert not trajectory_consistent(ex.context.start, ex.gold_ops[:-1], ex.context.target)


def test_dataset_carries_source_expressions():
    exs = D.generate(n=6, seed=5, max_steps=1)
    for ex in exs:
        assert ex.start_expr is not None and ex.target_expr is not None
        # applying gold to start yields a graph that is never grounded to the
        # WRONG math (True when groundable, None when the walk can't model it).
        applied = apply(ex.context.start, ex.gold_ops)
        assert is_grounded(applied, ex.target_expr) is not False
