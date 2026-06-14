"""Tests for sympy grounding + trajectory consistency."""

from __future__ import annotations

import sympy as sp
import pytest

from backend.semantic_graph.service import SemanticGraphService
from backend.experts.modules.proof_completion import dataset as D
from backend.experts.modules.proof_completion.graph_ops import apply
from backend.experts.modules.proof_completion.grounding import (
    graph_to_sympy,
    is_grounded,
    per_step_groundable,
    step_groundings,
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
    (r"\int_0^1 x^2 dx", sp.Integral(x ** 2, (x, 0, 1))),   # definite
    (r"\int x^2 dx", sp.Integral(x ** 2, x)),                # indefinite
    (r"\frac{a}{b}", a / b),
    (r"x^{n}", x ** n),
]


@pytest.mark.parametrize("latex,expected", ROUNDTRIP)
def test_graph_grounds_to_source_expression(latex, expected):
    g = SVC.latex_to_graph(latex)
    assert sympy_equiv(graph_to_sympy(g), expected)
    assert is_grounded(g, expected) is True


def test_grounding_rejects_wrong_expression():
    g = SVC.latex_to_graph(r"x^2 + 2 x + 1")
    assert is_grounded(g, x ** 2 + 3 * x + 1) is False


def test_equations_ground_up_to_sign():
    g = SVC.latex_to_graph(r"F = m a")
    F, m, aa = sp.symbols("F m a")
    assert is_grounded(g, sp.Eq(F, m * aa)) is True
    assert is_grounded(g, sp.Eq(m * aa, F)) is True  # sides swapped


def test_expanded_and_factored_forms_are_equivalent():
    # different graphs, same math: factored vs expanded both ground equal
    factored = SVC.latex_to_graph(r"(a-b)(a+b)")
    assert is_grounded(factored, a ** 2 - b ** 2) is True


def test_inequalities_and_logic_ground():
    cases = [
        (r"2 x + 1 < 7", sp.Lt(2 * x + 1, 7)),
        (r"3 x \leq 9", sp.Le(3 * x, 9)),
        (r"x^2 \geq 4", sp.Ge(x ** 2, 4)),
        (r"x \neq 0", sp.Ne(x, 0)),
        (r"x > 2 \implies x > 0", sp.Implies(sp.Gt(x, 2), sp.Gt(x, 0))),
    ]
    for latex, expected in cases:
        g = SVC.latex_to_graph(latex)
        assert is_grounded(g, expected) is True, latex


def test_inequality_direction_is_respected():
    # 3 > x is the same relation as x < 3 (canonical), but x < 3 != x <= 3
    assert sympy_equiv(sp.Gt(3, x), sp.Lt(x, 3)) is True
    assert sympy_equiv(sp.Lt(x, 3), sp.Le(x, 3)) is False
    # a true inequality must not match its reverse
    assert sympy_equiv(sp.Lt(x, 3), sp.Gt(x, 3)) is False


def test_inequality_and_logic_domains_are_groundable():
    for dom in ("inequalities", "logic"):
        exs = D.generate(n=4, seed=4, domains=[dom], max_ops=120)
        assert exs, f"no examples for {dom}"
        for e in exs:
            sg = step_groundings(e.context.start, e.gold_ops, e.step_exprs)
            assert all(s is True for s in sg), (dom, sg)


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


def test_multistep_generation_tags_steps_and_grounds_every_waypoint():
    exs = D.generate(n=20, seed=1, max_steps=3, max_ops=60)
    assert exs
    multi = [e for e in exs if e.n_steps > 1]
    assert multi, "expected at least one multi-step chain"
    for e in exs:
        # ops are tagged with contiguous 1..n_steps step indices
        assert sorted(set(o.step for o in e.gold_ops)) == list(range(1, e.n_steps + 1))
        # one expected expression per step
        assert len(e.step_exprs) == e.n_steps
        # every waypoint of the gold trajectory grounds to its expected expr
        assert all(s is True for s in step_groundings(
            e.context.start, e.gold_ops, e.step_exprs))


def test_per_step_groundable_counts_valid_waypoints():
    exs = D.generate(n=6, seed=2, max_steps=3, max_ops=60)
    e = next(x for x in exs if x.n_steps > 1)
    ok, total = per_step_groundable(e.context.start, e.gold_ops)
    assert total == e.n_steps
    assert ok == total  # gold waypoints are all valid math


def test_dataset_carries_source_expressions():
    exs = D.generate(n=6, seed=5, max_steps=1)
    for ex in exs:
        assert ex.start_expr is not None and ex.target_expr is not None
        # applying gold to start yields a graph that is never grounded to the
        # WRONG math (True when groundable, None when the walk can't model it).
        applied = apply(ex.context.start, ex.gold_ops)
        assert is_grounded(applied, ex.target_expr) is not False


def test_chained_inequality_grounds_as_conjunction():
    # "a <= g <= b" (an entry-corridor-style bound) parses with a nested
    # relation; it must ground to the standard conjunction And(a<=g, g<=b).
    g = SVC.latex_to_graph(r"a \leq x \leq b")
    got = graph_to_sympy(g)
    expected = sp.And(a <= x, x <= b)
    assert sympy_equiv(got, expected)
    assert is_grounded(g, expected) is True
    # and a WRONG corridor is rejected, not blessed
    assert is_grounded(g, sp.And(a <= x, x <= a)) is False
