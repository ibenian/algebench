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


# Test suite for _JS_ONLY_RE detection quality.
# Each entry: (test_expression, severity_if_missed, description)
# Severity:
#   'error'   — missed pattern allows code execution or data exfiltration;
#               the catch-fallback in compileExpr will run this as JS in any
#               trusted scene, even if this specific expression didn't trigger
#               the trust dialog itself.
#   'warning' — missed pattern is a gap but lower direct risk in expression context.
_JS_DETECTION_TESTS = [
    # ── Critical: bare function calls with no dot prefix ──────────────────
    ('eval("x")',                'error',   'eval() — direct arbitrary code execution'),
    ('new Function("return 1")', 'error',   'Function constructor — creates executable function'),
    ('fetch("https://x.com")',   'error',   'fetch() — network exfiltration / SSRF'),
    ('import("mod")',            'error',   'dynamic import() — loads external module'),
    # ── Critical: property access without () that bypasses dot-method-paren rule
    ('document.cookie',          'error',   'document.cookie — reads session cookies (no call, no dot-paren match)'),
    ('window.localStorage',      'error',   'window global — browser storage access (no call)'),
    ('globalThis.process',       'error',   'globalThis — platform-agnostic global escape'),
    # ── Significant: execution/loading patterns ────────────────────────────
    ('require("fs")',             'warning', 'require() — CommonJS module load (relevant in Node/Electron)'),
    ('setTimeout(f,0)',           'warning', 'setTimeout — deferred execution'),
    ('setInterval(f,100)',        'warning', 'setInterval — repeated execution'),
    # ── Lower risk: language constructs unusual in math expressions ─────────
    ('class Foo {}',              'warning', 'class declaration — not a math expression'),
    ('typeof x',                  'warning', 'typeof operator — unlikely in math but harmless'),
    ('delete x.y',                'warning', 'delete operator — mutates scope'),
    ('void 0',                    'warning', 'void operator — evaluates to undefined'),
    ('x instanceof Array',        'warning', 'instanceof — type check, not math'),
    ('throw new Error("x")',      'warning', 'throw — triggers exception'),
    ('await Promise.resolve(1)',  'warning', 'await — async keyword (math.js rejects it anyway)'),
]


def evaluate_js_detection_quality(js_only_re_pattern):
    """Run _JS_DETECTION_TESTS against the given regex pattern string.

    js_only_re_pattern: the raw pattern string extracted from app.js (or the
    Python mirror).  Tests are run against a compiled version of this pattern.

    Returns a list of (severity, caught, test_expr, description) tuples.
    'caught' is True if the regex matched the test expression.
    """
    try:
        live_re = re.compile(js_only_re_pattern)
    except re.error as e:
        return [('error', False, '', f'Could not compile extracted _JS_ONLY_RE: {e}')]

    results = []
    for expr, severity, description in _JS_DETECTION_TESTS:
        caught = bool(live_re.search(expr))
        results.append((severity, caught, expr, description))
    return results


