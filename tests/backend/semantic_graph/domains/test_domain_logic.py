"""Domain suite: Logic and set theory.

Covers implications, biconditionals (iff), quantifiers, set membership,
De Morgan's law, and set operations.  The parser recognises set/logic
operators (``\\cup``, ``\\cap``, ``\\land``, ``\\lor``, ``\\setminus``,
``\\wedge``, ``\\vee``) as first-class infix operators with correct
precedence.

Expressions without an equals sign may classify as ``statements``
(multi-clause) or ``algebraic`` depending on parser decomposition.

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
    "implies", "iff", "element_of", "not_element_of",
    "greater_than", "greater_equal", "less_than", "less_equal",
    "function", "Abs", "abs",
    "neg",
    "intersection", "union", "conjunction", "disjunction",
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

LOGIC_EXPRESSIONS: list[CatalogEntry] = [
    ("logic_implication",
     r"P \implies Q",
     PASS,
         "P,Q -> implies",
         "P,Q -> __implies_1",
     [{"op": "implies", "type": "operator"}]),

    ("logic_iff",
     r"P \iff Q",
     PASS,
         "P,Q -> iff",
         "P,Q -> __iff_1",
     [{"op": "iff", "type": "operator"}]),

    ("logic_element_of",
     r"x \in \mathbb{R}",
     PASS,
     "R,x -> rel:element_of",
     "R,x -> __element_of_1",
     [{"op": "element_of", "type": "relation"}]),

    ("logic_not_element",
     r"x \notin \mathbb{Z}",
     PASS,
     "Z,x -> rel:not_element_of",
     "Z,x -> __not_element_of_1",
     [{"op": "not_element_of", "type": "relation"}]),

    ("logic_subset",
     r"A \subseteq B",
     PASS,
     "B,subseteq -> multiply; A,multiply -> multiply",
     "B,subseteq -> __multiply_2; A,__multiply_2 -> __multiply_1",
     None),

    ("logic_union",
     r"A \cup B = B \cup A",
    PASS,
         "A,B -> union; A,B -> union; union,union -> rel:equals",
         "A,B -> __union_2; A,B -> __union_3; "
         "__union_2,__union_3 -> __equals_1",
     None),

    ("logic_intersection",
     r"A \cap B \subseteq A",
     PASS,
     "A,B -> intersection; A,subseteq -> multiply; "
     "intersection,multiply -> multiply",
     "A,B -> __intersection_2; A,subseteq -> __multiply_3; "
     "__intersection_2,__multiply_3 -> __multiply_1",
     None),

    ("logic_complement",
     r"(A \cup B)^c = A^c \cap B^c",
     PASS,
         "A,c -> power; B,c -> power; A,B -> union; "
         "power,power -> intersection; c,union -> power; "
         "intersection,power -> rel:equals",
         "A,c -> __power_5; B,c -> __power_6; A,B -> __union_3; "
         "__power_5,__power_6 -> __intersection_4; "
         "__union_3,c -> __power_2; "
         "__intersection_4,__power_2 -> __equals_1",
     None),

    ("logic_forall",
     r"\forall x \in \mathbb{R}, \quad x^2 \geq 0",
     PASS,
         "forall,x -> multiply; x -> power; "
         "R,multiply -> rel:element_of; num,power -> rel:greater_equal",
         "forall,x -> c0___multiply_1; x -> c1___power_1; "
         "R,c0___multiply_1 -> c0___element_of_2; "
         "c1___num_2,c1___power_1 -> c1___greater_equal_3",
     None),

    ("logic_exists",
     r"\exists x \in \mathbb{N}, \quad x > 100",
     PASS,
         "exists,x -> multiply; num,x -> rel:greater_than; "
         "N,multiply -> rel:element_of",
         "exists,x -> c0___multiply_1; "
         "c1___num_2,x -> c1___greater_than_1; "
         "N,c0___multiply_1 -> c0___element_of_2",
     None),

    ("logic_demorgan",
     r"\neg (P \land Q) \iff (\neg P) \lor (\neg Q)",
     PASS,
         "P,Q -> conjunction; P -> fn:neg; Q -> fn:neg; "
         "fn:neg,fn:neg -> disjunction; conjunction -> fn:neg; "
         "disjunction,fn:neg -> iff",
         "P,Q -> __conjunction_2; P -> __neg_4; Q -> __neg_5; "
         "__neg_4,__neg_5 -> __disjunction_3; "
         "__conjunction_2 -> __neg_1; "
         "__disjunction_3,__neg_1 -> __iff_6",
     None),

    ("logic_cardinality",
     r"|A \cup B| = |A| + |B| - |A \cap B|",
     PASS,
         "A -> fn:abs; B -> fn:abs; A,B -> intersection; A,B -> union; "
         "fn:abs,fn:abs -> add; intersection -> fn:abs; union -> fn:abs; "
         "fn:abs -> negation; add,negation -> add; "
         "add,fn:abs -> rel:equals",
         "A -> __abs_6; B -> __abs_7; "
         "A,B -> __intersection_10; A,B -> __union_3; "
         "__union_3 -> __abs_2; __intersection_10 -> __abs_9; "
         "__abs_6,__abs_7 -> __add_5; __abs_9 -> __negation_8; "
         "__add_5,__negation_8 -> __add_4; "
         "__abs_2,__add_4 -> __equals_1",
     None),
]


ALL_EXPRESSIONS = LOGIC_EXPRESSIONS


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
class TestLogicDomain:
    """Logic domain suite — universal + suite-specific invariants."""

    def test_universal_invariants(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        assert_universal_invariants(graph, latex=latex)

    def test_classification_kind(self, parse, latex, sig_type, sig_id, node_checks):
        graph = parse(latex)
        kind = graph.classification.kind
        assert kind in {"algebraic", "statements"}, (
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
