"""Per-domain example generators. One file per domain, each self-registering."""

from __future__ import annotations

import importlib
import pkgutil


def discover_domains() -> None:
    """Import every domain module so it self-registers into DOMAIN_REGISTRY."""
    for info in pkgutil.iter_modules(__path__):
        if info.name != "base":
            importlib.import_module(f"{__name__}.{info.name}")
