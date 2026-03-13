---
name: audit-expressions
description: Audit expression sandbox coverage. Scans all scene JSON files for expressions and verifies each is properly handled by the math.js sandbox or the JS trust verification system. Run this before merging any PR that adds or modifies scene files.
---

# Audit Expression Sandbox Coverage

This skill checks that **every expression string found in AlgeBench scene JSON files is covered by the sandbox / trust-verification model** in `static/app.js`, then **proposes concrete improvements** for any gaps found and **offers to apply them**.

It is the CLI companion to the `audit-expressions` GitHub Actions workflow, which runs the same check automatically on every PR that touches scene files. The workflow also posts the proposals as a PR comment so reviewers can see them without opening the raw CI log.

---

## Agent Workflow

Follow these steps in order every time this skill is invoked.

### Step 1 — Run the audit

```bash
python scripts/audit_expressions.py
```

No dependencies beyond the Python standard library. Works offline; no server needed.

Capture and display the full output. When running locally the output includes:
- Per-file expression counts and any flagged expressions
- A totals summary line
- A **📋 Coverage Proposals** section

When running in GitHub Actions the script additionally writes a markdown version of the report (including proposals) to the workflow step summary, which is visible directly in the PR Checks tab.

---

### Step 2 — Summarise findings

After running, report back to the user with:

1. **Pass / fail** — does the audit exit 0 (all covered) or 1 (uncovered expressions)?
2. **Per-file status** — list files with their emoji (✅/🔶/🔓/❌) and counts.
3. **Total counts** — safe, unsafe-scene, js/covered, uncovered, js-builtin.
4. **Coverage Proposals** — present every proposal from the output, numbered, with its title.

Example summary template:

> Audit complete. **3 of 8 scenes** have soft warnings (🔶 js-builtin). No hard failures (exit 0).
>
> Proposals to improve trust coverage:
> 1. Expand `_JS_ONLY_RE` — 100 `toFixed` expressions across 4 scenes not caught by the regex
> 2. Scan `{{...}}` content templates in `_scanSpecForUnsafeJs` — 100 templates never pre-scanned
> 3. Add 7 expression-bearing keys to `EXPR_KEYS` — `visibleExpr`, `radiusExpr`, etc.
>
> Shall I apply any of these?

Always ask the user whether to apply the proposals before making code changes.

---

### Step 3 — Apply proposals (on user confirmation)

For each proposal the user approves, apply the following changes:

#### Proposal 1: Expand `_JS_ONLY_RE` to catch JS-only built-ins

Edit **`static/app.js`** — find the `_JS_ONLY_RE` declaration (~line 90) and prepend the built-in names found by the audit:

```js
// Before:
const _JS_ONLY_RE = /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(/;

// After (example — use the actual names reported by the audit):
const _JS_ONLY_RE = /\btoFixed\b|\btoPrecision\b|\btoString\b|\bparseInt\b|\bparseFloat\b|\bisNaN\b|\bisFinite\b|\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(/;
```

Edit **`scripts/audit_expressions.py`** — merge the built-in names into `_JS_ONLY_RE` and remove them from `_JS_BUILTIN_FUNC_RE`:

```python
# Before:
_JS_ONLY_RE = re.compile(
    r'\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\('
    r'|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\('
)
_JS_BUILTIN_FUNC_RE = re.compile(
    r'\b(toFixed|toPrecision|toString|parseInt|parseFloat|isNaN|isFinite)\s*\('
)

# After:
_JS_ONLY_RE = re.compile(
    r'\btoFixed\b|\btoPrecision\b|\btoString\b|\bparseInt\b|\bparseFloat\b'
    r'|\bisNaN\b|\bisFinite\b'
    r'|\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\('
    r'|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\('
)
_JS_BUILTIN_FUNC_RE = re.compile(r'(?!)')  # nothing left to catch separately
```

#### Proposal 2: Scan `{{...}}` content templates in `_scanSpecForUnsafeJs`

Edit **`static/app.js`** — inside `_scanSpecForUnsafeJs`, add content-template scanning to the `walk()` function:

```js
// In _scanSpecForUnsafeJs — find the walk() function body and add:
function walk(obj, parentKey) {
    if (typeof obj === 'string') {
        return !!(parentKey && EXPR_KEYS.has(parentKey) && _JS_ONLY_RE.test(obj));
    }
    if (Array.isArray(obj)) return obj.some(item => walk(item, parentKey));
    if (obj && typeof obj === 'object') {
        return Object.entries(obj).some(([k, v]) => {
            // NEW: scan {{...}} expression blocks inside content strings
            if (k === 'content' && typeof v === 'string') {
                const tmplRe = /\{\{([\s\S]*?)\}\}/g;
                let m;
                while ((m = tmplRe.exec(v)) !== null) {
                    if (_JS_ONLY_RE.test(m[1])) return true;
                }
            }
            return walk(v, k);
        });
    }
    return false;
}
```

Edit **`scripts/audit_expressions.py`** — once `_scanSpecForUnsafeJs` scans templates, update `classify_expression()` to treat `content_template` as a covered field:

```python
# In classify_expression(), change the coverage check:
if _JS_ONLY_RE.search(expr):
    # content_template is now scanned by _scanSpecForUnsafeJs
    if field_key in _SCANNED_KEYS or field_key == 'content_template':
        return 'js_covered'
    return 'js_uncovered'
```

