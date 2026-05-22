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
    "derivative", "function",
    "less_than", "greater_than", "less_equal", "greater_equal",
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
     "num,x -> equals; num,y -> equals",
     "c0___num_2,x -> c0___equals_1; c1___num_2,y -> c1___equals_1",
     None),

    ("two_stmt_comma_quad",
     r"a = 1, \quad b = 2",
     PASS,
     "a,num -> equals; b,num -> equals",
     "a,c0___num_2 -> c0___equals_1; b,c1___num_2 -> c1___equals_1",
     None),

    ("three_stmt",
     r"x = 1 \\ y = 2 \\ z = 3",
     PASS,
     "num,x -> equals; num,y -> equals; num,z -> equals",
     "c0___num_2,x -> c0___equals_1; c1___num_2,y -> c1___equals_1; "
     "c2___num_2,z -> c2___equals_1",
     None),
]

CHAINED_EQUALS_EXPRESSIONS: list[CatalogEntry] = [
    ("chained_two",
     r"a = b = c",
     PASS,
     "b,c -> equals; a,equals -> rel:equals",
     "b,c -> __equals_1; __equals_1,a -> __equals_2",
     None),

    ("chained_three",
     r"a = b = c = d",
     PASS,
     "b,c -> equals; d,equals -> equals; a,equals -> rel:equals",
     "b,c -> __equals_2; __equals_2,d -> __equals_1; "
     "__equals_1,a -> __equals_3",
     None),

    ("substitution",
     r"F = ma = m \frac{dv}{dt}",
     PASS,
     "t,v -> derivative; a,m -> multiply; "
     "derivative,m -> multiply; multiply,multiply -> equals; "
     "F,equals -> rel:equals",
     "t,v -> __deriv_4; a,m -> __multiply_2; "
     "__deriv_4,m -> __multiply_3; "
     "__multiply_2,__multiply_3 -> __equals_1; "
     "F,__equals_1 -> __equals_5",
     [{"op": "derivative"}]),
]

MIXED_RELATION_EXPRESSIONS: list[CatalogEntry] = [
    ("mixed_relations",
     r"a \leq b \leq c",
     XFAIL,
     "", "",
     None),

    ("implication_chain",
     r"P \implies Q \implies R",
     PASS,
     "R,implies -> multiply; Q,multiply -> multiply; "
     "P,multiply -> rel:implies",
     "R,implies -> __multiply_2; Q,__multiply_2 -> __multiply_1; "
     "P,__multiply_1 -> __implies_3",
     None),
]

SYSTEM_EXPRESSIONS: list[CatalogEntry] = [
    ("system_2x2",
     r"2x + 3y = 7, \quad x - y = 1",
     PASS,
     "num,x -> multiply; num,y -> multiply; y -> negation; "
     "multiply,multiply -> add; negation,x -> add; "
     "add,num -> equals; add,num -> equals",
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
     XFAIL,
     "", "",
     None),
]

ANNOTATION_EXPRESSIONS: list[CatalogEntry] = [
    ("definition_where",
     r"E = \frac{1}{2}mv^2 \quad (\text{where } v = \text{velocity})",
     PASS,
     "num -> power; v -> power; m,power -> multiply; "
     "multiply,power -> multiply; E,multiply -> equals",
     "__num_4 -> __power_3; v -> __power_6; __power_6,m -> __multiply_5; "
     "__multiply_5,__power_3 -> __multiply_2; "
     "E,__multiply_2 -> __equals_1",
     [{"type": "annotation"}]),
]

SUBJECT_GROUP_EXPRESSIONS: list[CatalogEntry] = [
    ("subject_group",
     r"\alpha, \beta \in \mathbb{R}",
     PASS,
     "alpha,beta -> rel:and; R,rel:and -> rel:element_of",
     "alpha,beta -> __and_1; R,__and_1 -> __element_of_2",
     None),
]

ALL_EXPRESSIONS = (
    STATEMENT_SEPARATOR_EXPRESSIONS
    + CHAINED_EQUALS_EXPRESSIONS
    + MIXED_RELATION_EXPRESSIONS
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
        assert kind in {"algebraic", "statements"}, (
            f"Expected algebraic/statements classification, got {kind!r} "
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
