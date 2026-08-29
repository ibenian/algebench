"""The math.js functions this project adds, read from the source that defines them.

A scene expression is evaluated by math.js — so the model can rely on math.js's
own library without being told. What it CANNOT know is the handful of functions
added here, in `_MATHJS_EXTENSIONS` (src/expr.ts): `dataTable` and `bar` exist
nowhere else, and `binomial`/`erfc`/`beta`/`conjugate` are SymPy-compatibility
names, not math.js built-ins.

Read from the TypeScript rather than restated, because a hand-written copy in a
prompt goes stale silently: the model keeps being offered a function that was
removed, or never hears about one that was added, and either way the failure is
a scene that does not render with nothing to say why. `expr.ts` already exports
`EXTENSION_NAMES` for the same reason on the client side.
"""
from __future__ import annotations

import re
from functools import cache
from pathlib import Path

_SOURCE = Path(__file__).resolve().parent.parent / "src" / "expr.ts"

#: The block to read, and the keys within it. Anchored on the declaration rather
#: than a line number so ordinary edits above it do not shift the match.
_BLOCK = re.compile(r"^const _MATHJS_EXTENSIONS = \{(.*?)^\};", re.S | re.M)
_KEY = re.compile(r"^    ([A-Za-z_][A-Za-z0-9_]*)\s*:", re.M)

#: One name known to be in the block. If the shape of `expr.ts` changes, the
#: extraction must FAIL rather than quietly yield fewer names — a prompt that
#: silently loses its function list is the exact silent-failure this exists to
#: prevent.
_CANARY = "dataTable"


class ExtensionsUnreadable(RuntimeError):
    """`src/expr.ts` no longer has the shape this parser expects."""


@cache
def extension_names() -> tuple[str, ...]:
    """Every function `_MATHJS_EXTENSIONS` adds, in declaration order."""
    try:
        source = _SOURCE.read_text(encoding="utf-8")
    except OSError as e:
        raise ExtensionsUnreadable(f"cannot read {_SOURCE}: {e}") from e
    block = _BLOCK.search(source)
    if not block:
        raise ExtensionsUnreadable(
            f"no `const _MATHJS_EXTENSIONS = {{…}};` block in {_SOURCE}. The "
            f"prompt's list of project-specific math.js functions is generated "
            f"from it; fix the pattern rather than hard-coding the names.")
    names = tuple(_KEY.findall(block.group(1)))
    if _CANARY not in names:
        raise ExtensionsUnreadable(
            f"parsed {len(names)} name(s) from {_SOURCE} but not {_CANARY!r}, so "
            f"the parse is wrong even though it matched. Names: {names}")
    return names
