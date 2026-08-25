"""Context assembly is deterministic, so it is tested without an LM.

That separation is the point: selection can be improved later — summaries,
retrieval, budgeting — and these tests say what a given lesson yields today,
so a change to selection is visible rather than inferred from build quality.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.experts.handlers.build_scene.context import (
    MAX_SCENES_SUMMARISED, BuilderContext, MemoryRef, assemble_context,
    collect_slider_ids, derive_conventions,
)

REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
VECTOR_OPS = REPO_ROOT / "scenes" / "vector-operations.json"


@pytest.fixture(scope="module")
def lesson() -> dict:
    return json.loads(VECTOR_OPS.read_text())


# ---- placement ------------------------------------------------------------

def test_insert_without_an_index_appends(lesson: dict) -> None:
    ctx = assemble_context(lesson=lesson, intent="add a scene", op="insert")
    assert ctx.scene_index == len(lesson["scenes"])


def test_replace_requires_a_scene_that_exists(lesson: dict) -> None:
    """'Replace something' is not an instruction — refuse rather than guess."""
    with pytest.raises(ValueError):
        assemble_context(lesson=lesson, intent="redo it", op="replace", scene_index=None)
    with pytest.raises(ValueError):
        assemble_context(lesson=lesson, intent="redo it", op="replace", scene_index=99)


def test_only_a_replace_carries_the_full_scene(lesson: dict) -> None:
    """This is what makes regenerate-WITH-context work instead of from scratch."""
    ins = assemble_context(lesson=lesson, intent="x", op="insert")
    rep = assemble_context(lesson=lesson, intent="x", op="replace", scene_index=2)
    assert ins.current is None
    assert rep.current is lesson["scenes"][2]


def test_neighbours_are_the_scenes_either_side(lesson: dict) -> None:
    ctx = assemble_context(lesson=lesson, intent="x", op="insert", scene_index=2)
    assert [n["title"] for n in ctx.neighbours] == [
        lesson["scenes"][1]["title"], lesson["scenes"][3]["title"],
    ]


def test_appending_has_only_a_left_neighbour(lesson: dict) -> None:
    ctx = assemble_context(lesson=lesson, intent="x", op="insert")
    assert len(ctx.neighbours) == 1
    assert ctx.neighbours[0]["title"] == lesson["scenes"][-1]["title"]


# ---- derived, not asked ---------------------------------------------------

def test_conventions_come_from_the_elements_actually_present(lesson: dict) -> None:
    """A model told 'match the style' invents one; handed the real palette it reuses it."""
    conv = derive_conventions(lesson["scenes"])
    assert "#ff6644" in conv.colors, "the vector-a colour used throughout"
    assert conv.labels_are_latex, "this lesson labels in LaTeX"
    assert conv.elements_carry_prompts


def test_a_lesson_with_plain_labels_is_not_reported_as_latex() -> None:
    """One stray LaTeX label must not make the builder wrap every word in dollars."""
    scenes = [{"elements": [
        {"type": "vector", "label": "velocity"},
        {"type": "vector", "label": "position"},
        {"type": "vector", "label": "$a$"},
    ]}]
    assert derive_conventions(scenes).labels_are_latex is False


def test_slider_vocabulary_is_collected_so_the_model_cannot_collide(lesson: dict) -> None:
    ids = collect_slider_ids(lesson["scenes"])
    assert {"ax", "ay", "az", "bx", "by", "bz"} <= set(ids)
    assert len(ids) == len(set(ids)), "ids must be de-duplicated"


# ---- bounds ---------------------------------------------------------------

def test_summaries_are_bounded_and_the_omission_is_reported() -> None:
    """A silently truncated context reads as 'the model saw everything'."""
    big = {"title": "L", "scenes": [{"title": f"s{i}"} for i in range(MAX_SCENES_SUMMARISED + 5)]}
    ctx = assemble_context(lesson=big, intent="x", op="insert")
    assert len(ctx.scene_summaries) == MAX_SCENES_SUMMARISED
    assert any("scene summaries" in o for o in ctx.omitted), "truncation must be visible"


def test_agent_memory_contributes_shapes_not_values() -> None:
    """A stored matrix has no business in a prompt; `$key` is resolved at apply time."""
    ctx = assemble_context(
        lesson={"title": "L", "scenes": []}, intent="x", op="insert",
        memory=(MemoryRef("eigenvecs", "list of 3 lists (3-element)"),),
    )
    assert ctx.memory[0].key == "eigenvecs"
    assert "3" in ctx.memory[0].shape


# ---- shapes it must tolerate ---------------------------------------------

def test_a_single_scene_lesson_is_understood_as_one_scene() -> None:
    ctx = assemble_context(
        lesson={"title": "solo", "elements": [{"type": "vector"}]}, intent="x", op="insert",
    )
    assert ctx.scene_index == 1, "appends after the single scene"


def test_an_empty_app_yields_a_usable_context() -> None:
    ctx = assemble_context(lesson={}, intent="build me a scene", op="insert")
    assert isinstance(ctx, BuilderContext)
    assert ctx.scene_index == 0 and ctx.neighbours == () and ctx.current is None


def test_assembly_never_mutates_the_lesson(lesson: dict) -> None:
    before = json.dumps(lesson, sort_keys=True)
    assemble_context(lesson=lesson, intent="x", op="replace", scene_index=0)
    assert json.dumps(lesson, sort_keys=True) == before
