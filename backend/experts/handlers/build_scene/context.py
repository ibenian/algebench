"""Assemble what the scene builder is allowed to see.

A SEPARATE STAGE on purpose, not a helper inside the builder:

    chat intent -> context assembly -> DSPy builder -> compose -> validate -> place

The chat tool carries only the user's intent and enough to locate the operation.
The conversational agent does NOT choose what the expert sees — context selection
is builder infrastructure. Keeping it out of both the chat tool and the DSPy
module means selection can improve later (summaries, retrieval, token budgeting)
without touching the expert's contract, and it can be tested without an LM call.

Iteration 1 keeps selection explicit, deterministic and small. No retrieval, no
embeddings, no summarising LM call.

WHY DATACLASSES AND NOT PYDANTIC
--------------------------------
Everything nearby is pydantic, so the exception needs a reason. Pydantic earns its
keep at BOUNDARIES: untrusted input arriving (`BuildSceneRequest`), or a shape
leaving for another language (`contracts.py`). `BuilderContext` is neither. It is
assembled by our own code from an already-validated request and consumed by our
own prompt formatting — validation there would be re-checking what we just built.

There is also a concrete cost. This holds RAW SCENE DICTS (`neighbours`,
`current`). As pydantic fields they would either be re-validated and coerced —
the same class of lossiness that silently rewrote `1` as `1.0` in the canonical
model — or deep-copied for no benefit. `current` is meant to be the scene as it
actually is.

It follows the precedent too: `proof_edit`, the closest analogue, hands its DSPy
signature plain strings (`propose_edit(derivation, current_step, request, ...)`).
The framework's `CONTEXT_MODELS` machinery belongs to the registered-EXPERT path
(`invoke()` with a context_id scope) and is currently empty; build_scene is a
HANDLER, like proof_edit.

`frozen=True` gives the one guarantee that does matter here: assembly cannot be
undone downstream.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

#: Bounds. A 40-scene lesson must not become a 100KB prompt — the same reason
#: proof_edit bounds a derivation rather than sending all of it.
MAX_SCENES_SUMMARISED = 40
MAX_SUMMARY_CHARS = 200
MAX_INTENT_CHARS = 2000


@dataclass(frozen=True)
class SceneSummary:
    """One line about a scene, cheap enough to include for every one of them."""

    index: int
    title: str
    description: str


@dataclass(frozen=True)
class Conventions:
    """House style, DERIVED by scanning rather than asked of the model.

    A model told "match the lesson's style" will invent one; a model handed the
    palette actually in use will reuse it. Scanning is also the only way to be
    right about a lesson nobody described in prose.
    """

    colors: tuple[str, ...] = ()
    labels_are_latex: bool = False
    elements_carry_prompts: bool = False


@dataclass(frozen=True)
class MemoryRef:
    """An agent-memory key and its SHAPE — never its value.

    `_resolve_memory_refs` in server.py substitutes `$key` at apply time, so the
    model only needs to know a key exists and roughly what it holds. The values
    are computed arrays and matrices with no business in a prompt.
    """

    key: str
    shape: str


@dataclass(frozen=True)
class BuilderContext:
    """Everything the scene builder sees, and nothing else."""

    # where the result goes
    op: Literal["insert", "replace"]
    scene_index: int

    # what was asked
    intent: str
    clarifications: tuple[tuple[str, str], ...] = ()

    # lesson-level consistency
    lesson_title: str = ""
    lesson_description: str = ""
    conventions: Conventions = field(default_factory=Conventions)
    scene_summaries: tuple[SceneSummary, ...] = ()
    neighbours: tuple[dict, ...] = ()
    #: The full scene, and ONLY when replacing. This is what makes
    #: regenerate-with-context work rather than regenerate-from-scratch.
    current: Optional[dict] = None
    memory: tuple[MemoryRef, ...] = ()
    #: Slider ids already in use, so the model does not collide with them AND the
    #: binding check has something to check against.
    slider_vocabulary: tuple[str, ...] = ()
    #: What bounding dropped, if anything. A silently truncated context reads as
    #: "the model saw everything" when it did not.
    omitted: tuple[str, ...] = ()


def _first_line(text: Any, limit: int = MAX_SUMMARY_CHARS) -> str:
    if not isinstance(text, str):
        return ""
    line = text.strip().splitlines()[0] if text.strip() else ""
    return line[:limit]


def _scenes_of(lesson: dict) -> list[dict]:
    scenes = lesson.get("scenes")
    if isinstance(scenes, list):
        return [s for s in scenes if isinstance(s, dict)]
    # SingleSceneFormat: the lesson IS the scene.
    return [lesson] if lesson.get("title") or lesson.get("elements") else []


def _elements_of(scene: dict) -> list[dict]:
    out = [e for e in (scene.get("elements") or []) if isinstance(e, dict)]
    for step in scene.get("steps") or []:
        if isinstance(step, dict):
            out += [e for e in (step.get("add") or []) if isinstance(e, dict)]
    return out


def derive_conventions(scenes: list[dict]) -> Conventions:
    """Read the lesson's house style off the elements it already contains."""
    colors: list[str] = []
    latex = prompts = 0
    labelled = 0
    for scene in scenes:
        for el in _elements_of(scene):
            c = el.get("color")
            if isinstance(c, str) and c.startswith("#") and c not in colors:
                colors.append(c)
            label = el.get("label")
            if isinstance(label, str) and label:
                labelled += 1
                if "$" in label:
                    latex += 1
            if el.get("prompt"):
                prompts += 1
    return Conventions(
        colors=tuple(colors[:12]),
        # "Most labels" rather than "any": one stray LaTeX label should not make
        # the builder wrap every plain word in dollars.
        labels_are_latex=labelled > 0 and latex * 2 > labelled,
        elements_carry_prompts=prompts > 0,
    )


