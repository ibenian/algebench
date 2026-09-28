#!/usr/bin/env python3
"""Backfill stable ``id`` fields on lesson scenes, steps, proofs and proof steps.

Each missing id is set to the id the client already derives for that object
(see backend/lesson_ids.py), so no existing deeplink changes where it lands.

The ids are inserted into the file *text* — as the first key of each object,
matching the object's own indentation — rather than re-serializing the JSON, so
the diff is exactly the added ``"id"`` lines and each file keeps its current
formatting.

Usage:
    ./run.sh scripts/backfill_lesson_ids.py --check            # report, exit 1 if any missing
    ./run.sh scripts/backfill_lesson_ids.py --write            # fill them in
    ./run.sh scripts/backfill_lesson_ids.py --write scenes/eigenvalues.json

With no files, operates on scenes/*.json and scenes/draft/*.json.
"""

import argparse
import json
import re
import sys
from json.decoder import scanstring
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.lesson_ids import assign_missing_ids, id_errors  # noqa: E402

_NUMBER = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?")
_WS = " \t\n\r"


class _PosParser:
    """Minimal JSON parser that records where each object's braces sit.

    ``starts[id(obj)]`` is the text offset of the object's opening ``{``, and
    ``id_spans[id(obj)]`` the ``(start, end)`` of its ``"id"`` value, if any.
    """

    def __init__(self, text: str):
        self.text = text
        self.starts: dict[int, int] = {}
        self.id_spans: dict[int, tuple[int, int]] = {}
        self._keep: list = []  # keep every dict alive so id() stays unique

    def _ws(self, i):
        while i < len(self.text) and self.text[i] in _WS:
            i += 1
        return i

    def parse(self):
        value, i = self._value(self._ws(0))
        if self._ws(i) != len(self.text):
            raise ValueError("trailing data")
        return value

    def _value(self, i):
        c = self.text[i]
        if c == "{":
            return self._object(i)
        if c == "[":
            return self._array(i)
        if c == '"':
            return scanstring(self.text, i + 1)
        for lit, val in (("true", True), ("false", False), ("null", None)):
            if self.text.startswith(lit, i):
                return val, i + len(lit)
        m = _NUMBER.match(self.text, i)
        if not m:
            raise ValueError(f"unexpected character at {i}")
        return json.loads(m.group()), m.end()

    def _object(self, start):
        obj: dict = {}
        self.starts[id(obj)] = start
        self._keep.append(obj)
        i = self._ws(start + 1)
        if self.text[i] == "}":
            return obj, i + 1
        while True:
            key, i = scanstring(self.text, self._ws(i) + 1)
            i = self._ws(i)
            assert self.text[i] == ":"
            vstart = self._ws(i + 1)
            obj[key], i = self._value(vstart)
            if key == "id":
                self.id_spans[id(obj)] = (vstart, i)
            i = self._ws(i)
            if self.text[i] == "}":
                return obj, i + 1
            assert self.text[i] == ","
            i += 1

    def _array(self, start):
        arr: list = []
        i = self._ws(start + 1)
        if self.text[i] == "]":
            return arr, i + 1
        while True:
            val, i = self._value(self._ws(i))
            arr.append(val)
            i = self._ws(i)
            if self.text[i] == "]":
                return arr, i + 1
            assert self.text[i] == ","
            i += 1


def backfill_text(text: str) -> tuple[str, list]:
    """Return ``(new_text, changes)`` with missing ids inserted into ``text``."""
    parser = _PosParser(text)
    data = parser.parse()
    changes = assign_missing_ids(data)
    inserts = []
    for target, ident in changes:
        entry_value = json.dumps(ident, ensure_ascii=False)
        span = parser.id_spans.get(id(target.obj))
        if span:  # present but empty/null: overwrite the value, add no key
            inserts.append((span, entry_value))
            continue
        brace = parser.starts[id(target.obj)]
        first = brace + 1
        while text[first] in _WS:
            first += 1
        entry = f'"id": {entry_value},'
        if text[first] == "}":  # empty object: {} -> {"id": "x"}
            inserts.append(((first, first), entry[:-1]))
        elif "\n" in text[brace + 1:first]:  # multi-line: own line, same indent
            indent = text[text.rfind("\n", 0, first) + 1:first]
            inserts.append(((first, first), f"{entry}\n{indent}"))
        else:  # one-line object
            inserts.append(((first, first), f"{entry} "))
    for (start, end), s in sorted(inserts, reverse=True):
        text = text[:start] + s + text[end:]
    # Safety net: the edit must be exactly "the same data, plus these ids".
    if json.loads(text) != data:
        raise RuntimeError("text edit did not round-trip to the expected data")
    return text, changes


def _default_files() -> list[Path]:
    return sorted((ROOT / "scenes").glob("*.json")) + sorted((ROOT / "scenes" / "draft").glob("*.json"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report missing/duplicate ids; exit 1 if any")
    mode.add_argument("--write", action="store_true", help="insert missing ids in place")
    ap.add_argument("files", nargs="*", type=Path)
    args = ap.parse_args()

    files = args.files or _default_files()
    bad = 0
    for path in files:
        text = path.read_text()
        try:
            rel = path.resolve().relative_to(ROOT)
        except ValueError:
            rel = path
        if args.check:
            errors = id_errors(json.loads(text))
            if errors:
                bad += 1
                print(f"{rel}: {len(errors)} id problem(s)")
                for e in errors[:10]:
                    print(f"    {e}")
                if len(errors) > 10:
                    print(f"    ... {len(errors) - 10} more")
            continue
        new_text, changes = backfill_text(text)
        if changes:
            path.write_text(new_text)
            print(f"{rel}: added {len(changes)} id(s)")
        leftover = id_errors(json.loads(new_text))
        if leftover:  # duplicates need a human decision
            bad += 1
            for e in leftover:
                print(f"    {e}")
    if args.check:
        print(f"{bad} of {len(files)} file(s) have id problems" if bad else f"all {len(files)} file(s) OK")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
