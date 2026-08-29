"""`src/trust.ts` must scan exactly the keys `backend/expression_fields.py` names.

The trust scanner decides which strings in a scene get checked for unsafe JS
before the reader is asked whether to run it. `backend/expression_fields.py` is
the single definition of which keys those are, and `scripts/audit_expressions.py`
already reads it. `trust.ts` cannot import Python, so the sync is enforced here
rather than hoped for in a comment.

The two directions fail differently, and neither is loud:

  * a key in expression_fields.py but not in trust.ts — the scanner never looks
    at it, so the dialog is not OFFERED. `compileExpr` still refuses the
    expression (it gates on trust itself and returns `compile('0')`), so nothing
    executes unasked — the scene just silently draws that value as 0 and the
    reader is never given the choice that would have made it work. This is
    exactly what `points` did before it was added.
  * a key in trust.ts but not here — the scan is wider than the audit believes,
    so `audit_expressions.py` reports coverage it is not actually checking.

Modelled on tests/test_mathjs_extensions_sync.py: reading the TypeScript in a
test costs one CI second, where reading it at import time would put a parser on
the request path.
"""
from __future__ import annotations

import re
from pathlib import Path

from backend.expression_fields import EXPR_KEYS, NESTED_COORD_KEYS

ROOT = Path(__file__).resolve().parent.parent
TRUST_TS = ROOT / "src" / "trust.ts"


def _set_literal(name: str) -> set[str]:
    """Pull `const <name> = new Set([...])` out of trust.ts as a Python set."""
    src = TRUST_TS.read_text(encoding="utf-8")
    m = re.search(rf"const {name} = new Set\(\[(.*?)\]\)", src, re.S)
    assert m, f"{name} not found in {TRUST_TS} — was it renamed?"
    return set(re.findall(r"'([^']+)'", m.group(1)))


def test_the_flat_expression_keys_agree():
    assert _set_literal("EXPR_KEYS") == set(EXPR_KEYS)


def test_the_nested_coordinate_keys_agree():
    """`points` and `vertices` hold math.js one level down, inside coordinate
    sub-arrays, so no `*Expr` suffix marks them and each list has to name them."""
    assert _set_literal("NESTED_COORD_KEYS") == set(NESTED_COORD_KEYS)


def test_the_scanner_actually_uses_the_nested_set():
    """Declaring the set is not scanning it. The walker propagates `parentKey`
    down through arrays, so the predicate it calls on a string is what decides
    whether a nested coordinate is ever looked at."""
    src = TRUST_TS.read_text(encoding="utf-8")
    assert "_carriesExpressions(parentKey)" in src, (
        "the string branch must test _carriesExpressions, not _isExprKey — "
        "otherwise NESTED_COORD_KEYS is declared and never consulted"
    )
