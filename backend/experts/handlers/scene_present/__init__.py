"""Scene-present handler: a laser-pointer walk-through of the view, answering a question about it.

Self-registers ``scene_present`` on import: ``discover_handlers()`` imports the package, so without this line the
decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
