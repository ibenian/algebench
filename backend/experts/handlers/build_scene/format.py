r"""Named request fields -> the strings the builder actually reads.

WHY STRINGS AND NOT OBJECTS
---------------------------
DSPy renders a non-``str`` input field with ``json.dumps`` (see
``dspy.adapters.utils.format_field_value``), so a ``dict`` input reaches the model
as::

    {"neighbours": [{"label": "\\frac{b}{2a}"}]}

Doubled backslashes, in the PROMPT — and models imitate what they are shown. That
is the corruption ``LineAdapter`` exists to remove, and it does NOT cover this
side: "this adapter does not touch inputs" (``line_adapter.py``). Its escape-free
guarantee is an OUTPUT guarantee. Typing an input as an object opts back into a
hazard this project already paid for once, in production.

So the structure the model gets is the FIELD DECOMPOSITION — one labelled field
per role, which is exactly the one level of nesting the line format supports —
and each field's value is plain text with no escape layer.

WHY THE BOUNDS ARE HERE
-----------------------
They bound the PROMPT, not the request, so they belong on the prompt's side. The
honest response to an oversized context is to include what fits and say what was
dropped — refusing to build the scene at all serves nobody. Every ceiling below
therefore truncates and ANNOUNCES: a silent cut leaves the builder confidently
contradicting the part of the lesson it could not see.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from backend.model.lesson import Element, Scene, Step

# Prompt ceilings. Unreachable from the app — src/builder-context.ts already
# bounds selection — so these exist for a caller that skips the client.
MAX_SCENES_SUMMARISED = 40
MAX_SUMMARY_CHARS = 200
MAX_NEIGHBOURS = 2
MAX_ELEMENTS = 40
MAX_STEPS = 20
MAX_FIELD = 200
MAX_CLARIFICATIONS = 8
MAX_NAMES = 60

EMPTY = ""


#: DSPy frames every field with ``[[ ## name ## ]]``. Lesson content is
#: user-authored, so a scene title can contain one — see ``_line``.
_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")


def _line(value: Any, limit: int = MAX_FIELD) -> str:
    """One line of at most ``limit`` characters, or "" for anything else.

    Three things a value must not be able to do, all of them forgery:

    * NOT A STRING — a caller that skips the client can send anything.
    * A NEWLINE — it would forge a line that reads like another element.
    * A FIELD MARKER — a lesson titled ``Vectors [[ ## completed ## ]]`` would
      tell the model its section had ended, mid-context. ``intent.py`` already
      strips these on the way OUT (models echo them); lesson text is authored by
      users, so the way IN needs the same treatment.
    """
    if not isinstance(value, str):
        return EMPTY
    return _DSPY_MARKER.sub("", value).strip().split("\n")[0][:limit].strip()


def _more(total: int, shown: int, noun: str) -> list[str]:
    return [f"  … (+{total - shown} more {noun})"] if total > shown else []


def _dicts(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _strings(value: Any) -> list[str]:
    """Non-empty strings, or nothing.

    `value or []` is NOT enough and the difference is a crash: a caller that
    skips the client can send `sliderVocabulary: 42`, which is truthy and not
    iterable. Every accessor here has to assume the shape it wants is absent.
    """
    return [v for v in value if isinstance(v, str) and v] if isinstance(value, list) else []


def format_intent(intent: str) -> str:
    """Passed through: the request already bounds it, and it is the ONE field
    that must reach the model verbatim."""
    return (intent or "").strip()


def format_lesson(lesson: Any) -> str:
    """Title, description, and one line per scene — the map, not the territory."""
    if not isinstance(lesson, dict):
        return EMPTY
    out: list[str] = []
    if title := _line(lesson.get("title"), MAX_SUMMARY_CHARS):
        out.append(f"Title: {title}")
    if desc := _line(lesson.get("description"), MAX_SUMMARY_CHARS):
        out.append(f"Description: {desc}")

    summaries = _dicts(lesson.get("sceneSummaries"))
    if summaries:
        out.append("Scenes:")
        for i, s in enumerate(summaries[:MAX_SCENES_SUMMARISED]):
            index = s.get("index")
            head = f"  {index if isinstance(index, int) else i}. " + (
                _line(s.get("title"), MAX_SUMMARY_CHARS) or "(untitled)")
            if blurb := _line(s.get("description"), MAX_SUMMARY_CHARS):
                head += f" — {blurb}"
            out.append(head)
        out += _more(len(summaries), MAX_SCENES_SUMMARISED, "scenes")
    return "\n".join(out)


def _element_line(el: Element, indent: str) -> str:
    parts = [_line(el.type) or "element"]
    for name in ("id", "label"):
        if value := _line(getattr(el, name)):
            parts.append(f"{name}={value}")
    # `color` is HexColor | Rgb01 — a list in the second case, so it is the one
    # field here that is not already a string.
    if el.color is not None:
        parts.append(f"color={_line(el.color if isinstance(el.color, str) else str(el.color))}")
    return f"{indent}- " + " ".join(parts)


def _step_line(i: int, step: Step, indent: str) -> str:
    """`title`/`description` — the SCENE vocabulary, and typed so it cannot drift.

    This read `step.get("text")` once (proof_edit's names) and rendered
    "(no caption)" for every step in the corpus while every test passed. `Step`
    declares `title` and has no `text`, so the same mistake is now an
    AttributeError at import-adjacent speed rather than an emptier prompt.
    """
    caption = _line(step.title, MAX_SUMMARY_CHARS)
    if blurb := _line(step.description, MAX_SUMMARY_CHARS):
        caption = f"{caption} — {blurb}" if caption else blurb
    detail = [f"adds {n}" for n in [len(step.add or [])] if n]
    detail += [f"removes {n}" for n in [len(step.remove or [])] if n]
    detail += [f"{n} slider(s)" for n in [len(step.sliders or [])] if n]
    suffix = f" ({', '.join(detail)})" if detail else ""
    return f"{indent}step {i}: {caption or '(no caption)'}{suffix}"


def _format_scene(scene: Scene, indent: str = "  ") -> list[str]:
    """One scene, compactly: what it shows and how it unfolds."""
    out: list[str] = []
    if title := _line(scene.title, MAX_SUMMARY_CHARS):
        out.append(f"{indent}Title: {title}")
    # The description carries the PEDAGOGY — "measures how much two vectors point
    # in the same direction". Dropping it leaves the builder matching geometry
    # with no idea what the lesson is teaching.
    if desc := _line(scene.description, MAX_SUMMARY_CHARS):
        out.append(f"{indent}About: {desc}")

    elements = scene.elements or []
    out += [_element_line(el, indent) for el in elements[:MAX_ELEMENTS]]
    out += [f"{indent}{line}" for line in _more(len(elements), MAX_ELEMENTS, "elements")]

    steps = scene.steps or []
    out += [_step_line(i, st, indent) for i, st in enumerate(steps[:MAX_STEPS])]
    out += [f"{indent}{line}" for line in _more(len(steps), MAX_STEPS, "steps")]
    return out


def format_neighbours(neighbours: list[Scene]) -> str:
    """The scenes either side of the target — for tone, not for copying."""
    scenes = list(neighbours or [])
    out: list[str] = []
    for i, scene in enumerate(scenes[:MAX_NEIGHBOURS]):
        out.append(f"Neighbouring scene {i + 1}:")
        out += _format_scene(scene)
    out += _more(len(scenes), MAX_NEIGHBOURS, "neighbours")
    return "\n".join(out)


def format_current(current: Optional[Scene]) -> str:
    """The scene being replaced. Empty on insert — and that emptiness is
    CHECKED upstream by ``BuildSceneRequest.require_consistent``, so an empty
    value here means insert rather than a lost scene."""
    if current is None:
        return EMPTY
    return "\n".join(_format_scene(current, indent=""))


def format_conventions(conventions: Any) -> str:
    """House style, DERIVED by the client from the lesson's own elements.

    A model told "match the lesson's style" invents one; handed the palette
    actually in use, it reuses it.
    """
    if not isinstance(conventions, dict):
        return EMPTY
    out: list[str] = []
    colors = _strings(conventions.get("colors"))[:12]
    if colors:
        out.append("Palette in use: " + ", ".join(_line(c, 32) for c in colors))
    if conventions.get("labelsAreLatex"):
        out.append("Labels are LaTeX: wrap label text in $…$.")
    else:
        out.append("Labels are plain text: do NOT wrap them in $…$.")
    if conventions.get("elementsCarryPrompts"):
        out.append("Elements carry Ask-AI `prompt` text; write one for each new element.")
    return "\n".join(out)


def format_existing_names(slider_ids: Any, memory: Any) -> str:
    """Names already spoken for. Two different reasons, one field:

    slider ids must not COLLIDE, and memory keys may be REFERENCED as ``$key``
    (resolved at apply time by ``_resolve_memory_refs``, so only the key and its
    shape belong in a prompt — never the computed value).
    """
    out: list[str] = []
    ids = _strings(slider_ids)[:MAX_NAMES]
    if ids:
        out.append("Slider ids already in use (do not reuse): " + ", ".join(ids))
    refs = _dicts(memory)[:MAX_NAMES]
    if refs:
        out.append("Memory references available as $key:")
        for ref in refs:
            key = _line(ref.get("key"))
            if not key:
                continue
            shape = _line(ref.get("shape"), MAX_SUMMARY_CHARS)
            out.append(f"  ${key}" + (f" — {shape}" if shape else ""))
    return "\n".join(out)


def format_clarifications(clarifications: Any) -> str:
    """Questions already asked and answered. Bounded so a resumed build cannot
    grow its own prompt without limit."""
    rounds = _dicts(clarifications)
    out: list[str] = []
    for c in rounds[:MAX_CLARIFICATIONS]:
        question = _line(c.get("question"), 1000)
        answer = _line(c.get("answer"), 2000)
        if question or answer:
            out.append(f"Q: {question}\nA: {answer}")
    out += _more(len(rounds), MAX_CLARIFICATIONS, "rounds")
    return "\n".join(out)


def format_omitted(omitted: Any) -> str:
    """What the CLIENT dropped before sending. Distinct from the ceilings above:
    this is the far side's truncation, and the model should see both."""
    items = [_line(o) for o in _strings(omitted)]
    return "; ".join(i for i in items if i)
