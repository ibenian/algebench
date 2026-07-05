"""Shared helper: serialize scene/lesson JSON in the repo's compact-leaves format.

Plain ``json.dump(indent=2)`` explodes leaf arrays like ``[x, y, z]`` onto one
line per element, tripling the line count of scene files. Every writer that
touches lesson/scene JSON (prebake, enrichment, assemble, lint --fix) should go
through :func:`dumps_compact_leaves` instead so the on-disk format stays
consistent and diffs stay small.
"""

import json


def _has_nested_container(obj):
    """True if ``obj`` (dict/list) holds any value that is itself a non-empty
    dict or list — i.e. it is NOT a leaf container."""
    vals = obj.values() if isinstance(obj, dict) else obj
    return any(isinstance(v, (dict, list)) and v for v in vals)


def dumps_compact_leaves(obj, indent=2, level=0):
    """Pretty-print JSON, but collapse *leaf* containers — dicts/lists whose
    values are all scalars (or empty) — onto a single line.

    Keeps the scene hierarchy (scenes → proof → steps → graph) readable while
    shrinking the dozens of tiny graph node/edge objects from ~5 lines each to
    one. All scalar/leaf serialization is delegated to ``json.dumps``, so string
    escaping and number formatting are identical to a normal dump; only
    container indentation is custom. Round-trips to the same data as
    ``json.dumps`` (callers assert this before writing)."""
    if isinstance(obj, (dict, list)) and obj and not _has_nested_container(obj):
        return json.dumps(obj, ensure_ascii=False)  # leaf container → one line
    pad = " " * (indent * (level + 1))
    end = " " * (indent * level)
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = [
            f"{pad}{json.dumps(str(k), ensure_ascii=False)}: "
            f"{dumps_compact_leaves(v, indent, level + 1)}"
            for k, v in obj.items()
        ]
        return "{\n" + ",\n".join(items) + "\n" + end + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        items = [f"{pad}{dumps_compact_leaves(v, indent, level + 1)}" for v in obj]
        return "[\n" + ",\n".join(items) + "\n" + end + "]"
    return json.dumps(obj, ensure_ascii=False)  # scalar
