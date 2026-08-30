"""The math.js functions this project adds, beyond math.js's own library.

A scene expression is evaluated by math.js, so the model can rely on everything
math.js ships without being told. What it cannot infer is this list: `dataTable`
and `bar` exist nowhere else, and `binomial`/`erfc`/`beta`/`conjugate` are
SymPy-compatibility names rather than math.js built-ins.

KEEP IN SYNC WITH `_MATHJS_EXTENSIONS` in src/expr.ts — that is where they are
implemented; this is only the name list, for the builder's prompt. The sync is
enforced, not hoped for: `tests/test_mathjs_extensions_sync.py` reads the
TypeScript and fails if the two disagree, so adding one there without adding it
here breaks CI rather than quietly leaving the model unaware of it.

An earlier revision parsed `expr.ts` with a regex at import time. That put a
TypeScript parser on the request path to avoid duplicating eight strings, and
needed three guards of its own against parsing wrong. A plain list checked by a
test is smaller in every direction.
"""
from __future__ import annotations

#: Order matches the declaration in src/expr.ts, so a diff of the two reads the
#: same way.
EXTENSION_NAMES: tuple[str, ...] = (
    "toFixed",
    "concat",
    "bar",
    "dataTable",
    # SymPy `jscode` compatibility — emitted as bare names by derivations.
    "binomial",
    "erfc",
    "beta",
    "conjugate",
)


#: The bare `Math.*` names `src/expr.ts` binds into every expression scope
#: (`_CORE_MATH_NAMES`). Order matches the declaration there, so a diff of the
#: two reads the same way; `tests/test_mathjs_extensions_sync.py` enforces it.
#:
#: Needed because `setActiveSceneFunctions` SKIPS a scene function whose name is
#: one of these — quietly, with a `console.warn` nobody sees — so a builder that
#: proposes `max(a, b)` as a scene function produces a scene where every call to
#: it silently means math.js's own `max`. Compose refuses that instead.
CORE_MATH_NAMES: tuple[str, ...] = (
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh",
    "asinh", "acosh", "atanh",
    "abs", "sqrt", "cbrt", "pow", "exp", "log", "log2", "log10", "floor", "ceil",
    "round", "trunc",
    "min", "max", "sign", "hypot", "PI", "E",
)
