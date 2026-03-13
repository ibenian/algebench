---
name: audit-expressions
description: Audit expression sandbox coverage. Scans all scene JSON files for expressions and verifies each is properly handled by the math.js sandbox or the JS trust verification system. Run this before merging any PR that adds or modifies scene files.
---

# Audit Expression Sandbox Coverage

This skill checks that **every expression string found in AlgeBench scene JSON files is covered by the sandbox / trust-verification model** in `static/app.js`.

It is the CLI companion to the `audit-expressions` GitHub Actions workflow, which runs the same check automatically on every PR that touches scene files.

After reporting per-file results the script emits a **Coverage Proposals** section that suggests concrete improvements to the trust model, such as expanding `_JS_ONLY_RE`, extending `_scanSpecForUnsafeJs` to cover content templates, or adding newly discovered expression keys to `EXPR_KEYS`.

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
| `visibleExpr`, `radiusExpr`, `radiiExpr`, `centerExpr`, `fromExpr`, `toExpr`, `positionExpr` | Additional expression fields compiled by `compileExpr` but **not** currently scanned by `_scanSpecForUnsafeJs` |
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

## Coverage Proposals

After the per-file report, the script always emits a **📋 Coverage Proposals** section containing actionable suggestions based on what was found across all scenes:

| Proposal | Trigger | Suggested fix |
|---|---|---|
| Expand `_JS_ONLY_RE` | Any `js-builtin` findings | Add `toFixed`, `toPrecision`, etc. to the regex in `static/app.js` |
| Scan `{{...}}` templates in `_scanSpecForUnsafeJs` | `js-builtin` in `content_template` fields | Walk `content` strings and extract `{{...}}` blocks inside `_scanSpecForUnsafeJs` |
| Add keys to `EXPR_KEYS` | Newly discovered expression keys | Expand the `EXPR_KEYS` set in `_scanSpecForUnsafeJs` to include `visibleExpr`, `radiusExpr`, `radiiExpr`, `centerExpr`, `fromExpr`, `toExpr`, `positionExpr` |

**When presenting audit results, always include the Proposals section and explain what each proposal would improve.** If any `❌ js/uncovered` expressions are found that already appear in the new expression key fields (`visibleExpr` etc.), highlight these as requiring immediate action.

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

────────────────────────────────────────────────────────────
📋 Coverage Proposals
   The following additions would improve trust coverage:

  1. Expand _JS_ONLY_RE to catch JS-only built-in functions (N expressions)
     ...

  2. Extend _scanSpecForUnsafeJs to scan {{...}} content templates
     ...

  3. Add expression-bearing keys to EXPR_KEYS in _scanSpecForUnsafeJs
     ...
```

- **🔶 js-builtin** warnings are informational — `toFixed` and similar functions work via
  the JS fallback in `_evalInfoExpr` / `compileExpr` when the scene is trusted, and fall
  back to `0` / `?` silently when not trusted.  The proposals section explains how to
  make these proactively trigger the trust dialog instead.

- **❌ js/uncovered** is a hard failure (exit 1).  Fix by:
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
  │     ⚠️ Does NOT scan: visibleExpr,
  │        radiusExpr, radiiExpr,
  │        centerExpr, fromExpr, toExpr,
  │        positionExpr, content templates
  │
  └── No JS detected ─────────────────────► Silent load (math.js only)

compileExpr(str)
  ├── _JS_ONLY_RE matches ─────────────────► native Function (if trusted) / no-op
  ├── math.js parse succeeds ──────────────► math.js compiled expression
  └── math.js parse fails ─────────────────► native Function (if trusted) / no-op
      ⚠️ This path is taken by toFixed() etc.
         even without a _JS_ONLY_RE match
```

---

## Files

| File | Purpose |
|---|---|
| `scripts/audit_expressions.py` | The audit script (pure Python, no deps) |
| `.github/workflows/audit-expressions.yml` | GitHub Action — runs on every PR touching scenes |
| `.agents/skills/audit-expressions/SKILL.md` | This file |

