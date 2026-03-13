#!/usr/bin/env python3
"""Audit expression sandbox coverage across AlgeBench scene JSON files.

Classifies every expression string found in scene files and reports whether
each one is handled by the math.js sandbox (safe), requires the JS trust
dialog, or is uncovered (requires JS but sits in a field that
_scanSpecForUnsafeJs does not scan).

After the per-file report the script emits a Proposals section that suggests
concrete improvements to trust coverage based on what was found.

When running inside GitHub Actions (GITHUB_STEP_SUMMARY env var is set) the
script additionally writes a markdown version of the full report — including
all proposals — to the step summary so reviewers can see it directly in the
PR Checks tab without having to open the raw CI log.

Exit codes:
  0 — all expressions are covered (safe math.js or properly gated JS)
  1 — uncovered expressions found (require JS but not gated by trust dialog)
"""

import json
import os
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

# Additional expression-bearing keys that app.js compiles via compileExpr but
# that _scanSpecForUnsafeJs does NOT currently scan.  Expressions found here
# are classified as 'js_uncovered' when they match _JS_ONLY_RE.
_UNSCANNED_EXPR_KEYS = frozenset({
    'visibleExpr', 'radiusExpr', 'radiiExpr', 'centerExpr',
    'fromExpr', 'toExpr', 'positionExpr',
})

# Keys whose string values are never mathematical expressions — labels, ids,
# documentation fields, etc.  Excluded from the dynamic discovery pass.
_NON_EXPR_KEYS = frozenset({
    'type', 'id', 'name', 'label', 'color', 'title', 'description',
    'doc', 'prompt', 'caption', 'content', 'format', 'unit',
    'axis', 'camera', 'range', 'theme',
    'markdown', 'text', 'unsafe_explanation',
})

# Regex that extracts {{...}} template expressions from content strings.
_TEMPLATE_RE = re.compile(r'\{\{([\s\S]*?)\}\}')


def _extract_template_exprs(text):
    """Yield (expr, 'content_template') pairs from a {{...}} template string."""
    for m in _TEMPLATE_RE.finditer(text):
        expr = m.group(1).strip()
        if expr:
            yield expr, 'content_template'




def discover_unregistered_expr_keys(scene_files):
    """Scan all string-valued fields across scene files and return a dict of
    { key: example_expr } for keys that:
      - are not in _SCANNED_KEYS, _UNSCANNED_EXPR_KEYS, or _NON_EXPR_KEYS
      - have at least one value that looks like a JS or JS-builtin expression
    These are expression-bearing keys the audit doesn't know about yet.
    """
    known = _SCANNED_KEYS | _UNSCANNED_EXPR_KEYS | _NON_EXPR_KEYS
    found = {}

    def _walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in known or k in ('vertices', 'points'):
                    continue
                if isinstance(v, str) and v.strip() and k not in found:
                    if _JS_ONLY_RE.search(v) or _JS_BUILTIN_FUNC_RE.search(v):
                        found[k] = v.strip()
                elif isinstance(v, (dict, list)):
                    _walk(v)
        elif isinstance(obj, list):
            for item in obj:
                _walk(item)

    for path in scene_files:
        try:
            with open(path, encoding='utf-8') as fh:
                _walk(json.load(fh))
        except (json.JSONDecodeError, OSError):
            pass

    return found


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

            elif k in _UNSCANNED_EXPR_KEYS:
                # These fields are compiled by app.js but not scanned by
                # _scanSpecForUnsafeJs.  Extract string expressions from them
                # so we can flag any JS patterns as uncovered.
                if isinstance(v, str) and v.strip():
                    results.append((v.strip(), k))
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, str) and item.strip():
                            results.append((item.strip(), k))

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

    # ── Legend ─────────────────────────────────────────────────────────────
    print('Legend:')
    print('  ✅ safe          — pure math.js expression; no JS patterns detected')
    print('  🔓 unsafe-scene  — scene has "unsafe":true; all JS opted in explicitly')
    print('  ⚠️  js/covered    — JS pattern found in a scanned field; trust dialog fires')
    print('  ❌ js/uncovered  — JS pattern in an UNSCANNED field; trust dialog will NOT fire')
    print('  🔶 js-builtin    — uses toFixed/etc.; bypasses _JS_ONLY_RE via catch-fallback')
    print()

    print(f'Auditing {len(scene_files)} scene file(s) in {scenes_dir}\n')

    totals = {k: 0 for k in _CLASSIFICATION_LABELS}
    all_uncovered = []    # (scene_name, record)
    all_js_builtin = []   # (scene_name, record)
    scene_results_map = {}   # scene_name -> (results, scene_unsafe) for summary

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
        scene_results_map[scene_path.name] = (results, scene_unsafe)
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

    # ── Coverage proposals ─────────────────────────────────────────────────
    template_builtin = [
        (sn, r) for sn, r in all_js_builtin if r['field'] == 'content_template'
    ]
    unregistered_keys = discover_unregistered_expr_keys(scene_files)
    _print_proposals(totals, all_uncovered, all_js_builtin, template_builtin, unregistered_keys)

    # ── GitHub step summary (CI only) ──────────────────────────────────────
    _write_github_summary(
        _build_github_summary(
            scene_results_map, totals, all_uncovered, all_js_builtin,
            template_builtin, unregistered_keys
        )
    )

    if all_uncovered:
        sys.exit(1)

    print('\n✅ All expression-bearing fields are covered by the sandbox / trust model.')
    sys.exit(0)


