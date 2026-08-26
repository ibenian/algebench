"""Proposal -> canonical Scene. Deterministic, so all of it is testable now."""
from __future__ import annotations

import json
import pathlib

import pytest

from backend.experts.handlers.build_scene.compose import ComposeError, compose
from backend.experts.handlers.build_scene.proposed import ProposedElement, ProposedStep
from backend.model.lesson import Scene


def _el(**kw) -> ProposedElement:
    return ProposedElement.model_validate({"type": "point", **kw})


def _scene(**over) -> Scene:
    base = dict(
        title="Cross Product",
        description="Perpendicular to both.",
        elements=[
            _el(type="axis", label="x", step=-1),
            _el(type="vector", label=r"$\vec{a}$", step=0, **{"from": "0,0,0"}, to="2, 0, 0"),
            _el(type="vector", label=r"$\vec{b}$", step=1, **{"from": "0,0,0"}, to="1, 2, 0"),
        ],
        steps=[ProposedStep(index=0, title="Add a"), ProposedStep(index=1, title="Add b")],
    )
    return compose(**{**base, **over})


# ---- it produces something the renderer accepts --------------------------

def test_the_result_is_a_canonical_scene():
    scene = _scene()
    # Round-trips through the model the whole corpus round-trips through.
    assert Scene.model_validate(scene.model_dump(by_alias=True, exclude_none=True))
    assert scene.title and scene.steps and scene.elements


def test_elements_land_in_the_step_that_introduces_them():
    """LineAdapter cannot nest, so an element names its step and compose groups.
    Getting this wrong puts every object in the opening frame."""
    scene = _scene()
    assert [e.type for e in scene.elements] == ["axis"], "step -1 is scene-level"
    assert [len(s.add or []) for s in scene.steps] == [1, 1]


def test_an_element_in_a_step_that_does_not_exist_is_refused():
    """Silently dropping it is worse: the scene builds and the object never
    appears, which reads as the model forgetting to add it."""
    with pytest.raises(ComposeError, match="does not define"):
        _scene(elements=[_el(type="vector", step=7, to="1,1,1")],
               steps=[ProposedStep(index=0, title="only step")])


# ---- ids -----------------------------------------------------------------

def test_ids_are_minted_and_unique():
    """`remove[{id}]` and slider bindings reference these. A repeat does not fail
    here — it removes the wrong object three steps later."""
    scene = compose("T", "", [
        _el(type="vector", label="same", step=0, to="1,0,0"),
        _el(type="vector", label="same", step=0, to="0,1,0"),
        _el(type="vector", label="same", step=1, to="0,0,1"),
    ], [ProposedStep(index=0, title="a"), ProposedStep(index=1, title="b")])
    ids = [e.id for s in scene.steps for e in (s.add or [])]
    assert len(ids) == len(set(ids)) == 3
    assert ids == ["s0-same", "s0-same-2", "s1-same"], "step-scoped and readable"


def test_a_model_supplied_id_is_ignored():
    """extra="ignore" on ProposedElement, deliberately: an id the model chose is
    an id nothing checked."""
    scene = compose("T", "", [_el(type="point", label="p", step=-1, position="0,0,0",
                                  id="whatever-it-said")], [])
    assert scene.elements[0].id == "scene-p"


# ---- coordinates: the corpus decides -------------------------------------

CORPUS_EXPRESSIONS = ["Rp+h", "lambda + 0.6", "cos(theta)", "N", "2*pi*r", "sin(t)*R"]


@pytest.mark.parametrize("expr", CORPUS_EXPRESSIONS)
def test_real_mathjs_coordinates_pass_through_untouched(expr):
    """The plan said "LaTeX -> math.js" here. Applied to these it is not a no-op,
    it is destruction: `cos(theta)` becomes `c*o*s(E*a*h*t**2)` and `Rp+h` becomes
    `R*p + h`, splitting a variable the corpus actually uses. Conversion is gated
    on a backslash, and 0 of the corpus's 782 coordinates contain one.
    """
    scene = compose("T", "", [_el(type="point", label="p", step=-1,
                                  position=f"{expr}, 0, 0")], [])
    assert scene.elements[0].position[0] == expr


