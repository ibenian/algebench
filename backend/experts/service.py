"""Stateless expert invocation — the one place a request becomes signature input.

``invoke`` is the single converter:

1. ``scope = parse(context_id).terminal``                  (string key)
2. ``Model = resolve_context_model(spec)``                 (override or scope default)
3. ``ctx = Model.model_validate(payload)``                 (Pydantic validation gate)
4. ``module = spec.factory()``                             (a dspy.Module)
5. ``outputs = module(context=ctx, ...)``                  (kwarg binding → DSPy renders)
6. ``HANDLER_REGISTRY[out.kind](out, ...)`` for each       (registry lookup, no branching)

The backend stores nothing between calls. No ``Signature`` is ever constructed
here — kwargs bind to the signature's ``InputField`` names and DSPy renders the
prompt.
"""

from __future__ import annotations

from typing import Any

from .context_id import parse
from .registry import (
    EXPERT_REGISTRY,
    HANDLER_REGISTRY,
    resolve_context_model,
)


def invoke(
    name: str,
    context_id: str,
    payload: dict,
    instruction: str = "",
    lesson_context: str = "",
) -> list[dict]:
    """Run expert ``name`` against ``context_id`` and return normalized results."""
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
    outputs = module(
        context=ctx,
        context_id=context_id,
        lesson_context=lesson_context,
        instruction=instruction,
    )

    return [_handle(out, context_id=context_id) for out in outputs]


def _handle(out: Any, *, context_id: str) -> dict:
    handler = HANDLER_REGISTRY[out.kind]  # KeyError = output kind has no handler
    return handler(out, context_id=context_id)
