"""Proposal -> canonical Scene. Deterministic, so all of it is testable now."""
from __future__ import annotations

import json
import pathlib

import pytest

from backend.experts.handlers.build_scene.compose import ComposeError, compose
from backend.experts.modules.build_scene.proposed import (
    MAX_FUNCTIONS, ProposedElement, ProposedFunction, ProposedStep)
from backend.model.lesson import Scene


def _el(**kw) -> ProposedElement:
    return ProposedElement.model_validate({"type": "point", **kw})


def _scene(**over) -> Scene:
    base = dict(
        title="Cross Product",
        description="Perpendicular to both.",
        elements=[
            _el(type="axis", label="x", step=-1),
            _el(type="vector", label=r"$\vec{a}$", step=0, from_pos="0,0,0", to_pos="2, 0, 0"),
            _el(type="vector", label=r"$\vec{b}$", step=1, from_pos="0,0,0", to_pos="1, 2, 0"),
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
    # It lands in `expr`, not `position`: a literal field carries constants and
    # the `*Expr` family carries math.js (schemas/lesson.schema.json). What this
    # test is about is the TEXT — verbatim, whichever field holds it.
    body = scene.elements[0].model_dump(by_alias=True, exclude_none=True)
    assert body["type"] == "animated_point"
    assert body["expr"][0] == expr, "the expression must survive character for character"


def test_a_latex_coordinate_is_refused_and_says_what_belongs_there():
    """The case this is FOR: a model that has been writing KaTeX labels carries
    the habit into a coordinate.

    Nothing converts it. A converter cannot tell which notation it was handed,
    and translating valid math.js as if it were LaTeX turns `cos(theta)` into
    `c*o*s(E*a*h*t**2)` with no exception raised. The message names the field and
    the expected notation, which is what a retry needs to hear.
    """
    with pytest.raises(ComposeError) as e:
        compose("T", "", [_el(type="point", label="p", step=-1,
                              position=r"\cos(\theta), 0, 0")], [])
    assert "math.js" in str(e.value) and "label" in str(e.value)


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


# ---- the prompt template must round-trip ---------------------------------

@pytest.mark.parametrize("model", [ProposedElement, ProposedStep])
def test_every_key_the_model_is_shown_can_be_filled_in(model):
    """LineAdapter renders FIELD NAMES, not aliases.

    A field with an alias is therefore shown to the model under a name pydantic
    will not accept — it answers, and the value is silently dropped. `from_`
    (alias `from`, forced because `from` is a keyword) did exactly that: every
    vector lost its tail and the scene still composed. This asserts the template
    and the parser agree, for any field, alias or not.
    """
    from backend.experts.adapters.line_adapter import LineAdapter

    template = LineAdapter().render_model(model(), model.__name__)
    keys = [line.split(":", 1)[0] for line in template.splitlines()]
    assert keys == list(model.model_fields), "template keys must be the field names"

    filled = model.model_validate({k: "1" if model.model_fields[k].annotation is str else 1
                                   for k in keys})
    for k in keys:
        assert getattr(filled, k) not in ("", None), f"{k} was shown but is not accepted"


# ---- what happens when the model uses the schema's words, not ours --------

def test_the_schemas_own_vocabulary_is_refused_loudly_not_swallowed():
    """`from_pos`/`to_pos` are our words; the lesson schema says `from`/`to`, and a
    model that knows this domain may reach for those out of habit.

    That must not be silent. `extra="ignore"` on ProposedElement would swallow it
    and hand back a vector with no geometry — the same silent-loss failure the
    alias caused. LineAdapter checks keys BEFORE pydantic does, so the habit
    costs a retry with the valid keys named, which is what a retry needs.
    """
    from backend.experts.adapters.line_adapter import LineAdapter
    from backend.experts.modules.build_scene.signature import BuildSceneSig

    completion = (
        "[[ ## is_build ## ]]\nTrue\n\n[[ ## question ## ]]\n\n"
        "[[ ## title ## ]]\nT\n\n[[ ## description ## ]]\nD\n\n"
        "[[ ## steps ## ]]\nindex: 0\ntitle: Add a\n\n"
        "[[ ## elements ## ]]\nstep: 0\ntype: vector\nfrom: 0, 0, 0\nto: 2, 0, 0\n\n"
        "[[ ## completed ## ]]\n")

    with pytest.raises(Exception) as e:
        LineAdapter().parse(BuildSceneSig, completion)
    message = str(e.value)
    assert "unknown key 'from'" in message
    assert "'from_pos'" in message and "'to_pos'" in message, "the retry must be told the real keys"


def test_our_own_vocabulary_parses():
    from backend.experts.adapters.line_adapter import LineAdapter
    from backend.experts.modules.build_scene.signature import BuildSceneSig

    completion = (
        "[[ ## is_build ## ]]\nTrue\n\n[[ ## question ## ]]\n\n"
        "[[ ## title ## ]]\nT\n\n[[ ## description ## ]]\nD\n\n"
        "[[ ## steps ## ]]\nindex: 0\ntitle: Add a\n\n"
        "[[ ## sliders ## ]]\nstep: 0\nid: ax\nlabel: $a_x$\n"
        "min: -3\nmax: 3\nstep_size: 0.1\ndefault: 2\n\n"
        # Every output field must appear or the adapter refuses the whole answer,
        # `functions` included — which is the real cost of adding it, and the
        # reason this canned response is the right place to notice.
        "[[ ## functions ## ]]\nname: twiceAx\nexpr: 2 * ax\n\n"
        "[[ ## elements ## ]]\nstep: 0\ntype: vector\nfrom_pos: 0, 0, 0\nto_pos: ax, 0, 0\n\n"
        "[[ ## completed ## ]]\n")

    out = LineAdapter().parse(BuildSceneSig, completion)
    scene = compose(out["title"], out["description"], out["elements"], out["steps"],
                    out["sliders"], out["functions"])
    assert scene.functions == [{"name": "twiceAx", "expr": "2 * ax"}], (
        "the flat wire format has to survive the whole way to the scene")
    # PROMOTED: a slider-driven `to_pos` becomes an `animated_vector` carrying
    # `expr`, because the renderer resolves `to` once at load with no sliders
    # bound and would draw nothing at all.
    built = scene.steps[0].add[0]
    assert built.type == "animated_vector"
    assert built.from_ == [0, 0, 0]
    assert built.model_dump(exclude_none=True)["expr"] == ["ax", "0", "0"]
    assert scene.steps[0].sliders[0].id == "ax"
    assert scene.steps[0].sliders[0].label == "$a_x$"


# ---- animated elements must actually animate -----------------------------

def test_an_animated_element_without_an_expression_is_refused():
    """`animated_vector` was in SUPPORTED_TYPES while ProposedElement had no
    expression field at all — so the model could produce one and it would sit
    still. A static element wearing an animated type reads as a broken renderer.
    """
    with pytest.raises(ComposeError, match="to_expr"):
        compose("T", "", [_el(type="animated_vector", label="v", step=-1,
                              from_pos="0,0,0", to_pos="1,1,0")], [])


def test_animated_expressions_map_to_the_schemas_own_names():
    """The tail becomes `fromExpr` and the head becomes `expr`.

    `expr` is a deliberate choice, not a workaround. `toExpr` DOES exist —
    schemas/lesson.schema.json calls it "Alias for 'expr' on
    animated_vector/animated_cylinder", and the corpus uses it 18 times — but
    `expr` is what every animated renderer checks first (`el.expr || el.toExpr`)
    and the only spelling that also serves `animated_curve`, whose `expr` is a
    single string. An earlier version of this docstring claimed `toExpr` did not
    exist; it does.
    """
    scene = compose("T", "", [_el(type="animated_vector", label="v", step=-1,
                                  from_expr="0, 0, 0",
                                  to_expr="cos(t), sin(t), 0")], [])
    el = scene.elements[0].model_dump(exclude_none=True)
    assert el["fromExpr"] == ["0", "0", "0"]
    assert el["expr"] == ["cos(t)", "sin(t)", "0"]
    assert "toExpr" not in el


def test_expressions_do_not_frame_the_scene():
    """An animated element's path has no extent until the slider exists."""
    scene = compose("T", "", [
        _el(type="point", label="p", step=-1, position="1, 1, 0"),
        _el(type="animated_vector", label="v", step=-1, to_expr="100*t, 0, 0"),
    ], [])
    assert scene.range[0][1] < 10, "an expression must not become a bound"


def test_an_animated_line_is_driven_by_points_not_an_expression():
    """All 97 `animated_line` in the corpus use `points`; none use `expr`.

    Requiring `to_expr` for every animated_* refused every legitimate one — a
    type advertised as supported that could not be built. The earlier rule was
    assumed; this one is measured.
    """
    scene = compose("T", "", [_el(type="animated_line", label="path", step=-1,
                                  points="0,0,0; cos(t),sin(t),0")], [])
    assert len(scene.elements[0].points) == 2


def test_an_animated_element_with_neither_is_still_refused():
    """The guard has to keep working: something must vary with time, or it is a
    static element wearing an animated type."""
    with pytest.raises(ComposeError, match="to_expr"):
        compose("T", "", [_el(type="animated_vector", label="v", step=-1,
                              from_pos="0,0,0", to_pos="1,1,0")], [])


# ---- framing what the scene actually contains ----------------------------






# ---- axes are three axes ------------------------------------------------

def _axes_scene(*els):
    return compose("T", "d", list(els) + [
        ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="3,0,0"),
        ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="0,2,0"),
        ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="0,0,1"),
    ], [ProposedStep(index=0, title="s")])


