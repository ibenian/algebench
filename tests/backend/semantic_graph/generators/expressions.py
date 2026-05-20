"""Parametric cross-product expression generator.

Sweeps the parser's feature matrix across structure × relation × variable
decoration × operator axes.  Two modes:

- ``exhaustive()`` — structure × relation × decoration (~200 combos, runs on CI)
- ``sampled(seed, n)`` — random draw from the full cross-product
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass

from tests.backend.semantic_graph.generators.variables import ALL_VAR_STYLES


STRUCTURES: dict[str, str] = {
    "single":      "{lhs} {rel} {rhs}",
    "chained_2":   "{lhs} {rel} {mid} {rel} {rhs}",
    "stmt_sep":    r"{lhs} {rel} {rhs} \\ {lhs2} {rel} {rhs2}",
    "connective":  r"{lhs} {rel} {rhs} \implies {lhs2} {rel2} {rhs2}",
}

RELATIONS: tuple[str, ...] = (
    "=",
    r"\approx",
    r"\leq",
    r"\geq",
    r"\neq",
    r"\in",
    r"\propto",
)

OPERATOR_TEMPLATES: dict[str, str] = {
    "add":      "{a} + {b}",
    "multiply": "{a} \\cdot {b}",
    "frac":     r"\frac{{{a}}}{{{b}}}",
    "power":    "{a}^{{2}}",
    "func":     r"\sin({a})",
    "sqrt":     r"\sqrt{{{a}}}",
}

# Derive VAR_STYLES from the canonical variables.py definitions.
# Each entry selects specific labels from ALL_VAR_STYLES to keep the
# cross-product small (~200 combos) while covering representative cases.
# Key mapping preserves backward-compatible test IDs.
_VAR_STYLE_SELECTIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    #  local_key:  (canon_key,       selected labels)
    "plain":       ("plain",         ("x", "y", "z")),
    "greek":       ("greek",         ("alpha", "beta", "theta")),
    "accented":    ("accented",      ("vec_F", "hat_n", "bar_x")),
    "dot_deriv":   ("dot_derivative", ("dot_x", "ddot_x")),
    "subscripted": ("subscripted",   ("x_0", "C_d", "a_n")),
    "compound":    ("compound",      ("Delta_t", "Delta_x")),
}


def _build_var_styles() -> dict[str, tuple[str, ...]]:
    """Build VAR_STYLES by selecting labeled entries from variables.py."""
    result = {}
    for local_key, (canon_key, labels) in _VAR_STYLE_SELECTIONS.items():
        lookup = {label: latex for label, latex in ALL_VAR_STYLES[canon_key]}
        result[local_key] = tuple(lookup[lbl] for lbl in labels)
    return result


VAR_STYLES: dict[str, tuple[str, ...]] = _build_var_styles()


@dataclass(frozen=True)
class ExprTemplate:
    """A parametrically generated LaTeX expression with its axis metadata."""

    structure: str
    relation: str
    var_style: str
    operator: str
    latex: str

    @property
    def test_id(self) -> str:
        rel_name = self.relation.replace("\\", "").replace("{", "").replace("}", "")
        return f"{self.structure}-{rel_name}-{self.var_style}-{self.operator}"


def _render(
    structure: str,
    relation: str,
    var_style: str,
    operator: str,
) -> str:
    """Render a LaTeX string from the given axis values."""
    vars_ = VAR_STYLES[var_style]
    v = lambda i: vars_[i % len(vars_)]  # noqa: E731

    op_tpl = OPERATOR_TEMPLATES[operator]
    lhs = op_tpl.format(a=v(0), b=v(1))
    rhs = op_tpl.format(a=v(1), b=v(2 % len(vars_)))
    mid = v(2 % len(vars_))
    lhs2 = op_tpl.format(a=v(2 % len(vars_)), b=v(0))
    rhs2 = v(0)
    rel2 = "="

    return STRUCTURES[structure].format(
        lhs=lhs, rel=relation, rhs=rhs, mid=mid,
        lhs2=lhs2, rhs2=rhs2, rel2=rel2,
    )


def exhaustive() -> list[ExprTemplate]:
    """Structure × relation × var_style (~200 combos). CI-fast."""
    results = []
    for struct, rel, vs in itertools.product(
        STRUCTURES, RELATIONS, VAR_STYLES,
    ):
        op = "add"
        latex = _render(struct, rel, vs, op)
        results.append(ExprTemplate(struct, rel, vs, op, latex))
    return results


def sampled(seed: int = 42, n: int = 500) -> list[ExprTemplate]:
    """Random draw from the full cross-product (all 5 axes)."""
    rng = random.Random(seed)
    full = []
    for struct, rel, vs, op in itertools.product(
        STRUCTURES, RELATIONS, VAR_STYLES, OPERATOR_TEMPLATES,
    ):
        full.append((struct, rel, vs, op))

    chosen = rng.sample(full, min(n, len(full)))
    return [
        ExprTemplate(s, r, v, o, _render(s, r, v, o))
        for s, r, v, o in chosen
    ]
