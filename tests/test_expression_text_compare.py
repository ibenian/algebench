"""Lesson expressions never compare text with == or !=.

math.js compares strings as numbers: ``'—' == '—'`` throws "Cannot convert to a number", and an expression that throws
hides its label silently. Text is compared with ``equalText(a, b)`` (``not equalText(...)`` for "differs").
"""

import json
import re
from pathlib import Path

SCENES = Path(__file__).resolve().parent.parent / "scenes"
TEXT_COMPARE = re.compile(r"""[=!]=\s*['"]|['"]\s*[=!]=""")


def _expressions(node, key=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _expressions(v, k)
    elif isinstance(node, list):
        for v in node:
            yield from _expressions(v, key)
    elif isinstance(node, str) and key.endswith("Expr"):
        yield key, node


def test_no_lesson_expression_compares_text_with_equals():
    found = []
    for path in sorted(SCENES.rglob("*.json")):
        try:
            lesson = json.loads(path.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        found += [f"{path.relative_to(SCENES)}: {key}: {expr[:100]}" for key, expr in _expressions(lesson) if TEXT_COMPARE.search(expr)]
    assert not found, "use equalText(a, b) to compare text:\n" + "\n".join(found)
