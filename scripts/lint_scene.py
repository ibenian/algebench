#!/usr/bin/env python3
"""Lint a single AlgeBench scene JSON file before assembly.

Quick structural checks to catch common scene builder agent mistakes
before the scene is assembled into a lesson.

Usage:
    ./run.sh scripts/lint_scene.py scene.json
    ./run.sh scripts/lint_scene.py --fix scene.json

Exit codes:
    0  Scene passes all checks
    1  Scene has errors (unfixable or --fix not used)
"""

import argparse
import json
import re
import sys
from pathlib import Path


JS_PATTERNS = [
    (r'Math\.\w+', 'Math.X → use math.js (sin, cos, sqrt, pi, abs)'),
    (r'\w+\*\*\w+', 'x**n → use x^n or pow(x, n)'),
    (r'\.\s*toFixed\s*\(', '.toFixed(n) → use toFixed(x, n)'),
]

VALID_TYPES = {
    'skybox', 'axis', 'grid', 'vector', 'point', 'line', 'surface',
    'parametric_curve', 'parametric_surface', 'sphere', 'ellipsoid',
    'vectors', 'vector_field', 'plane', 'polygon', 'cylinder', 'text',
    'animated_vector', 'animated_line', 'animated_point',
    'animated_cylinder', 'animated_polygon', 'animated_curve',
}

EXPR_KEYS = {
    'expr', 'fromExpr', 'toExpr', 'positionExpr', 'centerExpr',
    'x', 'y', 'z', 'fx', 'fy', 'fz', 'expression',
    'radiusExpr', 'visibleExpr', 'labelExpr', 'rangeExpr',
    'valueExpr',
}


