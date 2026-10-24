"""Code-practice handler: reviews code a learner types against a lesson's code.

Self-registers ``code_practice`` on import: ``discover_handlers()`` imports the
package, so without this line the decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
