"""Expert packages. Each subpackage is one self-contained expert that
self-registers (the expert module + its metric) on import. Adding an expert =
drop a package here.
"""

from __future__ import annotations

import importlib
import pkgutil


def discover_experts() -> None:
    """Import every expert subpackage so it self-registers."""
    import backend.experts.modules as pkg

    for info in pkgutil.iter_modules(pkg.__path__):
        if info.ispkg:  # only expert packages, not stray modules
            importlib.import_module(f"{pkg.__name__}.{info.name}")