def test_latex_coordinates_are_rescued():
    """A model that has been writing LaTeX labels carries the habit into a
    coordinate. That is the case the gate is FOR."""
    scene = compose("T", "", [_el(type="point", label="p", step=-1,
                                  position=r"\cos(\theta), 0, 0")], [])
    assert scene.elements[0].position[0] == "cos(theta)"


def test_unparseable_latex_names_the_element():
    with pytest.raises(ComposeError, match="does not parse"):
        compose("T", "", [_el(type="point", label="p", step=-1,
                              position=r"\frac{, 0, 0")], [])


def test_integers_stay_integers():
    """`Num = Union[int, float]` exists because the corpus writes `0`, not `0.0`.
    Composing must not undo that."""
    scene = compose("T", "", [_el(type="point", label="p", step=-1,
                                  position="0, 1.5, 2")], [])
    assert [type(c).__name__ for c in scene.elements[0].position] == ["int", "float", "int"]


def test_a_coordinate_that_is_not_a_triple_is_refused():
    with pytest.raises(ComposeError, match="three comma-separated"):
        compose("T", "", [_el(type="point", label="p", step=-1, position="1, 2")], [])


# ---- staging -------------------------------------------------------------

def test_range_and_camera_come_from_the_geometry():
    """Both appear on 84/84 published scenes, so a scene without them is not
    finished. And a model asked for a camera returns a plausible one that frames
    nothing — this is arithmetic on what it already said."""
    scene = _scene()
    assert scene.range and scene.camera
    (x0, x1), (y0, y1), _ = scene.range
    assert x0 <= 0 and x1 >= 2 and y1 >= 2, "the geometry must be inside the frame"
    assert scene.camera.target == [1, 1, 0]


def test_a_flat_scene_still_has_depth():
    """Everything at z=0 gives a zero-depth axis, and a zero-depth range
    collapses the view."""
    scene = compose("T", "", [_el(type="point", label="p", step=-1, position="0,0,0")], [])
    z0, z1 = scene.range[2]
    assert z1 - z0 >= 2


def test_expression_coordinates_do_not_frame_the_scene():
    """`Rp+h` has no value until the sliders exist. Guessing one frames the scene
    around a number nobody chose."""
    scene = compose("T", "", [
        _el(type="point", label="a", step=-1, position="1, 1, 0"),
        _el(type="point", label="b", step=-1, position="Rp+h, 0, 0"),
    ], [])
    assert scene.range[0][1] < 10, "the expression must not be treated as a bound"


def test_a_scene_with_no_numeric_geometry_is_left_unstaged():
    """Better an absent range than one derived from nothing."""
    scene = compose("T", "", [_el(type="text", label="hello", step=-1)], [])
    assert scene.range is None and scene.camera is None


# ---- prompts -------------------------------------------------------------

def test_prompts_are_written_for_objects_that_have_meaning():
    scene = _scene()
    assert scene.elements[0].prompt is None, "an axis is furniture, not a subject"
    first = scene.steps[0].add[0]
    assert first.prompt and r"\vec{a}" in first.prompt


def test_the_models_own_prompt_wins():
    scene = compose("T", "", [_el(type="point", label="p", step=-1, position="0,0,0",
                                  prompt="Why is this the origin?")], [])
    assert scene.elements[0].prompt == "Why is this the origin?"


def test_prompts_are_omitted_when_the_lesson_does_not_use_them():
    """`conventions.elementsCarryPrompts` decides; the composer does not."""
    scene = compose("T", "", [_el(type="point", label="p", step=-1, position="0,0,0")],
                    [], with_prompts=False)
    assert scene.elements[0].prompt is None


# ---- refusals ------------------------------------------------------------

def test_an_unsupported_type_is_refused_by_name():
    """A type the composer cannot stage renders as an empty scene, which reads
    as a broken app rather than an unfinished feature."""
    with pytest.raises(ComposeError, match="sphere"):
        compose("T", "", [_el(type="sphere", label="s", step=-1, position="0,0,0")], [])


def test_a_scene_needs_a_title():
    with pytest.raises(ComposeError, match="title"):
        compose("  ", "", [], [])
