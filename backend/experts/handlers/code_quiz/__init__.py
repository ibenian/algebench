"""Code-quiz handler: asks the learner a question about the code they are typing, and judges the answer.

Self-registers ``code_quiz`` on import: ``discover_handlers()`` imports the package, so without this line the
decorator never runs and the endpoint 404s.
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
