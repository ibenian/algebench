"""Golden file regression tests.

Compares current parser output against saved snapshots to detect
unintentional changes in graph structure.
"""

from __future__ import annotations

import json

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph

_ARITHMETIC_CASES = {
    "addition": "2 + 3",
    "subtraction": "7 - 4",
    "multiplication": r"3 \cdot 5",
    "fraction": r"\frac{1}{2}",
    "mixed_operations": r"2 + 3 \cdot x",
}


@pytest.mark.parametrize(
    "name,latex",
    list(_ARITHMETIC_CASES.items()),
    ids=list(_ARITHMETIC_CASES.keys()),
)
def test_golden_arithmetic(name, latex, load_golden):
    expected = load_golden("arithmetic", name)
    graph = latex_to_semantic_graph(latex)
    actual = json.loads(
        json.dumps(graph.model_dump(by_alias=True), sort_keys=True)
    )
    expected_normalized = json.loads(json.dumps(expected, sort_keys=True))
    assert actual == expected_normalized, (
        f"Golden mismatch for {name!r}.\n"
        f"To update: run the golden file generator script."
    )
