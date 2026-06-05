"""Expert framework package.

``init_experts()`` is the single startup hook: configure DSPy, then import every
expert package so it self-registers. Registration is entirely decorator-driven
(``@register_expert`` / ``@register_handler`` / ``@register_metric`` and the
``Output`` base) — there is no central config file. The registries *are* the
source of truth. The package never imports ``server``.
"""

from __future__ import annotations

from .registry import (  # re-exported for convenience
    EXPERT_REGISTRY,
    HANDLER_REGISTRY,
    METRIC_REGISTRY,
    OUTPUT_REGISTRY,
    resolve_context_model,
)


def discover() -> None:
    """Import every expert package so decorators populate the registries."""
    from .modules import discover_experts
    discover_experts()


def init_experts(configure_lm: bool = True) -> None:
    """Configure DSPy and discover all experts (decorator self-registration)."""
    if configure_lm:
        from .llm_config import configure_dspy
        configure_dspy()
    discover()
