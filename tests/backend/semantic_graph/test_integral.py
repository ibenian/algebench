r"""Integral parsing in the semantic graph.

The calculus domain suite already exercises integrals inside full equations
(``integral_power``, ``integral_definite``, the fundamental theorem). This file
pins the **bare** integral forms and the exact node shape the grounder relies on:
an ``integral`` operator node carrying the integrand (the unroled operand), the
integration variable (``with_respect_to`` + a ``wrt`` edge), and — for a definite
integral — ``lb`` / ``ub`` bound edges with ``lower_bound`` / ``upper_bound``
attributes. ``graph_to_sympy`` reconstructs exactly this into ``sp.Integral``.
"""

from __future__ import annotations

import pytest

from tests.backend.semantic_graph.generators.invariants import (
    assert_universal_invariants,
)


def _integral_node(graph):
    return next(n for n in graph.nodes if n.op == "integral")


def _roles_into(graph, node_id):
    return {e.role for e in graph.edges if e.to == node_id}


@pytest.mark.parametrize("latex", [
    r"\int x^2 dx",
    r"\int x^2 \, dx",
    r"\int_0^1 x^2 dx",
    r"\int_a^b f dx",
])
def test_integral_parses_and_is_wellformed(parse, latex):
    g = parse(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    assert_universal_invariants(g, latex=latex)
    assert "integral" in {n.op for n in g.nodes}, f"no integral node for: {latex!r}"


def test_indefinite_integral_structure(parse):
    g = parse(r"\int x^2 dx")
    node = _integral_node(g)
    assert node.with_respect_to == "x"
    roles = _roles_into(g, node.id)
    assert "wrt" in roles
    assert "lb" not in roles and "ub" not in roles   # indefinite → no bounds


def test_definite_integral_carries_bounds(parse):
    g = parse(r"\int_0^1 x^2 dx")
    node = _integral_node(g)
    assert node.with_respect_to == "x"
    assert node.lower_bound and node.upper_bound
    roles = _roles_into(g, node.id)
    assert {"wrt", "lb", "ub"} <= roles


def test_integral_has_an_integrand(parse):
    # the integrand is the single operand edge with no role (here: x^2 → power)
    g = parse(r"\int_0^1 x^2 dx")
    node = _integral_node(g)
    operands = [e.from_ for e in g.edges
                if e.to == node.id and e.role not in ("wrt", "lb", "ub")]
    assert len(operands) == 1
    integrand = next(n for n in g.nodes if n.id == operands[0])
    assert integrand.op == "power"   # x^2
