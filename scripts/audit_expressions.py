#!/usr/bin/env python3
"""Audit expression sandbox coverage across AlgeBench scene JSON files.

Classifies every expression string found in scene files and reports whether
each one is handled by the math.js sandbox (safe), requires the JS trust
dialog, or is uncovered (requires JS but sits in a field that
_scanSpecForUnsafeJs does not scan).

Exit codes:
  0 — all expressions are covered (safe math.js or properly gated JS)
  1 — uncovered expressions found (require JS but not gated by trust dialog)
"""

import json
import re
import sys
from pathlib import Path


# Mirrors _JS_ONLY_RE from static/app.js (line 90).
# Detects expressions that require native JS execution.
_JS_ONLY_RE = re.compile(
    r'\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\('
    r'|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\('
)

# Secondary pattern: JS-only built-in functions used without a leading dot
# (e.g. toFixed(h, 2)) — these don't match _JS_ONLY_RE but fail math.js
# parsing and are silently evaluated via the JS fallback in compileExpr /
# _evalInfoExpr, without triggering the trust dialog proactively.
_JS_BUILTIN_FUNC_RE = re.compile(
    r'\b(toFixed|toPrecision|toString|parseInt|parseFloat|isNaN|isFinite)\s*\('
)

# Fields actively scanned by _scanSpecForUnsafeJs in static/app.js.
# Expressions found under these keys trigger the trust dialog when they
# contain JS-only patterns.
_SCANNED_KEYS = frozenset({'expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz'})

# Regex that extracts {{...}} template expressions from content strings.
_TEMPLATE_RE = re.compile(r'\{\{([\s\S]*?)\}\}')


def _extract_template_exprs(text):
    """Yield (expr, 'content_template') pairs from a {{...}} template string."""
    for m in _TEMPLATE_RE.finditer(text):
        expr = m.group(1).strip()
        if expr:
            yield expr, 'content_template'


def extract_expressions(obj, parent_key=None):
    """Recursively extract (expr, field_key) tuples from a scene object.

    field_key is the JSON key under which the expression was found, or a
    synthetic tag such as 'content_template' or 'vertices'.
    """
    results = []

    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == 'content' and isinstance(v, str):
                # Pull {{expr}} blocks out of info-panel / caption templates.
                for expr, tag in _extract_template_exprs(v):
                    results.append((expr, tag))

            elif k in ('vertices', 'points') and isinstance(v, list):
                # Polygon / animated-polygon vertex expressions are strings
                # inside coordinate sub-arrays, e.g. ["m11", "m21", "0"].
                for vertex in v:
                    if isinstance(vertex, (list, tuple)):
                        for coord in vertex:
                            if isinstance(coord, str) and coord.strip():
                                results.append((coord.strip(), k))
                    elif isinstance(vertex, str) and vertex.strip():
                        results.append((vertex.strip(), k))

            elif k in _SCANNED_KEYS and isinstance(v, str) and v.strip():
                results.append((v.strip(), k))

            else:
                results.extend(extract_expressions(v, k))

    elif isinstance(obj, list):
        for item in obj:
            results.extend(extract_expressions(item, parent_key))

    return results


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

_CLASSIFICATION_LABELS = {
    'safe': '✅ safe',
    'unsafe_scene': '🔓 unsafe-scene',
    'js_covered': '⚠️  js/covered',
    'js_uncovered': '❌ js/uncovered',
    'js_builtin': '🔶 js-builtin',
}


def classify_expression(expr, field_key, scene_unsafe):
    """Return a classification string for a single expression.

    Classifications
    ---------------
    safe          — Pure math.js expression; no JS patterns detected.
    js_covered    — Matches _JS_ONLY_RE and sits in a field that
                    _scanSpecForUnsafeJs checks, so the trust dialog will
                    trigger before the scene loads.
    js_uncovered  — Matches _JS_ONLY_RE but is NOT in a scanned field; the
                    trust dialog will NOT be shown proactively.  This is the
                    failure condition for the audit.
    js_builtin    — Uses a JS-only built-in function (e.g. toFixed) that does
                    not match _JS_ONLY_RE.  Evaluated via JS fallback only when
                    the scene is trusted; otherwise silently returns 0 / '?'.
    """
    if scene_unsafe:
        # The scene explicitly opts in to JS via "unsafe": true.
        # All expressions are covered, but we track them distinctly so the
        # report makes clear why they are not flagged.
        return 'unsafe_scene'

    if _JS_ONLY_RE.search(expr):
        if field_key in _SCANNED_KEYS:
            return 'js_covered'
        return 'js_uncovered'

    if _JS_BUILTIN_FUNC_RE.search(expr):
        return 'js_builtin'

    return 'safe'


