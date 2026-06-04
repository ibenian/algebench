"""Expert framework package.

``init_experts()`` is the single startup hook: configure DSPy, import the
self-registering modules/handlers/metrics, then load and cross-check
``experts.json``. The package never imports ``server`` — it is independent of
the chat/server stack.
"""

from __future__ import annotations

import importlib
import json
import os
import pkgutil

from .registry import (
    EXPERT_REGISTRY,
    HANDLER_REGISTRY,
    METRIC_REGISTRY,
    OUTPUT_REGISTRY,
    resolve_context_model,
)

_HERE = os.path.dirname(__file__)
EXPERTS_JSON = os.path.join(_HERE, "experts.json")


def _import_submodules(package_name: str) -> None:
    pkg = importlib.import_module(package_name)
    for info in pkgutil.iter_modules(pkg.__path__):
        importlib.import_module(f"{package_name}.{info.name}")


def discover() -> None:
    """Import everything that self-registers (outputs, modules, handlers, metrics)."""
    # outputs first so OUTPUT_REGISTRY is populated before cross-checks
    importlib.import_module("backend.experts.outputs")
    importlib.import_module("backend.experts.signatures")
    _import_submodules("backend.experts.modules")
    _import_submodules("backend.experts.handlers")
    importlib.import_module("backend.experts.metrics")


def load_config() -> dict:
    with open(EXPERTS_JSON, "r", encoding="utf-8") as fh:
        return json.load(fh)


def validate(config: dict) -> None:
    """Cross-check config against the registries; raise on any inconsistency."""
    for name, decl in config.items():
        if name not in EXPERT_REGISTRY:
            raise ValueError(f"experts.json: {name!r} has no registered module")
        spec = EXPERT_REGISTRY[name]
        if decl.get("context_scope") != spec.context_scope:
            raise ValueError(
                f"experts.json: {name!r} scope {decl.get('context_scope')!r} "
                f"!= module scope {spec.context_scope!r}"
            )
        # resolves (override or scope default) or raises
        resolve_context_model(spec)
        for kind in decl.get("outputs", []):
            if kind not in OUTPUT_REGISTRY:
                raise ValueError(f"experts.json: {name!r} output {kind!r} not registered")
            if kind not in HANDLER_REGISTRY:
                raise ValueError(f"experts.json: {name!r} output {kind!r} has no handler")
        if name not in METRIC_REGISTRY:
            raise ValueError(f"experts.json: {name!r} has no registered metric")


def init_experts(configure_lm: bool = True) -> dict:
    """Configure DSPy, discover registrations, load + validate config."""
    if configure_lm:
        from .llm_config import configure_dspy
        configure_dspy()
    discover()
    config = load_config()
    validate(config)
    return config
