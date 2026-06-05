"""Rational expressions: combine, simplify, common denominators."""

from __future__ import annotations

import random

from .base import Seed, a, b, register_domain, x, y


@register_domain("rational")
def seeds(rng: random.Random) -> list[Seed]:
    return [
        Seed("rational", "combine the fractions", 1 / x + 1 / (x + 1)),
        Seed("rational", "subtract the fractions", 1 / (x - 1) - 1 / (x + 1)),
        Seed("rational", "combine over a common denominator", a / x + b / y),
        Seed("rational", "simplify the rational expression", (x ** 2 - 1) / (x - 1)),
        Seed("rational", "simplify the rational expression", (x ** 2 - 4) / (x - 2)),
        Seed("rational", "split into partial fractions", 1 / (x * (x + 1))),
    ]
