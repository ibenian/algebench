"""Edge-role and node-type tests for the semantic graph.

Verifies that special-purpose edge roles (``exp``, ``wrt``, ``lhs``/``rhs``)
are emitted correctly by the parser, and that operators promoted from
the generic function branch (e.g. factorial) have the right node type.

These are structural invariants — each role has a clear contract about
which node types it targets and how many such edges a node should receive.
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


# ── Factorial (operator, not function) ─────────────────────────────

FACTORIAL_CASES = [
    pytest.param(
        r"n!",
        id="simple_factorial",
    ),
    pytest.param(
        r"\frac{x^n}{n!}",
        id="factorial_in_denominator",
    ),
    pytest.param(
        r"e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}",
        id="taylor_exp",
    ),
]


class TestFactorialOperator:
    """Factorial must be emitted as an operator node, not a function."""

    @pytest.mark.parametrize("latex", FACTORIAL_CASES)
    def test_factorial_is_operator(self, parse, latex):
        """Factorial nodes must have ``type="operator"``."""
        graph = parse(latex)
        fact_nodes = [n for n in graph.nodes if n.op == "factorial"]
        assert len(fact_nodes) >= 1, (
            f"Expected at least one factorial node for: {latex!r}"
        )
        for n in fact_nodes:
            assert n.type == "operator", (
                f"factorial node {n.id} has type={n.type!r}, "
                f"expected 'operator' for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", FACTORIAL_CASES)
    def test_factorial_is_unary(self, parse, latex):
        """Factorial is a unary operator — exactly one inbound edge."""
        graph = parse(latex)
        fact_nodes = [n for n in graph.nodes if n.op == "factorial"]
        for n in fact_nodes:
            inbound = [e for e in graph.edges if e.to == n.id]
            assert len(inbound) == 1, (
                f"factorial node {n.id} has {len(inbound)} inbound "
                f"edges, expected 1 for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", FACTORIAL_CASES)
    def test_factorial_edges_have_no_role(self, parse, latex):
        """The argument edge into factorial must have no role."""
        graph = parse(latex)
        fact_nodes = [n for n in graph.nodes if n.op == "factorial"]
        for n in fact_nodes:
            inbound = [e for e in graph.edges if e.to == n.id]
            for e in inbound:
                assert e.role is None, (
                    f"factorial edge {e.from_} → {e.to} has "
                    f"role={e.role!r}, expected None for: {latex!r}"
                )


# ── Sum/Product bounds (index spec and upper bound edges) ──────────

SUM_BOUND_CASES = [
    pytest.param(
        r"\sum_{n=0}^{\infty} a_n",
        id="simple_sum",
    ),
    pytest.param(
        r"e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!}",
        id="taylor_exp",
    ),
    pytest.param(
        r"\sum_{n=0}^{\infty} r^n = \frac{1}{1 - r}",
        id="geometric_series",
    ),
]


class TestSumBoundEdges:
    """Sum/product nodes must have edges from their bounds, not just
    node attributes.  The lower bound is an index-spec equals node
    (``n = 0``); the upper bound connects directly.

    The sum/product is an asymmetric operator — the lower-bound edge
    carries ``role="lb"`` and the upper-bound edge carries ``role="ub"``.
    """

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_sum_has_index_spec(self, parse, latex):
        """An equals node for the index specification (e.g. ``n = 0``)
        must feed into the sum node."""
        graph = parse(latex)
        sum_ids = {n.id for n in graph.nodes if n.op == "sum"}
        assert sum_ids, f"No sum node for: {latex!r}"
        for sid in sum_ids:
            inbound_ops = {
                next(n.op for n in graph.nodes if n.id == e.from_)
                for e in graph.edges if e.to == sid
            }
            assert "equals" in inbound_ops, (
                f"sum node {sid} has no inbound edge from an equals "
                f"(index-spec) node for: {latex!r}\n"
                f"  inbound ops: {inbound_ops}"
            )

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_index_spec_is_symmetric(self, parse, latex):
        """The index-spec equals node is symmetric — its inbound edges
        must have no role (no lhs/rhs)."""
        graph = parse(latex)
        sum_ids = {n.id for n in graph.nodes if n.op == "sum"}
        for sid in sum_ids:
            # Find the equals node feeding into this sum
            idx_ids = [
                e.from_ for e in graph.edges
                if e.to == sid
                and any(n.op == "equals" for n in graph.nodes if n.id == e.from_)
            ]
            assert idx_ids, f"No index-spec equals feeding sum {sid}"
            for idx_id in idx_ids:
                inbound = [e for e in graph.edges if e.to == idx_id]
                assert len(inbound) == 2, (
                    f"index-spec {idx_id} has {len(inbound)} inbound "
                    f"edges, expected 2 for: {latex!r}"
                )
                for e in inbound:
                    assert e.role is None, (
                        f"index-spec edge {e.from_} → {idx_id} has "
                        f"role={e.role!r}, expected None (symmetric) "
                        f"for: {latex!r}"
                    )

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_upper_bound_connected(self, parse, latex):
        """The upper bound (e.g. ∞) must have an edge into the sum."""
        graph = parse(latex)
        sum_nodes = [n for n in graph.nodes if n.op == "sum"]
        for sn in sum_nodes:
            upper = sn.upper_bound
            if upper is None:
                continue
            inbound_sources = {e.from_ for e in graph.edges if e.to == sn.id}
            assert upper in inbound_sources, (
                f"upper_bound {upper} of sum {sn.id} has no edge "
                f"into the sum node for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_lower_bound_edge_has_lb_role(self, parse, latex):
        """The edge from the index-spec equals node into the sum must
        carry ``role="lb"``."""
        graph = parse(latex)
        sum_ids = {n.id for n in graph.nodes if n.op == "sum"}
        for sid in sum_ids:
            lb_edges = [
                e for e in graph.edges
                if e.to == sid and e.role == "lb"
            ]
            assert len(lb_edges) == 1, (
                f"Expected exactly 1 lb-role edge into sum {sid}, "
                f"got {len(lb_edges)} for: {latex!r}"
            )
            # The lb edge must come from an equals (index-spec) node
            eq_ids = {n.id for n in graph.nodes if n.op == "equals"}
            assert lb_edges[0].from_ in eq_ids, (
                f"lb edge source {lb_edges[0].from_} is not an equals "
                f"node for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_upper_bound_edge_has_ub_role(self, parse, latex):
        """The edge from the upper bound into the sum must carry
        ``role="ub"``."""
        graph = parse(latex)
        sum_nodes = [n for n in graph.nodes if n.op == "sum"]
        for sn in sum_nodes:
            if sn.upper_bound is None:
                continue
            ub_edges = [
                e for e in graph.edges
                if e.to == sn.id and e.role == "ub"
            ]
            assert len(ub_edges) == 1, (
                f"Expected exactly 1 ub-role edge into sum {sn.id}, "
                f"got {len(ub_edges)} for: {latex!r}"
            )
            assert ub_edges[0].from_ == sn.upper_bound, (
                f"ub edge source {ub_edges[0].from_} doesn't match "
                f"upper_bound {sn.upper_bound} for: {latex!r}"
            )

    @pytest.mark.parametrize("latex", SUM_BOUND_CASES)
    def test_body_edge_has_no_role(self, parse, latex):
        """The summand (body) edge into the sum must have no role — only
        lb and ub edges are role-tagged."""
        graph = parse(latex)
        sum_ids = {n.id for n in graph.nodes if n.op == "sum"}
        for sid in sum_ids:
            inbound = [e for e in graph.edges if e.to == sid]
            roleless = [e for e in inbound if e.role is None]
            assert len(roleless) >= 1, (
                f"Expected at least 1 role-less (body) edge into sum "
                f"{sid}, got {len(roleless)} for: {latex!r}"
            )
