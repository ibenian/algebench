"""Stateless expert invocation — the one place a request becomes signature input.

``invoke`` is the single converter, fully typed end to end:

1. ``scope = parse(context_id).terminal``                  (string key)
2. ``Model = resolve_context_model(spec)``                 (override or scope default)
3. ``ctx = Model.model_validate(payload)``                 (Pydantic validation gate)
4. ``module = spec.factory()``                             (a dspy.Module)
5. ``outputs = module(context=ctx, ...)``                  (typed Output(s) back)
6. wrap everything in a single typed ``ExpertResult``

No dicts are produced here — serialization happens at the transport edge. Outputs
are typed payloads keyed by their ``kind``; the consumer dispatches on ``kind``.
The backend stores nothing between calls, and no ``Signature`` is constructed
(kwargs bind to the signature's ``InputField`` names).
"""

from __future__ import annotations

from .context_id import parse
from .outputs import ExpertResult, Output
from .registry import EXPERT_REGISTRY, resolve_context_model


def invoke(
    name: str,
    context_id: str,
    payload: dict,
    instruction: str = "",
    lesson_context: str = "",
) -> ExpertResult:
    """Run expert ``name`` against ``context_id``; return a typed ExpertResult."""
    spec = EXPERT_REGISTRY[name]  # KeyError = unknown expert (caller's bug)

    scope = parse(context_id).terminal
    if scope != spec.context_scope:
        raise ValueError(
            f"expert {name!r} expects scope {spec.context_scope!r} "
            f"but context_id {context_id!r} has terminal {scope!r}"
        )

    model = resolve_context_model(spec)
    ctx = model.model_validate(payload)  # <-- validation / injection gate

    module = spec.factory()
    raw = module(
        context=ctx,
        context_id=context_id,
        lesson_context=lesson_context,
        instruction=instruction,
    )

    return ExpertResult(expert=name, context_id=context_id, outputs=_normalize(raw))


def _normalize(raw) -> list[Output]:
    """Normalize a module's return into a flat list of typed Outputs."""
    if isinstance(raw, Output):
        return [raw]
    if isinstance(raw, (list, tuple)):
        flat: list[Output] = []
        for item in raw:
            flat.extend(_normalize(item))
        return flat
    # a dspy.Prediction or similar — pull the obvious output field(s)
    for attr in ("outputs", "trajectory"):
        if hasattr(raw, attr):
            return _normalize(getattr(raw, attr))
    raise TypeError(f"cannot normalize module output of type {type(raw).__name__}")
