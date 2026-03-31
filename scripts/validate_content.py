#!/usr/bin/env python3
"""Deep content validation for AlgeBench scene JSON files.

Goes beyond JSON Schema to check expression safety, slider references,
remove target validity, proof consistency, and camera sanity.

Usage:
    ./run.sh scripts/validate_content.py scenes/eigenvalues.json
    ./run.sh scripts/validate_content.py scenes/*.json
    ./run.sh scripts/validate_content.py --fix scenes/eigenvalues.json

Exit codes:
    0  All files pass (may have warnings)
    1  One or more files have errors
"""

import argparse
import json
import re
import sys
from pathlib import Path

# ---- Expression safety ----

EXPR_KEYS = {'expr', 'fromExpr', 'x', 'y', 'z', 'fx', 'fy', 'fz', 'expression',
             'radiusExpr', 'visibleExpr', 'labelExpr', 'toExpr', 'positionExpr',
             'centerExpr', 'rangeExpr'}

JS_PATTERNS = [
    (r'Math\.', 'Use math.js syntax (sin, cos, pi) not JavaScript (Math.sin, Math.PI)'),
    (r'\.toFixed\(', 'Use toFixed(x, n) not x.toFixed(n)'),
    (r'=>', 'Arrow functions are JavaScript, not math.js'),
    (r'\bfunction\b', 'function keyword is JavaScript, not math.js'),
    (r'\blet\s', 'let keyword is JavaScript, not math.js'),
    (r'\bconst\s', 'const keyword is JavaScript, not math.js'),
    (r'\breturn\s', 'return keyword is JavaScript, not math.js'),
    (r'\bfor\s*\(', 'for loop is JavaScript, not math.js'),
    (r'\bwhile\s*\(', 'while loop is JavaScript, not math.js'),
]

MATH_JS_REPLACEMENTS = [
    (r'Math\.sin\b', 'sin'),
    (r'Math\.cos\b', 'cos'),
    (r'Math\.tan\b', 'tan'),
    (r'Math\.sqrt\b', 'sqrt'),
    (r'Math\.abs\b', 'abs'),
    (r'Math\.pow\b', 'pow'),
    (r'Math\.min\b', 'min'),
    (r'Math\.max\b', 'max'),
    (r'Math\.floor\b', 'floor'),
    (r'Math\.ceil\b', 'ceil'),
    (r'Math\.round\b', 'round'),
    (r'Math\.log\b', 'log'),
    (r'Math\.exp\b', 'exp'),
    (r'Math\.PI\b', 'pi'),
    (r'Math\.E\b', 'e'),
    (r'\*\*', '^'),
]


def collect_expressions(obj, path='', skip_keys=None):
    """Recursively collect all expression strings with their JSON paths.
    skip_keys: set of keys to skip at any level (e.g., 'functions' for unsafe files)."""
    skip_keys = skip_keys or set()
    results = []
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key in skip_keys:
                continue
            child_path = f'{path}.{key}' if path else key
            if key in EXPR_KEYS:
                if isinstance(val, str):
                    results.append((child_path, val))
                elif isinstance(val, list):
                    for i, item in enumerate(val):
                        if isinstance(item, str):
                            results.append((f'{child_path}[{i}]', item))
            else:
                results.extend(collect_expressions(val, child_path, skip_keys))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            results.extend(collect_expressions(item, f'{path}[{i}]', skip_keys))
    return results


def check_expressions(data):
    """Check expressions for JavaScript patterns. Returns (errors, warnings, fixes)."""
    is_unsafe = data.get('unsafe', False) or bool(data.get('unsafeExplanation'))
    # Skip 'functions' key entirely for unsafe files — those contain intentional JS
    skip = {'functions'} if is_unsafe else set()
    exprs = collect_expressions(data, skip_keys=skip)
    errors = []
    fixes = []

    for path, expr in exprs:
        # Skip IIFE expressions in unsafe files
        if is_unsafe and ('function' in expr or '=>' in expr or 'let ' in expr
                          or 'const ' in expr or 'return ' in expr):
            continue

        for pattern, msg in JS_PATTERNS:
            if re.search(pattern, expr):
                if is_unsafe:
                    continue
                # Check if auto-fixable
                fixed = expr
                for fix_pat, fix_repl in MATH_JS_REPLACEMENTS:
                    fixed = re.sub(fix_pat, fix_repl, fixed)
                if fixed != expr:
                    fixes.append((path, expr, fixed))
                else:
                    errors.append(f'{path}: {msg} — "{expr[:80]}"')
                break  # One error per expression

    return errors, fixes, len(exprs)


