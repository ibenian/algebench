---
name: audit-expressions
description: Audit expression sandbox coverage. Scans all scene JSON files for expressions and verifies each is properly handled by the math.js sandbox or the JS trust verification system. Run this before merging any PR that adds or modifies scene files.
---

# Audit Expression Sandbox Coverage

This skill checks that **every expression string found in AlgeBench scene JSON files is covered by the sandbox / trust-verification model** in `static/app.js`.

It is the CLI companion to the `audit-expressions` GitHub Actions workflow, which runs the same check automatically on every PR that touches scene files.

---

## When to Run This

- Before merging a PR that adds or modifies files in `scenes/`
- After changing the expression evaluator in `static/app.js`
- After updating `scripts/audit_expressions.py` (the allowlist logic)

---

## How to Run

```bash
python scripts/audit_expressions.py
```

No dependencies beyond the Python standard library. Works offline; no server needed.

---

## What It Checks

The script scans every expression-bearing location in `scenes/*.json`:

| Location | Description |
|---|---|
| `expr`, `x`, `y`, `z`, `fx`, `fy`, `fz`, `expression` | Animated element expression fields — already scanned by `_scanSpecForUnsafeJs` |
| `{{...}}` blocks inside `content` strings | Info-panel / caption template expressions |
| String coordinates inside `vertices` / `points` arrays | Polygon / animated-polygon vertex expressions |

Each expression is classified against the same regex (`_JS_ONLY_RE`) used by `static/app.js`:

| Label | Meaning |
|---|---|
| ✅ **safe** | No JS patterns detected — evaluated by math.js sandbox |
| 🔓 **unsafe-scene** | Scene has `"unsafe": true` — all JS explicitly opted in |
| ⚠️ **js/covered** | Matches JS pattern; sits in a field checked by `_scanSpecForUnsafeJs` — trust dialog will appear |
| ❌ **js/uncovered** | Matches JS pattern; **not** in a scanned field — trust dialog will NOT appear proactively |
| 🔶 **js-builtin** | Uses a JS-only built-in (e.g. `toFixed`) that bypasses `_JS_ONLY_RE`; evaluated via JS fallback |

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All expressions are covered — safe to merge |
| `1` | One or more `js/uncovered` expressions detected — **PR should not merge** |

---

## Understanding the Output

```
✅ eigenvalues.json
   safe=17  js/covered=0  uncovered=0  js-builtin=0

🔶 rotating-habitat.json
   safe=11  js/covered=0  uncovered=0  js-builtin=20
   🔶 [content_template] 'toFixed(2*PI*rpm/60, 4)'
   ...

✅ All expression-bearing fields are covered by the sandbox / trust model.
```

- **🔶 js-builtin** warnings are informational — `toFixed` and similar functions work via
  the JS fallback in `_evalInfoExpr` / `compileExpr` when the scene is trusted, and fall
  back to `0` / `?` silently when not trusted.  They do not represent a security risk.

- **❌ js/uncovered** is a hard failure.  Fix by:
  1. Moving the expression into a scanned field (`expr`, `x`, `y`, `z`, etc.)
  2. Setting `"unsafe": true` on the scene root to opt the whole scene into JS
  3. Extending `_scanSpecForUnsafeJs` in `static/app.js` to cover the new field

---

## How the Trust Model Works (Reference)

```
Scene load
  │
  ├── "unsafe": true ──────────────────────► Trust dialog (always)
  │
  ├── _scanSpecForUnsafeJs(spec) ──────────► Trust dialog (if JS pattern found
  │     Scans: expr, x, y, z,                in expression keys)
  │            expression, fx, fy, fz
  │
  └── No JS detected ─────────────────────► Silent load (math.js only)

compileExpr(str)
  ├── _JS_ONLY_RE matches ─────────────────► native Function (if trusted) / no-op
  ├── math.js parse succeeds ──────────────► math.js compiled expression
  └── math.js parse fails ─────────────────► native Function (if trusted) / no-op
```

---

## Files

| File | Purpose |
|---|---|
| `scripts/audit_expressions.py` | The audit script (pure Python, no deps) |
| `.github/workflows/audit-expressions.yml` | GitHub Action — runs on every PR touching scenes |
| `.agents/skills/audit-expressions/SKILL.md` | This file |