def test_three_axes_are_three_different_axes():
    """Observed live: x, y and z were all drawn on the SAME line, so the scene
    showed one axis wearing three labels. `axis` is not a field the proposal had,
    so every axis element composed identically — and nothing errored."""
    scene = _axes_scene(
        ProposedElement(type="axis", axis="x", label="x"),
        ProposedElement(type="axis", axis="y", label="y"),
        ProposedElement(type="axis", axis="z", label="z"))
    assert [getattr(e, "axis") for e in scene.elements if e.type == "axis"] == ["x", "y", "z"]


def test_an_axis_is_recognised_from_its_label_when_unstated():
    """The model reliably LABELS an axis even when it forgets to say `axis:`.
    Reading the label is what keeps a common omission from collapsing all three
    onto one line."""
    scene = _axes_scene(
        ProposedElement(type="axis", label="x"),
        ProposedElement(type="axis", label="$y$"),
        ProposedElement(type="axis", label="Z"))
    assert [getattr(e, "axis") for e in scene.elements if e.type == "axis"] == ["x", "y", "z"]


def test_an_axis_that_names_no_axis_at_all_is_refused():
    """Better to refuse with a message than to draw three axes on one line."""
    with pytest.raises(ComposeError, match="which axis"):
        _axes_scene(ProposedElement(type="axis", label="the horizontal one"))


def test_every_axis_gets_the_scene_s_extent_along_it():
    """All 192 axes in the corpus carry a `range`; none rely on a default. It
    cannot be known until every element has been measured, so it is backfilled."""
    scene = _axes_scene(
        ProposedElement(type="axis", axis="x"),
        ProposedElement(type="axis", axis="z"))
    ranges = {getattr(e, "axis"): getattr(e, "range") for e in scene.elements if e.type == "axis"}
    assert ranges["x"] == scene.range[0]
    assert ranges["z"] == scene.range[2]


def test_a_grid_lands_in_a_plane():
    """`plane` decides which way a grid faces; without it the renderer picks and
    the grid can end up edge-on."""
    scene = _axes_scene(ProposedElement(type="grid", plane="xz"),
                        ProposedElement(type="grid"))
    assert [getattr(e, "plane") for e in scene.elements if e.type == "grid"] == ["xz", "xy"]


def test_adding_two_vectors_in_place_is_refused_with_the_fix():
    """Observed live: the model wrote `2, 1, 0 + 0, 2, 0` for "the tip of r plus
    F". The count is not what it got wrong, so the message names the fix."""
    with pytest.raises(ComposeError, match="COMPONENT BY COMPONENT"):
        compose("T", "d",
                [ProposedElement(type="vector", step=0, from_pos="0,0,0",
                                 to_pos="2, 1, 0 + 0, 2, 0")],
                [ProposedStep(index=0, title="s")])


# ---- sliders -------------------------------------------------------------

def _sl(**kw):
    from backend.experts.modules.build_scene.proposed import ProposedSlider
    return ProposedSlider(**kw)


