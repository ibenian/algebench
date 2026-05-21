"""Domain suite: Fourier & transforms.

Covers Fourier, Laplace, Z-transforms, convolution, calligraphic
operators, and Parseval's theorem.  This is Phase 4b — transform
notation exercises many parser subsystems simultaneously.

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
    "integral", "sum", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

EXPRESSIONS: list[CatalogEntry] = [
    ("fourier_hat",
     r"\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi} dx",
     PASS,
     "const:__const_15,num,x -> Tuple; x -> fn:f; f,xi -> multiply; "
     "x,xi -> multiply; hat,multiply -> multiply; i,multiply -> multiply; "
     "const:pi,multiply -> multiply; multiply,num -> multiply; "
     "e,multiply -> power; fn:f,power -> multiply; "
     "Tuple,multiply -> integral; integral,multiply -> equals",
     "__const_15,__num_14,x -> __expr_13; x -> __f_6; "
     "x,xi -> __multiply_12; f,xi -> __multiply_3; "
     "__multiply_12,i -> __multiply_11; __multiply_3,hat -> __multiply_2; "
     "__multiply_11,pi -> __multiply_10; "
     "__multiply_10,__num_9 -> __multiply_8; "
     "__multiply_8,e -> __power_7; __f_6,__power_7 -> __multiply_5; "
     "__expr_13,__multiply_5 -> __integral_4; "
     "__integral_4,__multiply_2 -> __equals_1",
     None),

    ("laplace",
     r"\mathcal{L}\{f(t)\} = F(s)",
     PASS,
     "s -> fn:F; t -> fn:f; L,fn:f -> multiply; fn:F,multiply -> equals",
     "s -> __F_4; t -> __f_3; L,__f_3 -> __multiply_2; "
     "__F_4,__multiply_2 -> __equals_1",
     None),

    ("inverse_laplace",
     r"f(t) = \mathcal{L}^{-1}\{F(s)\}",
     PASS,
     "s -> fn:F; t -> fn:f; L -> power; fn:F,power -> multiply; "
     "fn:f,multiply -> equals",
     "s -> __F_5; t -> __f_2; L -> __power_4; "
     "__F_5,__power_4 -> __multiply_3; __f_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("convolution",
     r"(f * g)(t) = \int_0^t f(\tau) g(t - \tau) d\tau",
     PASS,
     "num,t,tau -> Tuple; tau -> fn:f; f,g -> multiply; "
     "tau -> negation; negation,t -> add; multiply,t -> multiply; "
     "add -> fn:g; fn:f,fn:g -> multiply; Tuple,multiply -> integral; "
     "integral,multiply -> equals",
     "__num_11,t,tau -> __expr_10; tau -> __f_6; f,g -> __multiply_3; "
     "tau -> __negation_9; __negation_9,t -> __add_8; "
     "__multiply_3,t -> __multiply_2; __add_8 -> __g_7; "
     "__f_6,__g_7 -> __multiply_5; __expr_10,__multiply_5 -> __integral_4; "
     "__integral_4,__multiply_2 -> __equals_1",
     None),

    ("z_transform",
     r"X(z) = \sum_{n=0}^{\infty} x[n] z^{-n}",
     PASS,
     "const:__const_9,n,num -> Tuple; z -> fn:X; z -> power; "
     "n,power -> multiply; multiply,x -> multiply; "
     "Tuple,multiply -> sum; fn:X,sum -> equals",
     "z -> __X_2; __const_9,__num_8,n -> __expr_7; z -> __power_6; "
     "__power_6,n -> __multiply_5; __multiply_5,x -> __multiply_4; "
     "__expr_7,__multiply_4 -> __sum_3; __X_2,__sum_3 -> __equals_1",
     None),

    ("parseval",
     r"\int |f(x)|^2 dx = \int |\hat{f}(\xi)|^2 d\xi",
     PASS,
     "x -> Tuple; xi -> Tuple; x -> fn:f; f,xi -> multiply; "
     "fn:f -> fn:Abs; hat,multiply -> multiply; multiply -> fn:Abs; "
     "fn:Abs -> power; Tuple,power -> integral; fn:Abs -> power; "
     "Tuple,power -> integral; integral,integral -> equals",
     "xi -> __expr_12; x -> __expr_6; x -> __f_5; "
     "f,xi -> __multiply_11; __f_5 -> __Abs_4; "
     "__multiply_11,hat -> __multiply_10; __multiply_10 -> __Abs_9; "
     "__Abs_4 -> __power_3; __expr_6,__power_3 -> __integral_2; "
     "__Abs_9 -> __power_8; __expr_12,__power_8 -> __integral_7; "
     "__integral_2,__integral_7 -> __equals_1",
     None),

    ("dft",
     r"X_k = \sum_{n=0}^{N-1} x_n e^{-i 2\pi k n / N}",
     PASS,
     "N,num -> add; const:pi,i,k,n,num -> multiply; N -> power; "
     "add,n,num -> Tuple; multiply -> negation; "
     "negation,power -> multiply; e,multiply -> power; "
     "power,x_{n} -> multiply; Tuple,multiply -> sum; "
     "X_{k},sum -> equals",
     "N,__num_13 -> __add_12; __num_8,i,k,n,pi -> __multiply_7; "
     "N -> __power_9; __add_12,__num_11,n -> __expr_10; "
     "__multiply_7 -> __negation_6; "
     "__negation_6,__power_9 -> __multiply_5; "
     "__multiply_5,e -> __power_4; __power_4,x_{n} -> __multiply_3; "
     "__expr_10,__multiply_3 -> __sum_2; "
     "X_{k},__sum_2 -> __equals_1",
     None),

    ("transfer_fn",
     r"H(s) = \frac{Y(s)}{X(s)}",
     PASS,
     "s -> fn:H; s -> fn:X; s -> fn:Y; fn:X -> power; "
     "fn:Y,power -> multiply; fn:H,multiply -> equals",
     "s -> __H_2; s -> __X_6; s -> __Y_4; __X_6 -> __power_5; "
     "__Y_4,__power_5 -> __multiply_3; "
     "__H_2,__multiply_3 -> __equals_1",
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
class TestTransformsDomain:
    """Transforms domain suite — universal + suite-specific invariants."""

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
