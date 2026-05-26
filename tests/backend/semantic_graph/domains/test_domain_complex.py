"""Domain suite: Complex analysis.

Covers Euler's formula, modulus, polar form, conjugate, Cauchy integral,
residue theorem, De Moivre's theorem, Cauchy-Riemann equations, and
Laurent series.

Suite-specific invariant (from design doc §8.3):
  All operator nodes have ``op`` in ALLOWED_OPS.
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
    assert_signature,
    assert_node_properties,
)


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "sin", "cos", "Abs", "abs", "function", "sum",
    "partial_derivative", "closed_integral", "Res",
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

COMPLEX_EXPRESSIONS: list[CatalogEntry] = [
    ("complex_euler",
     r"e^{i\theta} = \cos\theta + i \sin\theta",
     PASS,
         "theta -> fn:cos; theta -> fn:sin; i,theta -> multiply; "
         "fn:sin,i -> multiply; e,multiply -> power; "
         "fn:cos,multiply -> add; add,power -> rel:equals",
         "theta -> __cos_5; i,theta -> __multiply_3; theta -> __sin_7; "
         "__sin_7,i -> __multiply_6; __multiply_3,e -> __power_2; "
         "__cos_5,__multiply_6 -> __add_4; "
         "__add_4,__power_2 -> __equals_1",
     None),

    ("complex_euler_identity",
     r"e^{i\pi} + 1 = 0",
     PASS,
         "const:pi,i -> multiply; e,multiply -> power; "
         "num,power -> add; add,num -> rel:equals",
         "i,pi -> __multiply_4; __multiply_4,e -> __power_3; "
         "__num_5,__power_3 -> __add_2; __add_2,__num_6 -> __equals_1",
     None),

    ("complex_modulus",
     r"|z| = \sqrt{a^2 + b^2}",
     PASS,
         "z -> fn:abs; a -> power; b -> power; power,power -> add; "
         "add -> power; fn:abs,power -> rel:equals",
         "z -> __abs_2; a -> __power_5; b -> __power_6; "
         "__power_5,__power_6 -> __add_4; __add_4 -> __power_3; "
         "__abs_2,__power_3 -> __equals_1",
     [{"op": "abs", "type": "function"}]),

    ("complex_polar_form",
     r"z = r e^{i\theta}",
     PASS,
         "i,theta -> multiply; e,multiply -> power; "
         "power,r -> multiply; multiply,z -> rel:equals",
         "i,theta -> __multiply_4; __multiply_4,e -> __power_3; "
         "__power_3,r -> __multiply_2; __multiply_2,z -> __equals_1",
     None),

    ("complex_conjugate",
     r"z \overline{z} = |z|^2",
     PASS,
         r"z -> fn:abs; \overline{z},z -> multiply; "
         "fn:abs -> power; multiply,power -> rel:equals",
         r"z -> __abs_4; \overline{z},z -> __multiply_2; "
         "__abs_4 -> __power_3; __multiply_2,__power_3 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),

    ("complex_cauchy_integral",
     r"f(a) = \frac{1}{2\pi i} \oint \frac{f(z)}{z - a} dz",
     PASS,
         "a -> fn:f; z -> fn:f; const:pi,i -> multiply; a -> negation; "
         "negation,z -> add; multiply,num -> multiply; add -> power; "
         "multiply -> power; fn:f,power -> multiply; "
         "multiply,z -> closed_integral; "
         "closed_integral,power -> multiply; "
         "fn:f,multiply -> rel:equals",
         "z -> __f_10; a -> __f_2; i,pi -> __multiply_7; "
         "a -> __negation_13; __negation_13,z -> __add_12; "
         "__multiply_7,__num_6 -> __multiply_5; __add_12 -> __power_11; "
         "__multiply_5 -> __power_4; __f_10,__power_11 -> __multiply_9; "
         "__multiply_9,z -> __closed_integral_8; "
         "__closed_integral_8,__power_4 -> __multiply_3; "
         "__f_2,__multiply_3 -> __equals_1",
     None),

    ("complex_residue",
     r"\oint f(z) dz = 2\pi i \sum \text{Res}(f, z_k)",
     PASS,
         "f,z_{k} -> fn:Res; z -> fn:f; fn:f,z -> closed_integral; "
         "fn:Res -> sum; i,sum -> multiply; "
         "const:pi,multiply -> multiply; multiply,num -> multiply; "
         "closed_integral,multiply -> rel:equals",
         "f,z_{k} -> __Res_9; z -> __f_3; "
         "__f_3,z -> __closed_integral_2; "
         "__Res_9 -> __sum_8; __sum_8,i -> __multiply_7; "
         "__multiply_7,pi -> __multiply_6; "
         "__multiply_6,__num_5 -> __multiply_4; "
         "__closed_integral_2,__multiply_4 -> __equals_1",
     None),

    ("complex_demoivre",
     r"(\cos\theta + i\sin\theta)^n = \cos(n\theta) + i\sin(n\theta)",
     PASS,
         "theta -> fn:cos; theta -> fn:sin; n,theta -> multiply; "
         "n,theta -> multiply; multiply -> fn:cos; multiply -> fn:sin; "
         "fn:sin,i -> multiply; fn:cos,multiply -> add; "
         "fn:sin,i -> multiply; fn:cos,multiply -> add; add,n -> power; "
         "add,power -> rel:equals",
         "theta -> __cos_4; n,theta -> __multiply_12; "
         "n,theta -> __multiply_9; theta -> __sin_6; "
         "__multiply_9 -> __cos_8; __sin_6,i -> __multiply_5; "
         "__multiply_12 -> __sin_11; __cos_4,__multiply_5 -> __add_3; "
         "__sin_11,i -> __multiply_10; "
         "__cos_8,__multiply_10 -> __add_7; __add_3,n -> __power_2; "
         "__add_7,__power_2 -> __equals_1",
     None),

    ("complex_analytic",
     r"\frac{\partial u}{\partial x} = \frac{\partial v}{\partial y}",
     PASS,
         "u,x -> partial_derivative; v,y -> partial_derivative; "
         "partial_derivative,partial_derivative -> rel:equals",
         "u,x -> __deriv_2; v,y -> __deriv_3; "
         "__deriv_2,__deriv_3 -> __equals_1",
     None),

    ("complex_laurent",
     r"f(z) = \sum_{n=-\infty}^{\infty} a_n (z - z_0)^n",
     PASS,
         "z -> fn:f; z_{0} -> negation; n,num -> rel:equals; "
         "negation,z -> add; add -> fn:a_{n}; fn:a_{n},n -> power; "
         "const:__const_5,n,power,rel:equals -> sum; "
         "fn:f,sum -> rel:equals",
         "__num_4,n -> __equals_6; z -> __f_2; z_{0} -> __negation_10; "
         "__negation_10,z -> __add_9; __add_9 -> __a_{n}_8; "
         "__a_{n}_8,n -> __power_7; "
         "__const_5,__equals_6,__power_7,n -> __sum_3; "
         "__f_2,__sum_3 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = COMPLEX_EXPRESSIONS


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
class TestComplexDomain:
    """Complex analysis domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_kind(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind
        assert kind in {"algebraic", "PDE"}, (
            f"Unexpected classification kind {kind!r} for: {latex!r}"
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
