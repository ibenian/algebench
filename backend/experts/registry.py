"""Registries for the expert framework.

Everything extensible is a plain ``dict`` looked up by a string key — there is
**no** ``if``/``switch`` on expert names, context scopes, output kinds, or
handler names anywhere in the framework. Experts, output types, handlers, and
metrics *self-register* via the decorators below (or, for outputs, via the
``__init_subclass__`` hook in :mod:`backend.experts.outputs`).

Adding an expert = drop a self-registering module + a handler + an
``experts.json`` entry. No core-loop edits.
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


# name -> ExpertSpec
EXPERT_REGISTRY: dict[str, ExpertSpec] = {}
# context_id terminal type -> default Pydantic context model
CONTEXT_MODELS: dict[str, type] = {}
# output kind -> handler callable (the kind comes from the Output's `kind` field)
HANDLER_REGISTRY: dict[str, Callable[..., Any]] = {}
# expert name -> DSPy metric callable
METRIC_REGISTRY: dict[str, Callable[..., Any]] = {}


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


def register_handler(kind: str) -> Callable[[Callable], Callable]:
    """Decorator: register an output-kind handler."""

    def deco(fn: Callable) -> Callable:
        if kind in HANDLER_REGISTRY:
            raise ValueError(f"handler for kind {kind!r} already registered")
        HANDLER_REGISTRY[kind] = fn
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
