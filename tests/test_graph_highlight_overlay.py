"""Exercise the server-side highlight overlay.

``server._apply_highlights_to_graph`` annotates semantic-graph nodes with
the proof step's highlight color, label (as ``description``), and the
highlight's source ``name`` (the key used in ``proofStep.highlights``).
The overlay must leave the graph schema-valid, because downstream
``scripts/graph_to_mermaid.validate_graph`` rejects unknown node
properties.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.model.semantic_graph import SemanticGraph

from backend.server import (  # noqa: E402  (path manipulation above)
    _apply_highlights_to_graph,
    _autofill_semantic_graphs,
    _extract_htmlclass_pairs,
    _strip_html_class,
)

REPO_ROOT = Path(__file__).parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "semantic-graph.schema.json"


@pytest.fixture(scope="module")
def graph_validator() -> Draft202012Validator:
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    return Draft202012Validator(schema)


def _build_scene(math: str, highlights: dict) -> dict:
    return {
        "scenes": [
            {
                "proof": {
                    "steps": [{"math": math, "highlights": highlights}]
                }
            }
        ]
    }


def _graph_dict(scene: dict) -> dict:
    """Extract the serialized graph dict from the scene."""
    return scene["scenes"][0]["proof"]["steps"][0]["semanticGraph"]["graph"]


def test_highlight_overlay_annotates_matched_nodes(graph_validator):
    """Each highlighted symbol should carry color + description + highlight."""
    scene = _build_scene(
        math=r"E = \htmlClass{hl-m}{m} \htmlClass{hl-c}{c}^2",
        highlights={
            "m": {"color": "#e91e63", "label": "rest mass"},
            "c": {"color": "#3f51b5", "label": "speed of light"},
        },
    )
    _autofill_semantic_graphs(scene)
    graph = _graph_dict(scene)

    by_id = {n["id"]: n for n in graph["nodes"]}
    assert by_id["m"]["color"] == "#e91e63"
    assert by_id["m"]["description"] == "rest mass"
    assert by_id["m"]["highlight"] == "m"

    assert by_id["c"]["color"] == "#3f51b5"
    assert by_id["c"]["highlight"] == "c"

    for node in graph["nodes"]:
        hl = node.get("highlight")
        if hl is not None:
            assert not hl.startswith("hl-"), (
                f"highlight should be the raw key, got {hl!r}"
            )


def test_highlight_overlay_preserves_schema_validity(graph_validator):
    """Annotated nodes must still validate against the semantic-graph schema."""
    scene = _build_scene(
        math=r"F = \htmlClass{hl-m}{m} \htmlClass{hl-a}{a}",
        highlights={
            "m": {"color": "#ff5722", "label": "mass"},
            "a": {"color": "#009688", "label": "acceleration"},
        },
    )
    _autofill_semantic_graphs(scene)
    graph = _graph_dict(scene)

    errors = sorted(graph_validator.iter_errors(graph), key=lambda e: e.path)
    assert not errors, "\n".join(e.message for e in errors)


def test_highlight_overlay_idempotent_and_respects_existing_fields():
    """Re-running the overlay should not overwrite author-provided color."""
    math = r"y = \htmlClass{hl-x}{x}"
    highlights = {"x": {"color": "#ff0000", "label": "input"}}

    scene = _build_scene(math, highlights)
    _autofill_semantic_graphs(scene)
    # Re-parse the serialized graph back into a SemanticGraph model,
    # modify a field, then re-run the overlay.
    graph_dict = _graph_dict(scene)
    graph = SemanticGraph.model_validate(graph_dict)
    by_id = {n.id: n for n in graph.nodes}
    by_id["x"].color = "#0000ff"  # author override

    hl_pairs = _extract_htmlclass_pairs(math)
    _apply_highlights_to_graph(graph, hl_pairs, highlights)

    assert by_id["x"].color == "#0000ff", (
        "overlay must not clobber author-provided color"
    )
    assert by_id["x"].highlight == "x"


def test_highlight_overlay_binds_subexpression_to_root_operator(graph_validator):
    """A highlight wrapping a whole sub-expression binds to its root operator."""
    scene = _build_scene(
        math=r"E = \htmlClass{hl-kinetic}{\frac{1}{2} m v^2}",
        highlights={"kinetic": {"color": "#ff9800", "label": "kinetic energy"}},
    )
    _autofill_semantic_graphs(scene)
    graph = _graph_dict(scene)

    annotated = [n for n in graph["nodes"] if n.get("highlight") == "kinetic"]
    assert len(annotated) == 1, "exactly one node should carry the highlight"
    root = annotated[0]
    assert root["type"] == "operator"
    assert root["op"] == "multiply"
    assert "v^{2}" in root["subexpr"]
    assert root["color"] == "#ff9800"
    assert root["description"] == "kinetic energy"

    for leaf_id in ("m", "v"):
        leaf = next(n for n in graph["nodes"] if n["id"] == leaf_id)
        assert leaf.get("highlight") is None

    errors = sorted(graph_validator.iter_errors(graph), key=lambda e: e.path)
    assert not errors, "\n".join(e.message for e in errors)


def test_highlight_overlay_noop_when_no_highlights():
    """Math with no htmlClass spans and no highlights — graph stays clean."""
    scene = _build_scene(math=r"y = x^2", highlights={})
    _autofill_semantic_graphs(scene)
    graph = _graph_dict(scene)
    for node in graph["nodes"]:
        assert node.get("highlight") is None


def test_strip_html_class_removes_wrappers_from_middle_of_math():
    assert (
        _strip_html_class(r"E = \htmlClass{hl-m}{m} \htmlClass{hl-c}{c}^2")
        == r"E = m c^2"
    )


def test_strip_html_class_preserves_nested_latex_body():
    assert (
        _strip_html_class(r"E = \htmlClass{hl-kinetic}{\frac{1}{2} m v^2}")
        == r"E = \frac{1}{2} m v^2"
    )


def test_strip_html_class_handles_malformed_wrapper_without_regex_backtracking():
    bad = "\\htmlClass{" * 2000 + "x"
    assert _strip_html_class(bad) == bad
