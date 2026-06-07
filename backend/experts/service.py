"""Stateless expert invocation — the one place a request becomes signature input.

``invoke`` is the single converter, fully typed end to end:

1. ``scope = parse(context_id).terminal``                  (string key)
2. ``Model = resolve_context_model(spec)``                 (override or scope default)
3. ``ctx = Model.model_validate(payload)``                 (Pydantic validation gate)
4. ``module = spec.factory()``                             (a dspy.Module)
5. ``outputs = module(context=ctx, ...)``                  (a list[Output])
6. wrap in a single typed ``ExpertResult``

Contract: an expert's ``forward`` returns a ``list[Output]`` (it unwraps its own
DSPy ``Prediction`` field). ``ExpertResult`` validates that shape via Pydantic.
No dicts are produced here — serialization happens at the transport edge; the
consumer dispatches each output on its ``kind``. The backend stores nothing
between calls, and no ``Signature`` is constructed.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .context_id import parse
from .outputs import ExpertResult
from .registry import EXPERT_REGISTRY, HANDLER_REGISTRY, resolve_context_model


class UnknownExpert(KeyError):
    """Raised by ``run`` when ``name`` is neither a handler nor a registered expert."""


class _ExpertCall(BaseModel):
    """Shape of a generic (non-handler) expert request body — validated so a
    malformed body surfaces as a 422 (pydantic ValidationError) at the endpoint
    rather than a 500 KeyError."""

    model_config = ConfigDict(extra="ignore")
    context_id: str
    payload: dict
    instruction: str = ""
    lesson_context: str = ""


def run(name: str, body: dict) -> dict:
    """Turn one HTTP request body into an expert run, returning a JSON-able dict.

    The single dispatch point behind ``POST /api/expert/{name}``:

    * If ``name`` has a registered **handler**, validate ``body`` against the
      handler's ``request_model`` and let the handler do its pre/post-processing
      around ``invoke`` (it returns the dict verbatim).
    * Otherwise treat ``name`` as a plain expert: ``body`` carries
      ``context_id`` + ``payload`` (and optional ``instruction`` /
      ``lesson_context``); ``invoke`` runs it and we serialize the
      ``ExpertResult``.

    Adding an expert or handler needs no new endpoint — it self-registers.
    """
    spec = HANDLER_REGISTRY.get(name)
    if spec is not None:
        req = spec.request_model.model_validate(body)
        return spec.fn(req)

    if name in EXPERT_REGISTRY:
        call = _ExpertCall.model_validate(body)   # ValidationError -> 422 (not KeyError/500)
        result = invoke(
            name,
            call.context_id,
            call.payload,
            instruction=call.instruction,
            lesson_context=call.lesson_context,
        )
        return result.model_dump()

    raise UnknownExpert(name)


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
    outputs = module(
        context=ctx,
        context_id=context_id,
        lesson_context=lesson_context,
        instruction=instruction,
    )  # list[Output]; ExpertResult validates the shape

    return ExpertResult(expert=name, context_id=context_id, outputs=outputs)
