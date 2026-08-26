"""Scene-builder handler — author one lesson scene from a natural-language ask.

Self-registers ``build_scene`` on import (see the package docstring in
``backend/experts/handlers/__init__.py``): ``discover_handlers()`` imports the
PACKAGE, so without the line below the decorator in ``handler.py`` never runs and
the endpoint 404s while every test that imports it directly still passes.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
