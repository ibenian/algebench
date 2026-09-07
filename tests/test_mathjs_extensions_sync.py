"""`backend/mathjs_extensions.py` must list exactly what `src/expr.ts` adds.

The two are deliberately separate: the TypeScript implements the functions, the
Python names them for the builder's prompt. Neither can import the other, so the
sync is enforced here rather than hoped for in a comment.

Both directions matter, and they fail differently:

  * a name in expr.ts but not in Python — the model never learns the function
    exists, so it writes something else or nothing;
  * a name in Python but not in expr.ts — the model is told to use a function
    that was removed, and the scene renders as nothing with no error anywhere.

An earlier revision read `expr.ts` with a regex at IMPORT time to avoid the
duplication. That put a TypeScript parser on the request path and needed three
guards against parsing wrong. Doing it in a test costs one CI second and cannot
degrade the prompt at runtime.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.mathjs_extensions import CORE_MATH_NAMES, EXTENSION_NAMES

ROOT = Path(__file__).resolve().parent.parent
EXPR_TS = ROOT / "src" / "expr.ts"

_BLOCK = re.compile(r"^const _MATHJS_EXTENSIONS = \{(.*?)^\};", re.S | re.M)
_KEY = re.compile(r"^    ([A-Za-z_][A-Za-z0-9_]*)\s*:", re.M)


def _declared_in_typescript() -> list[str]:
    block = _BLOCK.search(EXPR_TS.read_text(encoding="utf-8"))
    assert block, (
        f"no `const _MATHJS_EXTENSIONS = {{…}};` block in {EXPR_TS}. If it was "
        f"renamed or reformatted, fix this pattern — do not delete the test, "
        f"because it is the only thing keeping the builder's prompt honest.")
    names = _KEY.findall(block.group(1))
    assert "dataTable" in names, (
        f"the block matched but yielded {names}, which does not include a name "
        f"known to be in it — so the parse is wrong even though it matched.")
    return names


def test_the_two_lists_agree():
    declared = _declared_in_typescript()
    assert list(EXTENSION_NAMES) == declared, (
        "src/expr.ts and backend/mathjs_extensions.py disagree.\n"
        f"  only in expr.ts : {sorted(set(declared) - set(EXTENSION_NAMES))}\n"
        f"  only in python  : {sorted(set(EXTENSION_NAMES) - set(declared))}\n"
        "Order matters too, so a diff of the two reads the same way.")


@pytest.mark.parametrize("known", ["dataTable", "toFixed", "binomial"])
def test_the_check_is_looking_at_something_real(known):
    """Guards the guard: if the parse silently returned nothing, the comparison
    above would pass only when the Python list were empty too."""
    assert known in _declared_in_typescript()


_CORE_BLOCK = re.compile(r"^const _CORE_MATH_NAMES = \[(.*?)\];", re.S | re.M)


def test_the_core_math_names_agree():
    """`CORE_MATH_NAMES` must match `_CORE_MATH_NAMES` in expr.ts.

    These are RESERVED, not offered: `setActiveSceneFunctions` skips a scene
    function that shadows one, with a `console.warn` and nothing else. Compose
    refuses such a name so the builder hears about it — which only works while
    the two lists agree. A name here that expr.ts dropped refuses a legal
    function; a name expr.ts added that is missing here lets one through to be
    silently ignored in the browser.
    """
    block = _CORE_BLOCK.search(EXPR_TS.read_text(encoding="utf-8"))
    assert block, (
        f"no `const _CORE_MATH_NAMES = [...]` in {EXPR_TS}. If it was renamed, "
        f"fix this pattern — do not delete the test.")
    assert re.findall(r"'([^']+)'", block.group(1)) == list(CORE_MATH_NAMES)
