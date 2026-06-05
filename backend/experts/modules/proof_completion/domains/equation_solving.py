"""Equation solving: real goal-directed, multi-step derivations.

Each seed is a *scripted* chain where every step is a complete, groundable
equation a human would actually write while solving for x.
"""

from __future__ import annotations

import random

import sympy as sp

from .base import Seed, register_domain, x


def _linear(rng: random.Random) -> Seed:
    """ax + b = c  ->  ax = c - b  ->  x = root."""
    a = rng.randint(2, 7)
    root = rng.randint(1, 8)
    b = rng.randint(1, 9)
    c = a * root + b
    chain = (sp.Eq(a * x + b, c), sp.Eq(a * x, c - b), sp.Eq(x, sp.Integer(c - b) / a))
    return Seed("equation_solving", "solve the linear equation for x", chain[0], chain=chain)


def _quadratic_sqrt(rng: random.Random) -> Seed:
    """x^2 - k = 0  ->  x^2 = k  ->  x = r   (k a perfect square)."""
    r = rng.randint(2, 9)
    k = r * r
    chain = (sp.Eq(x ** 2 - k, 0), sp.Eq(x ** 2, k), sp.Eq(x, r))
    return Seed("equation_solving",
                "solve the quadratic by isolating x squared and taking the root",
                chain[0], chain=chain)


def _shifted_square(rng: random.Random) -> Seed:
    """(x + p)^2 = q  ->  x + p = s  ->  x = s - p   (q = s^2)."""
    p = rng.randint(1, 6)
    s = rng.randint(2, 7)
    q = s * s
    chain = (sp.Eq((x + p) ** 2, q), sp.Eq(x + p, s), sp.Eq(x, s - p))
    return Seed("equation_solving", "solve by taking the square root of both sides",
                chain[0], chain=chain)


def _isolate(rng: random.Random) -> Seed:
    """(a x)/d + b = c  ->  (a x)/d = c - b  ->  a x = d(c - b)  ->  x = root."""
    a = rng.randint(2, 5)
    d = rng.randint(2, 4)
    root = rng.randint(1, 6)
    b = rng.randint(1, 7)
    c = sp.Integer(a * root) / d + b
    chain = (
        sp.Eq(a * x / d + b, c),
        sp.Eq(a * x / d, c - b),
        sp.Eq(a * x, d * (c - b)),
        sp.Eq(x, root),
    )
    return Seed("equation_solving", "isolate x step by step", chain[0], chain=chain)


@register_domain("equation_solving")
def seeds(rng: random.Random) -> list[Seed]:
    return [_linear(rng), _quadratic_sqrt(rng), _shifted_square(rng), _isolate(rng)]
