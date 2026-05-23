"""Cycle-detection tests for the semantic graph.

Ensures that graphs produced by the parser are always acyclic DAGs,
even for expressions where a variable appears both inside a structure
and as a reference parameter of that structure (e.g. d/dx of x^n,
where x is both a child of power and the wrt variable of derivative).

The wrt edge uses ``role="wrt"`` and flows inward like every other
edge, so no special exemptions are needed.  Renderers visually reverse
the arrow based on the role.
"""

from __future__ import annotations

import pytest

from tests.backend.semantic_graph.generators.invariants import (
    assert_valid_graph,
)


# ── Derivative expressions (wrt variable inside the expression) ────────

DERIVATIVE_CYCLE_CASES = [
    pytest.param(
        r"\frac{d}{dx} x^n",
        id="d_dx_x_pow_n",
    ),
    pytest.param(
        r"\frac{d}{dx} x^n = n x^{n-1}",
        id="power_rule",
    ),
    pytest.param(
        r"\frac{dy}{dx} = ky",
        id="first_order_ode",
    ),
    pytest.param(
        r"\frac{dy}{dx} = \frac{x}{y}",
        id="separable_ode",
    ),
    pytest.param(
        r"\frac{d^2 y}{dx^2} + \omega^2 y = 0",
        id="second_order_ode",
    ),
    pytest.param(
        r"m \ddot{x} + c \dot{x} + k x = 0",
        id="damped_oscillator",
    ),
    pytest.param(
        r"\frac{dy}{dx} = \frac{dy}{du} \cdot \frac{du}{dx}",
        id="chain_rule",
    ),
    pytest.param(
        r"\frac{d}{dx} \int_a^x f(t) \, dt = f(x)",
        id="ftc",
    ),
    pytest.param(
        r"F = ma = m \frac{dv}{dt}",
        id="substitution_chain",
    ),
    pytest.param(
        r"\dot{x} = ax + by, \quad \dot{y} = cx + dy",
        id="ode_system",
    ),
]


class TestDerivativeCycleDetection:
    """Derivative wrt edges must not create cycles.

    The wrt edge (``x → derivative``) flows inward with
    ``role="wrt"``, keeping the graph acyclic even when the wrt
    variable also appears inside the differentiated expression.
    Renderers visually reverse the arrow based on the role.
    """

    @pytest.mark.parametrize("latex", DERIVATIVE_CYCLE_CASES)
    def test_no_cycle(self, parse, latex):
        graph = parse(latex)
        assert_valid_graph(graph, latex=latex)

    @pytest.mark.parametrize("latex", DERIVATIVE_CYCLE_CASES)
    def test_wrt_edges_have_role(self, parse, latex):
        """Every wrt edge must carry ``role="wrt"``.

        Visual arrow reversal is handled by the renderers based on
        the role — no ``semantic`` tag needed."""
        graph = parse(latex)
        wrt_edges = [e for e in graph.edges if e.role == "wrt"]
        for e in wrt_edges:
            assert e.semantic is None, (
                f"wrt edge {e.from_} → {e.to} should not have a "
                f"semantic tag, got {e.semantic!r} for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", DERIVATIVE_CYCLE_CASES)
    def test_wrt_edges_flow_inward(self, parse, latex):
        """wrt edges must point from the variable into the derivative
        node (not outward), matching the standard DAG convention."""
        graph = parse(latex)
        deriv_ids = {n.id for n in graph.nodes if n.op in ("derivative", "partial_derivative")}
        wrt_edges = [e for e in graph.edges if e.role == "wrt"]
        for e in wrt_edges:
            assert e.to in deriv_ids, (
                f"wrt edge should point into a derivative node, but "
                f"edge {e.from_} → {e.to} targets a non-derivative "
                f"node for: {latex!r}"
            )


# ── Limit expressions (tends_to with lhs/rhs roles) ───────────────────

LIMIT_CYCLE_CASES = [
    pytest.param(
        r"\lim_{x \to 0} \frac{\sin x}{x} = 1",
        id="limit_sinc",
    ),
    pytest.param(
        r"\lim_{x \to \infty} \frac{1}{x} = 0",
        id="limit_infinity",
    ),
    pytest.param(
        r"\lim_{x \to a} \frac{f(x)}{g(x)} = \lim_{x \to a} \frac{f'(x)}{g'(x)}",
        id="lhopital",
    ),
]


class TestLimitCycleDetection:
    """Limit tends_to edges must not create cycles."""

    @pytest.mark.parametrize("latex", LIMIT_CYCLE_CASES)
    def test_no_cycle(self, parse, latex):
        graph = parse(latex)
        assert_valid_graph(graph, latex=latex)


# ── Integral expressions (nested variable references) ──────────────────

INTEGRAL_CYCLE_CASES = [
    pytest.param(
        r"\int x^n \, dx = \frac{x^{n+1}}{n+1} + C",
        id="integral_power",
    ),
    pytest.param(
        r"\int_a^b f(x) \, dx = F(b) - F(a)",
        id="definite_integral",
    ),
]


class TestIntegralCycleDetection:
    """Integral graphs must remain acyclic."""

    @pytest.mark.parametrize("latex", INTEGRAL_CYCLE_CASES)
    def test_no_cycle(self, parse, latex):
        graph = parse(latex)
        assert_valid_graph(graph, latex=latex)
