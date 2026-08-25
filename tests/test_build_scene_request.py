"""The request the client sends, and the strings it becomes.

Deterministic — no LM — so what a given lesson yields is pinned TODAY and a
change to selection or wording is visible rather than inferred from whether
builds got better.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from backend.experts.handlers.build_scene import format as fmt
from backend.experts.handlers.build_scene.models import BuildSceneRequest

SCENE = {
    "title": "Vector addition",
    "elements": [
        {"type": "vector", "id": "a", "label": r"$\vec{a}$", "color": "#ff6644"},
        {"type": "vector", "id": "b", "label": r"$\vec{b}$", "color": "#44aaff"},
    ],
    "steps": [{"text": "Place the first vector", "add": [{"type": "point"}]}],
}


def _request(**over) -> BuildSceneRequest:
    base = {"op": "insert", "sceneIndex": 0, "intent": "add vector addition"}
    return BuildSceneRequest(**{**base, **over})


# ---- the request ---------------------------------------------------------

def test_replace_must_carry_the_scene_it_replaces():
    """Otherwise a from-scratch build wears the label of a refinement, and the
    scene it was asked to improve is silently discarded."""
    with pytest.raises(ValueError, match="scene being replaced"):
        _request(op="replace").require_consistent()

    _request(op="replace", current=SCENE).require_consistent()  # no raise


def test_insert_must_not_carry_a_current_scene():
    with pytest.raises(ValueError, match="must not carry"):
        _request(op="insert", current=SCENE).require_consistent()


def test_unknown_fields_are_refused():
    # extra="forbid": a renamed client field must fail loudly, not be ignored
    # and leave the model quietly blind to it.
    with pytest.raises(ValidationError):
        _request(sceneSummaries=[])


def test_scene_index_cannot_be_negative():
    # It becomes a list index during placement, where -1 is a valid position
    # that means something else entirely.
    with pytest.raises(ValidationError):
        _request(sceneIndex=-1)


def test_values_are_not_coerced():
    """Raw on purpose: re-validating through the canonical model would rewrite
    `1` as `1.0` inside the scenes the builder is shown."""
    scene = {"elements": [{"type": "sphere", "size": 1, "position": [0, 1, 2]}]}
    got = _request(op="replace", current=scene).current["elements"][0]
    assert got["size"] == 1 and isinstance(got["size"], int)
    assert all(isinstance(c, int) for c in got["position"])


# ---- LaTeX survives ------------------------------------------------------

def test_latex_reaches_the_prompt_unescaped():
    """The whole reason format.py exists.

    A `dict` input field is rendered by DSPy with ``json.dumps``, which DOUBLES
    every backslash — and models imitate what they are shown. LineAdapter does
    not cover this: it does not touch inputs.
    """
    text = fmt.format_current(SCENE)
    assert r"\vec{a}" in text
    assert "\\\\" not in text, "a doubled backslash means the JSON path leaked in"

    # The path NOT taken, for contrast — this is what a dict input would send.
    assert r"\\vec" in json.dumps(SCENE)


def test_a_newline_in_a_value_cannot_forge_a_line():
    """Values are one line each, so a label containing a newline must not become
    an extra line in the prompt — the model reads these positionally.

    Counting LINES is the assertion. Splitting on newline and checking the pieces
    for newlines proves nothing: split guarantees it.
    """
    clean = {"title": "keep", "elements": [{"type": "vector", "label": "keep"}]}
    forged = {"title": "keep\nSMUGGLED", "elements": [{"type": "vector", "label": "keep\nSMUGGLED"}]}
    assert len(fmt.format_current(forged).splitlines()) \
        == len(fmt.format_current(clean).splitlines()) == 2
    assert "SMUGGLED" not in fmt.format_current(forged)


# ---- bounded, and audibly so --------------------------------------------

def test_truncation_is_announced():
    """A silent cut leaves the builder confidently contradicting the part of the
    lesson it could not see."""
    lesson = {"title": "L", "sceneSummaries": [
        {"index": i, "title": f"s{i}"} for i in range(fmt.MAX_SCENES_SUMMARISED + 5)]}
    lines = fmt.format_lesson(lesson).splitlines()
    assert sum(1 for ln in lines if ln.startswith("  ") and ln[2].isdigit()) \
        == fmt.MAX_SCENES_SUMMARISED
    assert "… (+5 more scenes)" in lines[-1]


def test_neighbours_are_bounded():
    text = fmt.format_neighbours([SCENE] * (fmt.MAX_NEIGHBOURS + 3))
    assert text.count("Neighbouring scene") == fmt.MAX_NEIGHBOURS
    assert "… (+3 more neighbours)" in text


def test_elements_are_bounded_per_scene():
    scene = {"elements": [{"type": "point"}] * (fmt.MAX_ELEMENTS + 7)}
    text = fmt.format_current(scene)
    assert text.count("- point") == fmt.MAX_ELEMENTS
    assert "… (+7 more elements)" in text


def test_memory_values_never_reach_the_prompt():
    """Only the key and its shape. The values are computed arrays with no
    business in a prompt — `$key` is substituted at apply time."""
    memory = [{"key": "trajectory", "shape": "array of 400 [x,y,z]",
               "value": [[1, 2, 3]] * 400}]
    text = fmt.format_existing_names([], memory)
    assert "$trajectory" in text and "array of 400" in text
    assert "1, 2, 3" not in text and "[[" not in text


# ---- survives a caller that skips the client ----------------------------

@pytest.mark.parametrize("junk", [None, 42, "text", [], {}, [None, 7], {"a": None}])
def test_formatters_tolerate_garbage(junk):
    """These bounds exist for a caller that does not use src/builder-context.ts,
    so every formatter must survive input that shape-checking never saw."""
    assert isinstance(fmt.format_lesson(junk), str)
    assert isinstance(fmt.format_neighbours(junk), str)
    assert isinstance(fmt.format_current(junk), str)
    assert isinstance(fmt.format_conventions(junk), str)
    assert isinstance(fmt.format_clarifications(junk), str)
    assert isinstance(fmt.format_existing_names(junk, junk), str)
    assert isinstance(fmt.format_omitted(junk), str)


def test_conventions_state_the_negative_case_too():
    """"Labels are plain text" has to be SAID. Silence reads as no opinion, and
    the model falls back to whatever it saw in the neighbours."""
    assert "do NOT wrap" in fmt.format_conventions({"labelsAreLatex": False})
    assert "wrap label text" in fmt.format_conventions({"labelsAreLatex": True})
