"""The request and the catalog -> the strings the planner reads.

Every input is a bounded plain string, for the reason ``build_scene/format.py``
gives: a non-``str`` DSPy input is rendered as JSON, which doubles every
backslash in the lesson's LaTeX. Lesson text and the learner's words both go
through ``_line``, which drops newlines and DSPy field markers, so neither can
forge a catalog line or end a field early.

Catalog entries get opaque handles (``L1.S2.T3``) numbered per request. The
model answers with handles only; ``validate.py`` maps them back to refs, so
an id or link the model makes up never reaches the client.
"""
from __future__ import annotations

from backend.experts.handlers.build_scene.format import _clip, _line

from .catalog import Entry, LessonCatalog
from .models import Clarification, LearningPlanRequest

MAX_TITLE = 120
MAX_DETAIL = 120
#: Entries shown per lesson. The busiest published lesson has about 140.
MAX_ENTRIES = 160
MAX_KNOWN = 30

_KIND_LABEL = {"scene": "scene", "step": "step", "proof": "proof",
               "proofStep": "proof step", "glossary": "term"}


def _flat(text: str, limit: int) -> str:
    return _line(" ".join(str(text or "").split()), limit)


def handles_for(cats: list[LessonCatalog]) -> list[tuple[str, Entry, LessonCatalog]]:
    """Every entry with its handle, in catalog order.

    Handles encode the nesting so the model can read structure from them:
    ``L1.S2`` a scene, ``L1.S2.T3`` its step, ``L1.P1`` a proof, ``L1.P1.4``
    its step, ``L1.G5`` a glossary term.
    """
    out = []
    for li, cat in enumerate(cats, 1):
        s = t = p = q = g = 0
        for e in cat.entries:
            if e.kind == "scene":
                s, t = s + 1, 0
                h = f"L{li}.S{s}"
            elif e.kind == "step":
                t += 1
                h = f"L{li}.S{s}.T{t}"
            elif e.kind == "proof":
                p, q = p + 1, 0
                h = f"L{li}.P{p}"
            elif e.kind == "proofStep":
                q += 1
                h = f"L{li}.P{p}.{q}"
            else:
                g += 1
                h = f"L{li}.G{g}"
            out.append((h, e, cat))
    return out


def format_catalog(cats: list[LessonCatalog]) -> tuple[str, dict[str, Entry], str]:
    """The catalog text, the handles it showed, and what was left out."""
    lines: list[str] = []
    shown: dict[str, Entry] = {}
    omitted: list[str] = []
    by_lesson: dict[str, list] = {}
    for h, e, cat in handles_for(cats):
        by_lesson.setdefault(cat.lesson, []).append((h, e))
    for li, cat in enumerate(cats, 1):
        lines.append(f"L{li} — {_flat(cat.title, MAX_TITLE)}")
        rows = by_lesson.get(cat.lesson, [])
        for h, e in rows[:MAX_ENTRIES]:
            detail = _flat(e.detail, MAX_DETAIL)
            pad = "  " * (e.depth + 1)
            lines.append(f"{pad}{h} [{_KIND_LABEL[e.kind]}] {_flat(e.title, MAX_TITLE)}"
                         + (f" — {detail}" if detail else ""))
            shown[h] = e
        if len(rows) > MAX_ENTRIES:
            lines.append(f"  … (+{len(rows) - MAX_ENTRIES} more entries)")
            omitted.append(f"{len(rows) - MAX_ENTRIES} entries of L{li}")
        lines.append("")
    return "\n".join(lines).strip(), shown, "; ".join(omitted)


def format_where(req: LearningPlanRequest, cats: list[LessonCatalog]) -> str:
    """Where the learner is, as titles from the catalog. Ids that don't match
    anything published are dropped rather than shown as raw ids."""
    w = req.where
    if not w.lesson:
        return ""
    cat = next((c for c in cats if c.lesson == w.lesson), None)
    if cat is None:
        return "in a lesson that is not in the catalog"

    def find(kind: str, **ids) -> str:
        for e in cat.entries:
            if e.kind == kind and all(e.ref.get(k) == v for k, v in ids.items()):
                return _flat(e.title, MAX_TITLE)
        return ""

    parts = [f"lesson: {_flat(cat.title, MAX_TITLE)}"]
    if w.sc and (t := find("scene", sc=w.sc)):
        parts.append(f"scene: {t}")
        if w.st and (t := find("step", sc=w.sc, st=w.st)):
            parts.append(f"step: {t}")
    if w.pf and (t := find("proof", pf=w.pf)):
        parts.append(f"proof: {t}")
        if w.ps and (t := find("proofStep", pf=w.pf, ps=w.ps)):
            parts.append(f"proof step: {t}")
    return " › ".join(parts)


def format_known(known: list[str]) -> str:
    rows = [r for r in (_flat(k, MAX_TITLE) for k in known) if r][:MAX_KNOWN]
    extra = len([k for k in known if isinstance(k, str) and k.strip()]) - len(rows)
    return "\n".join([f"- {r}" for r in rows] + ([f"- … (+{extra} more)"] if extra > 0 else []))


def format_clarifications(rounds: list[Clarification]) -> str:
    return "\n".join(f"Q: {_flat(c.question, 300)}\nA: {_flat(c.answer, 300)}" for c in rounds)


def format_refused(problems: list[str]) -> str:
    return _clip("; ".join(problems), 600)


def render_inputs(req: LearningPlanRequest, cats: list[LessonCatalog]) -> tuple[dict, dict[str, Entry]]:
    """Every input field of the signature, plus the handles the catalog showed."""
    catalog, shown, omitted = format_catalog(cats)
    return {
        "target": _flat(req.target, 500),
        "where": format_where(req, cats),
        "known": format_known(req.known),
        "clarifications": format_clarifications(req.clarifications),
        "catalog": catalog,
        "omitted": omitted,
        "refused": "",
    }, shown
