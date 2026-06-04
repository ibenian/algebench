"""Calculus: differentiation (power, product, quotient, composite, polynomial)."""

from __future__ import annotations

import random

import sympy as sp

from .base import Seed, register_domain, x


@register_domain("calculus")
def seeds(rng: random.Random) -> list[Seed]:
    k = rng.randint(2, 4)
    return [
        Seed("calculus", "differentiate the power", sp.Derivative(x ** k, x)),
        Seed("calculus", "differentiate the polynomial",
             sp.Derivative(x ** 3 + x, x)),
        Seed("calculus", "differentiate the product",
             sp.Derivative(x * sp.sin(x), x)),
        Seed("calculus", "differentiate the quotient",
             sp.Derivative(x / (x + 1), x)),
        Seed("calculus", "differentiate the composite",
             sp.Derivative(sp.sin(x ** 2), x)),
        Seed("calculus", "differentiate the exponential",
             sp.Derivative(sp.exp(k * x), x)),
    ]
