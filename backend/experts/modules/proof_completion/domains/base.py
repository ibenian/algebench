"""Shared base for per-domain example generators.

Each domain lives in its own file in this package and registers a seed builder
via ``@register_domain("name")``. Adding a domain = drop a file here; the
generator discovers it automatically. A seed builder takes a seeded
``random.Random`` and returns a list of :class:`Seed`.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable

import sympy as sp

# Shared symbols used across domains.
x, y, a, b, c, n = sp.symbols("x y a b c n")


@dataclass(frozen=True)
class Seed:
    """A starting point for one example.

    ``expr`` seeds a *random* rewrite chain. ``chain`` (when set) is an explicit
    *scripted* derivation — a tuple of sympy expressions/equations used verbatim,
    for real goal-directed multi-step derivations.
    """

    domain: str
    intent: str
    expr: sp.Expr
    chain: tuple = ()


# domain name -> seed builder
DOMAIN_REGISTRY: dict[str, Callable[[random.Random], list]] = {}


def register_domain(name: str):
    """Decorator: register a domain's seed builder under ``name``."""

    def deco(fn: Callable[[random.Random], list]) -> Callable:
        if name in DOMAIN_REGISTRY:
            raise ValueError(f"domain {name!r} already registered")
        DOMAIN_REGISTRY[name] = fn
        return fn

    return deco
