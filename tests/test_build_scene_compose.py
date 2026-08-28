"""Proposal -> canonical Scene. Deterministic, so all of it is testable now."""
from __future__ import annotations

import json
import pathlib

import pytest

from backend.experts.handlers.build_scene.compose import ComposeError, compose
from backend.experts.modules.build_scene.proposed import ProposedElement, ProposedStep
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
    assert scene.elements[0].position[0] == expr


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
        "[[ ## elements ## ]]\nstep: 0\ntype: vector\nfrom_pos: 0, 0, 0\nto_pos: ax, 0, 0\n\n"
        "[[ ## completed ## ]]\n")

    out = LineAdapter().parse(BuildSceneSig, completion)
    scene = compose(out["title"], out["description"], out["elements"], out["steps"],
                    out["sliders"])
    # PROMOTED: a slider-driven `to_pos` becomes an `animated_vector` carrying
    # `expr`, because the renderer resolves `to` once at load with no sliders
    # bound and would draw nothing at all.
    built = scene.steps[0].add[0]
    assert built.type == "animated_vector"
    assert built.from_ == [0, 0, 0]
    assert built.model_dump(exclude_none=True)["expr"] == ["ax", "0", "0"]
    assert scene.steps[0].sliders[0].id == "ax"
    assert scene.steps[0].sliders[0].label == "$a_x$"
    # And the frame is computed at the slider's RESTING value, so the vector is
    # in shot the moment the reader arrives.
    assert scene.range[0][1] >= 2


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
    """Note the schema's asymmetry, which the proposal hides: the animated TAIL
    is `fromExpr`, but the animated HEAD is `expr` — not `toExpr`."""
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

def test_a_constant_expression_coordinate_is_measured_not_skipped():
    """Observed live: a torque scene put $\\tau$ at z = `3*sin(PI/4)` while every
    other coordinate was numeric and small. Skipping the expression gave a z
    range of [-1, 1] and the vector the scene existed to show was drawn OUTSIDE
    the frame — no error, no warning, just a scene that looked broken.
    """
    from backend.experts.handlers.build_scene.compose import _measure

    assert _measure("3*sin(PI/4)") == pytest.approx(2.1213, abs=1e-3)
    assert _measure("3 + cos(pi/4)") == pytest.approx(3.7071, abs=1e-3)
    assert _measure(2) == 2.0


def test_a_slider_dependent_coordinate_still_has_no_value():
    """The original rule, and it stands: `Rp+h` has no value until the sliders
    exist, and inventing one frames the scene around a number nobody chose."""
    from backend.experts.handlers.build_scene.compose import _measure

    assert _measure("Rp+h") is None
    assert _measure("cos(theta)") is None


def test_a_caret_is_refused_rather_than_mis_evaluated(monkeypatch):
    """`^` is exponentiation in math.js and XOR in Python: `2^3` would come back
    as 1, not 8. A wrong number is worse than none — it silently reframes the
    scene, and nothing downstream can tell.

    `safe_eval_math` happens to refuse `^` today ("Disallowed operation: BitXor"),
    so our own guard is defence in depth — which is the point: the caret rule is
    OURS and must not depend on someone else's allowlist staying as it is. The
    stub below is that allowlist changing.
    """
    from backend.experts.handlers.build_scene import compose as c

    monkeypatch.setattr(c, "safe_eval_math", lambda expr, _vars: (eval(expr), None))
    assert c._measure("2^3") is None, "a caret must never reach a Python evaluator"
    assert c._measure("2*3") == 6.0, "and nothing else is affected"


def test_an_evaluator_error_is_never_read_as_a_value(monkeypatch):
    """Same reasoning for `error`: `safe_eval_math` returns `(None, error)` today,
    so the `None` alone would carry the refusal. An evaluator that ever returned a
    best-effort value ALONGSIDE an error would otherwise get to frame the scene."""
    from backend.experts.handlers.build_scene import compose as c

    monkeypatch.setattr(c, "safe_eval_math", lambda *_: (99.0, "Unknown name: 'Rp'"))
    assert c._measure("Rp+h") is None


def test_the_frame_contains_an_expression_valued_element():
    """End to end: the composed range must hold the geometry, not just the part
    of it that happened to be written as a literal."""
    scene = compose(
        "Torque", "tau = r x F",
        [ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="3,0,0"),
         ProposedElement(type="vector", step=0, from_pos="0,0,0",
                         to_pos="0, 0, 3*sin(PI/4)")],
        [ProposedStep(index=0, title="Both")])
    zlo, zhi = scene.range[2]
    assert zhi >= 2.12, f"tau's tip is at z=2.12 and the frame stops at {zhi}"


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


def test_the_frame_is_computed_at_the_sliders_resting_value():
    """A slider-driven coordinate has no value in general but HAS one right now:
    what the reader sees before touching anything. Framing against the defaults
    is what puts an interactive scene in shot on arrival."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="0,0,r")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="r", min=0, max=6, default=4)])
    assert scene.range[2][1] >= 4, "the vector at rest reaches z=4 and must be in frame"


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


def test_a_constant_expression_is_not_promoted():
    """It resolves at load, so it renders as-is. Promoting it would make a still
    element animated for no reason and drop it out of `to`."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, from_pos="0,0,0",
                                     to_pos="0, 0, 3*sin(PI/4)")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="r", min=0, max=1)])
    assert scene.steps[0].add[0].type == "vector"


def test_a_type_that_cannot_move_says_so():
    """Better a message naming the element than a scene missing a piece."""
    with pytest.raises(ComposeError, match="cannot move"):
        compose("T", "d",
                [ProposedElement(type="axis", axis="x", step=0, position="r,0,0")],
                [ProposedStep(index=0, title="one")],
                [_sl(step=0, id="r", min=0, max=1)])


