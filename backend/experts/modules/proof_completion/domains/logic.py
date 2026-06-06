"""Logic: implications whose consequent is rewritten step by step (the
antecedent and the => connective are preserved; each step is groundable).
"""

from __future__ import annotations

import random

import sympy as sp

from .base import Seed, register_domain, x


def _implication_factor(rng: random.Random) -> Seed:
    """x > k  =>  x^2 > k^2   ->   x^2 - k^2 > 0   ->   (x - k)(x + k) > 0.

    (Difference-of-squares factoring renders as a product of two binomials,
    avoiding the ``x(...)`` latex that the parser misreads as a function call.)
    """
    k = rng.randint(1, 5)
    chain = (
        sp.Implies(sp.Gt(x, k), sp.Gt(x ** 2, k ** 2)),
        sp.Implies(sp.Gt(x, k), sp.Gt(x ** 2 - k ** 2, 0)),
        sp.Implies(sp.Gt(x, k), sp.Gt((x - k) * (x + k), 0)),
    )
    return Seed("logic", "rewrite the implication's consequent by factoring",
                chain[0], chain=chain)


@register_domain("logic")
def seeds(rng: random.Random) -> list[Seed]:
    return [_implication_factor(rng)]
