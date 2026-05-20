"""Frozen dataclass carrying the output of the preprocessing stage."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PreprocessResult:
    """Immutable output of the preprocessing stage."""

    cleaned_latex: str
    dotted_vars: dict[str, int]
    accent_map: dict[str, str]
    subscript_map: dict[str, str]
    annotations: list[dict]
