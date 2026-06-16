"""Canonical hierarchical ``context_id`` — parse / build / terminal.

A ``context_id`` is a path that uniquely identifies any target node in a lesson
document, mirroring its nesting, e.g.::

    root
    scene-sc1
    scene-sc1-step-st3
    scene-sc1-proof-p1-proofStep-ps2-semanticGraph

The **terminal segment type** (``root`` / ``scene`` / ``step`` / ``proof`` /
``proofStep`` / ``semanticGraph``) *is* the scope — it is used directly as the
``CONTEXT_MODELS`` key (a plain string, no name-branching). The segment values
locate the node, independent of array indices (which shift mid-run).

Slug constraint: because segments are joined and split on ``-``, scene/step/...
ids must not contain ``-`` (use :func:`slug` to sanitize).
"""

from __future__ import annotations

from dataclasses import dataclass

# Types that carry an id token (``<type>-<id>``).
TYPES_WITH_ID = ("scene", "step", "proof", "proofStep")
# Leaf types with no id token.
LEAF_TYPES = ("root", "semanticGraph")
KNOWN_TYPES = frozenset(TYPES_WITH_ID + LEAF_TYPES)


@dataclass(frozen=True)
class ParsedContextId:
    """Parsed form: ordered ``(type, id)`` segments + the terminal type."""

    segments: tuple[tuple[str, str | None], ...]
    terminal: str

    def id_for(self, type_: str) -> str | None:
        """The id of the first segment of ``type_`` (or None)."""
        for t, i in self.segments:
            if t == type_:
                return i
        return None


def slug(value: str) -> str:
    """Sanitize a raw id so it is safe as a ``context_id`` token (no ``-``)."""
    return value.replace("-", "_")


def parse(context_id: str) -> ParsedContextId:
    """Parse a ``context_id`` into ordered segments + terminal type."""
    if not isinstance(context_id, str) or not context_id:
        raise ValueError(f"empty context_id: {context_id!r}")

    tokens = context_id.split("-")
    segments: list[tuple[str, str | None]] = []
    i = 0
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t in TYPES_WITH_ID:
            if i + 1 >= n:
                raise ValueError(f"context_id {context_id!r}: {t!r} missing id")
            segments.append((t, tokens[i + 1]))
            i += 2
        elif t in LEAF_TYPES:
            segments.append((t, None))
            i += 1
        else:
            raise ValueError(f"context_id {context_id!r}: unknown segment {t!r}")

    if not segments:
        raise ValueError(f"context_id {context_id!r}: no segments")
    return ParsedContextId(segments=tuple(segments), terminal=segments[-1][0])


def build(
    *,
    root: bool = False,
    scene: str | None = None,
    step: str | None = None,
    proof: str | None = None,
    proof_step: str | None = None,
    semantic_graph: bool = False,
) -> str:
    """Build a canonical ``context_id`` from named parts."""
    if root:
        return "root"
    parts: list[str] = []
    if scene is not None:
        parts += ["scene", slug(scene)]
    if step is not None:
        parts += ["step", slug(step)]
    if proof is not None:
        parts += ["proof", slug(proof)]
    if proof_step is not None:
        parts += ["proofStep", slug(proof_step)]
    if semantic_graph:
        parts += ["semanticGraph"]
    if not parts:
        raise ValueError("build() received no segments")
    return "-".join(parts)


def terminal(context_id: str) -> str:
    """Shortcut: the scope (terminal segment type) of a ``context_id``."""
    return parse(context_id).terminal