def test_a_slider_lands_on_the_step_that_introduces_it():
    """The schema hangs sliders off `step.sliders`, not off the scene — which is
    why the model's instinct to write `type: slider` was structurally wrong."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=1, from_pos="0,0,0", to_pos="ax,0,0")],
                    [ProposedStep(index=0, title="one"), ProposedStep(index=1, title="two")],
                    [_sl(step=1, id="ax", label="$a_x$", min=-3, max=3, default=2)])
    assert scene.steps[0].sliders is None
    assert [s.id for s in scene.steps[1].sliders] == ["ax"]



def test_an_id_that_is_not_a_variable_name_is_refused():
    """The id becomes a math.js identifier inside every coordinate naming it."""
    for bad in ("2x", "a-b", "", "a b"):
        with pytest.raises(ComposeError, match="variable name"):
            compose("T", "d", [], [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id=bad, min=0, max=1)])


def test_two_sliders_cannot_share_an_id():
    """A coordinate naming it could not say which one it meant."""
    with pytest.raises(ComposeError, match="share the id"):
        compose("T", "d", [], [ProposedStep(index=0, title="one")],
                [_sl(step=0, id="r", min=0, max=1), _sl(step=0, id="r", min=2, max=3)])


def test_a_slider_with_nowhere_to_travel_is_refused():
    with pytest.raises(ComposeError, match="nowhere to travel"):
        compose("T", "d", [], [ProposedStep(index=0, title="one")],
                [_sl(step=0, id="r", min=2, max=2)])


def test_a_default_outside_the_track_is_clamped_not_refused():
    """The reader fixes it in one drag; refusing the whole scene over it costs
    far more than it saves."""
    scene = compose("T", "d", [], [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="r", min=0, max=5, default=99)])
    assert scene.steps[0].sliders[0].default == 5


def test_a_slider_in_a_step_that_does_not_exist_is_refused():
    """Silently dropping it leaves every coordinate naming it unresolvable — a
    scene that renders with pieces missing and no error anywhere."""
    with pytest.raises(ComposeError, match="never runs"):
        compose("T", "d", [], [ProposedStep(index=0, title="one")],
                [_sl(step=4, id="r", min=0, max=1)])


def test_step_size_never_reaches_the_scene_as_zero():
    """A zero increment is a slider that cannot move."""
    scene = compose("T", "d", [], [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="r", min=0, max=5, step_size=0)])
    assert scene.steps[0].sliders[0].step == 0.1


def test_a_slider_driven_vector_is_promoted_to_an_animated_one():
    """Observed live: nine sliders, a full legend, and an EMPTY viewport.

    The renderer resolves `to` once at load with no sliders bound, so
    `to: ["a_x","a_y","a_z"]` on a plain `vector` draws nothing and reports
    nothing. Every slider-driven vector in the corpus is an `animated_vector`
    carrying `expr` — which shape to use is a representation detail, decided
    here rather than left to the model to remember.
    """
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, label="$\\vec{a}$",
                                     from_pos="0,0,0", to_pos="a_x, a_y, 0")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="a_x", min=-3, max=3, default=2),
                     _sl(step=0, id="a_y", min=-3, max=3, default=1)])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["type"] == "animated_vector"
    assert built["expr"] == ["a_x", "a_y", "0"]
    assert built["from"] == [0, 0, 0], "the static tail stays static"


def test_a_CONSTANT_EXPRESSION_is_promoted_like_any_other():
    """`3*sin(PI/4)` is a constant to a reader and an EXPRESSION to the schema.

    An earlier version of this test asserted the opposite, on the premise that
    such a value "resolves at load, so it renders as-is". That premise was never
    checked and does not hold: `vector.ts` hands `to` to `dataToWorld`, which
    does plain arithmetic — `(pos[0] - rx[0]) / …` — so a string component is
    NaN, constant or not.

    The rule is the field's definition, not the value's arithmetic character:
    `from`/`to`/`position` carry numbers, the `*Expr` family carries math.js.
    A model that writes a constant as a formula is also breaking a rule the
    prompt already states ("A coordinate that does not depend on a slider is a
    NUMBER"), but composing it into a field that cannot hold it is our bug, not
    its.
    """
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, label="v", from_pos="0,0,0",
                                     to_pos="0, 0, 3*sin(PI/4)")],
                    [ProposedStep(index=0, title="one")])
    body = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert body["type"] == "animated_vector"
    assert body["expr"] == ["0", "0", "3*sin(PI/4)"]
    assert "to" not in body


def test_a_type_that_cannot_move_says_so():
    """Better a message naming the element than a scene missing a piece.

    `axis` has neither an `animated_axis` twin nor an expression field of its
    own, so there is nowhere for the expression to go. Contrast `text`, which
    has `positionExpr` and therefore moves in place — see the test below.
    """
    with pytest.raises(ComposeError, match="no expression field"):
        compose("T", "d",
                [ProposedElement(type="axis", axis="x", step=0, position="r,0,0")],
                [ProposedStep(index=0, title="one")],
                [_sl(step=0, id="r", min=0, max=1)])



def test_a_tip_to_tail_vector_keeps_its_tail_and_head_apart():
    """The tip-to-tail `b` in a summation scene has BOTH ends slider-driven.

    The two ends go to DIFFERENT keys — the moving tail to `fromExpr`, the moving
    head to `expr` (see schemas/lesson.schema.json). Sending both to `expr` loses one of them silently —
    the vector then starts at the origin instead of at the tip of `a`, which
    renders as a plausible picture of the wrong thing.
    """
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, label="$\\vec{b}$",
                                     from_pos="a_x, a_y, 0",
                                     to_pos="a_x + b_x, a_y + b_y, 0")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="a_x", min=-3, max=3, default=2),
                     _sl(step=0, id="a_y", min=-3, max=3, default=1),
                     _sl(step=0, id="b_x", min=-3, max=3, default=1),
                     _sl(step=0, id="b_y", min=-3, max=3, default=2)])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["type"] == "animated_vector"
    assert built["fromExpr"] == ["a_x", "a_y", "0"]
    assert built["expr"] == ["a_x + b_x", "a_y + b_y", "0"]


# ---- curves --------------------------------------------------------------

def test_a_graph_is_one_curve():
    """Asked for a sine wave with no curve type, a model approximated one with
    FORTY-EIGHT `animated_line` segments — and none of them rendered."""
    scene = compose("Sine", "d",
                    [ProposedElement(type="animated_curve", step=0, label="wave",
                                     curve_expr="A*sin(k*x)", range="-2*pi, 2*pi")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="A", min=0.2, max=3, default=2),
                     _sl(step=0, id="k", min=0.5, max=4, default=1)])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["expr"] == "A*sin(k*x)", "ONE expression, not a triple"
    # The interval stays as WRITTEN, in the EXPRESSION field: math.js resolves
    # `-2*pi` in the browser, and only `rangeExpr` counts as an expression field.
    assert built["rangeExpr"] == ["-2*pi", "2*pi"] and "range" not in built
    assert built["plane"] == "xy" and built["samples"] > 1


def test_a_parametric_curve_names_its_axes_separately():
    """The two curve types differ and it matters: `animated_curve` takes one
    expression for y over x, `parametric_curve` takes x, y and z over t. Handing
    either the other's shape draws nothing."""
    scene = compose("Circle", "d",
                    [ProposedElement(type="parametric_curve", step=0, label="c",
                                     to_expr="cos(t), sin(t), 0", range="0, 2*pi")],
                    [ProposedStep(index=0, title="one")])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert (built["x"], built["y"], built["z"]) == ("cos(t)", "sin(t)", "0")
    assert "expr" not in built, "the generic triple must not also be left behind"



def test_a_curve_without_a_range_is_refused():
    with pytest.raises(ComposeError, match="needs `range`"):
        compose("T", "d", [ProposedElement(type="animated_curve", step=0,
                                           curve_expr="sin(x)")],
                [ProposedStep(index=0, title="one")])


def test_an_animated_curve_without_its_expression_is_refused():
    with pytest.raises(ComposeError, match="curve_expr"):
        compose("T", "d", [ProposedElement(type="animated_curve", step=0,
                                           range="0, 1")],
                [ProposedStep(index=0, title="one")])


def test_a_slider_driven_line_animates_through_points():
    """`renderAnimatedLine` reads `el.points` — expression TRIPLES — and returns
    null without them. Promoting a line the way a vector is promoted produced an
    element that drew nothing and said nothing."""
    scene = compose("T", "d",
                    [ProposedElement(type="line", step=0, label="l",
                                     from_pos="0,0,0", to_pos="w, 0, 0")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="w", min=0, max=5, default=3)])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["type"] == "animated_line"
    assert built["points"] == [["0", "0", "0"], ["w", "0", "0"]]
    assert "expr" not in built and "fromExpr" not in built


