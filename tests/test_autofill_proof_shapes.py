"""Exercise ``_autofill_semantic_graphs`` across both proof shapes.

Scenes may set ``proof`` as either a single object or an array of proofs
(multi-proof scenes). The frontend's ``normalizeProofs`` handles both
shapes; the server's autofill must do the same, or array-typed scenes
silently miss their auto-derived graphs.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import server  # noqa: E402
from server import _autofill_semantic_graphs, _normalize_proofs  # noqa: E402


REPO_ROOT = Path(__file__).parent.parent


def test_normalize_proofs_shapes():
    assert _normalize_proofs(None) == []
    assert _normalize_proofs({"steps": []}) == [{"steps": []}]
    assert _normalize_proofs([{"a": 1}, {"b": 2}]) == [{"a": 1}, {"b": 2}]
    # Non-dict items in an array are filtered out.
    assert _normalize_proofs([{"a": 1}, "oops", None]) == [{"a": 1}]
    # Unknown shapes return empty, not a crash.
    assert _normalize_proofs("not a proof") == []
    assert _normalize_proofs(42) == []


def test_autofill_single_object_proof_still_works():
    spec = {
        "scenes": [
            {
                "title": "single",
                "proof": {"steps": [{"math": "y = x^2"}]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    assert "semanticGraph" in step
    assert "graph" in step["semanticGraph"]


def test_autofill_array_typed_proof_fills_every_proof():
    spec = {
        "scenes": [
            {
                "title": "multi",
                "proof": [
                    {"steps": [{"math": "y = x^2"}]},
                    {"steps": [{"math": "z = a + b"}]},
                ],
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    proofs = spec["scenes"][0]["proof"]
    assert "semanticGraph" in proofs[0]["steps"][0]
    assert "semanticGraph" in proofs[1]["steps"][0]


def test_autofill_array_typed_proof_leaves_existing_graphs_alone():
    existing = {"graph": {"nodes": [{"id": "sentinel"}], "edges": []}}
    spec = {
        "scenes": [
            {
                "title": "mixed",
                "proof": [
                    {"steps": [{"math": "y = x^2", "semanticGraph": existing}]},
                    {"steps": [{"math": "z = a + b"}]},
                ],
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    proofs = spec["scenes"][0]["proof"]
    # Step with a pre-existing graph is untouched.
    assert proofs[0]["steps"][0]["semanticGraph"] is existing
    # Step without a graph gets one auto-derived.
    second = proofs[1]["steps"][0]
    assert "semanticGraph" in second
    assert second["semanticGraph"]["graph"]["nodes"], "expected non-empty graph"


def test_autofill_null_proof_is_noop():
    spec = {"scenes": [{"title": "empty", "proof": None}]}
    _autofill_semantic_graphs(spec)  # must not raise
    assert spec["scenes"][0]["proof"] is None


def test_autofill_attaches_error_when_parser_returns_none(monkeypatch):
    """Issue #137: when the parser returns None, the step should carry an
    error record inside ``semanticGraph`` so the UI can surface the failure."""
    monkeypatch.setattr(
        server, "_derive_equation_chain_graph", lambda latex: None,
    )
    spec = {
        "scenes": [
            {
                "title": "unsupported",
                "proof": {"steps": [{"math": "\\int_0^1 f(x) dx"}]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    sg = step.get("semanticGraph")
    assert sg, "expected a semanticGraph record"
    assert "graph" not in sg
    err = sg.get("error")
    assert err, "expected an error inside semanticGraph"
    assert err["reason"] == "parse_failed"
    assert err["math"] == "\\int_0^1 f(x) dx"
    assert isinstance(err["message"], str) and err["message"]


def test_autofill_attaches_error_when_parser_raises(monkeypatch):
    """Issue #137: parser exceptions must become ``parse_crashed`` errors
    inside ``semanticGraph``, not silently dropped."""
    def boom(_latex):
        raise RuntimeError("synthetic parse crash")
    monkeypatch.setattr(server, "_derive_equation_chain_graph", boom)
    spec = {
        "scenes": [
            {
                "title": "crashy",
                "proof": {"steps": [{"math": "y = x^2"}]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    sg = step.get("semanticGraph")
    assert sg, "expected a semanticGraph record"
    assert "graph" not in sg
    err = sg.get("error")
    assert err, "expected an error inside semanticGraph"
    assert err["reason"] == "parse_crashed"
    assert "synthetic parse crash" in err["message"]


def test_autofill_success_does_not_attach_error():
    """Issue #137: the happy path should have ``graph`` but no ``error``
    inside ``semanticGraph``."""
    spec = {
        "scenes": [
            {
                "title": "ok",
                "proof": {"steps": [{"math": "y = x^2"}]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    sg = step.get("semanticGraph")
    assert sg and sg.get("graph")
    assert "error" not in sg


def test_autofill_skips_step_with_existing_graph():
    """A step with a pre-existing graph is left untouched — no re-derivation."""
    existing = {"graph": {"nodes": [{"id": "sentinel"}], "edges": []}}
    spec = {
        "scenes": [
            {
                "title": "pre-existing",
                "proof": {"steps": [{
                    "math": "y = x^2",
                    "semanticGraph": existing,
                }]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    assert step["semanticGraph"] is existing


def test_autofill_overwrites_error_only_record(monkeypatch):
    """A step that previously had only an error (no graph) should get a
    fresh derivation attempt on the next autofill pass."""
    old_error = {"error": {
        "reason": "parse_failed",
        "message": "old failure",
        "math": "y = x^2",
    }}
    spec = {
        "scenes": [
            {
                "title": "retry",
                "proof": {"steps": [{
                    "math": "y = x^2",
                    "semanticGraph": old_error,
                }]},
            }
        ]
    }
    _autofill_semantic_graphs(spec)
    step = spec["scenes"][0]["proof"]["steps"][0]
    sg = step.get("semanticGraph")
    assert sg and sg.get("graph"), "error-only record should be replaced with a derived graph"
    assert "error" not in sg


def test_autofill_atmospheric_entry_physics_fixture():
    """Regression: array-typed proof scenes should get auto-filled graphs.

    Before the fix, ``proof`` being an array caused the scene to be silently
    skipped and _none_ of its steps would have a ``semanticGraph``. Individual
    steps may still fail SymPy parsing (out of scope); we just require that
    each array-typed scene produces graphs for at least some steps.
    """
    fixture = REPO_ROOT / "scenes" / "draft" / "atmospheric-entry-physics.json"
    with open(fixture) as f:
        spec = json.load(f)
    _autofill_semantic_graphs(spec)

    def count_filled(scene):
        proofs = scene.get("proof")
        if not isinstance(proofs, list):
            return 0
        return sum(
            1
            for proof in proofs
            for step in proof.get("steps", [])
            if isinstance(step, dict) and step.get("semanticGraph")
        )

    def find_scene(title):
        for scene in spec.get("scenes", []):
            if scene.get("title") == title:
                return scene
        assert False, f"fixture changed — expected scene titled {title!r}"

    # "Trajectory and the Entry Corridor" — array-typed.
    scene_trajectory = find_scene("Trajectory and the Entry Corridor")
    assert isinstance(scene_trajectory.get("proof"), list), (
        "fixture changed — expected array-typed proof on "
        "'Trajectory and the Entry Corridor'"
    )
    assert count_filled(scene_trajectory) > 0, (
        "'Trajectory and the Entry Corridor' array-typed proofs should "
        "produce auto-derived graphs"
    )

    # "Aerodynamic Heating and the Bow Shock" — array-typed.
    scene_heating = find_scene("Aerodynamic Heating and the Bow Shock")
    assert isinstance(scene_heating.get("proof"), list), (
        "fixture changed — expected array-typed proof on "
        "'Aerodynamic Heating and the Bow Shock'"
    )
    assert count_filled(scene_heating) > 0, (
        "'Aerodynamic Heating and the Bow Shock' array-typed proofs should "
        "produce auto-derived graphs"
    )
