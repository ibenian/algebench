"""Proof-edit handler — natural-language step operations on an open proof.

Self-registers ``proof_edit`` on import (see the package docstring in
``backend/experts/handlers/__init__.py``).
"""
from __future__ import annotations

from . import handler  # noqa: F401  (import for the @register_handler side effect)
