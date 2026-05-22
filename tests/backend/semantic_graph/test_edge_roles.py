"""Edge-role tests for the semantic graph.

Verifies that special-purpose edge roles (``exp``, ``wrt``, ``lhs``/``rhs``)
are emitted correctly by the parser.  These are structural invariants —
each role has a clear contract about which node types it targets and
how many such edges a node should receive.
"""

from __future__ import annotations

import pytest


# ── Power expressions (exp role on exponent edge) ────────────────────

POWER_ROLE_CASES = [
    pytest.param(
        r"x^n",
        id="simple_symbolic_power",
    ),
    pytest.param(
        r"x^n = n x^{n-1}",
        id="power_with_symbolic_exp",
    ),
    pytest.param(
        r"e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}",
        id="taylor_exp",
    ),
]


class TestPowerExpRole:
    """Power nodes with symbolic exponents must emit ``role="exp"``
    on the exponent edge (second arg), not on the base edge."""

    @pytest.mark.parametrize("latex", POWER_ROLE_CASES)
    def test_exp_edges_exist(self, parse, latex):
        """At least one power node with a symbolic exponent must
        produce an ``exp`` role edge."""
        graph = parse(latex)
        power_ids = {n.id for n in graph.nodes if n.op == "power" and n.exponent is None}
        if not power_ids:
            pytest.skip("no symbolic-exponent power nodes in this expression")
        exp_edges = [e for e in graph.edges if e.role == "exp"]
        assert len(exp_edges) >= 1, (
            f"Expected at least one exp-role edge, got none for: {latex!r}"
        )

    @pytest.mark.parametrize("latex", POWER_ROLE_CASES)
    def test_exp_edges_target_power_nodes(self, parse, latex):
        """Every ``exp`` edge must point into a power node."""
        graph = parse(latex)
        power_ids = {n.id for n in graph.nodes if n.op == "power"}
        exp_edges = [e for e in graph.edges if e.role == "exp"]
        for e in exp_edges:
            assert e.to in power_ids, (
                f"exp edge {e.from_} → {e.to} targets a non-power node "
                f"for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", POWER_ROLE_CASES)
    def test_base_edges_have_no_role(self, parse, latex):
        """The base edge into a power node (first arg) must have no role,
        only the exponent edge gets ``exp``."""
        graph = parse(latex)
        power_ids = {n.id for n in graph.nodes if n.op == "power" and n.exponent is None}
        if not power_ids:
            pytest.skip("no symbolic-exponent power nodes in this expression")
        for pid in power_ids:
            edges_in = [e for e in graph.edges if e.to == pid]
            roles = [e.role for e in edges_in]
            exp_count = roles.count("exp")
            none_count = roles.count(None)
            assert exp_count == 1, (
                f"Expected exactly 1 exp edge into power {pid}, "
                f"got {exp_count} for: {latex!r}"
            )
            assert none_count >= 1, (
                f"Expected at least 1 role-less (base) edge into power {pid}, "
                f"got {none_count} for: {latex!r}"
            )