def _print_proposals(totals, all_uncovered, all_js_builtin, template_builtin,
                     unregistered_keys):
    """Emit the Coverage Proposals section.

    Analyses what was found across all scenes and produces actionable
    suggestions for expanding trust coverage in static/app.js.

    template_builtin: pre-filtered list of (scene_name, record) for
    content_template js-builtin findings (avoids recomputing in callers).
    unregistered_keys: dict of {key: example} from discover_unregistered_expr_keys().
    """
    proposals = []

    # ── Proposal 1: expand _JS_ONLY_RE to catch JS-only built-ins ─────────
    if totals['js_builtin'] > 0:
        builtin_names = set()
        for _, r in all_js_builtin:
            m = _JS_BUILTIN_FUNC_RE.search(r['expr'])
            if m:
                builtin_names.add(m.group(1))

        by_field = {}
        for _, r in all_js_builtin:
            by_field.setdefault(r['field'], 0)
            by_field[r['field']] += 1

        unique_scenes = {s for s, _ in all_js_builtin}
        names_str = '|'.join(f'\\b{n}\\b' for n in sorted(builtin_names))
        proposals.append((
            f'Expand _JS_ONLY_RE to catch JS-only built-in functions'
            f' ({totals["js_builtin"]} expressions across'
            f' {len(unique_scenes)} scene(s))',
            [
                f'Found {totals["js_builtin"]} expression(s) using JS-only built-ins'
                f' ({", ".join(sorted(builtin_names))}) that do not match _JS_ONLY_RE.',
                'These bypass the trust dialog and silently fall back to native JS'
                ' (returning 0 / "?" when untrusted).',
                'To gate them proactively, add them to _JS_ONLY_RE in static/app.js:',
                '',
                '  // Before:',
                '  const _JS_ONLY_RE = /\\blet\\b|...existing patterns.../;',
                '',
                '  // After (add at start of alternation):',
                f'  const _JS_ONLY_RE = /{names_str}|\\blet\\b|...existing patterns.../;',
                '',
                f'  Fields with builtin expressions: {", ".join(sorted(by_field))}',
            ]
        ))

    # ── Proposal 2: scan content templates in _scanSpecForUnsafeJs ─────────
    if template_builtin:
        proposals.append((
            f'Extend _scanSpecForUnsafeJs to scan {{{{...}}}} content templates'
            f' ({len(template_builtin)} template expression(s) use JS built-ins)',
            [
                '_scanSpecForUnsafeJs currently only inspects known EXPR_KEYS.',
                'Expressions inside {{...}} content templates are compiled by'
                ' _evalInfoExpr via the JS fallback but are never pre-scanned.',
                'Fix: extract {{...}} blocks from "content" strings inside'
                ' _scanSpecForUnsafeJs and test them against _JS_ONLY_RE',
                '(plus the built-in pattern once Proposal 1 is applied):',
                '',
                '  // In _scanSpecForUnsafeJs, inside walk():',
                '  if (k === "content" && typeof v === "string") {',
                '    const tmplRe = /\\{\\{([\\s\\S]*?)\\}\\}/g;',
                '    let m;',
                '    while ((m = tmplRe.exec(v)) !== null) {',
                '      if (_JS_ONLY_RE.test(m[1])) return true;',
                '    }',
                '  }',
            ]
        ))

    # ── Proposal 3: dynamically discovered unregistered expression-bearing keys
    if unregistered_keys:
        uncovered_js_keys = {r['field'] for _, r in all_uncovered
                             if r['field'] not in _SCANNED_KEYS}
        proposals.append((
            f'Register newly discovered expression-bearing keys in the audit'
            f' ({len(unregistered_keys)} unregistered key(s) found in scene files)',
            [
                'The audit found string fields with JS/expression values that are'
                ' not yet tracked in _SCANNED_KEYS or _UNSCANNED_EXPR_KEYS:',
                '',
            ] + [
                f'  {k!r}: e.g. {v!r}'
                for k, v in sorted(unregistered_keys.items())
            ] + [
                '',
                'For each key, decide:',
                '  a) If app.js evaluates it via compileExpr → add to _UNSCANNED_EXPR_KEYS',
                '     (and ideally also add it to EXPR_KEYS in _scanSpecForUnsafeJs)',
                '  b) If it is not evaluated as an expression → add to _NON_EXPR_KEYS',
                '     to suppress this proposal in future runs.',
            ] + (
                [
                    '',
                    '⚠️  These already contain JS patterns — immediate review required:',
                ] + [f'   {k}' for k in sorted(uncovered_js_keys)]
                if uncovered_js_keys else []
            )
        ))

    if not proposals:
        return

    # The marker below is used by the GitHub Actions workflow to extract this
    # section from stdout for the PR comment body.
    print('\n' + '─' * 60)
    print('📋 Coverage Proposals')
    print('   The following additions would improve trust coverage:\n')
    for i, (title, lines) in enumerate(proposals, 1):
        print(f'  {i}. {title}')
        for line in lines:
            print(f'     {line}' if line else '')
        print()


