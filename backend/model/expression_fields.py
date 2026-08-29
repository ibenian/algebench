"""Which element keys carry math.js, and which carry prose.

ONE definition, because there were nearly three. `static/trust.js` decides which
fields to scan for unsafe JS before a scene is trusted; `scripts/audit_expressions.py`
mirrors that to audit sandbox coverage; and `compose.py` needs the same answer to
know which strings can name a slider. A second opinion here is a security
question as much as a correctness one — a field one of them treats as an
expression and another does not is a field that gets evaluated without being
scanned.

The rule is trust.js's: anything ending in `Expr`, plus the handful of
expression-bearing keys that do not follow that convention.

There is deliberately NO exception list for `*Expr` keys that are not
expressions. All 11 in the schema are expressions, and the equivalent clause in
`scripts/audit_expressions.py` has no members ending in `Expr` either — so in
both places it was a branch that could not fire. An empty escape hatch is not
caution, it is unreachable code that reads as though a case exists. Add one the
day a `somethingExpr` turns out to be prose.

The ratio is why this is an ALLOWLIST and not a denylist: of the 86 properties
`$defs.element` declares, 16 carry expressions and 70 do not. An earlier revision
of `compose.py` listed 7 metadata keys and scanned everything else, which read
`legendGroup`, `cssClass` and `align` as code.
"""
from __future__ import annotations

#: Expression keys that do NOT end in `Expr`. Mirrors the explicit list in
#: `scanSpecForUnsafeJs` (static/trust.js).
EXPR_KEYS = frozenset({"expr", "x", "y", "z", "expression", "fx", "fy", "fz"})

#: Keys whose expressions are NESTED — strings inside coordinate sub-arrays
#: (`[["m11","m21","0"], …]`) rather than a flat value. `animated_line` compiles
#: its `points` and `animated_polygon` its `vertices`, so both carry math.js even
#: though neither name follows the `*Expr` convention.
NESTED_COORD_KEYS = frozenset({"points", "vertices"})


def is_expression_key(key: str) -> bool:
    """True for a key whose value IS math.js — trust.js's own rule, exactly.

    Narrow on purpose: this is the set `scanSpecForUnsafeJs` scans, and widening
    it here would quietly widen the security scan's idea of itself.
    `scripts/audit_expressions.py` depends on it meaning precisely that.
    """
    return key in EXPR_KEYS or key.endswith("Expr")


def carries_expressions(key: str) -> bool:
    """True for a key whose value may CONTAIN math.js, at any nesting.

    The question a caller asks when walking a composed element looking for
    slider names: `points` holds `[["ax","ay","0"], …]`, which is math.js one
    level down. `is_expression_key` says no to that — correctly, for its own
    purpose — so the two are separate rather than one predicate serving both
    badly.
    """
    return is_expression_key(key) or key in NESTED_COORD_KEYS
