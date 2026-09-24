"""The prebaker's proof traversal must reach every level the renderer reads.

``collectAllProofs`` (src/proof.ts) collects proofs from three places: the
lesson root, a scene, and a scene *step*. The prebaker used to walk only the
scene level, so a lesson that attached its proofs to steps reported
"steps with math: 0" and got nothing baked — silently, because a missing graph
is not an error anywhere. Three shipped lessons were affected
(quadratic-formula, special-relativity, transformer-architecture).

These pin the traversal itself rather than the derivation, so they stay fast
and do not depend on what the LaTeX parser can currently handle.
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts.prebake_semantic_graphs import (
    ProofLoc,
    _error_record,
    _existing_graph,
    iter_proof_steps,
)

REPO = Path(__file__).resolve().parent.parent


def _step(name):
    return {"id": name, "label": name, "math": f"{name} = 1"}


def _proof(pid, *step_names):
    return {"id": pid, "title": pid, "steps": [_step(n) for n in step_names]}


def _levels(spec):
    return [(loc.level, loc.label, step["id"]) for loc, _sc, _pr, step in iter_proof_steps(spec)]


def test_walks_root_scene_and_step_proofs_in_renderer_order():
    spec = {
        "title": "three levels",
        "proof": _proof("root-proof", "r0", "r1"),
        "scenes": [
            {
                "title": "scene 0",
                "proof": _proof("scene-proof", "s0"),
                "steps": [
                    {"id": "step-0"},
                    {"id": "step-1", "proof": _proof("step-proof", "k0", "k1")},
                ],
            },
        ],
    }
    assert _levels(spec) == [
        # Root first, then per scene: the scene's own proofs, then its steps'.
        ("root", "root.0.0", "r0"),
        ("root", "root.0.1", "r1"),
        ("scene", "0.0.0", "s0"),
        ("step", "0s1.0.0", "k0"),
        ("step", "0s1.0.1", "k1"),
    ]


def test_scene_and_step_proofs_get_distinct_labels():
    """The old ``(scene, proof, step)`` triple could not tell scene 2's own
    proof from the proof on scene 2's step 4 — both read ``2.0``."""
    spec = {
        "scenes": [
            {"proof": _proof("scene-own", "a"),
             "steps": [{"proof": _proof("step-own", "a")}]},
        ],
    }
    labels = [loc.label for loc, *_ in iter_proof_steps(spec)]
    assert labels == ["0.0.0", "0s0.0.0"]
    assert len(set(labels)) == len(labels)


def test_a_proof_array_is_indexed_within_its_container():
    spec = {"scenes": [{"steps": [{"proof": [_proof("p0", "a"), _proof("p1", "b")]}]}]}
    assert [loc.label for loc, *_ in iter_proof_steps(spec)] == ["0s0.0.0", "0s0.1.0"]


def test_yields_the_owning_scene_for_a_step_proof():
    """The enrichment pass builds its LM context from the scene, so a
    step-level proof must still hand back the scene it belongs to."""
    scene = {"title": "owner", "steps": [{"proof": _proof("p", "a")}]}
    (loc, sc, proof, step), = iter_proof_steps({"scenes": [scene]})
    assert sc is scene and proof["id"] == "p" and step["id"] == "a"
    assert (loc.scene, loc.owner_step) == (0, 0)


def test_root_proof_has_no_scene():
    (loc, sc, _pr, _st), = iter_proof_steps({"proof": _proof("p", "a")})
    assert loc == ProofLoc(None, None, 0, 0)
    assert loc.level == "root" and sc is None


def test_bare_single_scene_file_step_proofs_are_reached():
    """A file with ``elements`` and no ``scenes`` is one scene to the renderer,
    and its root proof must not also be counted as that scene's."""
    spec = {
        "title": "bare",
        "elements": [],
        "proof": _proof("root", "r"),
        "steps": [{"proof": _proof("step", "k")}],
    }
    assert _levels(spec) == [("root", "root.0.0", "r"), ("step", "0s0.0.0", "k")]


def test_tolerates_junk_without_raising():
    for spec in (None, [], "nope", {}, {"scenes": "nope"},
                 {"scenes": [None, 7, {"steps": "nope"}]},
                 {"scenes": [{"steps": [None, {"proof": {"steps": "nope"}}]}]}):
        assert list(iter_proof_steps(spec)) == []


def test_shipped_lessons_with_step_level_proofs_are_now_reached():
    """Regression guard for the three lessons that were invisible. If a lesson
    is retired or its proofs move, update the expectation — do not delete it."""
    expected = {
        "quadratic-formula.json": 19,
        "special-relativity.json": 6,
        "transformer-architecture.json": 6,
    }
    for name, want in expected.items():
        spec = json.loads((REPO / "scenes" / name).read_text(encoding="utf-8"))
        got = sum(1 for loc, *_ in iter_proof_steps(spec) if loc.level == "step")
        assert got == want, f"{name}: {got} step-level proof steps, expected {want}"