def _build_github_summary(scene_results_map, totals, all_uncovered, all_js_builtin,
                          template_builtin, unregistered_keys):
    """Return a markdown string suitable for the GitHub Actions step summary.

    scene_results_map: {scene_name: (results, scene_unsafe)}
    template_builtin: pre-filtered list of records for content_template js-builtin findings.
    unregistered_keys: dict of {key: example} from discover_unregistered_expr_keys().
    """
    lines = []
    lines.append('## 🔒 Expression Sandbox Audit\n')

    overall_ok = totals['js_uncovered'] == 0
    lines.append('**Overall status:** ' + ('✅ All covered' if overall_ok else '❌ Uncovered expressions found') + '\n')
    lines.append(
        f'| Metric | Count |\n|---|---|\n'
        f'| ✅ safe | {totals["safe"]} |\n'
        f'| 🔓 unsafe-scene | {totals["unsafe_scene"]} |\n'
        f'| ⚠️ js/covered | {totals["js_covered"]} |\n'
        f'| ❌ js/uncovered | {totals["js_uncovered"]} |\n'
        f'| 🔶 js-builtin | {totals["js_builtin"]} |\n'
    )

    lines.append('\n### Per-file results\n')
    for scene_name, (results, scene_unsafe) in scene_results_map.items():
        counts = {k: 0 for k in _CLASSIFICATION_LABELS}
        for r in results:
            counts[r['classification']] += 1

        file_uncovered = [r for r in results if r['classification'] == 'js_uncovered']
        file_builtin = [r for r in results if r['classification'] == 'js_builtin']

        unsafe_tag = ' `[unsafe:true]`' if scene_unsafe else ''
        if file_uncovered:
            icon = '❌'
        elif file_builtin:
            icon = '🔶'
        elif scene_unsafe:
            icon = '🔓'
        else:
            icon = '✅'

        lines.append(
            f'**{icon} {scene_name}**{unsafe_tag}  \n'
            f'safe={counts["safe"]}  unsafe-scene={counts["unsafe_scene"]}'
            f'  js/covered={counts["js_covered"]}'
            f'  uncovered={counts["js_uncovered"]}  js-builtin={counts["js_builtin"]}\n'
        )
        if file_uncovered:
            for r in file_uncovered:
                lines.append(f'- ❌ `[{r["field"]}]` `{r["expr"]}`\n')
        if file_builtin:
            details = '\n'.join(f'  - `[{r["field"]}]` `{r["expr"]}`' for r in file_builtin)
            lines.append(f'<details><summary>🔶 {len(file_builtin)} js-builtin expression(s)</summary>\n\n{details}\n</details>\n')

    if all_uncovered:
        lines.append('\n### ❌ Uncovered expressions (FAIL)\n')
        lines.append(
            'These expressions match `_JS_ONLY_RE` but sit in fields that'
            ' `_scanSpecForUnsafeJs` does not scan. They will execute native JS'
            ' without the trust dialog being shown.\n'
        )
        for scene_name, r in all_uncovered:
            lines.append(f'- `{scene_name}` `[{r["field"]}]` `{r["expr"]}`\n')

    # Coverage proposals
    lines.append('\n### 📋 Coverage Proposals\n')
    lines.append('The following improvements would expand trust coverage in `static/app.js`:\n')

    proposal_num = 0

    if totals['js_builtin'] > 0:
        proposal_num += 1
        builtin_names = set()
        for _, r in all_js_builtin:
            m = _JS_BUILTIN_FUNC_RE.search(r['expr'])
            if m:
                builtin_names.add(m.group(1))
        names_str = '|'.join(f'\\b{n}\\b' for n in sorted(builtin_names))
        lines.append(
            f'**{proposal_num}. Expand `_JS_ONLY_RE` to catch JS-only built-in functions**  \n'
            f'Found {totals["js_builtin"]} expression(s) using `{", ".join(sorted(builtin_names))}`'
            f' that do not match `_JS_ONLY_RE`. Add them to the regex in `static/app.js`:\n'
            f'```js\n'
            f'// static/app.js — line ~90\n'
            f'const _JS_ONLY_RE = /{names_str}|\\blet\\b|\\bconst\\b|\\bvar\\b|\\breturn\\b'
            f'|\\bfor\\s*\\(|\\bwhile\\s*\\(|=>|\\bfunction\\b|\\bMath\\.|\\.'
            f'([a-zA-Z_]\\w*)\\s*\\(/;\n'
            f'```\n'
            f'Also update `_JS_BUILTIN_FUNC_RE` check in `scripts/audit_expressions.py`'
            f' and move matched names into `_JS_ONLY_RE` there too.\n'
        )

    template_builtin_records = [r for _, r in template_builtin]
    if template_builtin_records:
        proposal_num += 1
        lines.append(
            f'**{proposal_num}. Extend `_scanSpecForUnsafeJs` to scan `{{{{...}}}}` content templates**  \n'
            f'{len(template_builtin_records)} `content` template expression(s) use JS built-ins'
            f' that are never pre-scanned. Add this block inside `walk()` in'
            f' `_scanSpecForUnsafeJs` in `static/app.js`:\n'
            f'```js\n'
            f'// Inside _scanSpecForUnsafeJs → walk(obj, parentKey)\n'
            f'if (k === \'content\' && typeof v === \'string\') {{\n'
            f'    const tmplRe = /\\{{\\{{([\\s\\S]*?)\\}}\\}}/g;\n'
            f'    let m;\n'
            f'    while ((m = tmplRe.exec(v)) !== null) {{\n'
            f'        if (_JS_ONLY_RE.test(m[1])) return true;\n'
            f'    }}\n'
            f'}}\n'
            f'```\n'
        )

    if unregistered_keys:
        proposal_num += 1
        uncovered_js_keys = {r['field'] for _, r in all_uncovered
                             if r['field'] not in _SCANNED_KEYS}
        key_list = '\n'.join(
            f'- `{k}`: e.g. `{v}`' for k, v in sorted(unregistered_keys.items())
        )
        lines.append(
            f'**{proposal_num}. Register newly discovered expression-bearing keys**  \n'
            f'The audit found {len(unregistered_keys)} key(s) with JS/expression values'
            f' not yet tracked:\n\n{key_list}\n\n'
            f'For each key: add to `_UNSCANNED_EXPR_KEYS` in `audit_expressions.py`'
            f' (and `EXPR_KEYS` in `_scanSpecForUnsafeJs` if app.js evaluates it),'
            f' or add to `_NON_EXPR_KEYS` to suppress.\n'
        )
        if uncovered_js_keys:
            lines.append(
                f'⚠️ **These already contain JS patterns — immediate review required:**\n'
                + '\n'.join(f'- `{k}`' for k in sorted(uncovered_js_keys)) + '\n'
            )

    return ''.join(lines)


def _write_github_summary(content):
    """Write markdown content to $GITHUB_STEP_SUMMARY if running in CI."""
    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        with open(summary_path, 'a', encoding='utf-8') as fh:
            fh.write(content)


if __name__ == '__main__':
    main()
