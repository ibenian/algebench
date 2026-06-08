"""Expert *handlers*. Each subpackage is one self-contained handler that
self-registers (``@register_handler``) on import.

A handler wraps a registered expert with custom pre/post-processing behind the
generic ``POST /api/expert/{name}`` endpoint — see ``README.md``. Adding a
handler = drop a package here; ``discover_handlers()`` imports it so the
decorator runs.
"""

from __future__ import annotations

import importlib
import pkgutil


def discover_handlers() -> None:
    """Import every handler subpackage so it self-registers."""
    import backend.experts.handlers as pkg

    for info in pkgutil.iter_modules(pkg.__path__):
        if info.ispkg:  # only handler packages, not stray modules
            importlib.import_module(f"{pkg.__name__}.{info.name}")
