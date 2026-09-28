"""Stable ids for lesson scenes, steps, proofs and proof steps.

Deeplinks (``sc=`` / ``st=`` / ``pf=`` / ``ps=``) resolve an explicit ``id``
first, then ``slugify(title)``, then the array index (``src/view-state-bridge.ts``).
Without an explicit id, editing a title or reordering steps silently re-points
every share link, AI jump and saved reference. Every lesson therefore carries an
explicit id on each of these objects.

The ids assigned here are exactly the ones the client already derives, so
filling them in never changes where an existing link lands:

- scenes / steps: ``buildIds(items, 'title')`` — id, else slug(title), else the
  index; collisions within the array get ``-2``, ``-3``, ...
- proof steps: the same, keyed on ``label``
- proofs: id, else slug(title) (no de-duplication, matching ``proofId``)

Once written, an id never changes when its title does — that is the point.
"""

from __future__ import annotations

import re
from typing import Any, Iterator, NamedTuple

_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# kind -> the field the client slugs when there is no explicit id.
_TITLE_KEY = {"scene": "title", "step": "title", "proof": "title", "proof-step": "label"}


def slugify(title: Any) -> str:
    """Mirror of ``slugify`` in src/view-state.ts."""
    s = "" if title is None else str(title)
    return _NON_ALNUM.sub("-", s.lower()).strip("-")


_LATEX = re.compile(r"\\[a-zA-Z]+|[\\${}^_]")


def readable_slug(title: Any, fallback: str, limit: int = 48) -> str:
    """An id for NEW content: slugify with LaTeX commands dropped and a length cap.

    Existing content must keep ``slugify`` (links already carry those slugs);
    content being created has no links yet, so it gets the cleaner form —
    ``Eigenvector $\\mathbf{v}_1$`` becomes ``eigenvector-v-1``, not
    ``eigenvector-mathbf-v-1``. The cap cuts at a word boundary.
    """
    slug = slugify(_LATEX.sub(" ", "" if title is None else str(title)))
    if len(slug) > limit:
        slug = slug[:limit + 1].rsplit("-", 1)[0] or slug[:limit]
    return slug or fallback


def unique_id(base: str, taken: set[str]) -> str:
    """``base``, or ``base-2``, ``base-3``… — whichever is free. Adds it to ``taken``."""
    ident, n = base, 2
    while ident in taken:
        ident = f"{base}-{n}"
        n += 1
    taken.add(ident)
    return ident


def build_ids(items: list, title_key: str) -> list[str]:
    """Mirror of ``buildIds`` in src/view-state-bridge.ts."""
    used: set[str] = set()
    out: list[str] = []
    for i, it in enumerate(items or []):
        it = it if isinstance(it, dict) else {}
        base = str(it["id"]) if it.get("id") else slugify(it.get(title_key))
        if not base:
            base = str(i)
        ident, n = base, 2
        while ident in used:
            ident = f"{base}-{n}"
            n += 1
        used.add(ident)
        out.append(ident)
    return out


class IdTarget(NamedTuple):
    obj: dict      # the scene / step / proof / proof step
    kind: str      # 'scene' | 'step' | 'proof' | 'proof-step'
    ident: str     # its explicit id, or the id the client derives for it
    path: str      # human-readable location, e.g. scenes[2].steps[0]
    scope: str     # ids must be unique within a scope (the containing array)

    @property
    def explicit(self) -> bool:
        return bool(self.obj.get("id"))

    @property
    def untitled(self) -> bool:
        """No title/label to derive from — the client falls back to the index."""
        return not slugify(self.obj.get(_TITLE_KEY[self.kind]))


def _dicts(items: Any) -> list[dict]:
    return [x for x in items if isinstance(x, dict)] if isinstance(items, list) else []


def _proof_targets(holder: dict, ctx: str) -> Iterator[IdTarget]:
    raw = holder.get("proof")
    proofs = [raw] if isinstance(raw, dict) else _dicts(raw)
    for pi, proof in enumerate(proofs):
        pctx = f"{ctx}.proof[{pi}]" if isinstance(raw, list) else f"{ctx}.proof"
        pctx = pctx.lstrip(".")
        pid = str(proof.get("id") or slugify(proof.get("title")))
        yield IdTarget(proof, "proof", pid, pctx, f"{ctx}.proof")
        steps = _dicts(proof.get("steps"))
        for si, (step, sid) in enumerate(zip(steps, build_ids(steps, "label"))):
            yield IdTarget(step, "proof-step", sid, f"{pctx}.steps[{si}]", pctx)


def _scene_targets(scene: dict, ctx: str) -> Iterator[IdTarget]:
    yield from _proof_targets(scene, ctx)
    steps = _dicts(scene.get("steps"))
    for i, (step, sid) in enumerate(zip(steps, build_ids(steps, "title"))):
        sctx = f"{ctx}.steps[{i}]".lstrip(".")
        yield IdTarget(step, "step", sid, sctx, f"{ctx}.steps")
        yield from _proof_targets(step, sctx)


def iter_id_targets(data: dict) -> Iterator[IdTarget]:
    """Every object in a lesson (or a bare single scene) that needs a stable id."""
    if not isinstance(data, dict):
        return
    if "scenes" in data:
        yield from _proof_targets(data, "")
        scenes = _dicts(data.get("scenes"))
        for i, (scene, sid) in enumerate(zip(scenes, build_ids(scenes, "title"))):
            yield IdTarget(scene, "scene", sid, f"scenes[{i}]", "scenes")
            yield from _scene_targets(scene, f"scenes[{i}]")
    else:
        # A bare scene: scene-builder output or a single-scene file.
        yield IdTarget(data, "scene", slugify(data.get("title")) or "0", "scene", "scene")
        yield from _scene_targets(data, "")


def missing_ids(data: dict) -> list[IdTarget]:
    """Targets without an explicit id; ``ident`` is the id the client derives."""
    return [t for t in iter_id_targets(data) if not t.explicit]


def id_to_write(t: IdTarget) -> str:
    """The id to write for a target that lacks one.

    Normally the client-derived id, so existing links keep resolving. An
    untitled object's derived id is only its index, which is not stable and
    reads as an integer-index token — use ``<kind>-<n>`` instead.
    """
    if t.untitled:
        n = int(t.ident) + 1 if t.ident.isdigit() else 1
        return f"{t.kind}-{n}"
    return t.ident


def assign_missing_ids(data: dict) -> list[tuple[IdTarget, str]]:
    """Write an id onto every target that lacks one, in place.

    Returns ``(target, id_written)`` for each change.
    """
    changed = []
    for t in missing_ids(data):
        ident = id_to_write(t)
        t.obj["id"] = ident
        changed.append((t, ident))
    return changed


def missing_id_errors(data: dict) -> list[str]:
    return [
        f'{t.path}: missing "id" (suggested: "{id_to_write(t)}")' for t in missing_ids(data)
    ]


def duplicate_id_errors(data: dict) -> list[str]:
    """Explicit ids repeated within one array.

    The client silently suffixes a duplicate, so a link written against the
    second copy would land on the first.
    """
    errors = []
    seen: dict[tuple[str, str], str] = {}
    for t in iter_id_targets(data):
        if not t.explicit:
            continue
        key = (t.scope, str(t.obj["id"]))
        if key in seen:
            errors.append(f'{t.path}: duplicate id "{t.obj["id"]}" (also at {seen[key]})')
        else:
            seen[key] = t.path
    return errors


def id_errors(data: dict) -> list[str]:
    """All stable-id problems: missing ids, then duplicates."""
    return missing_id_errors(data) + duplicate_id_errors(data)