def test_a_line_with_one_moving_end_still_gets_both():
    """A line with ONE moving end is still a moving line. Building only the
    moving end leaves `points` with a single entry, and the renderer needs two."""
    scene = compose("T", "d",
                    [ProposedElement(type="line", step=0, label="l",
                                     from_pos="w, 0, 0", to_pos="4, 0, 0")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="w", min=0, max=5, default=3)])
    assert len(scene.steps[0].add[0].model_dump(exclude_none=True)["points"]) == 2



def test_a_slider_moves_to_the_step_that_first_needs_it():
    """A step's sliders come into existence WITH the step, so an element added at
    step 1 naming `A` — with `A` introduced at step 2 — cannot evaluate. An
    `animated_curve` that cannot evaluate renders NOTHING, silently.

    Observed exactly: `A*sin(k*x)` drawn at step 1 with `A` at step 2 and `k` at
    step 3, on an empty pair of axes.
    """
    scene = compose("Sine", "d",
                    [ProposedElement(type="animated_curve", step=1, label="wave",
                                     curve_expr="A*sin(k*x)", range="-2*pi, 2*pi")],
                    [ProposedStep(index=0, title="axes"), ProposedStep(index=1, title="wave"),
                     ProposedStep(index=2, title="amplitude"), ProposedStep(index=3, title="frequency")],
                    [_sl(step=2, id="A", min=0.2, max=3, default=1),
                     _sl(step=3, id="k", min=0.5, max=4, default=1)])
    at = {i: [x.id for x in (st.sliders or [])] for i, st in enumerate(scene.steps)}
    assert sorted(at[1]) == ["A", "k"], "both must exist by the step that draws the curve"
    assert not at[2] and not at[3], "and must not be defined twice"


def test_a_slider_introduced_before_its_use_is_left_alone():
    """Only pulled FORWARD. A control the reader meets before it matters is the
    model's staging choice, and there is nothing broken about it."""
    scene = compose("T", "d",
                    [ProposedElement(type="animated_curve", step=2, label="w",
                                     curve_expr="A*sin(x)", range="0, 6")],
                    [ProposedStep(index=0, title="a"), ProposedStep(index=1, title="b"),
                     ProposedStep(index=2, title="c")],
                    [_sl(step=0, id="A", min=0.2, max=3, default=1)])
    assert [x.id for x in (scene.steps[0].sliders or [])] == ["A"]