def verify_app_js_trust_model(repo_root):
    """Parse static/app.js and verify the trust checker is intact and in sync.

    Checks:
    1. _JS_ONLY_RE in app.js matches the Python mirror in this script
    2. EXPR_KEYS in _scanSpecForUnsafeJs matches _SCANNED_KEYS in this script
    3. compileExpr catch-fallback bypass is documented (known, expected path)
    4. No additional compileExpr-style functions bypass the trust check

    Returns a list of (severity, message) tuples where severity is
    'error', 'warning', or 'info'.
    """
    app_js_path = repo_root / 'static' / 'app.js'
    if not app_js_path.exists():
        return [('error', f'static/app.js not found at {app_js_path}')]

    content = app_js_path.read_text(encoding='utf-8')
    findings = []

    # ── 1. Extract and compare _JS_ONLY_RE ────────────────────────────────
    js_re_match = re.search(r'const _JS_ONLY_RE\s*=\s*/(.+?)/;', content)
    if not js_re_match:
        findings.append(('error', '_JS_ONLY_RE declaration not found in static/app.js'))
    else:
        js_pattern = js_re_match.group(1)
        py_pattern = _JS_ONLY_RE.pattern
        # Extract \bWORD\b terms from each pattern for structural comparison
        js_terms = set(re.findall(r'\\b([a-zA-Z_]\w*)\\b', js_pattern))
        py_terms = set(re.findall(r'\\b([a-zA-Z_]\w*)\\b', py_pattern))
        only_in_app = js_terms - py_terms
        only_in_script = py_terms - js_terms
        if only_in_app:
            findings.append(('warning',
                f'_JS_ONLY_RE drift: terms in app.js not in audit script: {sorted(only_in_app)}'
                ' — audit may miss JS patterns that app.js catches'))
        if only_in_script:
            findings.append(('warning',
                f'_JS_ONLY_RE drift: terms in audit script not in app.js: {sorted(only_in_script)}'
                ' — audit flags patterns that app.js does not gate'))
        if not only_in_app and not only_in_script:
            findings.append(('info', '_JS_ONLY_RE is in sync between app.js and audit script'))

        # ── 1b. Detection quality: run known-dangerous patterns against the live regex
        detection_results = evaluate_js_detection_quality(js_pattern)
        missed_errors   = [(e, d) for s, caught, e, d in detection_results if not caught and s == 'error']
        missed_warnings = [(e, d) for s, caught, e, d in detection_results if not caught and s == 'warning']
        caught_count    = sum(1 for _, caught, _, _ in detection_results if caught)
        total           = len(detection_results)

        if missed_errors:
            for expr, desc in missed_errors:
                findings.append(('error',
                    f'_JS_ONLY_RE misses critical pattern: {expr!r} — {desc}'))
        if missed_warnings:
            findings.append(('warning',
                f'_JS_ONLY_RE coverage gaps ({len(missed_warnings)} soft): '
                + ', '.join(e for e, _ in missed_warnings)))
        findings.append(('info' if not missed_errors else 'warning',
            f'_JS_ONLY_RE detection quality: {caught_count}/{total} test patterns caught'
            + (' ✅' if not missed_errors and not missed_warnings else '')))

    # ── 2. Extract and compare EXPR_KEYS in _scanSpecForUnsafeJs ──────────
    expr_keys_match = re.search(
        r'function _scanSpecForUnsafeJs\b.*?const EXPR_KEYS\s*=\s*new Set\(\[([^\]]+)\]\)',
        content, re.DOTALL
    )
    if not expr_keys_match:
        findings.append(('error',
            'EXPR_KEYS declaration not found inside _scanSpecForUnsafeJs in static/app.js'))
    else:
        app_keys = frozenset(re.findall(r"'([^']+)'", expr_keys_match.group(1)))
        only_in_app = app_keys - _SCANNED_KEYS
        only_in_script = _SCANNED_KEYS - app_keys
        if only_in_app:
            findings.append(('error',
                f'EXPR_KEYS drift: keys scanned by app.js but missing from _SCANNED_KEYS: '
                f'{sorted(only_in_app)} — audit will NOT flag JS expressions in these fields'))
        if only_in_script:
            findings.append(('warning',
                f'EXPR_KEYS drift: keys in _SCANNED_KEYS but absent from app.js EXPR_KEYS: '
                f'{sorted(only_in_script)} — audit over-reports coverage for these fields'))
        if not only_in_app and not only_in_script:
            findings.append(('info', 'EXPR_KEYS is in sync between app.js and audit script'))

    # ── 3. Verify compileExpr catch-fallback bypass is present and bounded ─
    # Expected: math.js parse failure → JS Function() fallback when trusted
    compile_fn_match = re.search(
        r'function compileExpr\s*\([^)]*\)\s*\{(.*?)\n\}',
        content, re.DOTALL
    )
    if not compile_fn_match:
        findings.append(('error', 'compileExpr function not found in static/app.js'))
    else:
        fn_body = compile_fn_match.group(1)
        has_js_guard = '_JS_ONLY_RE.test(' in fn_body
        has_trust_check = "_sceneJsTrustState === 'trusted'" in fn_body
        has_catch_fallback = 'catch' in fn_body and 'Function(' in fn_body
        has_untrusted_noop = "_mathjs.compile('0')" in fn_body

        if not has_js_guard:
            findings.append(('error',
                'compileExpr: _JS_ONLY_RE guard missing — JS expressions may execute without check'))
        if not has_trust_check:
            findings.append(('error',
                'compileExpr: trust state check missing — JS may execute without user approval'))
        if not has_catch_fallback:
            findings.append(('warning',
                'compileExpr: catch-fallback not found — toFixed/JS-builtin handling may have changed'))
        if not has_untrusted_noop:
            findings.append(('error',
                'compileExpr: no-op return for untrusted scenes not found — untrusted JS may execute'))
        if has_js_guard and has_trust_check and has_catch_fallback and has_untrusted_noop:
            findings.append(('info',
                'compileExpr: trust guard intact (JS_ONLY_RE gate + trust check + catch-fallback + untrusted no-op)'))

    # ── 4. Check for other compile-style functions that bypass the pattern ─
    compile_fns = re.findall(r'function (compile\w+)\s*\(', content)
    for fn_name in compile_fns:
        if fn_name == 'compileExpr':
            continue
        fn_match = re.search(
            rf'function {re.escape(fn_name)}\s*\([^)]*\)\s*\{{(.*?)\n\}}',
            content, re.DOTALL
        )
        if fn_match:
            body = fn_match.group(1)
            uses_js = 'Function(' in body
            has_trust = "_sceneJsTrustState === 'trusted'" in body
            has_guard = '_JS_ONLY_RE.test(' in body
            if uses_js and not has_trust:
                findings.append(('error',
                    f'{fn_name}: uses Function() without trust check — potential bypass'))
            elif uses_js and not has_guard:
                findings.append(('warning',
                    f'{fn_name}: uses Function() with trust check but no _JS_ONLY_RE pre-scan'))
            elif uses_js and has_trust and has_guard:
                findings.append(('info',
                    f'{fn_name}: properly gated (JS_ONLY_RE + trust check)'))

    return findings


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
    print('Trust checker integrity:')
    print('  🔴 error   — trust model is broken or bypassed; must fix before merge')
    print('  🟡 warning — potential drift or gap; review recommended')
    print('  🟢 info    — component verified intact')
    print()

    # ── Trust checker integrity ────────────────────────────────────────────
    trust_findings = verify_app_js_trust_model(repo_root)
    severity_icon = {'error': '🔴', 'warning': '🟡', 'info': '🟢'}
    has_trust_errors = any(s == 'error' for s, _ in trust_findings)
    print('── Trust Checker (static/app.js) ──')
    for severity, msg in trust_findings:
        print(f'  {severity_icon[severity]} {msg}')
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

    if all_uncovered or has_trust_errors:
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
    print('\n# PROPOSALS_START')
    print('─' * 60)
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