def collect_slider_ids(scenes: list[dict]) -> tuple[str, ...]:
    ids: list[str] = []
    for scene in scenes:
        for step in scene.get("steps") or []:
            if not isinstance(step, dict):
                continue
            for slider in step.get("sliders") or []:
                sid = slider.get("id") if isinstance(slider, dict) else None
                if isinstance(sid, str) and sid and sid not in ids:
                    ids.append(sid)
    return tuple(ids)


def assemble_context(
    *,
    lesson: dict,
    intent: str,
    op: Literal["insert", "replace"],
    scene_index: Optional[int] = None,
    clarifications: tuple[tuple[str, str], ...] = (),
    memory: tuple[MemoryRef, ...] = (),
) -> BuilderContext:
    """Deterministically decide what the builder sees. No LM, no I/O."""
    scenes = _scenes_of(lesson or {})
    omitted: list[str] = []

    # Where the result goes. An insert with no index appends; a replace must name
    # a scene that exists, since "replace something" is not an instruction.
    if op == "replace":
        if scene_index is None or not (0 <= scene_index < len(scenes)):
            raise ValueError(f"replace needs an existing scene index, got {scene_index}")
        target = scene_index
    else:
        target = len(scenes) if scene_index is None else max(0, min(scene_index, len(scenes)))

    summarised = scenes[:MAX_SCENES_SUMMARISED]
    if len(scenes) > MAX_SCENES_SUMMARISED:
        omitted.append(f"{len(scenes) - MAX_SCENES_SUMMARISED} scene summaries")

    summaries = tuple(
        SceneSummary(i, str(s.get("title") or ""), _first_line(s.get("description")))
        for i, s in enumerate(summarised)
    )

    # Neighbours: enough to match tone and pick up where the previous scene left
    # off, without paying for the whole lesson.
    around = [i for i in (target - 1, target + 1) if 0 <= i < len(scenes)]
    neighbours = tuple(scenes[i] for i in around)

    return BuilderContext(
        op=op,
        scene_index=target,
        intent=(intent or "").strip()[:MAX_INTENT_CHARS],
        clarifications=clarifications,
        lesson_title=str(lesson.get("title") or ""),
        lesson_description=_first_line(lesson.get("description")),
        conventions=derive_conventions(scenes),
        scene_summaries=summaries,
        neighbours=neighbours,
        current=scenes[target] if op == "replace" else None,
        memory=memory,
        slider_vocabulary=collect_slider_ids(scenes),
        omitted=tuple(omitted),
    )