# ---- Remove target validity ----

def check_remove_targets(data):
    """Track element IDs through steps and check remove targets."""
    errors = []
    checked = 0
    scenes = data.get('scenes', [data] if 'elements' in data else [])

    for si, scene in enumerate(scenes):
        active_ids = set()
        # Base elements
        for el in scene.get('elements', []):
            if el.get('id'):
                active_ids.add(el['id'])

        for sti, step in enumerate(scene.get('steps', [])):
            # Add new elements
            for el in step.get('add', []):
                if el.get('id'):
                    active_ids.add(el['id'])

            # Check removes
            for rm in step.get('remove', []):
                checked += 1
                rm_id = rm.get('id')
                rm_type = rm.get('type')
                if rm_id and rm_id != '*' and rm_id not in active_ids and not rm_type:
                    errors.append(
                        f'scenes[{si}].steps[{sti}].remove: '
                        f'ID "{rm_id}" not found in active elements'
                    )

    return errors, checked


# ---- Slider-expression consistency ----

BUILTIN_VARS = {'t', 'x', 'y', 'z', 'u', 'v', 'pi', 'PI', 'e', 'E', 'i',
                'sin', 'cos', 'tan', 'sqrt', 'abs', 'pow', 'min', 'max',
                'floor', 'ceil', 'round', 'log', 'exp', 'asin', 'acos', 'atan',
                'atan2', 'sign', 'mod', 'toFixed', 'prev', 'tanh', 'sinh', 'cosh',
                'sec', 'csc', 'cot'}


def extract_identifiers(expr):
    """Extract potential variable identifiers from a math.js expression."""
    # Remove string literals and numbers
    cleaned = re.sub(r'"[^"]*"', '', expr)
    cleaned = re.sub(r"'[^']*'", '', cleaned)
    # Extract identifiers (word chars not starting with digit)
    return set(re.findall(r'\b([a-zA-Z_]\w*)\b', cleaned))


def check_slider_refs(data):
    """Check that expressions only reference defined slider IDs or builtins."""
    warnings = []
    checked = 0
    scenes = data.get('scenes', [data] if 'elements' in data else [])

    is_unsafe = data.get('unsafe', False) or bool(data.get('unsafeExplanation'))

    for si, scene in enumerate(scenes):
        active_sliders = set()
        # Collect function names
        func_names = set()
        for fn in scene.get('functions', []):
            name = fn.get('name') or fn.get('id')
            if name:
                func_names.add(name)

        # Collect domain imports — we can't know their exports, so skip check
        has_imports = bool(data.get('import', []))

        for sti, step in enumerate(scene.get('steps', [])):
            # Add sliders from this step
            for sl in step.get('sliders', []):
                if sl.get('id'):
                    active_sliders.add(sl['id'])

            # Remove sliders if requested
            for rm in step.get('remove', []):
                if rm.get('type') == 'slider':
                    active_sliders.clear()

            # Check expressions in added elements
            skip = {'functions'} if is_unsafe else set()
            for el in step.get('add', []):
                exprs = collect_expressions(el, skip_keys=skip)
                for path, expr in exprs:
                    # Skip IIFE/JS expressions in unsafe files
                    if is_unsafe and any(kw in expr for kw in
                                         ('function', '=>', 'let ', 'const ', 'return ')):
                        continue
                    checked += 1
                    ids = extract_identifiers(expr)
                    known = BUILTIN_VARS | active_sliders | func_names
                    unknown = ids - known
                    if unknown and not has_imports:
                        # Filter out likely false positives (short math tokens)
                        real_unknown = {u for u in unknown if len(u) > 1}
                        if real_unknown:
                            warnings.append(
                                f'scenes[{si}].steps[{sti}] {path}: '
                                f'possible undefined refs: {real_unknown}'
                            )

    return warnings, checked


# ---- Proof checks ----

