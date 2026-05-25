"""Domain suite: Optics & waves.

Covers wave equation, Snell's law, diffraction, interference, Doppler
effect, thin lens equation, and harmonic motion.  Uses domain hint
``mechanics`` (waves fall under the mechanics umbrella).

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.

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


# ── Domain ─────────────────────────────────────────────────────────────

DOMAIN = "mechanics"


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
}

ALLOWED_KINDS = {"algebraic"}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

WAVE_FUNDAMENTALS: list[CatalogEntry] = [
    ("wave_velocity",
     r"v = f \lambda",
     PASS,
     "f,lambda -> multiply; multiply,v -> rel:equals",
     "f,lambda -> __multiply_2; __multiply_2,v -> __equals_1",
     None),

    ("frequency_period",
     r"f = \frac{1}{T}",
     PASS,
     "T -> power; f,power -> rel:equals",
     "T -> __power_2; __power_2,f -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("angular_frequency",
     r"\omega = 2 \pi f",
     PASS,
     "const:pi,f -> multiply; multiply,num -> multiply; "
     "multiply,omega -> rel:equals",
     "f,pi -> __multiply_4; __multiply_4,__num_3 -> __multiply_2; "
     "__multiply_2,omega -> __equals_1",
     None),

    ("wave_number",
     r"k = \frac{2 \pi}{\lambda}",
     PASS,
     "const:pi,num -> multiply; lambda -> power; "
     "multiply,power -> multiply; k,multiply -> rel:equals",
     "__num_4,pi -> __multiply_3; lambda -> __power_5; "
     "__multiply_3,__power_5 -> __multiply_2; __multiply_2,k -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("wave_energy",
     r"E = \frac{1}{2} k A^2",
     PASS,
     "A -> power; num -> power; k,power -> multiply; "
     "multiply,power -> multiply; E,multiply -> rel:equals",
     "__num_4 -> __power_3; A -> __power_6; __power_6,k -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; E,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}, {"op": "power", "exponent": "-1"}]),

    ("intensity",
     r"I = \frac{P}{A}",
     PASS,
     "A -> power; P,power -> multiply; I,multiply -> rel:equals",
     "A -> __power_3; P,__power_3 -> __multiply_2; "
     "I,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
]

OPTICS_EXPRESSIONS: list[CatalogEntry] = [
    ("snell",
     r"n_1 \sin\theta_1 = n_2 \sin\theta_2",
     PASS,
     "theta_{1} -> fn:sin; theta_{2} -> fn:sin; "
     "fn:sin,n_{1} -> multiply; fn:sin,n_{2} -> multiply; "
     "multiply,multiply -> rel:equals",
     "theta_{1} -> __sin_3; theta_{2} -> __sin_5; "
     "__sin_3,n_{1} -> __multiply_2; __sin_5,n_{2} -> __multiply_4; "
     "__multiply_2,__multiply_4 -> __equals_1",
     None),

    ("thin_lens",
     r"\frac{1}{f} = \frac{1}{d_o} + \frac{1}{d_i}",
     PASS,
     "d_{i} -> power; d_{o} -> power; f -> power; "
     "power,power -> add; add,power -> rel:equals",
     "f -> __power_2; d_{o} -> __power_4; d_{i} -> __power_5; "
     "__power_4,__power_5 -> __add_3; __add_3,__power_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("brewster",
     r"\tan\theta_B = \frac{n_2}{n_1}",
     PASS,
     "theta_{B} -> fn:tan; n_{1} -> power; "
     "n_{2},power -> multiply; fn:tan,multiply -> rel:equals",
     "n_{1} -> __power_4; theta_{B} -> __tan_2; "
     "__power_4,n_{2} -> __multiply_3; __multiply_3,__tan_2 -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("malus",
     r"I = I_0 \cos^2\theta",
     PASS,
     "theta -> fn:cos; fn:cos -> power; "
     "I_{0},power -> multiply; I,multiply -> rel:equals",
     "theta -> __cos_4; __cos_4 -> __power_3; "
     "I_{0},__power_3 -> __multiply_2; I,__multiply_2 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

DIFFRACTION_EXPRESSIONS: list[CatalogEntry] = [
    ("diffraction_grating",
     r"{d} \sin\theta = m \lambda",
     PASS,
     "theta -> fn:sin; lambda,m -> multiply; d,fn:sin -> multiply; "
     "multiply,multiply -> rel:equals",
     "lambda,m -> __multiply_4; theta -> __sin_3; "
     "__sin_3,d -> __multiply_2; __multiply_2,__multiply_4 -> __equals_1",
     None),

    ("path_difference",
     r"\Delta = {d} \sin\theta",
     PASS,
     "theta -> fn:sin; d,fn:sin -> multiply; Delta,multiply -> rel:equals",
     "theta -> __sin_3; __sin_3,d -> __multiply_2; "
     "Delta,__multiply_2 -> __equals_1",
     None),

    ("standing_wave",
     r"\lambda_n = \frac{2 L}{n}",
     PASS,
     "L,num -> multiply; n -> power; multiply,power -> multiply; "
     "lambda_{n},multiply -> rel:equals",
     "L,__num_4 -> __multiply_3; n -> __power_5; "
     "__multiply_3,__power_5 -> __multiply_2; "
     "__multiply_2,lambda_{n} -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),
]

DYNAMIC_EXPRESSIONS: list[CatalogEntry] = [
    ("doppler",
     r"f' = f \frac{v + v_o}{v - v_s}",
     PASS,
     "v,v_{o} -> add; v_{s} -> negation; negation,v -> add; "
     "add -> power; add,power -> multiply; "
     "f,multiply -> multiply; f',multiply -> rel:equals",
     "v,v_{o} -> __add_4; v_{s} -> __negation_7; "
     "__negation_7,v -> __add_6; __add_6 -> __power_5; "
     "__add_4,__power_5 -> __multiply_3; __multiply_3,f -> __multiply_2; "
     "__multiply_2,f' -> __equals_1",
     [{"op": "power", "exponent": "-1"}]),

    ("simple_harmonic",
     r"x = A \cos(\omega t + \phi)",
     PASS,
     "omega,t -> multiply; multiply,phi -> add; add -> fn:cos; "
     "A,fn:cos -> multiply; multiply,x -> rel:equals",
     "omega,t -> __multiply_5; __multiply_5,phi -> __add_4; "
     "__add_4 -> __cos_3; A,__cos_3 -> __multiply_2; "
     "__multiply_2,x -> __equals_1",
     None),
]


ALL_EXPRESSIONS = (
    WAVE_FUNDAMENTALS
    + OPTICS_EXPRESSIONS
    + DIFFRACTION_EXPRESSIONS
    + DYNAMIC_EXPRESSIONS
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
class TestWavesDomain:
    """Optics & waves domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_universal_invariants(graph, latex=latex, domain=DOMAIN)

    def test_classification_is_algebraic(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_classification_kind_is(graph, "algebraic", latex=latex)

    def test_operators_within_allowed_set(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_operators_in(graph, ALLOWED_OPS, latex=latex)

    def test_connectivity_by_type(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_signature(graph, sig_type, labeler=label_by_type, latex=latex)

    def test_connectivity_by_id(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_signature(graph, sig_id, labeler=label_by_id, latex=latex)

    def test_node_properties(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_node_properties(graph, node_checks, latex=latex)
