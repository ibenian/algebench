"""Registries for the expert framework.

Everything extensible is a plain ``dict`` looked up by a string key — there is
**no** ``if``/``switch`` on expert names or context scopes anywhere in the
framework. Experts and metrics *self-register* via the decorators below, and
``discover_experts()`` imports the modules so registration happens on load.

Four registries: ``EXPERT_REGISTRY`` (name → :class:`ExpertSpec`),
``CONTEXT_MODELS`` (context_id terminal scope → default Pydantic model),
``METRIC_REGISTRY`` (name → DSPy metric), and ``HANDLER_REGISTRY`` (name →
:class:`HandlerSpec`). A *handler* wraps an expert call with custom
pre/post-processing (parse a feature request, build the context payload, call
``service.invoke``, post-process the outputs) behind the generic
``POST /api/expert/{name}`` endpoint; experts with no handler are reached
through the default ``invoke`` path. Experts still return typed ``Output``
objects directly and ``service.invoke`` wraps them in an
:class:`~backend.experts.outputs.ExpertResult`.

Adding an expert = drop a self-registering module under ``modules/``; adding a
handler = drop a self-registering module under ``handlers/``. No core-loop
edits, no config file.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional


# --------------------------------------------------------------------------- #
# Registry containers
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class ExpertSpec:
    """An expert's registration record.

    ``factory`` constructs a fresh ``dspy.Module`` instance (the optimizable
    unit). ``context_scope`` is a ``context_id`` terminal type. ``context_model``
    optionally overrides the default ``CONTEXT_MODELS[scope]`` for experts whose
    input is not a single document node (e.g. a two-graph transition).
    """

    name: str
    factory: Callable[[], Any]
    context_scope: str
    context_model: Optional[type] = None


@dataclass(frozen=True)
class HandlerSpec:
    """A handler's registration record.

    A handler is request→orchestration glue exposed at ``POST /api/expert/{name}``:
    ``fn`` takes a validated ``request_model`` instance and returns a JSON-able
    ``dict`` (it does the pre-processing, calls ``service.invoke`` for the actual
    expert, and post-processes the outputs). ``requires_experts`` asks the
    endpoint to ensure DSPy/experts are configured before the call (it almost
    always does, since handlers run experts). Concurrency/abuse is handled by the
    shared per-IP rate limiter at the endpoint, not here.
    """

    name: str
    fn: Callable[[Any], dict]
    request_model: type
    requires_experts: bool = True


# name -> ExpertSpec
EXPERT_REGISTRY: dict[str, ExpertSpec] = {}
# context_id terminal type -> default Pydantic context model
CONTEXT_MODELS: dict[str, type] = {}
# expert name -> DSPy metric callable
METRIC_REGISTRY: dict[str, Callable[..., Any]] = {}
# handler name -> HandlerSpec (custom pre/post wrapper around an expert call)
HANDLER_REGISTRY: dict[str, HandlerSpec] = {}


# --------------------------------------------------------------------------- #
# Decorators / registration helpers
# --------------------------------------------------------------------------- #

def register_expert(
    name: str,
    *,
    context_scope: str,
    context_model: Optional[type] = None,
) -> Callable[[type], type]:
    """Class decorator: register a ``dspy.Module`` subclass as an expert."""

    def deco(cls: type) -> type:
        if name in EXPERT_REGISTRY:
            raise ValueError(f"expert {name!r} already registered")
        EXPERT_REGISTRY[name] = ExpertSpec(
            name=name,
            factory=cls,
            context_scope=context_scope,
            context_model=context_model,
        )
        # convenience back-references on the class
        cls.expert_name = name  # type: ignore[attr-defined]
        cls.context_scope = context_scope  # type: ignore[attr-defined]
        cls.context_model = context_model  # type: ignore[attr-defined]
        return cls

    return deco


def register_handler(
    name: str,
    *,
    request_model: type,
    requires_experts: bool = True,
) -> Callable[[Callable], Callable]:
    """Decorator: register a function as a handler for ``POST /api/expert/{name}``.

    The decorated ``fn(req)`` receives a validated ``request_model`` instance and
    returns a JSON-able ``dict``. The handler name is independent of the expert
    name(s) it calls — it decides which expert(s) to invoke.
    """

    def deco(fn: Callable) -> Callable:
        if name in HANDLER_REGISTRY:
            raise ValueError(f"handler {name!r} already registered")
        HANDLER_REGISTRY[name] = HandlerSpec(
            name=name,
            fn=fn,
            request_model=request_model,
            requires_experts=requires_experts,
        )
        return fn

    return deco


def register_metric(name: str) -> Callable[[Callable], Callable]:
    """Decorator: register an expert's DSPy metric (keyed by expert name)."""

    def deco(fn: Callable) -> Callable:
        METRIC_REGISTRY[name] = fn
        return fn

    return deco


def register_context_model(scope: str, model: type) -> None:
    """Register the default context model for a ``context_id`` terminal scope."""
    CONTEXT_MODELS[scope] = model


def resolve_context_model(spec: ExpertSpec) -> type:
    """The context model an expert consumes: its override, else the scope default."""
    if spec.context_model is not None:
        return spec.context_model
    try:
        return CONTEXT_MODELS[spec.context_scope]
    except KeyError as exc:  # pragma: no cover - guarded at startup
        raise KeyError(
            f"no context model for scope {spec.context_scope!r} "
            f"(expert {spec.name!r}); register one or set context_model"
        ) from exc