def check_proofs(data):
    """Check proof consistency: highlights, sceneStep, structure."""
    errors = []
    warnings = []
    proof_count = 0
    step_count = 0

    def check_proof(proof, ctx):
        nonlocal proof_count, step_count
        proof_count += 1

        if not proof.get('title'):
            warnings.append(f'{ctx}: proof missing title')
        if not proof.get('steps'):
            errors.append(f'{ctx}: proof has no steps')
            return

        for i, step in enumerate(proof.get('steps', [])):
            step_count += 1
            step_ctx = f'{ctx}.steps[{i}]'

            if not step.get('label'):
                warnings.append(f'{step_ctx}: proof step missing label')

            # Check highlight consistency
            math = step.get('math', '')
            highlights = step.get('highlights', {})

            # Find all \htmlClass{hl-NAME} references in math
            hl_refs = set(re.findall(r'\\htmlClass\{hl-(\w+)\}', math))
            hl_keys = set(highlights.keys())

            orphan_keys = hl_keys - hl_refs
            missing_keys = hl_refs - hl_keys

            for k in orphan_keys:
                warnings.append(f'{step_ctx}: highlight key "{k}" has no matching \\htmlClass in math')
            for k in missing_keys:
                errors.append(f'{step_ctx}: \\htmlClass{{hl-{k}}} in math but no highlight definition')

    def scan_proofs(obj, ctx):
        proof = obj.get('proof')
        if proof is None:
            return
        proofs = proof if isinstance(proof, list) else [proof]
        for i, p in enumerate(proofs):
            check_proof(p, f'{ctx}.proof[{i}]' if len(proofs) > 1 else f'{ctx}.proof')

    # Root level
    scan_proofs(data, 'root')

    # Scene and step level
    scenes = data.get('scenes', [data] if 'elements' in data else [])
    for si, scene in enumerate(scenes):
        scan_proofs(scene, f'scenes[{si}]')
        for sti, step in enumerate(scene.get('steps', [])):
            scan_proofs(step, f'scenes[{si}].steps[{sti}]')

    return errors, warnings, proof_count, step_count


# ---- Camera sanity ----

def check_camera(data):
    """Check camera positions are within reasonable bounds."""
    warnings = []
    scenes = data.get('scenes', [data] if 'elements' in data else [])

    for si, scene in enumerate(scenes):
        scene_range = scene.get('range', [[-5, 5], [-5, 5], [-5, 5]])
        if not isinstance(scene_range, list) or len(scene_range) < 3:
            continue

        max_extent = max(abs(r[1] - r[0]) for r in scene_range if isinstance(r, list) and len(r) >= 2)
        threshold = max_extent * 5

        cam = scene.get('camera', {})
        if cam:
            pos = cam.get('position', [])
            if isinstance(pos, list) and len(pos) >= 3:
                for i, v in enumerate(pos):
                    if isinstance(v, (int, float)) and abs(v) > threshold:
                        warnings.append(
                            f'scenes[{si}].camera.position[{i}]: '
                            f'value {v} is far from scene range (max extent={max_extent})'
                        )

    return warnings


# ---- Info overlay placeholder check ----

def check_overlays(data):
    """Check {{placeholder}} references in info overlay content."""
    warnings = []
    checked = 0
    scenes = data.get('scenes', [data] if 'elements' in data else [])

    for si, scene in enumerate(scenes):
        active_sliders = set()

        for sti, step in enumerate(scene.get('steps', [])):
            for sl in step.get('sliders', []):
                if sl.get('id'):
                    active_sliders.add(sl['id'])

            for rm in step.get('remove', []):
                if rm.get('type') == 'slider':
                    active_sliders.clear()

            for info in step.get('info', []):
                content = info.get('content', '')
                checked += 1
                placeholders = re.findall(r'\{\{([^}]+)\}\}', content)
                for ph in placeholders:
                    # Simple identifier check — complex expressions are fine
                    ph_ids = extract_identifiers(ph)
                    unknown = ph_ids - BUILTIN_VARS - active_sliders
                    # Only warn for simple single-identifier placeholders
                    if len(ph_ids) == 1 and unknown:
                        warnings.append(
                            f'scenes[{si}].steps[{sti}].info "{info.get("id", "?")}": '
                            f'placeholder {{{{{ph}}}}} may reference undefined slider'
                        )

    return warnings, checked


# ---- Main ----