def test_a_scene_level_element_needs_its_sliders_from_the_start():
    """It is on screen before any step runs."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=-1, label="v",
                                     from_pos="0,0,0", to_pos="w,0,0")],
                    [ProposedStep(index=0, title="a"), ProposedStep(index=1, title="b")],
                    [_sl(step=1, id="w", min=0, max=5, default=3)])
    assert [x.id for x in (scene.steps[0].sliders or [])] == ["w"]


# ---- curves are described, not plotted -----------------------------------

# ---- straight pieces, and how many of them ------------------------------
#
# There is no cap. There was one — first on the COUNT of `line`/`animated_line`
# in a step, then on the longest chain of them — and it was removed because it
# could never do the job it claimed. A square wave IS piecewise linear and
# belongs in `points`; a sine wave traced the same way is the bug. The two are
# structurally identical, so no structural rule separates them: the corpus ships
# `square-wave` at 8 vertices and `dp-arc` at 9, both deliberate.
#
# The count version also refused four hand-authored scenes outright
# (`photons-wavelength-energy` draws 15 lines in one step) and, live, a DNA
# ladder whose nine rungs are exactly what a `line` is for.
#
# The pathology it existed for — 48 `animated_line` segments approximating one
# sine wave — happened when the builder had NO CURVE TYPE. `animated_curve` and
# `parametric_curve` were added because of it, which is the actual fix; the
# prompt carries the rest. Asked live to "draw a sine wave by chaining 20 short
# straight segments", the model refused and used `animated_curve`.


def test_a_ladder_of_disjoint_rungs_composes():
    """Nine rungs between two helices. Each is a real straight thing, and the
    `parametric_curve` the old refusal prescribed cannot draw them: one curve is
    one connected path, so it gives you either strand and never the ladder."""
    rungs = [ProposedElement(type="line", step=0, label=f"bp{i}",
                             from_pos=f"cos({i}), sin({i}), {i}",
                             to_pos=f"-cos({i}), -sin({i}), {i}")
             for i in range(9)]
    scene = compose("T", "d", rungs, [ProposedStep(index=0, title="one")])
    assert len(scene.steps[0].add) == 9


def test_many_lines_in_one_step_compose():
    """`photons-wavelength-energy` draws 15 in a single step, hand-authored and
    shipping. The count rule would have refused it."""
    ticks = [ProposedElement(type="line", step=0, label=f"t{i}",
                             from_pos=f"{i}, 0, 0", to_pos=f"{i}, 0.3, 0")
             for i in range(15)]
    scene = compose("T", "d", ticks, [ProposedStep(index=0, title="one")])
    assert len(scene.steps[0].add) == 15


def test_a_genuinely_piecewise_shape_composes():
    """A square wave. Its corners are REAL — this is what `points` is for, and
    the chain rule would have called it a sampled curve."""
    wave = ProposedElement(
        type="line", step=0, label="square wave",
        points="0,0,0; 0,1,0; 1,1,0; 1,-1,0; 2,-1,0; 2,1,0; 3,1,0; 3,0,0")
    scene = compose("T", "d", [wave], [ProposedStep(index=0, title="one")])
    assert len(scene.steps[0].add[0].points) == 8


def test_a_slider_id_with_stray_whitespace_still_drives_its_element():
    """`_sliders` is the one place that normalises an id. Reading the RAW id for
    the resting values meant normalising in two places and disagreeing: a model
    writing `id: ax ` got a slider called `ax` and a resting key of `ax `, so
    nothing matched — the vector was never promoted and the frame collapsed to
    the default extent. One trailing space, and the scene rendered nothing.
    """
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="ax,0,0")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="ax ", min=0, max=5, default=3)])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["type"] == "animated_vector"
    assert built["expr"] == ["ax", "0", "0"]



# ---- a coordinate may contain commas of its own --------------------------

def test_a_function_call_inside_a_coordinate_is_not_three_coordinates():
    """Observed live, on a dot-product scene that was CORRECT and thrown away:

        (ax/hypot(ax,ay,az) + bx/hypot(bx,by,bz)) * 0.5, (ay/…) * 0.5, (az/…) * 0.5

    Splitting naively on `,` made that nine parts, refused the scene, and offered
    advice about adding vectors component by component that had nothing to do
    with it. `hypot(ax, ay, az)` is ONE value.
    """
    from backend.experts.handlers.build_scene.compose import _coord

    parts = _coord("(ax/hypot(ax,ay,az) + bx/hypot(bx,by,bz)) * 0.5, "
                   "(ay/hypot(ax,ay,az) + by/hypot(bx,by,bz)) * 0.5, "
                   "(az/hypot(ax,ay,az) + bz/hypot(bx,by,bz)) * 0.5", "text")
    assert len(parts) == 3
    assert parts[0] == "(ax/hypot(ax,ay,az) + bx/hypot(bx,by,bz)) * 0.5"


def test_nesting_and_bracket_kinds_are_all_respected():
    from backend.experts.handlers.build_scene.compose import _split_top_level

    assert _split_top_level("max(1, min(2, 3)), b, c", "w") == ["max(1, min(2, 3))", "b", "c"]
    assert _split_top_level("v[0, 1], y, z", "w") == ["v[0, 1]", "y", "z"]
    assert _split_top_level("1, 2, 0", "w") == ["1", "2", "0"]


def test_the_vector_addition_mistake_is_still_caught():
    """The fix must not swallow the error it was sitting next to: `2, 1, 0 + 0,
    2, 0` has no brackets, so it still splits long and still gets the hint."""
    with pytest.raises(ComposeError, match="COMPONENT BY COMPONENT"):
        compose("T", "d",
                [ProposedElement(type="vector", step=0, from_pos="0,0,0",
                                 to_pos="2, 1, 0 + 0, 2, 0")],
                [ProposedStep(index=0, title="one")])


def test_a_curve_range_may_call_a_function_too():
    """`range` had the same naive split: `0, max(a,b)` is two values."""
    scene = compose("T", "d",
                    [ProposedElement(type="animated_curve", step=0,
                                     curve_expr="sin(x)", range="0, max(3, 6)")],
                    [ProposedStep(index=0, title="one")])
    assert scene.steps[0].add[0].model_dump(exclude_none=True)["rangeExpr"] == ["0", "max(3, 6)"]


def test_unbalanced_brackets_are_refused_not_papered_over():
    """Clamping the depth at zero reads the text as if the stray bracket were not
    there — which turns malformed math.js into a coordinate that composes cleanly
    and then fails at render, silently. Refusing names the problem instead."""
    from backend.experts.handlers.build_scene.compose import _split_top_level

    for bad in ("a), b, c", "cos(t, sin(t), 0", "((1, 2, 3)"):
        with pytest.raises(ComposeError, match="unbalanced brackets"):
            _split_top_level(bad, "vector 'v'")

    # The one a final depth check alone would MISS: the brackets cancel, so the
    # count ends at zero, but a comma fell inside the phantom group and never
    # split. Without the running check this reads as two coordinates and is
    # refused for the wrong reason.
    with pytest.raises(ComposeError, match="nothing open before it"):
        _split_top_level("a), (b, c", "vector 'v'")


def test_brackets_must_match_in_KIND_not_merely_in_count():
    """`([)]` and `(]` balance numerically and are still malformed math.js.
    Counting alone lets them through — and the whole reason this refuses at all
    is to stop text that composes cleanly and then fails at render."""
    from backend.experts.handlers.build_scene.compose import _split_top_level

    for bad in ("([)], y, z", "(a], b, c", "[1, 2), 3"):
        with pytest.raises(ComposeError, match="mismatched brackets"):
            _split_top_level(bad, "vector 'v'")

    # And every legitimate mix still splits.
    assert _split_top_level("max(v[0], 1), y, z", "w") == ["max(v[0], 1)", "y", "z"]


def test_a_refusal_names_the_FIELD_not_just_the_element():
    """All three coordinate fields used to share one `where`, so a refusal read
    `text '$\\theta$': expected three coordinates` and left the reader to work out
    which of `position`, `from_pos` or `to_pos` it meant — by elimination, if they
    happened to know a `text` has no endpoints. It names the field the MODEL
    wrote, not the schema's (`from_pos`, not `from`), because that is the name in
    the answer being corrected.
    """
    with pytest.raises(ComposeError, match=r"position: expected three"):
        compose("T", "d", [ProposedElement(type="text", step=0, label="t", position="1, 2")],
                [ProposedStep(index=0, title="one")])

    with pytest.raises(ComposeError, match=r"to_pos: expected three"):
        compose("T", "d", [ProposedElement(type="vector", step=0, label="v",
                                           from_pos="0,0,0", to_pos="1, 2")],
                [ProposedStep(index=0, title="one")])

    with pytest.raises(ComposeError, match=r"range: a curve needs"):
        compose("T", "d", [ProposedElement(type="animated_curve", step=0, curve_expr="sin(x)")],
                [ProposedStep(index=0, title="one")])


def test_a_refusal_shows_the_label_as_the_author_wrote_it():
    r"""`!r` escapes the backslash, so a label that IS `$\theta$` was reported as
    `$\\theta$` — doubling, in a module whose entire thesis is that
    backslash-doubling is the silent corruption to avoid. It also makes the label
    unrecognisable to whoever is trying to find the element it names.
    """
    with pytest.raises(ComposeError) as e:
        compose("T", "d", [ProposedElement(type="text", step=0, label=r"$\theta$",
                                           position="1, 2")],
                [ProposedStep(index=0, title="one")])
    assert r"$\theta$" in str(e.value)
    assert r"$\\theta$" not in str(e.value)


def test_the_latex_refusal_does_not_double_the_thing_it_is_contrasting():
    r"""This message says "write cos(theta), not \cos(\theta)" — with `!r` the
    quoted offender came out as `'\\cos(\\theta)'` while the advice beside it
    showed single backslashes, so the contrast the message exists to draw was
    between two things that looked different for the wrong reason."""
    with pytest.raises(ComposeError) as e:
        compose("T", "d", [ProposedElement(type="text", step=0, label="t",
                                           position=r"\cos(\theta), 0, 0")],
                [ProposedStep(index=0, title="one")])
    assert r"`\cos(\theta)`" in str(e.value), "fenced as code, so markdown leaves it alone"
    assert "\\\\cos" not in str(e.value)


# ---- compose never evaluates math.js -------------------------------------

def test_compose_does_not_evaluate_expressions_at_all():
    r"""The invariant, stated once so it cannot creep back.

    A scene's expressions are math.js — plus this project's own extensions — and
    they are executed in exactly ONE place: the browser, by math.js. An earlier
    revision evaluated them here with `safe_eval_math`, a PYTHON ast parser. That
    is one language read through another language's grammar, and it works only
    where the two happen to agree; where they do not, the failure is silent and
    total. `x^2` is exponentiation in math.js and XOR in Python, so a parabola
    composed with NO `range` and NO `camera`. Ternaries, factorials and
    element-wise operators diverge the same way.

    Every one of these is a valid math.js coordinate and none of them may
    contribute a number to the frame — not even the ones Python could parse.
    """
    # Every component an expression, so a literal cannot account for the frame.
    # `3*sin(PI/4)` and `hypot(1,2,2)` are the ones Python COULD have evaluated —
    # they are here precisely because "it happens to parse" is not a reason to.
    for coord in ("x^2, x^2, x^2", "3*sin(PI/4), 3*sin(PI/4), 3*sin(PI/4)",
                  "a ? 1 : 2, a ? 1 : 2, a ? 1 : 2",
                  "hypot(1,2,2), hypot(1,2,2), hypot(1,2,2)", "2*pi, 2*pi, 2*pi"):
        scene = compose("T", "d",
                        [ProposedElement(type="point", step=0, label="p", position=coord)],
                        [ProposedStep(index=0, title="one")])
        assert scene.range is None, f"{coord!r} was evaluated to frame the scene"
        assert scene.camera is None


def test_the_module_does_not_import_a_python_evaluator():
    """Guarding the boundary, not just the behaviour: the moment something in
    here imports an evaluator again, the same class of bug is one call away."""
    import pathlib

    source = (pathlib.Path(__file__).resolve().parent.parent
              / "backend" / "experts" / "handlers" / "build_scene" / "compose.py").read_text()
    for banned in ("safe_eval_math", "eval_math_sweep", "ast.parse", "eval("):
        assert f"import {banned}" not in source and f"{banned}(" not in source, (
            f"compose.py evaluates math.js in Python again, via {banned}")


def test_literal_coordinates_still_frame_the_scene():
    """The other half: framing was never the problem, evaluating was. Numbers
    are numbers and need no evaluator to be measured."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, label="v",
                                     from_pos="0,0,0", to_pos="3, 4, 0")],
                    [ProposedStep(index=0, title="one")])
    assert scene.range[0] == [-0.5, 3.5]
    assert scene.camera is not None