# ---------------------------------------------------------------------------
# Per-file audit
# ---------------------------------------------------------------------------

def audit_scene_file(path):
    """Audit one scene file.

    Returns a list of dicts:
      { 'expr': str, 'field': str, 'classification': str }
    """
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)

    # A top-level "unsafe": true means the author explicitly opts the entire
    # scene into native JS execution.
    scene_unsafe = bool(data.get('unsafe'))

    results = []
    for expr, field_key in extract_expressions(data):
        cls = classify_expression(expr, field_key, scene_unsafe)
        results.append({'expr': expr, 'field': field_key, 'classification': cls})

    return results, scene_unsafe


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]

    repo_root = Path(__file__).resolve().parent.parent
    scenes_dir = repo_root / 'scenes'

    scene_files = sorted(scenes_dir.glob('*.json'))
    if not scene_files:
        print('No scene files found in', scenes_dir)
        sys.exit(0)

    print(f'Auditing {len(scene_files)} scene file(s) in {scenes_dir}\n')

    totals = {k: 0 for k in _CLASSIFICATION_LABELS}
    all_uncovered = []    # (scene_name, record)
    all_js_builtin = []   # (scene_name, record)

    for scene_path in scene_files:
        try:
            results, scene_unsafe = audit_scene_file(scene_path)
        except (json.JSONDecodeError, OSError) as exc:
            print(f'  ERROR reading {scene_path.name}: {exc}')
            continue

        counts = {k: 0 for k in _CLASSIFICATION_LABELS}
        for r in results:
            counts[r['classification']] += 1
            totals[r['classification']] += 1

        file_uncovered = [r for r in results if r['classification'] == 'js_uncovered']
        file_builtin = [r for r in results if r['classification'] == 'js_builtin']

        unsafe_tag = ' [unsafe:true]' if scene_unsafe else ''
        if file_uncovered:
            status = '❌'
        elif file_builtin:
            status = '🔶'
        elif scene_unsafe:
            status = '🔓'
        else:
            status = '✅'

        print(f'{status} {scene_path.name}{unsafe_tag}')
        print(
            f'   safe={counts["safe"]}  unsafe-scene={counts["unsafe_scene"]}'
            f'  js/covered={counts["js_covered"]}'
            f'  uncovered={counts["js_uncovered"]}  js-builtin={counts["js_builtin"]}'
        )

        if file_uncovered:
            for r in file_uncovered:
                print(f'   ❌ [{r["field"]}] {r["expr"]!r}')

        if file_builtin:
            for r in file_builtin:
                print(f'   🔶 [{r["field"]}] {r["expr"]!r}')

        all_uncovered.extend((scene_path.name, r) for r in file_uncovered)
        all_js_builtin.extend((scene_path.name, r) for r in file_builtin)
        print()

    print('─' * 60)
    print(
        f'Total  ✅ safe={totals["safe"]}'
        f'  🔓 unsafe-scene={totals["unsafe_scene"]}'
        f'  ⚠️  js/covered={totals["js_covered"]}'
        f'  ❌ uncovered={totals["js_uncovered"]}'
        f'  🔶 js-builtin={totals["js_builtin"]}'
    )

    # ── Soft warnings ──────────────────────────────────────────────────────
    if all_js_builtin:
        print(
            '\n🔶 JS-builtin soft warnings'
            '\n   These expressions use JS-only functions (e.g. toFixed) that are not'
            '\n   detected by _JS_ONLY_RE and therefore do not trigger the trust dialog'
            '\n   proactively.  They are evaluated via the JS fallback in compileExpr /'
            '\n   _evalInfoExpr only when the scene is already trusted; otherwise they'
            '\n   return 0 or "?" silently.'
        )
        for scene_name, r in all_js_builtin:
            print(f'   [{scene_name}] [{r["field"]}] {r["expr"]!r}')

    # ── Hard failures ──────────────────────────────────────────────────────
    if all_uncovered:
        print(
            '\n❌ FAIL: The following expressions contain JS-only patterns (_JS_ONLY_RE'
            '\n   match) but sit in fields that _scanSpecForUnsafeJs does not scan.'
            '\n   They will execute native JS without the trust dialog being shown.'
        )
        for scene_name, r in all_uncovered:
            print(f'   [{scene_name}] [{r["field"]}] {r["expr"]!r}')
        print(
            '\n   Fix: move the expression into a scanned field (expr, x, y, z,'
            '\n   expression, fx, fy, fz), add "unsafe": true to the scene, or'
            '\n   extend _scanSpecForUnsafeJs in static/app.js to cover the field.'
        )
        sys.exit(1)

    print('\n✅ All expression-bearing fields are covered by the sandbox / trust model.')
    sys.exit(0)


if __name__ == '__main__':
    main()
