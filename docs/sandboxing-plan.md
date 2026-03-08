# Sandboxing Improvement Plan

> **Frontend sandboxing is complete.** See [sandbox-model.md](sandbox-model.md) for the
> full implementation reference.

---

## Frontend — math.js Sandbox ✅ Implemented

### Previous State

`compileExpr()` / `evalExpr()` in `static/app.js` used `new Function()` to evaluate all
expression strings. This ran in the full browser context with unrestricted access to
`window`, `document`, `fetch`, `localStorage`, etc.

**Risk:** A malicious scene JSON could execute arbitrary JavaScript in the page.

### Current Implementation

Expressions are evaluated through a two-tier model:

**Tier 1 — math.js sandbox (default)**
- All expressions compiled via `_mathjs.compile()` and evaluated with `compiled.evaluate(scope)`
- Scope contains only `t` (animation time) and current slider values — no browser APIs reachable
- `import` and `createUnit` disabled on the sandboxed instance

**Tier 2 — native JS fallback (trusted scenes only)**
- Expressions matching the JS-only regex route to `new Function`:
  ```js
  /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\./
  ```
- Only executes when user explicitly trusts the scene via the trust dialog
- `Math.` prefix is detected at compile time, preventing math.js parse-succeeds-but-eval-fails errors

**Trust system**
- `"unsafe": true` in scene JSON → trust dialog shown immediately (no scan)
- No `"unsafe"` flag → expression fields scanned; dialog shown only if JS detected
- User choice is per-scene-load; denied scenes get no-op (return 0) for all JS expressions

**Scene JSON migration**
- All built-in scenes converted from `Math.sin(t)` → `sin(t)`, `Math.pow(x,n)` → `pow(x,n)`, etc.
- `gradient-descent-terrain.json`: all non-IIFE expressions converted to math.js;
  only the Himmelblau animated descent IIFEs remain as native JS (no closed form exists)

---

## Backend — subprocess resource limits ⏳ Pending

Math expressions sent to the `eval_math` tool are evaluated via `safe_eval_math()` in
`gemini_live_tools/math_eval.py`. The AST-based whitelist approach is solid but there are
no CPU or memory limits — a pathological expression like `999**999**999` would hang the server.

**Planned approach:** Run `safe_eval_math()` in a worker subprocess with `resource.setrlimit`
and a wall-clock timeout:

```python
import resource, multiprocessing

def _eval_worker(expr, variables, result_queue):
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))      # 2 CPU seconds
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    result, err = safe_eval_math(expr, variables)
    result_queue.put((result, err))

def sandboxed_eval_math(expr, variables=None, timeout=5.0):
    q = multiprocessing.Queue()
    p = multiprocessing.Process(target=_eval_worker, args=(expr, variables, q))
    p.start()
    p.join(timeout)
    if p.is_alive():
        p.kill()
        return None, "Expression timed out"
    return q.get()
```

**Notes:**
- `resource.setrlimit` is Unix-only; on Windows use `threading.Timer`
- ~50–100ms worker startup latency is acceptable for agent tool calls (not in render loop)

---

## Priority

| Item | Status | Risk | Priority |
|---|---|---|---|
| Replace `new Function()` with math.js | ✅ Done | High | — |
| Trust dialog + scan system | ✅ Done | High | — |
| Backend subprocess timeout/memory limits | ⏳ Pending | Medium (DoS) | Medium |

---

## Not In Scope

- Sandboxing the AI agent's tool calls beyond `eval_math` — the agent runs server-side with
  intentional access to scene state; the threat model is untrusted scene JSON, not the agent
- Sandboxing MathBox/Three.js internals — library code, not user-supplied expressions