def test_a_slider_reference_is_found_INSIDE_nested_coordinates():
    """`points` holds `[["ax","ay","0"], …]` — math.js one level down.

    An `animated_line` is driven entirely by `points`, so missing this would
    leave its sliders unmoved and the line unresolvable. `is_expression_key` says
    no to `points` (correctly — it is not what trust.js scans), which is why
    `carries_expressions` exists as a separate question.
    """
    from backend.experts.handlers.build_scene.compose import _references
    from backend.model.lesson import Element

    line = Element.model_validate({"type": "animated_line", "id": "s0-l",
                                   "points": [["0", "0", "0"], ["ax", "ay", "0"]]})
    assert _references(line, {"ax", "ay", "zz"}) == {"ax", "ay"}


def test_an_unknown_field_is_not_scanned_at_all():
    """The allowlist's whole point. `Element` is `extra="allow"`, so anything can
    ride through — and most of what does is prose. Of the 86 properties
    `$defs.element` declares, 16 carry expressions and 70 do not.
    """
    from backend.experts.handlers.build_scene.compose import _references
    from backend.model.lesson import Element

    el = Element.model_validate({"type": "point", "id": "p", "position": [0, 0, 0],
                                 "legendGroup": "the a vector", "cssClass": "a-b-c"})
    assert _references(el, {"a", "b", "c"}) == set()


# ---- reasons are rendered as markdown, so they must survive it ------------

def test_a_refused_expression_survives_markdown_rendering():
    r"""Observed live. A `parametric_curve` range containing `sa_x*sb_x` was
    reported to the reader as `sa_xsb_x` — the chat renders the reason as
    markdown, and the `*` pairs were eaten as emphasis. The refusal was CORRECT
    (8 opening brackets, 9 closing) but read as nonsense, which is worse than a
    wrong refusal: it makes a right answer untrustworthy.

    Model-authored text is therefore quoted as CODE. Asterisks and underscores
    are what a math.js expression is made of, and both are markdown syntax.
    """
    bad = "0, acos(max(-1, min(1, ((sa_x*sb_x + sa_y*sb_y) / (sqrt(sa_x*sa_x) + 1e-9))))))"
    with pytest.raises(ComposeError) as e:
        compose("T", "d", [ProposedElement(type="animated_curve", step=0,
                                           curve_expr="sin(x)", range=bad)],
                [ProposedStep(index=0, title="one")])
    assert f"`{bad}`" in str(e.value), "the offender must be fenced as code"
    assert "'" + bad + "'" not in str(e.value), "plain quotes let markdown eat it"

    # The COORDINATE path too, which is where the reader meets this most often.
    coord = "sa_x*sb_x, sa_y*sb_y"
    with pytest.raises(ComposeError) as e2:
        compose("T", "d", [ProposedElement(type="vector", step=0, label="v",
                                           from_pos="0,0,0", to_pos=coord)],
                [ProposedStep(index=0, title="one")])
    assert f"`{coord}`" in str(e2.value)
    assert "'" + coord + "'" not in str(e2.value)


def test_an_unlabelled_element_says_where_it_is():
    """`parametric_curve '(unlabelled)'` identified nothing — and the fallback
    that replaced it must not simply repeat the type either."""
    with pytest.raises(ComposeError, match=r"vector in step 0 to_pos"):
        compose("T", "d", [ProposedElement(type="vector", step=0,
                                           from_pos="0,0,0", to_pos="1, 2")],
                [ProposedStep(index=0, title="one")])
    with pytest.raises(ComposeError, match=r"scene-level vector to_pos"):
        compose("T", "d", [ProposedElement(type="vector", step=-1,
                                           from_pos="0,0,0", to_pos="1, 2")],
                [ProposedStep(index=0, title="one")])


def test_a_label_is_fenced_because_KaTeX_is_markdown_hostile():
    r"""A label is KaTeX — `$\vec{a}$`, `$a_x$` — and underscores are emphasis."""
    with pytest.raises(ComposeError) as e:
        compose("T", "d", [ProposedElement(type="vector", step=0, label=r"$a_x$",
                                           from_pos="0,0,0", to_pos="1, 2")],
                [ProposedStep(index=0, title="one")])
    assert r"`$a_x$`" in str(e.value)


# ---- a constant is never confused with an expression ---------------------

def test_a_literal_coordinate_field_NEVER_holds_an_expression():
    r"""The rule, stated once: `from`/`to`/`position` carry CONSTANTS, and the
    `*Expr` family carries math.js — schemas/lesson.schema.json.

    `$defs.vec3` would permit a string in a literal field (`items: oneOf
    [number, string]`), but only some renderers honour that: `text.ts` falls back
    to reading `position` as expressions, `vector.ts` passes `to` straight into
    `makeArrowMesh` and into `(from[0] + to[0]) / 2`, so a string there is NaN and
    the element renders nothing. 0 of the corpus's 1088 coordinates mix the two.

    An earlier rule promoted only coordinates naming a SLIDER, so `2*pi, 0, 0`
    — an expression referencing nothing — stayed static and silently failed.
    """
    scene = compose("T", "d", [
        ProposedElement(type="vector", step=0, label="a", from_pos="0,0,0", to_pos="2*pi, 0, 0"),
        ProposedElement(type="vector", step=0, label="b", from_pos="0,0,0", to_pos="ax, ay, 0"),
        ProposedElement(type="point",  step=0, label="p", position="cos(t), 0, 0"),
        ProposedElement(type="line",   step=0, label="l", from_pos="0,0,0", to_pos="w, 0, 0"),
        ProposedElement(type="vector", step=0, label="c", from_pos="0,0,0", to_pos="1, 2, 3"),
    ], [ProposedStep(index=0, title="one")],
       [_sl(step=0, id="ax", min=0, max=3, default=1),
        _sl(step=0, id="ay", min=0, max=3, default=1),
        _sl(step=0, id="w", min=0, max=3, default=1)])

    for el in scene.steps[0].add:
        body = el.model_dump(by_alias=True, exclude_none=True)
        for field in ("from", "to", "position"):
            for part in body.get(field, []):
                assert not isinstance(part, str), (
                    f"{body['type']}.{field} holds the expression {part!r} — "
                    f"a literal field must never carry one")
        # And an element that HAS an expression must be an animated type, or the
        # renderer will not evaluate it.
        if any(k in body for k in ("expr", "fromExpr", "points")):
            assert body["type"].startswith("animated_"), body["type"]


