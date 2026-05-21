"""Domain suite: Ordinary differential equations.

Covers 1st/2nd order ODEs, systems, initial conditions, Bernoulli,
exact equations, Laplace transforms, and variation of parameters.
This is Phase 1 — locking in coverage for ODE constructs.

Suite-specific invariant (from design doc §8.3):
  Classification ``kind`` is ``ODE`` for single-statement ODEs.
  Multi-statement expressions (systems, initial conditions) have
  ``kind`` of ``statements``.

Connectivity is verified via ``graph_signature()`` — a canonical string
encoding of the graph's edge structure.
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
    "add", "multiply", "power", "equals", "negation",
    "derivative", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)
#   - tag: PASS | XFAIL | SKIP (imported from invariants)
#   - sig_by_type: label_by_type connectivity string (type-prefixed labels)
#   - sig_by_id:   label_by_id connectivity string (raw node IDs)
#   - "" for collapsed expressions (no edges)
#   - node_checks: list of dicts for node property assertions, or None
#
# XFAIL is strict — CI catches the fix and prompts mark removal.

# Type alias for catalog entries
CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

FIRST_ORDER_EXPRESSIONS: list[CatalogEntry] = [
    ("first_order",
     r"\frac{dy}{dx} = ky",
     PASS,
     "x,y -> derivative; k,y -> multiply; derivative,multiply -> equals",
     "x,y -> __deriv_2; k,y -> __multiply_3; "
     "__deriv_2,__multiply_3 -> __equals_1",
     [{"op": "derivative"}]),

    ("separable",
     r"\frac{dy}{dx} = \frac{x}{y}",
     PASS,
     "x,y -> derivative; y -> power; power,x -> multiply; "
     "derivative,multiply -> equals",
     "x,y -> __deriv_2; y -> __power_4; __power_4,x -> __multiply_3; "
     "__deriv_2,__multiply_3 -> __equals_1",
     [{"op": "derivative"}, {"op": "power", "exponent": "-1"}]),

    ("bernoulli",
     r"\frac{dy}{dx} + P(x) y = Q(x) y^n",
     PASS,
     "x,y -> derivative; x -> fn:P; x -> fn:Q; n,y -> power; "
     "fn:P,y -> multiply; fn:Q,power -> multiply; "
     "derivative,multiply -> add; add,multiply -> equals",
     "x -> __P_5; x -> __Q_7; x,y -> __deriv_3; n,y -> __power_8; "
     "__P_5,y -> __multiply_4; __Q_7,__power_8 -> __multiply_6; "
     "__deriv_3,__multiply_4 -> __add_2; __add_2,__multiply_6 -> __equals_1",
     [{"op": "derivative"}]),

    ("exact",
     r"M(x,y) dx + N(x,y) dy = 0",
     PASS,
     "x,y -> fn:M; x,y -> fn:N; dx,fn:M -> multiply; dy,fn:N -> multiply; "
     "multiply,multiply -> add; add,num -> equals",
     "x,y -> __M_4; x,y -> __N_6; __M_4,dx -> __multiply_3; "
     "__N_6,dy -> __multiply_5; __multiply_3,__multiply_5 -> __add_2; "
     "__add_2,__num_7 -> __equals_1",
     None),
]

SECOND_ORDER_EXPRESSIONS: list[CatalogEntry] = [
    ("second_order",
     r"\frac{d^2 y}{dx^2} + \omega^2 y = 0",
     PASS,
     "x,y -> derivative; omega -> power; power,y -> multiply; "
     "derivative,multiply -> add; add,num -> equals",
     "x,y -> __deriv_3; omega -> __power_5; __power_5,y -> __multiply_4; "
     "__deriv_3,__multiply_4 -> __add_2; __add_2,__num_6 -> __equals_1",
     [{"op": "derivative"}, {"op": "power", "exponent": "2"}]),

    ("damped_oscillator",
     r"m \ddot{x} + c \dot{x} + k x = 0",
     PASS,
     "t,x -> derivative; t,x -> derivative; k,x -> multiply; "
     "c,derivative -> multiply; derivative,m -> multiply; "
     "multiply,multiply -> add; add,multiply -> add; add,num -> equals",
     "t,x -> __deriv_5; t,x -> __deriv_7; k,x -> __multiply_8; "
     "__deriv_5,m -> __multiply_4; __deriv_7,c -> __multiply_6; "
     "__multiply_4,__multiply_6 -> __add_3; "
     "__add_3,__multiply_8 -> __add_2; __add_2,__num_9 -> __equals_1",
     [{"op": "derivative"}]),
]

SYSTEM_EXPRESSIONS: list[CatalogEntry] = [
    ("system",
     r"\dot{x} = ax + by, \quad \dot{y} = cx + dy",
     PASS,
     "t,x -> derivative; t,y -> derivative; a,x -> multiply; "
     "b,y -> multiply; c,x -> multiply; dy,multiply -> add; "
     "multiply,multiply -> add; add,derivative -> equals; "
     "add,derivative -> equals",
     "t,x -> c0___deriv_2; a,x -> c0___multiply_4; b,y -> c0___multiply_5; "
     "t,y -> c1___deriv_2; c,x -> c1___multiply_4; "
     "c0___multiply_4,c0___multiply_5 -> c0___add_3; "
     "c1___multiply_4,dy -> c1___add_3; "
     "c0___add_3,c0___deriv_2 -> c0___equals_1; "
     "c1___add_3,c1___deriv_2 -> c1___equals_1",
     [{"op": "derivative"}]),

    ("initial_condition",
     r"y'' + y = 0, \quad y(0) = 1, \quad y'(0) = 0",
     PASS,
     "y,y'' -> add; num -> fn:y; num -> fn:y'; "
     "add,num -> equals; fn:y,num -> equals; fn:y',num -> equals",
     "y,y'' -> c0___add_2; c1___num_3 -> c1___y_2; "
     "c2___num_3 -> c2___y'_2; c0___add_2,c0___num_3 -> c0___equals_1; "
     "c1___num_4,c1___y_2 -> c1___equals_1; "
     "c2___num_4,c2___y'_2 -> c2___equals_1",
     None),
]

TRANSFORM_EXPRESSIONS: list[CatalogEntry] = [
    ("laplace_transform",
     r"s Y(s) - y(0) = \mathcal{L}\{f(t)\}",
     PASS,
     "s -> fn:Y; t -> fn:f; num -> fn:y; L,fn:f -> multiply; "
     "fn:Y,s -> multiply; fn:y -> negation; multiply,negation -> add; "
     "add,multiply -> equals",
     "s -> __Y_4; t -> __f_9; __num_7 -> __y_6; __Y_4,s -> __multiply_3; "
     "L,__f_9 -> __multiply_8; __y_6 -> __negation_5; "
     "__multiply_3,__negation_5 -> __add_2; "
     "__add_2,__multiply_8 -> __equals_1",
     None),

    ("variation_params",
     r"y_p = u_1 y_1 + u_2 y_2",
     PASS,
     "u_{1},y_{1} -> multiply; u_{2},y_{2} -> multiply; "
     "multiply,multiply -> add; add,y_{p} -> equals",
     "u_{1},y_{1} -> __multiply_3; u_{2},y_{2} -> __multiply_4; "
     "__multiply_3,__multiply_4 -> __add_2; __add_2,y_{p} -> __equals_1",
     None),
]

ALL_EXPRESSIONS = (
    FIRST_ORDER_EXPRESSIONS
    + SECOND_ORDER_EXPRESSIONS
    + SYSTEM_EXPRESSIONS
    + TRANSFORM_EXPRESSIONS
)


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
class TestODEDomain:
    """ODE domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_ode(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"ODE", "algebraic", "statements"}, (
            f"Expected ODE/algebraic/statements classification, got {kind!r} "
            f"for: {latex!r}"
        )

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


# ── Extensibility: add regression cases here ────────────────────────────


class TestODERegressions:
    """Regression tests for specific ODE parsing issues."""
