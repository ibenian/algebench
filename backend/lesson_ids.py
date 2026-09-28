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
- proofs: id, else slug(title), else ``_idx_<n>`` (``proofId``). Root-, scene-
  and step-level proofs are flattened into ONE list (``collectAllProofs``) and
  ``pf=`` is resolved against all of it, so proof ids are unique lesson-wide;
  ``n`` is the position in that flattened list

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
        head = slug[:limit + 1]
        # Cut at the last word boundary within the cap; a single long word has
        # none, so hard-truncate it.
        slug = head.rsplit("-", 1)[0] if "-" in head else slug[:limit]
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


#: Scope of proof ids: the whole lesson (see the module docstring).
PROOF_SCOPE = "proofs"


def _proof_targets(holder: dict, ctx: str, counter: list[int]) -> Iterator[IdTarget]:
    """``counter[0]`` is the proof's index in the client's flattened list, which
    visits proofs in the same order as this walk: root, then per scene its own
    proofs followed by its steps' proofs."""
    raw = holder.get("proof")
    proofs = [raw] if isinstance(raw, dict) else _dicts(raw)
    for pi, proof in enumerate(proofs):
        pctx = f"{ctx}.proof[{pi}]" if isinstance(raw, list) else f"{ctx}.proof"
        pctx = pctx.lstrip(".")
        pid = str(proof.get("id") or slugify(proof.get("title")) or f"_idx_{counter[0]}")
        counter[0] += 1
        yield IdTarget(proof, "proof", pid, pctx, PROOF_SCOPE)
        steps = _dicts(proof.get("steps"))
        for si, (step, sid) in enumerate(zip(steps, build_ids(steps, "label"))):
            yield IdTarget(step, "proof-step", sid, f"{pctx}.steps[{si}]", pctx)


def _scene_targets(scene: dict, ctx: str, counter: list[int]) -> Iterator[IdTarget]:
    yield from _proof_targets(scene, ctx, counter)
    steps = _dicts(scene.get("steps"))
    for i, (step, sid) in enumerate(zip(steps, build_ids(steps, "title"))):
        sctx = f"{ctx}.steps[{i}]".lstrip(".")
        yield IdTarget(step, "step", sid, sctx, f"{ctx}.steps")
        yield from _proof_targets(step, sctx, counter)


def iter_id_targets(data: dict) -> Iterator[IdTarget]:
    """Every object in a lesson (or a bare single scene) that needs a stable id."""
    if not isinstance(data, dict):
        return
    counter = [0]
    if "scenes" in data:
        yield from _proof_targets(data, "", counter)
        scenes = _dicts(data.get("scenes"))
        for i, (scene, sid) in enumerate(zip(scenes, build_ids(scenes, "title"))):
            yield IdTarget(scene, "scene", sid, f"scenes[{i}]", "scenes")
            yield from _scene_targets(scene, f"scenes[{i}]", counter)
    else:
        # A bare scene: scene-builder output or a single-scene file. Its own
        # proof is the file-level one, visited once, as the client does.
        yield IdTarget(data, "scene", slugify(data.get("title")) or "0", "scene", "scene")
        yield from _scene_targets(data, "", counter)


def missing_ids(data: dict) -> list[IdTarget]:
    """Targets without an explicit id; ``ident`` is the id the client derives."""
    return [t for t in iter_id_targets(data) if not t.explicit]


def id_to_write(t: IdTarget) -> str:
    """The id to write for a target that lacks one.

    Normally the client-derived id, so existing links keep resolving. The one
    exception is an untitled scene/step/proof step whose derived id is a BARE
    index (``3``): that is not stable, and a link carrying it still resolves
    through the integer-index fallback, so it gets ``<kind>-<n>`` instead
    (made unique by ``assign_missing_ids``). A collision-resolved fallback such
    as ``1-2`` is not an integer — no fallback would catch it — so it is kept,
    as is an untitled proof's ``_idx_<n>``.
    """
    if t.untitled and t.kind != "proof" and t.ident.isdigit():
        return f"{t.kind}-{int(t.ident) + 1}"
    return t.ident


def assign_missing_ids(data: dict) -> list[tuple[IdTarget, str]]:
    """Write an id onto every target that lacks one, in place.

    Returns ``(target, id_written)`` for each change.

    Existing content keeps the id the client resolves for it today, so no link
    moves. One legacy layout has no safe answer: a derived id that an explicit
    id elsewhere in the scope also claims (``[{title: Intro}, {id: intro}]``
    resolves as ``intro`` / ``intro-2`` on the client, so either write swaps
    or duplicates a link target). Those are left unwritten and reported by
    ``ambiguous_id_errors`` for a human to settle. New content should get its
    ids BEFORE it joins the lesson (see ``assemble_scene.py``).
    """
    targets = list(iter_id_targets(data))
    taken: dict[str, set[str]] = {}
    for t in targets:
        if t.explicit:
            taken.setdefault(t.scope, set()).add(str(t.obj["id"]))
    changed = []
    for t in targets:
        if t.explicit:
            continue
        scope = taken.setdefault(t.scope, set())
        ident = id_to_write(t)
        if ident == t.ident:
            if ident in scope:  # ambiguous legacy layout — see above
                continue
            scope.add(ident)
        else:  # a renamed index fallback: no link carries it, so just be unique
            ident = unique_id(ident, scope)
        t.obj["id"] = ident
        changed.append((t, ident))
    return changed


