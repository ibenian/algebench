"""Code-assist handler: takes over Type along's editor to write the next part of the code, step by step.

Self-registers ``code_assist`` on import: ``discover_handlers()`` imports the package, so without this line the
decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
