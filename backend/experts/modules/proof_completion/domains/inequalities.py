"""Inequality solving: real multi-step derivations, including the sign flip
when dividing by a negative. Every step is a complete, groundable inequality.
"""

from __future__ import annotations

import random

import sympy as sp

from .base import Seed, register_domain, x


def _linear_lt(rng: random.Random) -> Seed:
    """a x + b < c  ->  a x < c - b  ->  x < bound."""
    a = rng.randint(2, 6)
    bound = rng.randint(1, 7)
    b = rng.randint(1, 8)
    c = a * bound + b
    chain = (sp.Lt(a * x + b, c), sp.Lt(a * x, c - b), sp.Lt(x, bound))
    return Seed("inequalities", "solve the linear inequality for x", chain[0], chain=chain)


def _linear_ge(rng: random.Random) -> Seed:
    """a x - b >= c  ->  a x >= c + b  ->  x >= bound."""
    a = rng.randint(2, 6)
    bound = rng.randint(1, 7)
    b = rng.randint(1, 8)
    c = a * bound - b
    chain = (sp.Ge(a * x - b, c), sp.Ge(a * x, c + b), sp.Ge(x, bound))
    return Seed("inequalities", "solve the inequality for x", chain[0], chain=chain)


def _sign_flip(rng: random.Random) -> Seed:
    """-a x + b < c  ->  -a x < c - b  ->  x > -bound  (dividing by negative flips)."""
    a = rng.randint(2, 5)
    b = rng.randint(1, 6)
    bound = rng.randint(1, 5)
    c = a * bound + b
    chain = (
        sp.Lt(-a * x + b, c),
        sp.Lt(-a * x, c - b),
        sp.Gt(x, -bound),  # divide by -a: inequality flips
    )
    return Seed("inequalities",
                "solve the inequality, flipping the sign when dividing by a negative",
                chain[0], chain=chain)


@register_domain("inequalities")
def seeds(rng: random.Random) -> list[Seed]:
    return [_linear_lt(rng), _linear_ge(rng), _sign_flip(rng)]
