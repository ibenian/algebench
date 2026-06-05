"""Algebra: expand / factor polynomial expressions (random rewrite chains)."""

from __future__ import annotations

import random

from .base import Seed, a, b, register_domain, x


@register_domain("algebra")
def seeds(rng: random.Random) -> list[Seed]:
    p, q = rng.randint(1, 5), rng.randint(1, 5)
    return [
        Seed("algebra", "expand the square", (x + p) ** 2),
        Seed("algebra", "expand the squared difference", (x - p) ** 2),
        Seed("algebra", "expand the product", (x + p) * (x + q)),
        Seed("algebra", "expand the cube", (x + 1) ** 3),
        Seed("algebra", "expand the product of conjugates", (a - b) * (a + b)),
        Seed("algebra", "factor the difference of squares", a ** 2 - b ** 2),
        Seed("algebra", "expand the binomial", (p * x + q) ** 2),
        Seed("algebra", "factor the perfect-square trinomial",
             x ** 2 + 2 * p * x + p * p),
    ]