def test_a_promoted_element_still_counts_towards_the_frame():
    """It is the whole scene, so leaving it out frames the view around nothing."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, from_pos="0,0,0",
                                     to_pos="0, 0, h")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="h", min=0, max=9, default=6)])
    assert scene.range[2][1] >= 6


def test_a_tip_to_tail_vector_keeps_its_tail_and_head_apart():
    """The tip-to-tail `b` in a summation scene has BOTH ends slider-driven.

    The schema's asymmetry bites here: the moving tail is `fromExpr` and the
    moving head is `expr`. Sending both to `expr` loses one of them silently —
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
    # And the frame holds the head at rest: (2+1, 1+2) = (3, 3).
    assert scene.range[0][1] >= 3 and scene.range[1][1] >= 3


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
    assert built["range"] == [-6.28, 6.28]
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


def test_a_curve_is_framed_by_sampling_it():
    """A curve names an INTERVAL, not endpoints, so it contributes no coordinates
    the way other elements do — a scene whose only content was a curve came out
    with no `range` at all."""
    scene = compose("Sine", "d",
                    [ProposedElement(type="animated_curve", step=0, label="wave",
                                     curve_expr="A*sin(x)", range="-2*pi, 2*pi")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="A", min=0.2, max=3, default=2)])
    assert scene.range is not None
    assert scene.range[0][1] >= 6.28, "the whole x interval must be in frame"
    assert scene.range[1][1] >= 2, "and the amplitude at rest"


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


def test_framing_follows_the_curve_s_own_plane():
    """`plane: xz` plots the curve's height along z, not y — the renderer reads
    it that way. Framing the wrong axis leaves the curve outside the view just as
    surely as not framing it at all."""
    scene = compose("T", "d",
                    [ProposedElement(type="animated_curve", step=0, plane="xz",
                                     curve_expr="3*sin(x)", range="0, 2*pi")],
                    [ProposedStep(index=0, title="one")])
    assert scene.range[2][1] >= 3, "the amplitude belongs on z for an xz curve"
    assert scene.range[1][1] < 3, "and not on y"


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

def test_a_hand_sampled_curve_is_refused_with_the_formula_to_write_instead():
    """Observed: asked for a sine wave with no curve type available, a model
    emitted FORTY-EIGHT `animated_line` segments — `-6.283185` to `-6.021238`,
    and so on. Slow, jagged, and it rendered nothing.

    Enforced as well as prompted because prompting alone has already failed twice
    on this signature: the model kept inventing `type: slider` after being told
    the type list was closed.
    """
    chain = [ProposedElement(type="line", step=0,
                             from_pos=f"{i}, 0, 0", to_pos=f"{i + 1}, 0, 0")
             for i in range(20)]
    with pytest.raises(ComposeError, match="animated_curve"):
        compose("T", "d", chain, [ProposedStep(index=0, title="one")])


def test_a_handful_of_real_segments_is_still_fine():
    """A coordinate frame, a chord and its drop lines. The busiest published step
    holding lines has five, so the bound must not touch ordinary scenes."""
    few = [ProposedElement(type="line", step=0, label=f"l{i}",
                           from_pos="0,0,0", to_pos=f"{i + 1}, 1, 0")
           for i in range(5)]
    scene = compose("T", "d", few, [ProposedStep(index=0, title="one")])
    assert len(scene.steps[0].add) == 5


def test_the_bound_applies_to_scene_level_elements_too():
    """A chain drawn before any step runs is the same mistake."""
    chain = [ProposedElement(type="line", step=-1,
                             from_pos=f"{i}, 0, 0", to_pos=f"{i + 1}, 0, 0")
             for i in range(20)]
    with pytest.raises(ComposeError, match="the scene has"):
        compose("T", "d", chain, [ProposedStep(index=0, title="one")])


def test_a_chain_of_moving_segments_is_caught_too():
    """The observed 48 were `animated_line`, not `line` — the model wrote them
    slider-driven (`A * sin(k * -6.021238)`), so they arrive already promoted.
    Checking only the static type would miss the exact case this exists for."""
    chain = [ProposedElement(type="line", step=0,
                             from_pos=f"{i}, A*sin(k*{i}), 0",
                             to_pos=f"{i + 1}, A*sin(k*{i + 1}), 0")
             for i in range(20)]
    with pytest.raises(ComposeError, match="sampled by hand"):
        compose("T", "d", chain, [ProposedStep(index=0, title="one")],
                [_sl(step=0, id="A", min=0.2, max=3, default=1),
                 _sl(step=0, id="k", min=0.5, max=4, default=1)])


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
    assert scene.range[0][1] >= 3, "and the frame must hold it at rest"


def test_framing_uses_the_value_the_reader_actually_sees():
    """The resting values come from the BUILT sliders, so a default outside the
    track is framed at its CLAMPED value — what is on screen — not at the number
    the model wrote and the slider cannot reach."""
    scene = compose("T", "d",
                    [ProposedElement(type="vector", step=0, from_pos="0,0,0", to_pos="0,0,h")],
                    [ProposedStep(index=0, title="one")],
                    [_sl(step=0, id="h", min=0, max=4, default=99)])
    assert scene.range[2][1] < 10, "99 is unreachable; the frame must use the clamped 4"
    assert scene.range[2][1] >= 4


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
    assert scene.steps[0].add[0].model_dump(exclude_none=True)["range"] == [0, 6]


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
    assert r"'\cos(\theta)'" in str(e.value)
    assert "\\\\cos" not in str(e.value)
