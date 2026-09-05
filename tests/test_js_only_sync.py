"""`backend/js_only.py` must mirror `_JS_ONLY_RE` in `src/expr.ts` exactly.

`compileExpr` sends anything matching that regex to the JS fallback, which for an
untrusted scene means `compile('0')` — silently zero. `compose` refuses such
bodies in a scene function so the builder cannot author one, and that only works
while the two lists agree.

They did not. The Python copy was written by hand from memory and missed fifteen
tokens plus the backtick form of bracket access; each gap was a body that passed
compose and became 0 in the browser. Hence a test rather than a comment.

Modelled on tests/test_mathjs_extensions_sync.py — reading the TypeScript costs
one CI second, where reading it at import time would put a parser on the request
path.
"""
from __future__ import annotations

import re
from pathlib import Path

from backend.js_only import JS_ONLY_ALTERNATIVES

ROOT = Path(__file__).resolve().parent.parent
EXPR_TS = ROOT / "src" / "expr.ts"

_DECL = re.compile(r"export const _JS_ONLY_RE = /(.*?)/;")


def _declared_in_typescript() -> list[str]:
    m = _DECL.search(EXPR_TS.read_text(encoding="utf-8"))
    assert m, (
        f"no `export const _JS_ONLY_RE = /…/;` in {EXPR_TS}. If it was renamed or "
        f"reformatted, fix this pattern — do not delete the test, because it is "
        f"the only thing keeping compose's guard aligned with the runtime's.")
    # Split on the alternation's `|` but not on an ESCAPED one: `\|\|` (the
    # JavaScript `||`) contains two literal pipes, which a plain split would
    # tear into empty fragments. Nothing here escapes a backslash itself, so a
    # single look-behind is exact.
    return re.split(r"(?<!\\)\|", m.group(1))


def test_the_alternatives_agree_in_order():
    assert list(JS_ONLY_ALTERNATIVES) == _declared_in_typescript()


def test_the_python_copy_is_a_valid_regex():
    """A fragment copied wrong is a crash at import, not a silent miss — but the
    crash should surface here, not on someone's first build request."""
    re.compile("|".join(JS_ONLY_ALTERNATIVES))


def test_a_semicolon_is_never_treated_as_javascript():
    """`;` must stay OUT of `_JS_ONLY_RE`, and this is why.

    It is VALID math.js: `[1,2;3,4]` is a matrix literal and `a; b` a block. An
    expression matching `_JS_ONLY_RE` is routed to the JS fallback, which for an
    untrusted scene is `compile('0')` — so listing `;` would silently zero every
    working matrix expression in the corpus.

    compose still refuses a semicolon in a scene FUNCTION BODY, but for its own
    reason (a body is one expression, not a block), which is why that rule lives
    in compose and not in the mirror.
    """
    for fragment in JS_ONLY_ALTERNATIVES:
        assert ";" not in fragment, (
            f"{fragment!r} would classify a semicolon as JavaScript; `;` is "
            f"valid math.js and doing so zeroes matrix literals when untrusted")


def test_the_javascript_spellings_are_covered():
    """The four operators math.js spells differently, plus template literals.

    Each threw inside `_mathjs.compile` and became a silent 0 before it was
    listed. `==` and `!=` must NOT be here — math.js parses both.
    """
    joined = "|".join(JS_ONLY_ALTERNATIVES)
    for fragment in (r"===", r"!==", r"\|\|", r"&&", r"\$\{"):
        assert fragment in joined, f"{fragment!r} missing from the mirror"

    pattern = re.compile(joined)
    assert pattern.search("a === b") and pattern.search("a !== b")
    assert pattern.search("a || b") and pattern.search("a && b")
    assert pattern.search("`${x}`")
    # The math.js spellings stay usable.
    assert not pattern.search("a == b")
    assert not pattern.search("a != b")
    assert not pattern.search("[1, 2; 3, 4]")
