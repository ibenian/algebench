"""Domain suite: Partial derivatives & PDEs.

Covers partial differentiation, classical PDEs (heat, wave, Laplace,
transport), physics PDEs (Schrödinger, continuity, Burgers), and
multivariable calculus identities (chain rule, total differential).

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
    assert_signature,
    assert_node_properties,
)


# ── Domain ─────────────────────────────────────────────────────────────

DOMAIN = "partial_derivatives"


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "partial_derivative", "function",
}


# ── Expression catalog ──────────────────────────────────────────────────
#
# Each entry: (test_id, latex, tag, sig_by_type, sig_by_id, node_checks)

CatalogEntry = tuple[str, str, object, str, str, list[dict] | None]

BASIC_PARTIAL_EXPRESSIONS: list[CatalogEntry] = [
    ("gradient_component",
     r"\frac{\partial f}{\partial x}",
     PASS,
     "f,x -> partial_derivative",
     "f,x -> __deriv_1",
     [{"op": "partial_derivative", "with_respect_to": "x"}]),

    ("heat_equation",
     r"\frac{\partial u}{\partial t} = k \frac{\partial^2 u}{\partial x^2}",
     PASS,
     "t,u -> partial_derivative; u,x -> partial_derivative; "
     "k,partial_derivative -> multiply; multiply,partial_derivative -> rel:equals",
     "t,u -> __deriv_2; u,x -> __deriv_4; "
     "__deriv_4,k -> __multiply_3; __deriv_2,__multiply_3 -> __equals_1",
     [{"op": "partial_derivative", "with_respect_to": "t"},
      {"op": "partial_derivative", "with_respect_to": "x"}]),

    ("wave_equation",
     r"\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}",
     PASS,
     "t,u -> partial_derivative; u,x -> partial_derivative; c -> power; "
     "partial_derivative,power -> multiply; multiply,partial_derivative -> rel:equals",
     "t,u -> __deriv_2; u,x -> __deriv_5; c -> __power_4; "
     "__deriv_5,__power_4 -> __multiply_3; "
     "__deriv_2,__multiply_3 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

CLASSICAL_PDE_EXPRESSIONS: list[CatalogEntry] = [
    ("laplace_2d",
     r"\frac{\partial^2 u}{\partial x^2} + \frac{\partial^2 u}{\partial y^2} = 0",
     PASS,
     "u,x -> partial_derivative; u,y -> partial_derivative; "
     "partial_derivative,partial_derivative -> add; add,num -> rel:equals",
     "u,x -> __deriv_3; u,y -> __deriv_4; "
     "__deriv_3,__deriv_4 -> __add_2; __add_2,__num_5 -> __equals_1",
     None),

    ("transport",
     r"\frac{\partial u}{\partial t} + c \frac{\partial u}{\partial x} = 0",
     PASS,
     "t,u -> partial_derivative; u,x -> partial_derivative; "
     "c,partial_derivative -> multiply; multiply,partial_derivative -> add; "
     "add,num -> rel:equals",
     "t,u -> __deriv_3; u,x -> __deriv_5; "
     "__deriv_5,c -> __multiply_4; __deriv_3,__multiply_4 -> __add_2; "
     "__add_2,__num_6 -> __equals_1",
     None),

    ("diffusion",
     r"\frac{\partial C}{\partial t} = D \frac{\partial^2 C}{\partial x^2}",
     PASS,
     "C,t -> partial_derivative; C,x -> partial_derivative; "
     "D,partial_derivative -> multiply; multiply,partial_derivative -> rel:equals",
     "C,t -> __deriv_2; C,x -> __deriv_4; "
     "D,__deriv_4 -> __multiply_3; __deriv_2,__multiply_3 -> __equals_1",
     None),

    ("poisson_2d",
     r"\frac{\partial^2 u}{\partial x^2} + \frac{\partial^2 u}{\partial y^2} = f(x,y)",
     PASS,
     "x,y -> fn:f; u,x -> partial_derivative; u,y -> partial_derivative; "
     "partial_derivative,partial_derivative -> add; add,fn:f -> rel:equals",
     "u,x -> __deriv_3; u,y -> __deriv_4; x,y -> __f_5; "
     "__deriv_3,__deriv_4 -> __add_2; __add_2,__f_5 -> __equals_1",
     None),

    ("harmonic_2d",
     r"\frac{\partial^2 \phi}{\partial x^2} + \frac{\partial^2 \phi}{\partial y^2} = 0",
     PASS,
     "phi,x -> partial_derivative; phi,y -> partial_derivative; "
     "partial_derivative,partial_derivative -> add; add,num -> rel:equals",
     "phi,x -> __deriv_3; phi,y -> __deriv_4; "
     "__deriv_3,__deriv_4 -> __add_2; __add_2,__num_5 -> __equals_1",
     None),
]

PHYSICS_PDE_EXPRESSIONS: list[CatalogEntry] = [
    ("schrodinger_time",
     r"i \hbar \frac{\partial \psi}{\partial t} = H \psi",
     PASS,
     "H,psi -> multiply; psi,t -> partial_derivative; "
     "hbar,partial_derivative -> multiply; i,multiply -> multiply; "
     "multiply,multiply -> rel:equals",
     "psi,t -> __deriv_4; H,psi -> __multiply_5; "
     "__deriv_4,hbar -> __multiply_3; __multiply_3,i -> __multiply_2; "
     "__multiply_2,__multiply_5 -> __equals_1",
     [{"op": "partial_derivative", "with_respect_to": "t"}]),

    ("continuity",
     r"\frac{\partial \rho}{\partial t} + \nabla \cdot (\rho \mathbf{v}) = 0",
     PASS,
     "rho,v -> multiply; rho,t -> partial_derivative; "
     "multiply,nabla -> multiply; multiply,partial_derivative -> add; "
     "add,num -> rel:equals",
     "rho,t -> __deriv_3; rho,v -> __multiply_5; "
     "__multiply_5,nabla -> __multiply_4; __deriv_3,__multiply_4 -> __add_2; "
     "__add_2,__num_6 -> __equals_1",
     [{"op": "partial_derivative", "with_respect_to": "t"}]),

    ("burgers",
     r"\frac{\partial u}{\partial t} + u \frac{\partial u}{\partial x} = \nu \frac{\partial^2 u}{\partial x^2}",
     PASS,
     "t,u -> partial_derivative; u,x -> partial_derivative; "
     "u,x -> partial_derivative; nu,partial_derivative -> multiply; "
     "partial_derivative,u -> multiply; multiply,partial_derivative -> add; "
     "add,multiply -> rel:equals",
     "t,u -> __deriv_3; u,x -> __deriv_5; u,x -> __deriv_7; "
     "__deriv_5,u -> __multiply_4; __deriv_7,nu -> __multiply_6; "
     "__deriv_3,__multiply_4 -> __add_2; __add_2,__multiply_6 -> __equals_1",
     None),

    ("klein_gordon",
     r"\frac{\partial^2 \phi}{\partial t^2} - c^2 \frac{\partial^2 \phi}{\partial x^2} + m^2 \phi = 0",
     PASS,
     "phi,t -> partial_derivative; phi,x -> partial_derivative; "
     "c -> power; m -> power; partial_derivative,power -> multiply; "
     "phi,power -> multiply; multiply -> negation; "
     "negation,partial_derivative -> add; add,multiply -> add; "
     "add,num -> rel:equals",
     "phi,t -> __deriv_4; phi,x -> __deriv_8; "
     "m -> __power_10; c -> __power_7; "
     "__deriv_8,__power_7 -> __multiply_6; __power_10,phi -> __multiply_9; "
     "__multiply_6 -> __negation_5; __deriv_4,__negation_5 -> __add_3; "
     "__add_3,__multiply_9 -> __add_2; __add_2,__num_11 -> __equals_1",
     [{"op": "power", "exponent": "2"}]),
]

MULTIVAR_CALCULUS_EXPRESSIONS: list[CatalogEntry] = [
    ("chain_rule_multi",
     r"\frac{\partial z}{\partial x} = \frac{\partial z}{\partial u} "
     r"\frac{\partial u}{\partial x} + \frac{\partial z}{\partial v} "
     r"\frac{\partial v}{\partial x}",
     PASS,
     "u,x -> partial_derivative; u,z -> partial_derivative; "
     "v,x -> partial_derivative; v,z -> partial_derivative; "
     "x,z -> partial_derivative; "
     "partial_derivative,partial_derivative -> multiply; "
     "partial_derivative,partial_derivative -> multiply; "
     "multiply,multiply -> add; add,partial_derivative -> rel:equals",
     "x,z -> __deriv_2; u,z -> __deriv_5; u,x -> __deriv_6; "
     "v,z -> __deriv_8; v,x -> __deriv_9; "
     "__deriv_5,__deriv_6 -> __multiply_4; "
     "__deriv_8,__deriv_9 -> __multiply_7; "
     "__multiply_4,__multiply_7 -> __add_3; "
     "__add_3,__deriv_2 -> __equals_1",
     None),

    ("total_differential",
     r"dz = \frac{\partial z}{\partial x} dx + \frac{\partial z}{\partial y} dy",
     PASS,
     "x,z -> partial_derivative; y,z -> partial_derivative; "
     "dx,partial_derivative -> multiply; dy,partial_derivative -> multiply; "
     "multiply,multiply -> add; add,dz -> rel:equals",
     "x,z -> __deriv_4; y,z -> __deriv_6; "
     "__deriv_4,dx -> __multiply_3; __deriv_6,dy -> __multiply_5; "
     "__multiply_3,__multiply_5 -> __add_2; __add_2,dz -> __equals_1",
     None),
]

ALL_EXPRESSIONS = (
    BASIC_PARTIAL_EXPRESSIONS
    + CLASSICAL_PDE_EXPRESSIONS
    + PHYSICS_PDE_EXPRESSIONS
    + MULTIVAR_CALCULUS_EXPRESSIONS
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
class TestPartialDerivativesDomain:
    """Partial derivatives domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        assert_universal_invariants(graph, latex=latex, domain=DOMAIN)

    def test_classification_is_pde_or_ode(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex, domain=DOMAIN)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"algebraic", "ODE", "PDE"}, (
            f"Expected algebraic/ODE/PDE classification, got {kind!r} for: {latex!r}"
        )

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


# ── Regressions & known limitations ───────────────────────────────────


class TestPartialDerivativesRegressions:
    """Regression tests for partial derivative parsing edge cases."""

    @pytest.mark.xfail(strict=True, reason="Mixed partial notation not supported")
    def test_mixed_partial_produces_partial_derivative_op(self, parse):
        r"""``\frac{\partial^2 f}{\partial x \partial y}`` should produce
        a partial_derivative node, but currently parses as multiply/power."""
        g = parse(r"\frac{\partial^2 f}{\partial x \partial y}",
                  domain=DOMAIN)
        pd_nodes = [n for n in g.nodes if n.op == "partial_derivative"]
        assert len(pd_nodes) >= 1

    @pytest.mark.xfail(strict=True, reason="Jacobian notation not supported")
    def test_jacobian_produces_partial_derivative_op(self, parse):
        r"""``\frac{\partial(u,v)}{\partial(x,y)}`` should produce
        partial_derivative nodes, but currently parses as function calls."""
        g = parse(r"\frac{\partial(u,v)}{\partial(x,y)}", domain=DOMAIN)
        pd_nodes = [n for n in g.nodes if n.op == "partial_derivative"]
        assert len(pd_nodes) >= 1
