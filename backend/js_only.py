r"""What ``src/expr.ts`` treats as JavaScript rather than math.js.

``compileExpr`` routes an expression matching ``_JS_ONLY_RE`` to the JS fallback,
which runs ONLY for a scene the reader has trusted. Untrusted, it becomes
``compile('0')``: a value that is silently, confidently zero.

The scene builder must never author one, so ``compose`` refuses these before they
reach a scene. That only works while the two lists agree, and hand-maintaining
the Python copy already failed once — it was written from memory and missed
fifteen tokens (``new``, ``this``, ``typeof``, ``class``, ``try``/``catch`` …)
plus the BACKTICK form of bracket access. Each gap was a body that passed compose
and turned into 0 in the browser.

So the alternatives are mirrored verbatim and ``tests/test_js_only_sync.py`` reads
the TypeScript and fails if they drift. Same arrangement as
``backend/mathjs_extensions.py`` and ``backend/expression_fields.py``: the
TypeScript implements, Python mirrors, a test holds them together.

Order matches the declaration in ``src/expr.ts`` so a diff of the two reads the
same way. These are REGEX FRAGMENTS, not literals — identical syntax in both
languages, which is why a verbatim copy is safe.
"""
from __future__ import annotations

JS_ONLY_ALTERNATIVES: tuple[str, ...] = (
    r"\blet\b", r"\bconst\b", r"\bvar\b", r"\breturn\b",
    r"\bfor\s*\(", r"\bwhile\s*\(", r"=>", r"\bfunction\b", r"\bMath\.",
    r"\.([a-zA-Z_]\w*)\s*\(",
    r"\bnew\b", r"\bthis\b", r"\btypeof\b", r"\binstanceof\b", r"\bdelete\b",
    r"\bclass\b", r"\basync\b", r"\bawait\b", r"\byield\b", r"\bthrow\b",
    r"\btry\b", r"\bcatch\b", r"\bimport\b", r"\bdebugger\b",
    r"\bif\b", r"\belse\b", r"\bswitch\b", r"\bcase\b", r"\bdo\b",
    r"\bbreak\b", r"\bcontinue\b", r"\bwith\s*\(", r"\bvoid\b",
    # Triple-quoted so the double quote needs no escape: a raw `\"` keeps its
    # backslash, which is harmless to the regex but not byte-identical to the
    # TypeScript, and the sync test compares sources exactly on purpose.
    r'''\[\s*['"`]''',
    # JavaScript spellings math.js does not parse. It has `==`/`!=`, `or`/`and`,
    # and no template literals, so each of these threw in `_mathjs.compile` and
    # became `compile('0')` — silently zero, no trust prompt, no warning. They
    # belong on the same footing as `let` or `=>`.
    #
    # NOT `;`. A semicolon is VALID math.js: `[1,2;3,4]` is a matrix literal and
    # `a; b` a block. Listing it here would route working expressions to the JS
    # fallback and zero them for any reader who has not trusted the scene —
    # exactly the failure this module exists to prevent.
    r"===", r"!==", r"\|\|", r"&&", r"\$\{",
)