def validate_file(path, fix=False):
    """Run all content checks on a single file. Returns (errors, warnings, fixes, stats)."""
    try:
        with open(path) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f'Invalid JSON: {e}'], [], [], {}

    errors = []
    warnings = []
    fixes = []
    stats = {}

    # Expression safety
    expr_errors, expr_fixes, expr_count = check_expressions(data)
    errors.extend(expr_errors)
    fixes.extend(expr_fixes)
    stats['expressions'] = (expr_count, len(expr_errors), len(expr_fixes))

    # Remove targets
    rm_errors, rm_count = check_remove_targets(data)
    errors.extend(rm_errors)
    stats['remove_targets'] = (rm_count, len(rm_errors))

    # Slider refs
    sl_warnings, sl_count = check_slider_refs(data)
    warnings.extend(sl_warnings)
    stats['slider_refs'] = (sl_count, len(sl_warnings))

    # Proofs
    proof_errors, proof_warnings, proof_count, proof_step_count = check_proofs(data)
    errors.extend(proof_errors)
    warnings.extend(proof_warnings)
    stats['proofs'] = (proof_count, proof_step_count, len(proof_errors), len(proof_warnings))

    # Camera
    cam_warnings = check_camera(data)
    warnings.extend(cam_warnings)
    stats['camera'] = len(cam_warnings)

    # Overlays
    ov_warnings, ov_count = check_overlays(data)
    warnings.extend(ov_warnings)
    stats['overlays'] = (ov_count, len(ov_warnings))

    # Apply fixes if requested
    if fix and fixes:
        text = path.read_text()
        for fix_path, old, new in fixes:
            text = text.replace(json.dumps(old), json.dumps(new))
        path.write_text(text)

    return errors, warnings, fixes, stats


def print_report(path, errors, warnings, fixes, stats, errors_only=False):
    """Print a formatted validation report."""
    ec, ee, ef = stats.get('expressions', (0, 0, 0))
    rc, re_ = stats.get('remove_targets', (0, 0))
    sc, sw = stats.get('slider_refs', (0, 0))
    pc, psc, pe, pw = stats.get('proofs', (0, 0, 0, 0))
    cw = stats.get('camera', 0)
    oc, ow = stats.get('overlays', (0, 0))

    def status(errs, warns=0):
        if errs:
            return f'FAIL ({errs} error{"s" if errs != 1 else ""})'
        if warns:
            return f'WARN ({warns} warning{"s" if warns != 1 else ""})'
        return 'PASS'

    total_errors = len(errors)
    total_warnings = len(warnings)

    # In errors-only mode, skip files that pass cleanly
    if errors_only and total_errors == 0 and not fixes:
        return True

    print(f'\nValidated: {path}')
    print(f'  Expressions: {status(ee)} ({ec} checked, {ef} auto-fixable)')
    print(f'  Remove IDs:  {status(re_)} ({rc} checked)')
    print(f'  Slider refs: {status(0, sw)} ({sc} checked)')
    if pc > 0:
        print(f'  Proofs:      {status(pe, pw)} ({pc} proof{"s" if pc != 1 else ""}, {psc} steps)')
    else:
        print(f'  Proofs:      N/A')
    print(f'  Camera:      {status(0, cw)}')
    print(f'  Overlays:    {status(0, ow)} ({oc} checked)')

    if fixes:
        print(f'\n  Auto-fixable ({len(fixes)}):')
        for fix_path, old, new in fixes[:10]:
            print(f'    {fix_path}: {old[:40]} → {new[:40]}')
        if len(fixes) > 10:
            print(f'    ... and {len(fixes) - 10} more')

    if errors:
        print(f'\n  Errors ({total_errors}):')
        for e in errors[:20]:
            print(f'    ❌ {e}')

    if warnings:
        print(f'\n  Warnings ({total_warnings}):')
        for w in warnings[:20]:
            print(f'    ⚠️  {w}')

    if total_errors:
        print(f'\n  Result: INVALID ({total_errors} error{"s" if total_errors != 1 else ""}, {total_warnings} warning{"s" if total_warnings != 1 else ""})')
    elif total_warnings:
        print(f'\n  Result: VALID ({total_warnings} warning{"s" if total_warnings != 1 else ""})')
    else:
        print(f'\n  Result: VALID')

    return total_errors == 0


def main():
    parser = argparse.ArgumentParser(description='Deep content validation for AlgeBench scene files')
    parser.add_argument('files', nargs='*', type=Path, help='Scene JSON files to validate')
    parser.add_argument('--fix', action='store_true', help='Auto-fix expression issues in place')
    parser.add_argument('-e', '--errors-only', action='store_true', help='Only show files with errors (suppress passing files)')
    args = parser.parse_args()

    if not args.files:
        parser.print_help()
        sys.exit(0)

    failed = 0
    for path in args.files:
        if not path.exists():
            print(f'⏭️  {path} (not found)')
            continue

        errors, warnings, fixes, stats = validate_file(path, fix=args.fix)
        passed = print_report(path, errors, warnings, fixes, stats, errors_only=args.errors_only)
        if not passed:
            failed += 1

    print()
    if failed:
        print(f'❌ {failed} file(s) have errors.')
        sys.exit(1)
    elif not args.errors_only:
        print(f'✅ All {len(args.files)} file(s) pass content checks.')
        sys.exit(0)


if __name__ == '__main__':
    main()
