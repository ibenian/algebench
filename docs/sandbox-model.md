# AlgeBench Expression Sandbox Model

> See also: [sandboxing-plan.md](sandboxing-plan.md) — implementation status and
> backend sandboxing roadmap.

## ⚠ Security Disclaimer

**This is a best-efforts sandboxing approach, not a formally verified security boundary.**

- The JS detection regex is a heuristic — creative obfuscation could bypass it.
- math.js is a large, general-purpose library; undiscovered escape paths may exist.
- The implementation has not undergone a formal security audit.
- **Do not load scene JSON files from untrusted sources.** Only open scenes from authors
  you trust. When in doubt, choose "Run Safely (math.js only)" in the trust dialog — or
  don't load the scene at all.

This sandbox is designed to raise the bar against accidental or casual misuse, not to
provide ironclad isolation against a determined attacker.

---

## Overview

AlgeBench evaluates mathematical expressions defined in scene JSON files. Expressions appear in
animated element fields (`x`, `y`, `z`, `expr`, vertex arrays, etc.) and drive all dynamic
visualizations. Since these expressions execute in the browser, the system uses a **two-tier
sandboxed evaluation model** to reduce exposure when loading scenes from unknown authors.

---

## Two-Tier Evaluation

### Tier 1 — Sandboxed (math.js) — Default

All expressions are evaluated through a sandboxed [math.js](https://mathjs.org/) instance that:

- Uses its **own parser and interpreter** — no `eval`, no `new Function`
- Only resolves symbols against an **explicit scope object** (`{ t, a, b, ... }` slider values)
- Has **no access** to `window`, `document`, `fetch`, `localStorage`, or any browser API
- Supports the full math.js library: `sin`, `cos`, `sqrt`, `pow`, `pi`, `e`, `atan2`, etc.

**Safe expression examples:**
```
sin(t)
cos(theta) * r
sqrt(a^2 + b^2)
(2 + 0.6*cos(v)) * cos(u)
```

Two functions are disabled on the sandboxed instance: `import` (prevents adding new
functions to the math.js scope) and `createUnit` (prevents polluting the unit registry).
Security comes from the scope object containing only known-safe values.

### Tier 2 — Native JavaScript (new Function) — Trusted Only

Expressions containing native JavaScript constructs are **automatically detected** by a regex
(see `_JS_ONLY_RE` in `static/app.js`). It matches something like:

```
let / const / var / return / for( / while( / => / function / Math. / .method(
```

This catches:
- IIFE/loop expressions: `let`, `const`, `var`, `return`, `for (`, `while (`, `=>`, `function`
- Direct browser global access: `Math.pow`, `Math.sin`, `Math.PI`, etc.
- **Method calls** on values: `.toFixed(`, `.constructor(`, `.toString(` — these are blocked
  because they traverse the JS prototype chain and can reach `Function` via
  `.constructor.constructor('return fetch(...)()')`.

These expressions **require explicit user trust** before execution. If the user does not trust
the scene, JS-only expressions become **no-ops** (return `0`) and a warning is shown in the
status bar.

---

## Trust Dialog

The trust dialog is shown when either condition is true:

1. **`"unsafe": true`** — author explicitly declares JS is used; dialog shown immediately (no scan)
2. **JS expressions detected** — scan finds patterns matching the JS-only regex (only runs when `"unsafe"` is absent or `false`)

The `unsafe_explanation` field is shown in the dialog in either case.

### Dialog Behavior

| User Choice | Effect |
|---|---|
| **Trust & Enable JS** | JS expressions execute normally. Status bar shows "⚡ Native JS" pill. |
| **Run Safely (math.js only)** | JS expressions become no-ops (return 0). Status bar shows "⚠ JS disabled" warning pill. |
| *(No JS detected, no `unsafe: true`)* | Scene loads silently in math.js sandbox — no dialog shown. |

### Trust is Per-Scene-Load

Trust state is reset every time a new scene is loaded.

---

## JSON Fields for Unsafe Scenes

```json
{
  "unsafe": true,
  "unsafe_explanation": "This scene uses loop-based gradient descent animation requiring native JS.",
  "title": "Gradient Descent Terrain",
  ...
}
```

| Field | Type | Description |
|---|---|---|
| `"unsafe"` | `boolean` | When `true`, treats the scene as unsafe immediately — shows dialog without scanning. Omit or set `false` to trigger expression scanning first. |
| `"unsafe_explanation"` | `string` | Custom explanation shown in the trust dialog. Used whether triggered by `unsafe: true` or by detected JS patterns. |

---

## Status Bar Indicators

| Indicator | Meaning |
|---|---|
| `⚡ Native JS` (blue pill) | User trusted the scene; native JS expressions are executing |
| `⚠ JS disabled` (amber pill) | User did not trust; JS expressions are suppressed (no-ops) |
| *(no pill)* | Scene uses only math.js sandbox — fully secure |

---

## Expression Syntax Reference

All scenes should use **math.js syntax** unless they require loops or complex JS logic:

| Old (JavaScript) | New (math.js) |
|---|---|
| `Math.sin(t)` | `sin(t)` |
| `Math.cos(t)` | `cos(t)` |
| `Math.tan(t)` | `tan(t)` |
| `Math.pow(x, n)` | `pow(x, n)` or `x^n` |
| `Math.sqrt(x)` | `sqrt(x)` |
| `Math.abs(x)` | `abs(x)` |
| `Math.log(x)` | `log(x)` |
| `Math.atan2(y, x)` | `atan2(y, x)` |
| `Math.min(a, b)` | `min(a, b)` |
| `Math.max(a, b)` | `max(a, b)` |
| `Math.floor(x)` | `floor(x)` |
| `Math.PI` | `pi` |
| `Math.E` | `e` |
| `t**2` | `t^2` or `pow(t, 2)` |

**Scope variables always available in expressions:**
- `t` — animation time (seconds)
- Slider IDs (e.g. `a`, `b`, `theta`, `phi`) — current slider values

---

## Agent Authoring Guidelines

When the AI agent generates scene JSON, it **must** use math.js syntax:

- Use `sin(t)` not `Math.sin(t)`
- Use `pi` not `Math.PI`
- Use `pow(x, n)` or `x^n` not `x**n` or `Math.pow(x,n)`
- Use `min(a, b)`, `max(a, b)`, `floor(x)` not `Math.min`, `Math.max`, `Math.floor`
- Only use IIFE/loops when absolutely necessary (e.g. iterative algorithms with no closed form)
- If using IIFE/loops, set `"unsafe": true` and provide a clear `"unsafe_explanation"`

---

## Security Boundary Summary

```
Scene JSON loaded
      │
      ├── "unsafe":true ──────────────────────────────► Show Trust Dialog
      │                                                        │
      └── no "unsafe" ──► Scan expression fields               │
                │                                              │
                ├── JS patterns found ──────────────────► Show Trust Dialog
                │                                               │
                └── No JS found ──► math.js sandbox             │
                                    No dialog, no pill          │
                                                          ┌─────┴─────┐
                                                   User trusts   User denies
                                                          │             │
                                                   new Function    math.js only
                                                   + math.js      JS → no-op
                                                   ⚡ Native JS   ⚠ JS disabled
```
