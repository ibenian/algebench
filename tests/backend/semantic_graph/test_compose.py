r"""Function composition ``\circ`` in the semantic-graph parser.

``\circ`` has no native SymPy operator, so ``f \circ g`` used to parse as
``f · circ · g`` — a stray ``circ`` symbol multiplied in — collapsing the
composition into a value/leaf node instead of a binary operator (issue #443).

It is now rewritten (like ``\cap`` / ``\cup``) into an infix ``compose``
operator node with its two operands as inputs.
"""

from __future__ import annotations

import pytest

from backend.semantic_graph.service import SemanticGraphService
from tests.backend.semantic_graph.generators.invariants import (
    assert_universal_invariants,
    child_ids_of_op,
    find_node,
    has_operator,
)

_SVC = SemanticGraphService()


def _graph(latex: str):
    return _SVC.latex_to_graph(latex)


COMPOSE_CASES = [
    r"f \circ g",
    r"g \circ f",
    r"f \circ g \circ h",
    r"(f \circ g)(x) = f(g(x))",
    r"\text{sub-}c \circ \text{sub-}c = \text{sub-}c",
]


@pytest.mark.parametrize("latex", COMPOSE_CASES)
def test_compose_parses_and_is_wellformed(latex):
    g = _graph(latex)
    assert g is not None, f"failed to parse: {latex!r}"
    assert_universal_invariants(g, latex=latex)
    assert has_operator(g, "compose"), f"no compose operator node for: {latex!r}"


def test_compose_is_binary_operator_not_leaf():
    r"""``f \circ g`` → a compose operator fed by exactly f and g (issue #443)."""
    g = _graph(r"f \circ g")
    node = find_node(g, type="operator", op="compose")
    assert node is not None, "compose should be an operator node, not a leaf"
    # No stray ``circ`` symbol leaked in as a value node.
    assert not any(n.latex == r"\circ" for n in g.nodes), "stray \\circ leaf present"
    ids = child_ids_of_op(g, "compose")
    assert ids == {"f", "g"}, f"compose should have f and g as operands, got {ids}"


def test_compose_operator_glyph_and_kind():
    r"""The compose node carries the ∘ glyph and a ``function`` classification."""
    from backend.semantic_graph.constants import _OPERATOR_GLYPHS, _OPERATOR_KINDS

    assert _OPERATOR_GLYPHS["compose"] == "∘"
    assert _OPERATOR_KINDS["compose"] == "function"


def test_compose_root_subexpr_has_no_placeholder_leak():
    r"""A whole-expression ``f \circ g`` must not leak ``\Xi_{N}`` into subexpr."""
    g = _graph(r"f \circ g")
    node = find_node(g, type="operator", op="compose")
    assert node is not None
    assert node.subexpr and "Xi" not in node.subexpr, (
        f"compose subexpr leaked a placeholder: {node.subexpr!r}"
    )
    assert node.subexpr == r"f \circ g", node.subexpr
