"""Code-compare handler: the learner's code against the original, as a diff by meaning, with a walk through what matters.

Self-registers ``code_compare`` on import: ``discover_handlers()`` imports the package, so without this line the
decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
