"""A record of what the server did to the proposer's answer before returning it.

Between the LM's proposal and the artifact a client renders sit several passes
that silently rewrite it: symbols the CAS report doesn't know get flagged,
companion plots and annotations that won't compile get dropped, sweeps the curve
is flat across get widened.  Each pass knew exactly what it changed and threw
that away, so the artifact arrived looking like something the proposer wrote —
including the parts it didn't.

This collects those decisions into a list the response carries back, so "why is
this range not what the model asked for?" has an answer in the payload instead of
requiring someone to read the server log.  Entries are ordinary prose, addressed
to whoever is looking at the artifact:

    the proposer's sweep h ∈ [-5, 20] is flat at its own pinned values
    (the curve varies by 1.7% across it) — widened to [-10240, 40960]

``level`` separates the two audiences: ``changed``/``dropped`` are corrections
someone should see, while ``ok`` is the routine "looked, nothing to do" that
makes the trail complete rather than a list of complaints.
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

log = logging.getLogger(__name__)

# Every pass that may rewrite the proposal, in the order the handler runs them.
Stage = Literal["symbols", "extras", "view-ranges"]

# ``ok`` — looked, nothing to do. ``changed`` — the server rewrote something.
# ``dropped`` — the server removed something. ``warning`` — left as proposed, but
# something is wrong with it.
Level = Literal["ok", "changed", "dropped", "warning"]


class BuildNote(BaseModel):
    """One decision, typed.

    A model rather than a dict specifically for ``stage`` and ``level``: both are
    switched on downstream (:func:`summarize` buckets by level, a client filters
    by stage), so a typo in either is not a cosmetic error — the entry silently
    lands in no bucket and disappears from the summary, which is precisely the
    swallowed-warning failure this module exists to prevent.
    """

    model_config = ConfigDict(extra="forbid")

    stage: Stage
    level: Level
    message: str
    # Viewport ID (``v1-h``), never an ordinal — by the time these are read, a
    # later pass may have dropped or reordered what a position pointed at.
    view: Optional[str] = None
    # Raw values behind the prose, so a client can render either without parsing
    # the message back apart. Shape varies by stage, hence a bare dict.
    detail: dict[str, Any] = Field(default_factory=dict)


def note(sink: Optional[list], stage: str, level: str, message: str,
         view: Optional[str] = None, **detail: Any) -> None:
    """Append one decision to *sink* (a no-op when the caller passed None).

    ``sink`` is optional throughout so every pass stays callable — and testable —
    without threading a collector through, which is how they were all written
    before this existed.

    A bad stage/level is a programming error, but it is an error in TELEMETRY:
    it gets logged and dropped rather than raised, because failing an analysis
    request over a malformed note would be a worse outcome than losing the note.
    """
    if sink is None:
        return
    try:
        sink.append(BuildNote(stage=stage, level=level, message=message,
                              view=view, detail=detail))
    except ValidationError as e:
        log.error("[build-log] refusing malformed note (stage=%r level=%r): %s",
                  stage, level, e)


def serialize(entries: list[BuildNote]) -> list[dict]:
    """Wire form: drop the empty optionals rather than ship a payload of nulls."""
    return [e.model_dump(exclude_none=True, exclude_defaults=False)
            for e in entries]


def summarize(entries: list[BuildNote]) -> str:
    """One line naming what was corrected and what still looks wrong.

    The headline for a client that wants a badge rather than the whole trail.
    Warnings are counted separately and never omitted: a proposal that was left
    untouched BECAUSE it could not be checked is not the same as one that came
    back clean, and "returned as proposed" alone would report them identically.
    """
    changed = [e for e in entries if e.level in ("changed", "dropped")]
    warned = [e for e in entries if e.level == "warning"]

    parts = []
    if changed:
        by_stage: dict[str, int] = {}
        for e in changed:
            by_stage[e.stage] = by_stage.get(e.stage, 0) + 1
        parts.append("corrected " + ", ".join(
            f"{n} in {stage}" for stage, n in by_stage.items()))
    if warned:
        parts.append(f"{len(warned)} warning" + ("s" if len(warned) > 1 else ""))
    return "; ".join(parts) if parts else "returned as proposed"
