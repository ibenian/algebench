"""``POST /api/expert/scene_present``: the beats of a laser-pointer walk-through answering a question.

Returns ``{"result": {"steps": [{say, target, mark, frame}]}}``, or ``{"reason": ...}`` when the model failed or had
nothing to show. A ``target`` is one of the request's refs (else empty); a ``frame`` is a state of the run (else -1).
"""
from __future__ import annotations

import logging

from backend.experts.modules.scene_present.intent import present
from backend.experts.registry import register_handler

from .models import ScenePresentRequest

log = logging.getLogger(__name__)

LOG_TAG = "[scene_present]"
NOTHING = "I couldn't find anything on screen to walk you through for that. Try asking in the chat instead."


def render_inputs(req: ScenePresentRequest) -> dict:
    """The presenter's inputs, all ``str``."""
    frames = ""
    if req.frames:
        frames = "\n".join(f"{f.n}: {f.text.strip()}" + (f"  [{f.state.strip()}]" if f.state.strip() else "") for f in req.frames)
        frames += f"\non screen now: {req.frame}" if req.frame >= 0 else ""
    return {
        "question": req.question.strip(),
        "lesson": req.lesson.strip(),
        "view": req.view.strip() or "(nothing described)",
        "frames": frames,
        "targets": "\n".join(f"{t.ref}: {t.about.strip()}" if t.about.strip() else t.ref for t in req.targets),
        "on_view": _on_view(req),
    }


def _on_view(req: ScenePresentRequest) -> str:
    """What earlier walk-throughs left on the view, one per line: notes, board lines, drawn shapes by id."""
    v = req.on_view
    # An arrow comes with the notes, named by what it joins ("arrow: a -> b").
    lines = [t if t.startswith("arrow: ") else f"note: {t}" for t in v.notes] + [f"board: {t}" for t in v.board]
    for d in v.drawn:
        joins = f" ({' -> '.join(d.joins)})" if d.joins else ""
        lines.append(f"draw:{d.id}: {d.type}{f' {d.label!r}' if d.label else ''}{joins}")
    return "\n".join(lines) or "(nothing: the view is clean)"


@register_handler("scene_present", request_model=ScenePresentRequest, speaks=True)
def scene_present(req: ScenePresentRequest) -> dict:
    out = present({t.ref for t in req.targets}, len(req.frames), left=req.on_view, **render_inputs(req))
    if out.error:
        return {"reason": out.error}
    if not out.steps:
        return {"reason": NOTHING}
    log.info("%s %d beat(s), %d pointing, %d moving, %d drawing", LOG_TAG, len(out.steps),
             sum(bool(s.target) for s in out.steps), sum(s.frame >= 0 for s in out.steps), sum(bool(s.draw) for s in out.steps))
    return {"result": out.model_dump(exclude={"error"})}