def ambiguous_id_errors(data: dict) -> list[str]:
    """Id-less targets whose client-resolved id an explicit id also claims."""
    explicit = {(t.scope, str(t.obj["id"])) for t in iter_id_targets(data) if t.explicit}
    return [
        f'{t.path}: missing "id", and its current link id "{t.ident}" is also an '
        f'explicit id elsewhere — assign both ids by hand'
        for t in missing_ids(data)
        if id_to_write(t) == t.ident and (t.scope, t.ident) in explicit
    ]


def missing_id_errors(data: dict) -> list[str]:
    return [
        f'{t.path}: missing "id" (suggested: "{id_to_write(t)}")' for t in missing_ids(data)
    ]


def duplicate_id_errors(data: dict) -> list[str]:
    """Explicit ids repeated within their scope: the containing array, or the
    whole lesson for proofs.

    A link written against the second copy would land on the first.
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


def _title_key(title: Any) -> str:
    """Exact title, whitespace-normalized. Not the slug: ``A+B`` and ``A B``
    slug alike but are different steps."""
    return " ".join(str(title or "").split())


def _carry(old_items: list[dict], old_ids: list[str], new_items: list[dict],
           key: str, mint: str) -> list[tuple[dict, dict]]:
    """Give each new item the resolved id of the old item with the same
    ``key`` (repeated titles matched in order), unique within ``new_items``.
    Returns the ``(old, new)`` pairs that matched."""
    queues: dict[str, list[tuple[dict, str]]] = {}
    for o, oid in zip(old_items, old_ids):
        if oid and _title_key(o.get(key)):
            queues.setdefault(_title_key(o.get(key)), []).append((o, oid))
    taken: set[str] = set()
    pairs, fresh = [], []
    for n in new_items:
        queue = queues.get(_title_key(n.get(key)))
        o, keep = queue.pop(0) if queue else (None, None)
        if keep and keep not in taken:
            n["id"] = keep
            taken.add(keep)
            pairs.append((o, n))
        else:
            fresh.append(n)
    for n in fresh:
        n["id"] = unique_id(str(n.get("id") or readable_slug(n.get(key), mint)), taken)
    return pairs


def _scene_proofs(scene: dict) -> list[dict]:
    """The scene's own proofs followed by its steps' proofs."""
    out = []
    for holder in [scene, *_dicts(scene.get("steps"))]:
        raw = holder.get("proof")
        out += [raw] if isinstance(raw, dict) else _dicts(raw)
    return out


def carry_ids(old: dict, new: dict, old_id: str) -> None:
    """Keep a replaced scene's ids on its replacement, in place.

    The scene keeps ``old_id`` (its resolved id, which links already use). Each
    new step whose title matches an old step's takes that step's resolved id,
    and likewise each proof (by title) and, within a matched proof, each proof
    step (by label) — so ``st=``, ``pf=`` and ``ps=`` links into the scene keep
    landing on the same content. Titles match exactly (whitespace-normalized),
    repeats in order. Unmatched items keep their own id, made unique among
    their siblings; proof ids are lesson-wide, which the validator checks.
    """
    new["id"] = old_id
    old_steps, new_steps = _dicts(old.get("steps")), _dicts(new.get("steps"))
    _carry(old_steps, build_ids(old_steps, "title"), new_steps, "title", "step")
    old_proofs = _scene_proofs(old)
    old_pids = [str(p.get("id") or slugify(p.get("title"))) for p in old_proofs]
    new_proofs = _scene_proofs(new)
    queues: dict[str, list[tuple[dict, str]]] = {}
    for p, pid in zip(old_proofs, old_pids):
        if pid and _title_key(p.get("title")):
            queues.setdefault(_title_key(p.get("title")), []).append((p, pid))
    for proof in new_proofs:
        queue = queues.get(_title_key(proof.get("title")))
        if not queue:
            continue
        old_proof, pid = queue.pop(0)
        proof["id"] = pid
        old_ps = _dicts(old_proof.get("steps"))
        _carry(old_ps, build_ids(old_ps, "label"), _dicts(proof.get("steps")),
               "label", "proof-step")
