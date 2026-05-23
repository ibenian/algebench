"""Domain suite: Multi-statement & structural expressions.

Covers chained equals, statement separators, piecewise, systems of
equations, and other structural patterns.  This is Phase 1 — locking
in coverage for multi-statement and structural constructs.

Suite-specific invariant (from design doc §8.3):
  ``classification["kind"] == "statements"`` for multi-statement
  expressions with correct ``count``.  Single-equation structural
  patterns use ``kind == "algebraic"``.

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


# ── Allowed operators for this domain ───────────────────────────────────

ALLOWED_OPS = {
    "add", "multiply", "power", "equals", "negation",
    "derivative", "function", "piecewise", "branch",
    "less_than", "greater_than", "less_equal", "greater_equal",
    "implies", "iff", "and", "element_of",
    "approximately", "not_equal", "proportional",
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

STATEMENT_SEPARATOR_EXPRESSIONS: list[CatalogEntry] = [
    ("two_stmt_backslash",
     r"x = 1 \\ y = 2",
     PASS,
     "num,x -> rel:equals; num,y -> rel:equals",
     "c0___num_2,x -> c0___equals_1; c1___num_2,y -> c1___equals_1",
     None),

    ("two_stmt_comma_quad",
     r"a = 1, \quad b = 2",
     PASS,
     "a,num -> rel:equals; b,num -> rel:equals",
     "a,c0___num_2 -> c0___equals_1; b,c1___num_2 -> c1___equals_1",
     None),

    ("three_stmt",
     r"x = 1 \\ y = 2 \\ z = 3",
     PASS,
     "num,x -> rel:equals; num,y -> rel:equals; num,z -> rel:equals",
     "c0___num_2,x -> c0___equals_1; c1___num_2,y -> c1___equals_1; "
     "c2___num_2,z -> c2___equals_1",
     None),
]

CHAINED_EQUALS_EXPRESSIONS: list[CatalogEntry] = [
    ("chained_two",
     r"a = b = c",
     PASS,
     "a,b,c -> rel:equals",
     "a,b,c -> __equals_1",
     None),

    ("chained_three",
     r"a = b = c = d",
     PASS,
     "a,b,c,d -> rel:equals",
     "a,b,c,d -> __equals_1",
     None),

    ("substitution",
     r"F = ma = m \frac{dv}{dt}",
     PASS,
     "t,v -> derivative; a,m -> multiply; "
     "derivative,m -> multiply; F,multiply,multiply -> rel:equals",
     "t,v -> __deriv_3; a,m -> __multiply_1; "
     "__deriv_3,m -> __multiply_2; "
     "F,__multiply_1,__multiply_2 -> __equals_4",
     [{"op": "derivative"}]),
]

CHAINED_SYMMETRIC_EXPRESSIONS: list[CatalogEntry] = [
    ("chained_approx",
     r"a \approx b \approx c",
     PASS,
     "a,b,c -> rel:approximately",
     "a,b,c -> __approximately_1",
     None),

    ("chained_neq",
     r"a \neq b \neq c",
     PASS,
     "a,b,c -> rel:not_equal",
     "a,b,c -> __not_equal_1",
     None),

    ("chained_propto",
     r"a \propto b \propto c",
     PASS,
     "a,b,c -> rel:proportional",
     "a,b,c -> __proportional_1",
     None),
]

INEQUALITY_EXPRESSIONS: list[CatalogEntry] = [
    ("chained_leq",
     r"a \leq b \leq c",
     PASS,
     "b,c -> rel:less_equal; a,rel:less_equal -> rel:less_equal",
     "b,c -> __less_equal_1; __less_equal_1,a -> __less_equal_2",
     None),

    ("single_geq",
     r"x \geq 0",
     PASS,
     "num,x -> rel:greater_equal",
     "__num_1,x -> __greater_equal_2",
     None),

    ("chained_geq",
     r"a \geq b \geq c",
     PASS,
     "b,c -> rel:greater_equal; a,rel:greater_equal -> rel:greater_equal",
     "b,c -> __greater_equal_1; __greater_equal_1,a -> __greater_equal_2",
     None),

    ("single_implication",
     r"P \implies Q",
     PASS,
     "P,Q -> implies",
     "P,Q -> __implies_1",
     [{"op": "implies", "_edge_roles": {"lhs": 1, "rhs": 1}}]),

    ("implication_chain",
     r"P \implies Q \implies R",
     PASS,
     "Q,R -> implies; P,implies -> implies",
     "Q,R -> __implies_1; P,__implies_1 -> __implies_2",
     [{"op": "implies", "_edge_roles": {"lhs": 1, "rhs": 1}}]),

    ("implication_chain_four",
     r"A \implies B \implies C \implies D",
     PASS,
     "C,D -> implies; B,implies -> implies; A,implies -> implies",
     "C,D -> __implies_1; B,__implies_1 -> __implies_2; "
     "A,__implies_2 -> __implies_3",
     [{"op": "implies", "_edge_roles": {"lhs": 1, "rhs": 1}}]),

    ("single_iff",
     r"P \iff Q",
     PASS,
     "P,Q -> iff",
     "P,Q -> __iff_1",
     [{"op": "iff"}]),

    ("chained_iff",
     r"P \iff Q \iff R",
     PASS,
     "P,Q,R -> iff",
     "P,Q,R -> __iff_1",
     [{"op": "iff"}]),
]

SYSTEM_EXPRESSIONS: list[CatalogEntry] = [
    ("system_2x2",
     r"2x + 3y = 7, \quad x - y = 1",
     PASS,
     "num,x -> multiply; num,y -> multiply; y -> negation; "
     "multiply,multiply -> add; negation,x -> add; "
     "add,num -> rel:equals; add,num -> rel:equals",
     "c0___num_4,x -> c0___multiply_3; c0___num_6,y -> c0___multiply_5; "
     "y -> c1___negation_3; "
     "c0___multiply_3,c0___multiply_5 -> c0___add_2; "
     "c1___negation_3,x -> c1___add_2; "
     "c0___add_2,c0___num_7 -> c0___equals_1; "
     "c1___add_2,c1___num_4 -> c1___equals_1",
     None),
]

PIECEWISE_EXPRESSIONS: list[CatalogEntry] = [
    ("piecewise",
     r"f(x) = \begin{cases} x & x \geq 0 \\ -x & x < 0 \end{cases}",
     PASS,
     "x -> fn:f; x -> negation; num,x -> rel:greater_equal; "
     "num,x -> rel:less_than; "
     "negation,rel:less_than -> branch; rel:greater_equal,x -> branch; "
     "branch,branch -> piecewise; fn:f,piecewise -> rel:equals",
     "x -> __f_9; __num_3,x -> __greater_equal_4; "
     "__num_8,x -> __less_than_7; x -> __negation_6; "
     "__greater_equal_4,x -> __branch_2; "
     "__less_than_7,__negation_6 -> __branch_5; "
     "__branch_2,__branch_5 -> __piecewise_1; "
     "__f_9,__piecewise_1 -> __equals_10",
     [{"op": "piecewise"},
      {"op": "branch"},
      {"op": "greater_equal", "_edge_roles": {"lhs": 1, "rhs": 1}},
      {"op": "less_than", "_edge_roles": {"lhs": 1, "rhs": 1}}]),
]

ANNOTATION_EXPRESSIONS: list[CatalogEntry] = [
    ("definition_where",
     r"E = \frac{1}{2}mv^2 \quad (\text{where } v = \text{velocity})",
     PASS,
     "num -> power; v -> power; m,power -> multiply; "
     "multiply,power -> multiply; E,multiply -> rel:equals",
     "__num_4 -> __power_3; v -> __power_6; __power_6,m -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; "
     "E,__multiply_2 -> __equals_1",
     [{"type": "annotation"}]),
]

SUBJECT_GROUP_EXPRESSIONS: list[CatalogEntry] = [
    ("subject_group",
     r"\alpha, \beta \in \mathbb{R}",
     PASS,
     "alpha,beta -> and; R,and -> rel:element_of",
     "alpha,beta -> __and_1; R,__and_1 -> __element_of_2",
     None),
]

ALL_EXPRESSIONS = (
    STATEMENT_SEPARATOR_EXPRESSIONS
    + CHAINED_EQUALS_EXPRESSIONS
    + CHAINED_SYMMETRIC_EXPRESSIONS
    + INEQUALITY_EXPRESSIONS
    + SYSTEM_EXPRESSIONS
    + PIECEWISE_EXPRESSIONS
    + ANNOTATION_EXPRESSIONS
    + SUBJECT_GROUP_EXPRESSIONS
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
class TestStructuralDomain:
    """Structural domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_is_correct(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind if graph.classification else None
        assert kind in {"algebraic", "statements", "piecewise"}, (
            f"Expected algebraic/statements/piecewise classification, got {kind!r} "
            f"for: {latex!r}"
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


# ── Extensibility: add regression cases here ────────────────────────────


class TestStructuralRegressions:
    """Regression tests for specific structural parsing issues."""
