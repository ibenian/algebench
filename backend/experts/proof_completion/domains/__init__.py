"""Per-domain example generators. One file per domain, each self-registering."""

from __future__ import annotations

import importlib
import pkgutil


def discover_domains() -> None:
    """Import every domain module so it self-registers into DOMAIN_REGISTRY."""
    import backend.experts.proof_completion.domains as pkg

    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name != "base":
            importlib.import_module(f"{pkg.__name__}.{info.name}")