def test_a_constant_is_never_promoted_into_an_expression_field():
    """The other direction. A number is a number: moving `3` into `expr` would
    make a still element animated for no reason and drop it out of `to`."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, label="v",
                                     from_pos="0,0,0", to_pos="1, 2, 3")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="ax", min=0, max=3, default=1)])
    body = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert body["type"] == "vector"
    assert body["to"] == [1, 2, 3] and "expr" not in body


def test_prose_is_not_read_as_a_slider_reference():
    r"""Scanning every string field read English as code.

    A point at `[0, 0, 0]` "referenced" a slider named `a` because its prompt
    said *"What does a represent here?"*, and every axis "referenced" one named
    `x` through its own `axis: "x"`. Both then dragged the slider forward to a
    step nothing on it actually uses — and `x`, `a`, `t` are exactly the names
    sliders get.
    """
    from backend.experts.handlers.build_scene.compose import _references
    from backend.model.lesson import Element

    axis = Element.model_validate({"type": "axis", "id": "scene-x", "axis": "x",
                                   "label": "x", "prompt": "What does the x-axis show?"})
    assert _references(axis, {"x", "y"}) == set()

    point = Element.model_validate({"type": "point", "id": "s0-a", "label": r"$\vec{a}$",
                                    "prompt": "What does a represent here?",
                                    "position": [0, 0, 0]})
    assert _references(point, {"a", "vec"}) == set()


def test_a_real_reference_is_still_found_including_in_an_unknown_field():
    """The denylist must not become an allowlist by accident: anything not named
    as metadata is still scanned, so a new expression-bearing field is covered
    the day it appears rather than the day someone remembers to list it."""
    from backend.experts.handlers.build_scene.compose import _references
    from backend.model.lesson import Element

    moving = Element.model_validate({"type": "animated_vector", "id": "s0-v", "label": "v",
                                     "from": [0, 0, 0], "expr": ["ax", "ay", "0"]})
    assert _references(moving, {"ax", "ay", "zz"}) == {"ax", "ay"}

    future = Element.model_validate({"type": "point", "id": "p", "someNewExpr": ["w*2"]})
    assert _references(future, {"w"}) == {"w"}


def test_a_text_moves_in_place_because_it_has_its_own_expression_field():
    """There is no `animated_text`, and refusing one was a regression I
    introduced: `src/objects/text.ts` does `el.positionExpr ||
    el.position.map(String)` and compiles either, and the corpus has
    expression-positioned `text` elements that render fine.

    So the question is not "does an animated twin exist" but "is there anywhere
    for the expression to go" — and for `text` there is.
    """
    scene = compose("T", "d", [
        ProposedElement(type="text", step=0, label="moving", position="2*pi, 0, 0"),
        ProposedElement(type="text", step=0, label="still", position="1, 2, 0"),
    ], [ProposedStep(index=0, title="one")])
    moving, still = (e.model_dump(by_alias=True, exclude_none=True) for e in scene.steps[0].add)
    assert moving["type"] == "text" and moving["positionExpr"] == ["2*pi", "0", "0"]
    assert "position" not in moving, "a literal field must not also hold it"
    assert still["type"] == "text" and still["position"] == [1, 2, 0]


def test_a_slider_named_in_a_curve_RANGE_is_pulled_forward_too():
    """The sine-wave bug again, through a different field.

    A curve at step 1 with `range: [0, "T"]` and `T` introduced at step 2 cannot
    resolve its own interval and draws nothing. `range` is a literal field to
    `static/trust.js` — `rangeExpr` is its expression variant — so an interval
    left in `range` was invisible to `_references` and never pulled the slider
    forward. Same rule as a coordinate: numbers to the literal field,
    expressions to the `*Expr` one.
    """
    scene = compose("T", "d",
                    [ProposedElement(type="animated_curve", step=1, label="wave",
                                     curve_expr="sin(x)", range="0, T")],
                    [ProposedStep(index=0, title="axes"), ProposedStep(index=1, title="wave"),
                     ProposedStep(index=2, title="period")],
                    [_sl(step=2, id="T", min=1, max=10, default=6)])
    assert [s.id for s in (scene.steps[1].sliders or [])] == ["T"], \
        "the slider must exist by the step that draws the curve"
    built = scene.steps[1].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["rangeExpr"] == ["0", "T"] and "range" not in built


def test_a_numeric_interval_stays_in_the_literal_field():
    scene = compose("T", "d",
                    [ProposedElement(type="animated_curve", step=0, curve_expr="sin(x)",
                                     range="0, 6.28")],
                    [ProposedStep(index=0, title="one")])
    built = scene.steps[0].add[0].model_dump(by_alias=True, exclude_none=True)
    assert built["range"] == [0, 6.28] and "rangeExpr" not in built


# ---- scene functions -----------------------------------------------------
#
# The place to state a derivation ONCE. Every rule below is one the RENDERER
# already applies and applies silently: `setActiveSceneFunctions` drops a bad
# entry with a `console.warn`, or compiles a bad body to `0`. Refusing here is
# what turns those into something the model is re-asked with.

def _fn(**kw) -> ProposedFunction:
    return ProposedFunction(**kw)


def _sliders(*ids) -> list:
    return [_sl(step=0, id=i, min=-5, max=5) for i in ids]


def _with_fns(fns, elements=None, sliders=None):
    els = elements or [ProposedElement(type="line", step=0,
                                       from_pos="0,0,0", to_pos="1,0,0")]
    return compose("T", "d", els, [ProposedStep(index=0, title="one")],
                   sliders, fns)


def test_a_function_is_declared_once_and_called_from_elements():
    """The dot-product case. The projection scalar appeared in a vector's x, its
    y, and both ends of a line — four copies of one idea, wrong in all four."""
    scene = _with_fns(
        [_fn(name="projK", expr="(ax*bx + ay*by) / (ax*ax + ay*ay)")],
        elements=[ProposedElement(type="vector", step=0, from_pos="0,0,0",
                                  to_pos="projK()*ax, projK()*ay, 0")],
        sliders=_sliders("ax", "ay", "bx", "by"))
    # `Scene` does not DECLARE `functions` — it is `extra="allow"`, so the entry
    # rides through as a plain dict. That predates this change and the emitted
    # JSON is the same either way.
    assert scene.functions[0]["name"] == "projK"
    assert scene.functions[0]["expr"] == "(ax*bx + ay*by) / (ax*ax + ay*ay)"


def test_arguments_are_parsed_from_the_flat_string():
    """`args` is a STRING because LineAdapter is one level deep — `v, rn`, not a
    list. compose splits it, exactly as it splits a coordinate."""
    scene = _with_fns([_fn(name="heatingRate", args="v, rn", expr="v^3 / sqrt(rn)")])
    assert scene.functions[0]["args"] == ["v", "rn"]


def test_no_arguments_leaves_args_off_entirely():
    """A function with none still sees every slider, which is how the corpus
    mostly uses them. Emitting `args: []` would be noise in the JSON."""
    scene = _with_fns([_fn(name="k", expr="2 * pi")])
    assert "args" not in scene.functions[0]


def test_a_name_a_slider_already_uses_is_refused():
    """`_buildScope` writes sliders into the scope AFTER scene functions, so the
    slider wins and the function is never reachable. Silent, and hard to spot
    precisely because the name still resolves."""
    with pytest.raises(ComposeError, match="slider is already called"):
        _with_fns([_fn(name="ax", expr="1")], sliders=_sliders("ax"))


def test_a_mathjs_name_is_refused():
    """`setActiveSceneFunctions` skips a reserved name with a console.warn, so
    every call would silently mean math.js's own `max`."""
    with pytest.raises(ComposeError, match="already a math.js function"):
        _with_fns([_fn(name="max", expr="1")])
    with pytest.raises(ComposeError, match="already a math.js function"):
        _with_fns([_fn(name="toFixed", expr="1")]), "project extensions count too"


