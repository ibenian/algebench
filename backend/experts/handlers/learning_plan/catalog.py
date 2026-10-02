"""What a plan can be built from: the published lessons' scenes, steps, proofs,
proof steps and glossary terms, each with the ref the client navigates by.

Read from the raw lesson JSON, not through ``_load_scene``, which would trigger
graph autofill. Ids come from :func:`~backend.lesson_ids.iter_id_targets`, the
walk that mirrors how the client resolves ``sc``/``st``/``pf``/``ps``, so a ref
built here lands where a share link would. Each lesson is parsed once per
change of its file (cached by mtime), like the lesson picker's index.

Only published lessons (``scenes/*.json``). Drafts duplicate them, and a plan
step pointing into a draft would break the day the draft is promoted.

Lesson ids from a request are looked up in the directory listing, never turned
into a path, so nothing a caller sends can name a file.
"""
from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.lesson_ids import iter_id_targets

ROOT = Path(__file__).resolve().parents[4]
SCENES_DIR = ROOT / "scenes"
DOMAINS_DIR = ROOT / "static" / "domains"

#: The client's step kinds (``ContentKind`` in src/plan-core.ts).
KINDS = ("scene", "step", "proof", "proofStep", "glossary")

_DOMAIN_NAME = re.compile(r"[A-Za-z0-9_\-]+")


@dataclass(frozen=True)
class Entry:
    """One thing a plan step can point at."""

    kind: str
    title: str
    detail: str
    #: A ``ContentRef`` (src/plan-core.ts): ``lesson`` plus the ids that locate it.
    ref: dict
    #: Nesting under its scene or proof, for rendering only.
    depth: int = 0


@dataclass(frozen=True)
class LessonCatalog:
    lesson: str
    title: str
    entries: tuple[Entry, ...]
    #: Words used to pick lessons for a target (see ``preselect``).
    title_words: frozenset[str] = field(default_factory=frozenset)
    heading_words: frozenset[str] = field(default_factory=frozenset)
    body_words: frozenset[str] = field(default_factory=frozenset)
    #: Glossary terms and aliases, lowercased, matched as phrases.
    terms: tuple[str, ...] = ()


def _text(value) -> str:
    """A string field with its whitespace collapsed, or ""."""
    return " ".join(value.split()) if isinstance(value, str) else ""


_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset("""
    the and for with from into that this what why how does when where which who
    are was were can will its it's your you them they their than then also just
    about understand understanding learn learning want need know explain show
    between using use used work works way ways get make our there here have has
""".split())


def words(text: str) -> set[str]:
    """Content words, lowercased, with a plural ``s`` dropped."""
    out = set()
    for w in _WORD.findall(text.lower()):
        if len(w) < 3 or w in _STOP:
            continue
        out.add(w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w)
    return out


def _glossary_entries(glossary, lesson: str, seen: set[str]) -> list[Entry]:
    out = []
    if not isinstance(glossary, dict):
        return out
    for key, entry in glossary.items():
        if not isinstance(key, str) or not key or key.lower() in seen or not isinstance(entry, dict):
            continue
        seen.add(key.lower())
        term = _text(entry.get("term")) or key
        out.append(Entry("glossary", term, _text(entry.get("markdown")),
                         {"lesson": lesson, "glossary": key}))
    return out


def _glossary_names(glossary) -> list[str]:
    """Every name a glossary answers to: each entry's key, term and aliases,
    as the lesson picker's index reads them (``_glossary_terms`` in server.py)."""
    names: list[str] = []
    if not isinstance(glossary, dict):
        return names
    for key, entry in glossary.items():
        if isinstance(key, str):
            names.append(key)
        if isinstance(entry, dict):
            if isinstance(entry.get("term"), str):
                names.append(entry["term"])
            if isinstance(entry.get("aliases"), list):
                names += [a for a in entry["aliases"] if isinstance(a, str)]
    return names


def _domain_path(name) -> Optional[Path]:
    """static/domains/<name>/docs.json, confined there; None for a bad name."""
    if not isinstance(name, str) or not _DOMAIN_NAME.fullmatch(name):
        return None
    path = DOMAINS_DIR / name / "docs.json"
    try:
        return path if path.resolve().is_relative_to(DOMAINS_DIR.resolve()) else None
    except OSError:
        return None


def _mtime(path: Optional[Path]) -> int:
    try:
        return path.stat().st_mtime_ns if path else -1
    except OSError:
        return -1


def _domain_glossary(name) -> dict:
    """An imported domain's glossary, from static/domains/<name>/docs.json."""
    path = _domain_path(name)
    if path is None:
        return {}
    try:
        docs = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return docs.get("glossary") if isinstance(docs, dict) and isinstance(docs.get("glossary"), dict) else {}


