"""The model's picks -> plan steps, in code.

The model names catalog handles; this is where each becomes a ref. A handle
that wasn't in the catalog sent is dropped (so an invented one never reaches
the client), as is a repeat of a step already in the plan and a step with no
``why``. Titles come from the catalog, not the model.
"""
from __future__ import annotations

from backend.experts.handlers.build_scene.format import _line

from .catalog import Entry

#: Longer than this is a course, not a path to one idea.
MAX_PLAN_STEPS = 8
MAX_WHY = 300
MAX_TITLE = 200


def _flat(text, limit: int) -> str:
    return _line(" ".join(str(text or "").split()), limit)


def plan_steps(picks, shown: dict[str, Entry]) -> tuple[list[dict], list[str]]:
    """``(steps, problems)``: the valid steps in order, and why others were dropped."""
    steps: list[dict] = []
    problems: list[str] = []
    seen: set[tuple] = set()
    for pick in picks:
        handle = _flat(getattr(pick, "handle", ""), 40).strip(" `'\"[]")
        entry = shown.get(handle)
        if entry is None:
            problems.append(f"{handle or '(empty)'} is not a handle in the catalog")
            continue
        key = tuple(sorted(entry.ref.items()))
        if key in seen:
            continue
        why = _flat(getattr(pick, "why", ""), MAX_WHY)
        if not why:
            problems.append(f"{handle} has no why")
            continue
        seen.add(key)
        steps.append({
            "kind": entry.kind,
            "title": _flat(entry.title, MAX_TITLE),
            "why": why,
            "ref": {k: v for k, v in entry.ref.items() if v},
        })
        if len(steps) == MAX_PLAN_STEPS:
            break
    return steps, problems


def mostly_invalid(steps: list[dict], problems: list[str]) -> bool:
    """Worth one more ask: nothing usable, or more dropped than kept."""
    return not steps or len(problems) > len(steps)
