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

from typing import Any, Optional

# Every pass that may rewrite the proposal, in the order the handler runs them.
STAGES = ("symbols", "extras", "view-ranges")

LEVELS = ("ok", "changed", "dropped", "warning")


def note(sink: Optional[list], stage: str, level: str, message: str,
         view: Optional[int] = None, **detail: Any) -> None:
    """Append one decision to *sink* (a no-op when the caller passed None).

    ``sink`` is optional throughout so every pass stays callable — and testable —
    without threading a collector through, which is how they were all written
    before this existed.
    """
    if sink is None:
        return
    entry: dict[str, Any] = {"stage": stage, "level": level, "message": message}
    if view is not None:
        entry["view"] = view
    if detail:
        entry["detail"] = detail
    sink.append(entry)


def summarize(entries: list) -> str:
    """One line naming what was corrected and what still looks wrong.

    The headline for a client that wants a badge rather than the whole trail.
    Warnings are counted separately and never omitted: a proposal that was left
    untouched BECAUSE it could not be checked is not the same as one that came
    back clean, and "returned as proposed" alone would report them identically.
    """
    changed = [e for e in entries if e.get("level") in ("changed", "dropped")]
    warned = [e for e in entries if e.get("level") == "warning"]

    parts = []
    if changed:
        by_stage: dict[str, int] = {}
        for e in changed:
            by_stage[e["stage"]] = by_stage.get(e["stage"], 0) + 1
        parts.append("corrected " + ", ".join(
            f"{n} in {stage}" for stage, n in by_stage.items()))
    if warned:
        parts.append(f"{len(warned)} warning" + ("s" if len(warned) > 1 else ""))
    return "; ".join(parts) if parts else "returned as proposed"
