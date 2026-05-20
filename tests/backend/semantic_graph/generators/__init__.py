"""Parametric test data generators for semantic graph domain suites."""

from .expressions import ExprTemplate, exhaustive, sampled
from .invariants import (
    PASS,
    XFAIL,
    SKIP,
    assert_universal_invariants,
    assert_valid_graph,
    assert_no_placeholder_leak,
    assert_pydantic_validates,
)
from .variables import (
    VARIABLES, GREEK, ACCENTED, DOT_DERIVATIVES, SUBSCRIPTED,
    COMPOUND, STYLED, ALL_VAR_STYLES,
)

__all__ = [
    "PASS",
    "XFAIL",
    "SKIP",
    "ExprTemplate",
    "exhaustive",
    "sampled",
    "assert_universal_invariants",
    "assert_valid_graph",
    "assert_no_placeholder_leak",
    "assert_pydantic_validates",
    "VARIABLES",
    "GREEK",
    "ACCENTED",
    "DOT_DERIVATIVES",
    "SUBSCRIPTED",
    "COMPOUND",
    "STYLED",
    "ALL_VAR_STYLES",
]