def collect_expressions(obj, path=''):
    """Yield (path, expr_string) for all expression fields in an object."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f'{path}.{k}' if path else k
            if k in EXPR_KEYS:
                if isinstance(v, str):
                    yield full, v
                elif isinstance(v, list):
                    for i, item in enumerate(v):
                        if isinstance(item, str):
                            yield f'{full}[{i}]', item
            else:
                yield from collect_expressions(v, full)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            yield from collect_expressions(item, f'{path}[{i}]')


def flatten_element(el):
    """Flatten nested props/params into top-level keys. Returns (fixed_el, fixes)."""
    fixes = []
    for nested_key in ('props', 'params', 'properties'):
        if nested_key in el and isinstance(el[nested_key], dict):
            fixes.append(f'Flattened "{nested_key}" into element')
            nested = el.pop(nested_key)
            for k, v in nested.items():
                if k not in el:
                    el[k] = v
    return el, fixes


def lint_element(el, path, fix=False):
    """Check a single element. Returns (errors, warnings, fixes)."""
    errors, warnings, fixes = [], [], []

    if not isinstance(el, dict):
        errors.append(f'{path}: Element is not an object')
        return errors, warnings, fixes

    # Check for nested props
    for nested_key in ('props', 'params', 'properties'):
        if nested_key in el:
            if fix:
                el, new_fixes = flatten_element(el)
                fixes.extend(f'{path}: {f}' for f in new_fixes)
            else:
                errors.append(f'{path}: Properties nested under "{nested_key}" — should be flat')

    # Check type
    el_type = el.get('type')
    if not el_type:
        errors.append(f'{path}: Missing "type" field')
    elif el_type not in VALID_TYPES:
        errors.append(f'{path}: Invalid type "{el_type}" (not in supported types)')

    return errors, warnings, fixes


def lint_expressions(scene, fix=False):
    """Check all expressions for JS patterns. Returns (errors, fixes)."""
    errors, fixes = [], []
    for path, expr in collect_expressions(scene):
        for pattern, msg in JS_PATTERNS:
            if re.search(pattern, expr):
                if fix and pattern == r'Math\.\w+':
                    # Auto-fix Math.X patterns
                    original = expr
                    expr = re.sub(r'Math\.sin', 'sin', expr)
                    expr = re.sub(r'Math\.cos', 'cos', expr)
                    expr = re.sub(r'Math\.tan', 'tan', expr)
                    expr = re.sub(r'Math\.sqrt', 'sqrt', expr)
                    expr = re.sub(r'Math\.abs', 'abs', expr)
                    expr = re.sub(r'Math\.pow', 'pow', expr)
                    expr = re.sub(r'Math\.PI', 'pi', expr)
                    expr = re.sub(r'Math\.E\b', 'e', expr)
                    expr = re.sub(r'Math\.min', 'min', expr)
                    expr = re.sub(r'Math\.max', 'max', expr)
                    expr = re.sub(r'Math\.floor', 'floor', expr)
                    expr = re.sub(r'Math\.ceil', 'ceil', expr)
                    expr = re.sub(r'Math\.round', 'round', expr)
                    if expr != original:
                        fixes.append(f'{path}: {original} → {expr}')
                else:
                    errors.append(f'{path}: {msg} — "{expr}"')
    return errors, fixes


def lint_scene(scene, fix=False):
    """Run all checks on a scene. Returns (errors, warnings, fixes)."""
    all_errors, all_warnings, all_fixes = [], [], []

    # Required fields
    if 'title' not in scene:
        all_warnings.append('Missing "title" field')

    # Check scene-level prompt (AI tutor guidance)
    if 'prompt' not in scene:
        all_warnings.append('Missing "prompt" field (AI tutor guidance for this scene)')

    # Check base elements
    for i, el in enumerate(scene.get('elements', [])):
        e, w, f = lint_element(el, f'elements[{i}]', fix=fix)
        all_errors.extend(e)
        all_warnings.extend(w)
        all_fixes.extend(f)

    # Check step elements and prompts
    for si, step in enumerate(scene.get('steps', [])):
        if 'title' not in step:
            all_warnings.append(f'steps[{si}]: Missing "title"')
        if 'prompt' not in step:
            all_warnings.append(f'steps[{si}]: Missing "prompt" (per-step AI tutor guidance)')
        for ei, el in enumerate(step.get('add', [])):
            e, w, f = lint_element(el, f'steps[{si}].add[{ei}]', fix=fix)
            all_errors.extend(e)
            all_warnings.extend(w)
            all_fixes.extend(f)

    # Check proof prompts
    proof = scene.get('proof')
    if isinstance(proof, dict):
        if 'prompt' not in proof:
            all_warnings.append('proof: Missing "prompt" (AI tutor guidance for the proof)')
        for pi, ps in enumerate(proof.get('steps', [])):
            if isinstance(ps, dict) and 'prompt' not in ps:
                all_warnings.append(f'proof.steps[{pi}]: Missing "prompt" (proof step AI guidance)')

    # Check expressions (skip for unsafe scenes — they use native JS intentionally)
    # Scene builders use "_unsafe_reason" as a signal field; assembled lessons use "unsafe"
    if not scene.get('unsafe') and not scene.get('_unsafe_reason'):
        expr_errors, expr_fixes = lint_expressions(scene, fix=fix)
        all_errors.extend(expr_errors)
        all_fixes.extend(expr_fixes)

    return all_errors, all_warnings, all_fixes


def main():
    parser = argparse.ArgumentParser(description='Lint an AlgeBench scene JSON file')
    parser.add_argument('file', type=Path, help='Scene JSON file to lint')
    parser.add_argument('--fix', action='store_true', help='Auto-fix common issues in place')
    args = parser.parse_args()

    # Parse JSON
    try:
        with open(args.file) as f:
            scene = json.load(f)
    except json.JSONDecodeError as e:
        print(f'FAIL: Invalid JSON — {e}')
        sys.exit(1)
    except FileNotFoundError:
        print(f'FAIL: File not found — {args.file}')
        sys.exit(1)

    errors, warnings, fixes = lint_scene(scene, fix=args.fix)

    # Write back if fixes were applied
    if fixes and args.fix:
        with open(args.file, 'w') as f:
            json.dump(scene, f, indent=2, ensure_ascii=False)
            f.write('\n')

    # Report
    steps = len(scene.get('steps', []))
    elements = len(scene.get('elements', []))
    step_elements = sum(len(s.get('add', [])) for s in scene.get('steps', []))
    print(f'Scene: {scene.get("title", "(untitled)")}')
    print(f'  Structure: {steps} steps, {elements} base elements, {step_elements} step elements')

    if fixes:
        print(f'  Auto-fixed ({len(fixes)}):')
        for fix in fixes:
            print(f'    {fix}')

    if warnings:
        print(f'  ⚠️  Warnings ({len(warnings)}):')
        for w in warnings:
            print(f'    {w}')

    if errors:
        print(f'  Errors ({len(errors)}):')
        for e in errors:
            print(f'    {e}')
        print(f'\n  Run: ./run.sh scripts/lint_scene.py --fix {args.file}')
        sys.exit(1)
    else:
        print(f'  Result: OK')


if __name__ == '__main__':
    main()