#### Proposal 3: Add expression-bearing keys to `EXPR_KEYS`

Edit **`static/app.js`** — expand the `EXPR_KEYS` set inside `_scanSpecForUnsafeJs`:

```js
// Before:
const EXPR_KEYS = new Set(['expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz']);

// After:
const EXPR_KEYS = new Set([
    'expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz',
    'visibleExpr', 'radiusExpr', 'radiiExpr',
    'centerExpr', 'fromExpr', 'toExpr', 'positionExpr',
]);
```

Edit **`scripts/audit_expressions.py`** — move the keys from `_UNSCANNED_EXPR_KEYS` to `_SCANNED_KEYS`:

```python
# Before:
_SCANNED_KEYS = frozenset({'expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz'})
_UNSCANNED_EXPR_KEYS = frozenset({
    'visibleExpr', 'radiusExpr', 'radiiExpr', 'centerExpr',
    'fromExpr', 'toExpr', 'positionExpr',
})

# After:
_SCANNED_KEYS = frozenset({
    'expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz',
    'visibleExpr', 'radiusExpr', 'radiiExpr', 'centerExpr',
    'fromExpr', 'toExpr', 'positionExpr',
})
_UNSCANNED_EXPR_KEYS = frozenset()  # all expression keys are now scanned
```

---

### Step 4 — Re-run to verify

After applying any proposals, re-run the audit to confirm the counts changed as expected:

```bash
python scripts/audit_expressions.py
```

- Previously `js_builtin` expressions should now classify as `js_covered` (after Proposals 1+2)
- Previously `safe` counts for the new keys should now appear under `js_covered` if JS is used
- Exit code must still be `0`

Report the before/after comparison to the user.

---

## What the Script Checks

The script scans every expression-bearing location in `scenes/*.json`:

| Location | Field key(s) | Currently scanned? |
|---|---|---|
| Animated element expression fields | `expr`, `x`, `y`, `z`, `fx`, `fy`, `fz`, `expression` | ✅ Yes |
| Animated origin / target / position | `fromExpr`, `toExpr`, `positionExpr` | ⚠️ No (Proposal 3) |
| Visibility expression | `visibleExpr` | ⚠️ No (Proposal 3) |
| Sphere / ellipsoid size | `radiusExpr`, `radiiExpr`, `centerExpr` | ⚠️ No (Proposal 3) |
| Info-panel template expressions | `{{...}}` inside `content` strings | ⚠️ No (Proposal 2) |
| Polygon vertex coordinates | `vertices` / `points` arrays | ✅ (via vertices walk) |

Each expression is classified:

| Label | Meaning |
|---|---|
| ✅ **safe** | No JS patterns — evaluated by math.js sandbox |
| 🔓 **unsafe-scene** | Scene has `"unsafe": true` — all JS opted in |
| ⚠️ **js/covered** | Matches `_JS_ONLY_RE`; field is checked by `_scanSpecForUnsafeJs` — trust dialog fires |
| ❌ **js/uncovered** | Matches `_JS_ONLY_RE`; field is **not** scanned — trust dialog will NOT fire |
| 🔶 **js-builtin** | Uses a JS-only built-in (e.g. `toFixed`) that bypasses `_JS_ONLY_RE` |

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All expressions are covered — safe to merge |
| `1` | One or more `js/uncovered` expressions detected — **do not merge** |

---

## GitHub Actions Integration

The `audit-expressions.yml` workflow runs automatically on every PR that touches `scenes/*.json`, `static/app.js`, or the audit script itself. It:

1. Runs the full audit (proposals always visible in the step summary via `$GITHUB_STEP_SUMMARY`)
2. Posts the **Coverage Proposals** section as a PR comment so reviewers can see it without opening the raw CI log
3. Fails the check if any `js/uncovered` expressions are found

---

## How the Trust Model Works (Reference)

```
Scene load
  │
  ├── "unsafe": true ──────────────────────► Trust dialog (always)
  │
  ├── _scanSpecForUnsafeJs(spec) ──────────► Trust dialog (if JS pattern found
  │     Currently scans:                      in expression keys)
  │       expr, x, y, z, expression,
  │       fx, fy, fz
  │     ⚠️ Does NOT scan:
  │       visibleExpr, radiusExpr, radiiExpr,
  │       centerExpr, fromExpr, toExpr,
  │       positionExpr, content templates
  │
  └── No JS detected ─────────────────────► Silent load (math.js only)

compileExpr(str)
  ├── _JS_ONLY_RE matches ─────────────────► native Function (if trusted) / no-op
  ├── math.js parse succeeds ──────────────► math.js compiled expression
  └── math.js parse fails ─────────────────► native Function (if trusted) / no-op
      ⚠️  toFixed(), toPrecision(), etc. take this path without matching
          _JS_ONLY_RE — they bypass the trust dialog proactively
```

---

## Files

| File | Purpose |
|---|---|
| `scripts/audit_expressions.py` | The audit script (pure Python, no deps) |
| `.github/workflows/audit-expressions.yml` | GitHub Action — runs on PRs, posts PR comment with proposals |
| `.agents/skills/audit-expressions/SKILL.md` | This file |