def build_catalog(lesson: str, spec: dict) -> LessonCatalog:
    """The catalog of one lesson, from its raw JSON."""
    entries: list[Entry] = []
    scene_id: Optional[str] = None
    for t in iter_id_targets(spec):
        o = t.obj
        if t.kind == "scene":
            scene_id = t.ident
            entries.append(Entry("scene", _text(o.get("title")) or t.ident,
                                 _text(o.get("description")), {"lesson": lesson, "sc": t.ident}))
        elif t.kind == "step":
            entries.append(Entry("step", _text(o.get("title")) or t.ident, _text(o.get("description")),
                                 {"lesson": lesson, "sc": scene_id, "st": t.ident}, depth=1))
        elif t.kind == "proof":
            # A root-level proof sits outside any scene. Scene- and step-level
            # proofs carry their scene, so the jump loads it; never the step,
            # because the proof's own step binding places the scene step.
            at_root = not t.path.startswith("scenes[")
            ref = {"lesson": lesson, "pf": t.ident} if at_root else {"lesson": lesson, "sc": scene_id, "pf": t.ident}
            entries.append(Entry("proof", _text(o.get("title")) or t.ident,
                                 _text(o.get("goal")), ref, depth=0 if at_root else 1))
        elif t.kind == "proof-step":
            parent = next(e for e in reversed(entries) if e.kind == "proof")
            entries.append(Entry("proofStep", _text(o.get("label")) or t.ident,
                                 _text(o.get("justification")) or _text(o.get("explanation")),
                                 {**parent.ref, "ps": t.ident}, depth=parent.depth + 1))
    seen: set[str] = set()
    names = _glossary_names(spec.get("glossary"))
    entries += _glossary_entries(spec.get("glossary"), lesson, seen)
    for name in lesson_imports(spec):
        glossary = _domain_glossary(name)
        names += _glossary_names(glossary)
        entries += _glossary_entries(glossary, lesson, seen)

    title = _text(spec.get("title")) or lesson
    headings = " ".join([e.title for e in entries if e.kind in ("scene", "proof")] + names)
    body = " ".join(f"{e.title} {e.detail}" for e in entries)
    # Matched as whole phrases, so a short alias ("GD", "FTA") can't match inside a word.
    phrases = {" ".join(_WORD.findall(n.lower())) for n in names}
    terms = tuple(sorted(p for p in phrases if len(p) >= 2))
    return LessonCatalog(lesson, title, tuple(entries), frozenset(words(title)),
                         frozenset(words(headings)), frozenset(words(body)), terms)


def lesson_imports(spec: dict) -> list:
    return spec.get("import") if isinstance(spec.get("import"), list) else []


def _fingerprint(lesson_mtime: int, imports: list) -> tuple:
    """What a cached catalog was built from: the lesson file and every imported
    domain's docs.json, whose glossary entries it carries."""
    return (lesson_mtime, tuple((str(n), _mtime(_domain_path(n))) for n in imports))


# lesson id -> (fingerprint, the lesson's imports, catalog)
_cache: dict[str, tuple[tuple, list, LessonCatalog]] = {}
_lock = threading.Lock()


def published_lessons() -> dict[str, Path]:
    """Published lesson id -> its file, confined to scenes/."""
    if not SCENES_DIR.exists():
        return {}
    root = SCENES_DIR.resolve()
    out = {}
    for f in sorted(SCENES_DIR.glob("*.json")):
        try:
            if f.resolve().is_relative_to(root):
                out[f.stem] = f
        except OSError:
            continue
    return out


def catalog_for(lesson: str, files: Optional[dict[str, Path]] = None) -> Optional[LessonCatalog]:
    """The catalog of a published lesson, or None for anything else."""
    path = (files if files is not None else published_lessons()).get(lesson)
    if path is None:
        return None
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return None
    with _lock:
        cached = _cache.get(lesson)
    if cached and cached[0] == _fingerprint(mtime, cached[1]):
        return cached[2]
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(spec, dict):
        return None
    imports = lesson_imports(spec)
    fingerprint = _fingerprint(mtime, imports)   # before building: an edit mid-build rebuilds next time
    cat = build_catalog(lesson, spec)
    with _lock:
        _cache[lesson] = (fingerprint, imports, cat)
    return cat


def score(cat: LessonCatalog, target: str) -> int:
    """How well a lesson matches the target text. No LLM: titles count most,
    then scene/proof titles and glossary terms, then any text, plus a bonus
    for a glossary term named in the target."""
    tw = words(target)
    s = (3 * len(tw & cat.title_words) + 2 * len(tw & cat.heading_words)
         + len(tw & cat.body_words))
    low = " ".join(_WORD.findall(target.lower()))
    s += sum(4 for term in cat.terms if f" {' '.join(_WORD.findall(term))} " in f" {low} ")
    return s


#: Lessons sent to the model per plan, the current one included.
MAX_LESSONS = 4


def preselect(target: str, current: Optional[str] = None,
              limit: int = MAX_LESSONS) -> list[LessonCatalog]:
    """The lessons worth showing the model for this target: the learner's own
    lesson (when it's published) first, then the best matches. A lesson with no
    match is never added just to fill the quota."""
    files = published_lessons()
    picked: list[LessonCatalog] = []
    if current and (cat := catalog_for(current, files)):
        picked.append(cat)
    ranked = []
    for lesson in files:
        if lesson == current:
            continue
        cat = catalog_for(lesson, files)
        if cat and (s := score(cat, target)) > 0:
            ranked.append((-s, lesson, cat))
    ranked.sort(key=lambda r: (r[0], r[1]))
    # A lesson that shares a word or two with the target ("velocity" in a
    # relativity lesson, for "terminal velocity") is noise next to one that is
    # about it, and every lesson sent costs prompt.
    floor = max(2, -ranked[0][0] // 3) if ranked else 0
    picked += [cat for s, _, cat in ranked if -s >= floor][: max(0, limit - len(picked))]
    return picked