def test_enrich_all_tags_each_result_with_its_own_address(monkeypatch):
    """``enrich_all`` fans its steps out concurrently. The address must travel
    with each target, not be read off the collection loop's variable — closing
    over it tagged every result with the LAST step visited.
    """
    import asyncio

    from scripts import prebake_semantic_graph_enrichment as enr

    def _baked(name):
        s = _step(name)
        s["semanticGraph"] = {"graph": {"nodes": [{"id": name}], "edges": []}}
        return s

    spec = {
        "scenes": [
            {"proof": {"id": "scene-proof", "steps": [_baked("a")]},
             "steps": [{"proof": {"id": "step-proof", "steps": [_baked("b"), _baked("c")]}}]},
        ],
    }

    monkeypatch.setattr(enr, "_existing_graph", lambda st: (st.get("semanticGraph") or {}).get("graph"))
    monkeypatch.setattr(enr, "_is_enriched", lambda g: False)
    monkeypatch.setattr(enr, "_build_context", lambda *a, **k: {})

    async def _fake_enrich(agent, graph, context, *, rebake):
        await asyncio.sleep(0)                       # force interleaving
        return {**graph, "enrichment": {"fields": []}}

    monkeypatch.setattr(enr, "_enrich_graph", _fake_enrich)

    class _Agent:
        max_retries = 1

    monkeypatch.setitem(
        __import__("sys").modules,
        "backend.agents",
        type("M", (), {"SemanticGraphEnrichmentAgent": _Agent})(),
    )

    out = asyncio.run(enr.enrich_all(spec, rebake=False, concurrency=4, retries=1))

    assert out["enriched"] == 3 and not out["errors"]
    # Each of the three carries its own address — one scene-level, two on a step.
    assert sorted(c["loc"] for c in out["changed"]) == ["0.0.0", "0s0.0.0", "0s0.0.1"]


def test_empty_scenes_array_is_a_bare_file_not_a_lesson():
    """`scenes: []` must walk like a bare file, matching the renderer.

    `isLessonFormat` requires `scenes.length > 0`, so a spec carrying
    `elements`, top-level `steps` and `scenes: []` is loaded through the
    non-lesson path. Accepting `[]` as a lesson here walked an empty list and
    silently emitted nothing -- the step proofs were not mis-placed, they were
    absent.
    """
    proof = {"id": "sp", "steps": [{"label": "L", "math": "y = 2"}]}
    with_empty = {"elements": [], "scenes": [], "steps": [{"proof": proof}]}
    no_scenes = {"elements": [], "steps": [{"proof": proof}]}

    got = list(iter_proof_steps(with_empty))
    assert len(got) == 1, "scenes: [] still yields its step-level proof"
    # and identically to the same file written without the empty array
    assert [loc for loc, *_ in got] == [loc for loc, *_ in iter_proof_steps(no_scenes)]

    # a real lesson is untouched
    lesson = {"scenes": [{"id": "s", "steps": [{"proof": proof}]}]}
    assert len(list(iter_proof_steps(lesson))) == 1


def test_steps_only_bare_file_still_yields_its_step_proofs():
    """No `elements` is not a reason to drop a step proof.

    scene-loader hands anything `isLessonFormat` rejects to `loadScene(spec)`,
    and a scene that builds everything in its steps "has no base elements but
    is not empty". The schema requires only `title`. Gating the bare-scene
    stand-in on `elements` silently dropped every step proof in such a file.
    """
    proof = {"id": "sp", "steps": [{"label": "L", "math": "y = 2"}]}
    steps_only = {"title": "b", "steps": [{"proof": proof}]}
    assert len(list(iter_proof_steps(steps_only))) == 1

    # still once, not twice, when a root proof is present as well
    with_root = {"title": "b", "proof": proof, "steps": [{"proof": proof}]}
    assert len(list(iter_proof_steps(with_root))) == 2

    # a real lesson is untouched
    lesson = {"scenes": [{"id": "s", "steps": [{"proof": proof}]}]}
    assert len(list(iter_proof_steps(lesson))) == 1


def test_an_empty_graph_dict_is_an_error_record_not_a_billable_step():
    """`{error, graph: {}}` must bill exactly like `{error}` with no graph key.

    Both are identical to the two consumers: the server's autofill skips on
    truthy `sg.graph`, and `renderCurrentStepGraph` checks `sg.error` whenever
    the graph is falsy and returns WITHOUT posting. `_error_record` used
    `isinstance`, so an empty dict counted as a graph, the record was called
    non-error, and a root/step step was charged to `onDemandDeriveSeconds` for
    a round trip that never happens.
    """
    with_empty = {"semanticGraph": {"error": {"m": 1}, "graph": {}}}
    no_key = {"semanticGraph": {"error": {"m": 1}}}

    # neither carries a usable graph ...
    assert _existing_graph(with_empty) is None
    assert _existing_graph(no_key) is None
    # ... and both are error records, so neither is billed on demand
    assert _error_record(with_empty) is True
    assert _error_record(no_key) is True

    # a real graph is still a graph, and is not an error record
    real = {"semanticGraph": {"error": {"m": 1}, "graph": {"nodes": []}}}
    assert _existing_graph(real) == {"nodes": []}
    assert _error_record(real) is False
