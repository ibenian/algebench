"""Code-alternatives handler: other solutions to the same problem in the lesson, and any two of them side by side.

Self-registers ``code_alternatives`` on import: ``discover_handlers()`` imports the package, so without this line the
decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