def test_a_duplicate_name_is_refused():
    """The renderer keeps the first and warns. Two definitions of one name means
    the model believed both, and only one of them is true."""
    with pytest.raises(ComposeError, match="defined twice"):
        _with_fns([_fn(name="k", expr="1"), _fn(name="k", expr="2")])


def test_a_name_that_is_not_an_identifier_is_refused():
    with pytest.raises(ComposeError, match="must be a math.js identifier"):
        _with_fns([_fn(name="proj-k", expr="1")])
    with pytest.raises(ComposeError, match="must be a math.js identifier"):
        _with_fns([_fn(name="2k", expr="1")])


def test_a_body_that_is_javascript_is_refused():
    """STRICTER than the renderer on purpose. It accepts a JS body when the
    reader has granted trust — `gradient-descent-terrain` ships a `let`/`for`
    IIFE — but a scene the builder authors must render for a reader who granted
    nothing, and an untrusted JS body compiles to `0`: every call returns 0 and
    the scene draws confident, wrong geometry."""
    # `||` and `&&` sit beside `===` for the same reason: math.js has none of
    # them, none is in `_JS_ONLY_RE`, and all three end as a silent `0`. Watched
    # live — given `functions`, the builder learned `==` and still wrote
    # `(mag_a(..) == 0 || mag_b(..) == 0) ? 0 : ..`.
    for body in ("(()=>{let x=1; return x;})()", "Math.max(a, b)",
                 "a === 0 ? 0 : 1", "a == 0 || b == 0", "a > 0 && b > 0", "${x}",
                 # METHOD CALLS and BRACKET ACCESS, both of which `_JS_ONLY_RE`
                 # already treats as JS — so they slipped compose and compiled to
                 # `0` in the browser. Observed: a live answer wrote
                 # `{dotProduct().toFixed(2)}`.
                 "x.toFixed(2)", "a.constructor(1)", "o['constructor']"):
        with pytest.raises(ComposeError, match="JavaScript, not math.js"):
            _with_fns([_fn(name="k", expr=body)])


def test_the_bare_extension_call_is_still_allowed():
    """The leading dot is the whole test. `toFixed` is one of this project's own
    math.js extensions, so `toFixed(x, 2)` is legal and must stay legal — only
    `.toFixed(`, the JS method on a value, is not."""
    scene = _with_fns([_fn(name="k", args="x", expr="toFixed(x, 2)")])
    assert scene.functions[0]["expr"] == "toFixed(x, 2)"


def test_a_decimal_is_not_mistaken_for_a_method_call():
    """`\.[A-Za-z_]` and not `\.\w`: `0.5*sin(x)` has a dot followed by a digit,
    and reading that as property access would refuse ordinary arithmetic."""
    scene = _with_fns([_fn(name="k", args="x", expr="0.5 * sin(x) + 1.25")])
    assert scene.functions[0]["expr"] == "0.5 * sin(x) + 1.25"


def test_the_mathjs_ternary_is_still_allowed():
    """The fix the refusal PRESCRIBES has to work. math.js has `a ? b : c`; only
    the `===` inside it was ever the problem."""
    scene = _with_fns([_fn(name="k", args="a", expr="a == 0 ? 0 : 1 / a")])
    assert scene.functions[0]["expr"] == "a == 0 ? 0 : 1 / a"
    # And the spelling the message prescribes for the other two.
    ok = _with_fns([_fn(name="k", args="a, b", expr="a == 0 or b == 0 ? 0 : 1")])
    assert ok.functions[0]["expr"] == "a == 0 or b == 0 ? 0 : 1"


def test_a_latex_body_is_refused_like_any_coordinate():
    with pytest.raises(ComposeError):
        _with_fns([_fn(name="k", expr=r"\frac{1}{2}")])


def test_a_body_that_is_missing_is_refused():
    with pytest.raises(ComposeError, match="needs `expr`"):
        _with_fns([_fn(name="k", expr="")])


def test_a_bad_argument_name_is_refused():
    with pytest.raises(ComposeError, match="not a valid argument name"):
        _with_fns([_fn(name="k", args="v, 2n", expr="v")])
    with pytest.raises(ComposeError, match="listed twice"):
        _with_fns([_fn(name="k", args="v, v", expr="v")])


def test_too_many_functions_is_refused_not_truncated():
    """The proposal used to be sliced to the cap in `propose_scene`. Elements call
    a function BY NAME, so dropping the tail leaves those calls unresolvable —
    and math.js only reports that at EVALUATION time, in the browser, where the
    renderer swallows it. A scene that draws wrong geometry and says nothing is
    the worst of the available outcomes; refusing is the best."""
    many = [_fn(name=f"f{i}", expr="1") for i in range(MAX_FUNCTIONS + 1)]
    with pytest.raises(ComposeError, match="more than the"):
        _with_fns(many)


def test_the_cap_itself_composes():
    """Off-by-one guard: the refusal must start ABOVE the cap, not at it."""
    at_cap = [_fn(name=f"f{i}", expr="1") for i in range(MAX_FUNCTIONS)]
    assert len(_with_fns(at_cap).functions) == MAX_FUNCTIONS


def test_a_function_may_call_one_declared_later():
    """`setActiveSceneFunctions` reserves every name before compiling any body,
    so order carries no meaning — and the field description now says so. A
    composer that quietly required declaration order would contradict it."""
    scene = _with_fns([_fn(name="outer", args="x", expr="inner(x) * 2"),
                       _fn(name="inner", args="x", expr="x + 1")])
    assert [f["name"] for f in scene.functions] == ["outer", "inner"]


def test_no_functions_leaves_the_key_off():
    """41 of 84 corpus scenes carry no `functions`, and an empty list would be a
    new key in every scene the builder writes."""
    scene = _with_fns(None)
    assert "functions" not in scene.model_dump(exclude_none=True)


def test_an_entirely_blank_entry_is_skipped_not_refused():
    """A model that emits the block template unfilled has proposed nothing, and
    refusing the whole scene over an empty stanza costs the reader the other
    eleven elements that were right."""
    scene = _with_fns([_fn(name="", expr=""), _fn(name="k", expr="1")])
    assert [f["name"] for f in scene.functions] == ["k"]
