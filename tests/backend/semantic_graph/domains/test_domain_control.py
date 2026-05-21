"""Domain suite: Control theory.

Covers transfer functions, feedback loops, PID controllers, state-space
representation, and characteristic equations.  This is Phase 4b —
the parser handles most control-theory notation well since it reuses
calculus and algebra constructs.

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
    "derivative", "integral", "function", "Abs", "abs",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("transfer_function",
     r"G(s) = \frac{Y(s)}{U(s)}",
     PASS,
     "s -> fn:G; s -> fn:U; s -> fn:Y; fn:U -> power; "
     "fn:Y,power -> multiply; fn:G,multiply -> equals",
     "s -> __G_2; s -> __U_6; s -> __Y_4; __U_6 -> __power_5; "
     "__Y_4,__power_5 -> __multiply_3; "
     "__G_2,__multiply_3 -> __equals_1",
     None),

    ("closed_loop",
     r"T(s) = \frac{G(s)}{1 + G(s)H(s)}",
     PASS,
     "s -> fn:G; s -> fn:G; s -> fn:H; s -> fn:T; "
     "fn:G,fn:H -> multiply; multiply,num -> add; "
     "add -> power; fn:G,power -> multiply; "
     "fn:T,multiply -> equals",
     "s -> __G_4; s -> __G_9; s -> __H_10; s -> __T_2; "
     "__G_9,__H_10 -> __multiply_8; __multiply_8,__num_7 -> __add_6; "
     "__add_6 -> __power_5; __G_4,__power_5 -> __multiply_3; "
     "__T_2,__multiply_3 -> __equals_1",
     None),

    ("pid_controller",
     r"u(t) = K_p e(t) + K_i \int_0^t e(\tau) d\tau + K_d \frac{de}{dt}",
     PASS,
     "num,t,tau -> Tuple; e,t -> derivative; t -> fn:e; "
     "tau -> fn:e; t -> fn:u; Tuple,fn:e -> integral; "
     "K_{d},derivative -> multiply; K_{p},fn:e -> multiply; "
     "K_{i},integral -> multiply; multiply,multiply -> add; "
     "add,multiply -> add; add,fn:u -> equals",
     "e,t -> __deriv_13; t -> __e_6; tau -> __e_9; "
     "__num_11,t,tau -> __expr_10; t -> __u_2; "
     "__e_9,__expr_10 -> __integral_8; "
     "K_{d},__deriv_13 -> __multiply_12; "
     "K_{p},__e_6 -> __multiply_5; "
     "K_{i},__integral_8 -> __multiply_7; "
     "__multiply_5,__multiply_7 -> __add_4; "
     "__add_4,__multiply_12 -> __add_3; "
     "__add_3,__u_2 -> __equals_1",
     None),

    ("state_space",
     r"\dot{x} = Ax + Bu",
     PASS,
     "t,x -> derivative; A,x -> multiply; B,u -> multiply; "
     "multiply,multiply -> add; add,derivative -> equals",
     "t,x -> __deriv_2; A,x -> __multiply_4; B,u -> __multiply_5; "
     "__multiply_4,__multiply_5 -> __add_3; "
     "__add_3,__deriv_2 -> __equals_1",
     None),

    ("output_eq",
     r"y = Cx + Du",
     PASS,
     "C,x -> multiply; D,u -> multiply; multiply,multiply -> add; "
     "add,y -> equals",
     "C,x -> __multiply_3; D,u -> __multiply_4; "
     "__multiply_3,__multiply_4 -> __add_2; "
     "__add_2,y -> __equals_1",
     None),

    ("characteristic_eq",
     r"\det(sI - A) = 0",
     PASS,
     "I,s -> multiply; A -> negation; multiply,negation -> add; "
     "add -> fn:det; fn:det,num -> equals",
     "I,s -> __multiply_4; A -> __negation_5; "
     "__multiply_4,__negation_5 -> __add_3; "
     "__add_3 -> __det_2; __det_2,__num_6 -> __equals_1",
     None),

    ("routh_criterion",
     r"s^3 + 2s^2 + 3s + 4 = 0",
     PASS,
     "num,s -> multiply; s -> power; s -> power; "
     "num,power -> multiply; multiply,power -> add; "
     "add,multiply -> add; add,num -> add; add,num -> equals",
     "__num_10,s -> __multiply_9; s -> __power_5; s -> __power_8; "
     "__num_7,__power_8 -> __multiply_6; "
     "__multiply_6,__power_5 -> __add_4; "
     "__add_4,__multiply_9 -> __add_3; "
     "__add_3,__num_11 -> __add_2; __add_2,__num_12 -> __equals_1",
     None),

    ("nyquist",
     r"|G(j\omega)| = 1",
     PASS,
     "j,omega -> multiply; multiply -> fn:G; fn:G -> fn:Abs; "
     "fn:Abs,num -> equals",
     "j,omega -> __multiply_4; __multiply_4 -> __G_3; "
     "__G_3 -> __Abs_2; __Abs_2,__num_5 -> __equals_1",
     [{"op": "Abs", "type": "function"}]),

    ("laplace_step",
     r"Y(s) = G(s) \cdot \frac{1}{s}",
     PASS,
     "s -> fn:G; s -> fn:Y; s -> power; fn:G,power -> multiply; "
     "fn:Y,multiply -> equals",
     "s -> __G_4; s -> __Y_2; s -> __power_5; "
     "__G_4,__power_5 -> __multiply_3; "
     "__Y_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
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
class TestControlDomain:
    """Control theory domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_valid(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"algebraic", "ODE"}, (
            f"Expected 'algebraic' or 'ODE', got {kind!r} for: {latex!r}"
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
