r"""Integral parsing in the semantic graph.

The calculus domain suite already exercises integrals inside full equations
(``integral_power``, ``integral_definite``, the fundamental theorem). This file
pins the **bare** integral forms and the exact node shape the grounder relies on:
an ``integral`` operator node carrying the integrand (the unroled operand), a
first-class ``differential`` node per integration variable (``dv`` for ∫…dv)
connected by a ``wrt`` edge, and — for a definite integral — ``lb`` / ``ub``
bound edges with ``lower_bound`` / ``upper_bound`` attributes. The integral keeps
``with_respect_to`` as summary metadata for the semantic views, but the
authoritative integration variable lives on the differential node.
``graph_to_sympy`` reconstructs exactly this into ``sp.Integral``.
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


def _differential_into(graph, node_id):
    """The differential node feeding ``node_id`` via a ``wrt`` edge, if any."""
    diff_ids = {e.from_ for e in graph.edges if e.to == node_id and e.role == "wrt"}
    return [n for n in graph.nodes if n.id in diff_ids]


def test_indefinite_integral_structure(parse):
    g = parse(r"\int x^2 dx")
    node = _integral_node(g)
    assert node.with_respect_to == "x"          # summary metadata kept on integral
    roles = _roles_into(g, node.id)
    # the integration variable rides a ``wrt`` edge — but from a first-class
    # ``differential`` node (``dx``), not the bare variable
    assert "wrt" in roles
    assert "lb" not in roles and "ub" not in roles   # indefinite → no bounds
    diffs = _differential_into(g, node.id)
    assert len(diffs) == 1
    assert diffs[0].type == "differential"
    assert diffs[0].with_respect_to == "x"
    assert diffs[0].latex == "dx"


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
