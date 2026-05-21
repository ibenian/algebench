"""Domain suite: Optimization.

Covers argmin/argmax, Lagrange multipliers, KKT conditions,
gradient descent, and sup/inf notation.  This is Phase 4b —
constrained optimization with subscripted bounds is partially supported.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.

Connectivity is verified via ``graph_signature()``.
"""

from __future__ import annotations

import pytest

from tests.backend.semantic_graph.generators.invariants import (
    PASS,
    XFAIL,
    SKIP,
    label_by_type,
    label_by_id,
    assert_universal_invariants,
    assert_operators_in,
    assert_classification_kind_is,
    assert_signature,
    assert_node_properties,
)


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "multiply", "power", "equals", "add", "negation",
    "less_equal", "greater_equal", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("argmin",
     r"\arg\min_{x} f(x)",
     PASS,
     "x -> fn:f; fn:f,min_{x} -> multiply; arg,multiply -> multiply",
     "x -> __f_3; __f_3,min_{x} -> __multiply_2; "
     "__multiply_2,arg -> __multiply_1",
     None),

    ("argmax",
     r"\arg\max_{\theta} \mathcal{L}(\theta)",
     PASS,
     "L,theta -> multiply; max_{theta},multiply -> multiply; "
     "arg,multiply -> multiply",
     "L,theta -> __multiply_3; __multiply_3,max_{theta} -> __multiply_2; "
     "__multiply_2,arg -> __multiply_1",
     None),

    ("constrained",
     r"\min_{x} f(x) \leq g(x)",
     PASS,
     "x -> fn:f; x -> fn:g; fn:f,min_{x} -> multiply; "
     "fn:g,multiply -> less_equal",
     "x -> __f_3; x -> __g_4; __f_3,min_{x} -> __multiply_2; "
     "__g_4,__multiply_2 -> __less_equal_1",
     None),

    ("lagrangian",
     r"L(x, \lambda) = f(x) + \lambda g(x)",
     PASS,
     "lambda,x -> fn:L; x -> fn:f; x -> fn:g; "
     "fn:g,lambda -> multiply; fn:f,multiply -> add; "
     "add,fn:L -> equals",
     "lambda,x -> __L_2; x -> __f_4; x -> __g_6; "
     "__g_6,lambda -> __multiply_5; __f_4,__multiply_5 -> __add_3; "
     "__L_2,__add_3 -> __equals_1",
     None),

    ("kkt_stationarity",
     r"\nabla f(x^*) + \lambda \nabla g(x^*) = 0",
     PASS,
     "f,nabla -> multiply",
     "f,nabla -> __multiply_1",
     None),

    ("gradient_descent",
     r"x_{k+1} = x_k - \alpha \nabla f(x_k)",
     PASS,
     "x_{k} -> fn:f; fn:f,nabla -> multiply; alpha,multiply -> multiply; "
     "multiply -> negation; negation,x_{k} -> add; "
     "add,x_{k + 1} -> equals",
     "x_{k} -> __f_6; __f_6,nabla -> __multiply_5; "
     "__multiply_5,alpha -> __multiply_4; "
     "__multiply_4 -> __negation_3; __negation_3,x_{k} -> __add_2; "
     "__add_2,x_{k + 1} -> __equals_1",
     None),

    ("dual_problem",
     r"\max_{\lambda \geq 0} \min_{x} L(x, \lambda)",
     XFAIL,
     "",
     "",
     None),

    ("sup_inf",
     r"\sup_{x \in S} \inf_{y \in T} f(x, y)",
     PASS,
     "x,y -> fn:f; fn:f,inf_{y*(T*in)} -> multiply; "
     "multiply,sup_{x*(S*in)} -> multiply",
     "x,y -> __f_3; __f_3,inf_{y*(T*in)} -> __multiply_2; "
     "__multiply_2,sup_{x*(S*in)} -> __multiply_1",
     None),
]


ALL_EXPRESSIONS = EXPRESSIONS


# ── Test collection ─────────────────────────────────────────────────────


def _build_params():
    """Build pytest parametrize params from the expression catalog."""
    params = []
    for test_id, latex, tag, sig_type, sig_id, node_checks in ALL_EXPRESSIONS:
        marks = [tag] if tag is not None else []
        params.append(pytest.param(
            latex, sig_type, sig_id, node_checks, id=test_id, marks=marks,
        ))
    return params


@pytest.mark.parametrize("latex, sig_type, sig_id, node_checks", _build_params())
class TestOptimizationDomain:
    """Optimization domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_node_properties(graph, node_checks, latex=latex)
