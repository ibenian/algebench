# TypeScript Migration + Optional Vite Dev Layer — Proposal

> Migrating the AlgeBench frontend from JavaScript to TypeScript, faithfully, while adding Vite as an **optional** local development layer that production never touches.

---

## 1. Why revisit this

Two existing documents concluded "don't move to TypeScript":

- [`docs/ts-conversion-evaluation.md`](../ts-conversion-evaluation.md) (#237) — recommends `.d.ts` sidecars instead of a real conversion.
- [Issue #406](https://github.com/ibenian/algebench/issues/406) — ranks TypeScript + bundler as Phase 3, *"only if warranted"*.

Both rest on one load-bearing assumption: **that a bundler forces a build step into deployment**, across Render (two branches) and the Hugging Face Space.

That assumption turns out to be wrong. The pattern is: Vite emits into the tree the Python server already serves, **that output is committed to git**, and Node stays a dev-time-only dependency. Render, the HF Space, and end users never run it. (This is the model used successfully in a sibling FastAPI + TypeScript project.)

Two other objections have also weakened since the evaluation was written:

| Objection in `ts-conversion-evaluation.md` | Status now |
|---|---|
| A build step breaks the two-target deploy | **Resolved** — committed output, deployment unchanged |
| No frontend tests to validate the conversion | **Partly resolved** — 7 test files under `node --test` now exist |
| Loses the edit-refresh iteration loop | **Improved** — `npm run dev` gives HMR, faster than refresh |
| MathBox has no type definitions | **Still true** — a real, irreducible cost |
| Weeks of work shipping no features | **Still true, and larger than stated** (see §3.1) |

This proposal therefore revisits the decision — but restructures the strategy around one rule:

> **Migration first. Refactoring later.**

---

## 2. Goals, principles, and non-goals

### Goals

1. Migrate the frontend to TypeScript **as faithfully as possible** — 1:1 ports, no restructuring.
2. Introduce Vite as an **optional local development layer**, never a runtime or deployment dependency.
3. Leave the repository buildable, testable, mergeable, deployable and operational **after every phase**.
4. Strengthen automated frontend verification progressively, phase by phase.

### Principles

- **Faithful port.** Behavioral comparison between old and new code must stay straightforward.
- **Preserve crash semantics.** Where untyped code implicitly assumed a DOM node existed, use an assertion — not `?.`. A missing element must still throw exactly as it did, not silently no-op.
- **Vite is optional.** FastAPI-only mode is the production path and must always work with no Vite process running.
- **The backend is stable infrastructure.** Change it only where the migration genuinely requires it, and justify each change.
- **`tsc --noEmit` is the correctness gate; Vite emits.**
- **Generated JS lives only under `static/dist/`.**
- **Do not weaken CSP** to make Vite easier to integrate.

### Non-goals

During this migration we are **not**:

- redesigning the frontend architecture, or reorganizing the codebase;
- splitting large modules because they are large;
- performing broad refactoring, renaming, or dead-code removal;
- introducing React/Vue/Svelte or any framework; redesigning UI/UX;
- changing application behavior;
- redesigning backend APIs or restructuring FastAPI;
- making production depend on Vite, or making deployment run Node;
- performing unrelated performance optimization;
- combining unrelated cleanup with migration PRs.

Explicitly moved **out** of the migration and into §11 Post-migration future work:

- splitting the 1,100–1,900-line files;
- issue #406's replacement of ~50 flat `window.*` globals with an `AlgeBench` namespace.

If something is not required to safely convert JS→TS or to stand up the optional Vite dev workflow, it stays unchanged.

---

## 3. AlgeBench-specific constraints

These are what make this migration different from a textbook one. Each must be explicitly handled.

### 3.1 Scale

81 `.js` files, ~36,500 lines. `ts-conversion-evaluation.md` says "47 files / ~17,000 lines" — **stale by roughly 2×**. Its 18–28 day estimate should be treated as a floor.

### 3.2 Strict CSP with no `'unsafe-inline'` — the sharpest gotcha

`backend/server.py:1511` and `:1549` send `script-src 'self' https://cdn.jsdelivr.net` (one adds `'unsafe-eval'`, load-bearing for the math.js expression sandbox). Vite's build **injects an inline module-preload polyfill script**, which this CSP blocks outright.

Requires `build.modulePreload: { polyfill: false }` plus a check that no other inline script is emitted. `static/renderproof.html` already documents that CSP forbids inline script — the constraint is deliberate and **is not to be relaxed**.

### 3.3 Three HTML entry points

`static/index.html`, `static/prove.html`, `static/renderproof.html` → a Vite **multi-page** build (`rollupOptions.input` with three entries).

### 3.4 `__APP_VERSION__` substitution vs. Vite's HTML transform

`prove.html`/`renderproof.html` load `/prove.js?v=__APP_VERSION__`; the server substitutes the token per request (`backend/server.py:667`, `:1537`). Vite rewrites `<script src>` during its HTML transform and drops the query. Fixed on the build side (a plugin re-appending the token to emitted tags) so unhashed filenames and server-side cache-busting both survive — **no backend change**.

### 3.5 Server-owned frontend routes

There is **no `StaticFiles` mount**. Every asset is served by an explicit hand-written route behind an allowlist: `_TOP_LEVEL_MODULES` (`backend/server.py:1642`, 31 names) plus `/objects/`, `/coach/`, `/graph-panel/`, `/proof-animation/`, `/domains/`, `/fonts/`, `/chat.js`, and the catch-all `/{name}.js` (`:2071`).

Bundling makes most of these unreferenced, but **they are not deleted during the migration** — removing them is refactoring, and some still back dynamic imports. See §11.

### 3.6 Dynamic `import()` call sites

3 sites in production code — `static/expr.js`, `static/scene-loader.js`, and `static/graph-panel/d3-semantic-graph.js` (2 further uses live in `*.test.js` and are out of scope). Each must be audited: either let Vite code-split it into `static/dist/`, or exclude it and keep it server-served. Decide per site, document the decision.

### 3.7 CDN globals and version-sensitive typings

`three@0.137.0` (+ OrbitControls/TrackballControls from the deprecated `examples/js/` path), `mathbox@2.3.1`, `katex@0.16.9`, `marked@12`, `mathjs@13`. All but MathBox have usable `@types`; `@types/three` must be version-matched to 0.137. **MathBox needs a hand-written `.d.ts`** (~1–2 days) — its chained-builder API has no published types.

### 3.8 Expression sandbox and trust model

`expr.js` / `trust.js` evaluate author-supplied math.js strings; the `audit-expressions` skill and its CI workflow gate this. The audit must be re-run after any phase touching those files or the bundling.

### 3.9 Existing frontend tests

`node --test static/*.test.js`, 7 files — real regression signal. They must stay green and move with their sources.

### 3.10 `chat.js` is still a classic non-module script

Converting it to a module is required (it must enter the bundle) — but the `window.*` globals it defines and consumes **stay as they are**, assigned from the module. Removing them is #406's job, post-migration.

---

## 4. Source and build-output layout

```
src/                       handwritten TS/JS sources (git-renamed from static/)
  globals.d.ts             ambient types for CDN globals
  mathbox.d.ts             hand-written MathBox declarations
  types/lesson.d.ts        generated from schemas/lesson.schema.json
index.html                 \
prove.html                  } Vite HTML entry sources (repo root, Vite convention)
renderproof.html           /
static/
  index.html               GENERATED — server reads this exact path
  prove.html               GENERATED
  renderproof.html         GENERATED
  dist/                    GENERATED — all bundled JS + sourcemaps, and nowhere else
  style.css, tokens.css    handwritten, untouched
  fonts/, scenes/          handwritten, untouched
```

**Rules.** All generated JavaScript goes under `static/dist/`. Nothing generated is written to the `static/` root **except the three HTML files**, because `backend/server.py:429` and the `/`, `/index.html`, `/renderproof` handlers read those exact paths and re-read them per request. Rewriting those handlers purely for aesthetics would be a backend change we do not need — so the HTML stays put, as the one documented exception.

Output is **unminified, unhashed, sourcemapped, and committed** — reviewable diffs, readable stack traces, and a deploy that consumes ready-to-serve artifacts.

`node_modules/` and `.vite/` get added to `.gitignore` (neither is there today).

---

## 5. Runtime architecture

### 5.1 Normal mode — FastAPI only (this is production)

```
browser → FastAPI (uvicorn) → static/*.html  (+ __APP_VERSION__ substitution)
                            → static/dist/*.js
```

No Node. No Vite. No build at deploy time. This is what Render and the HF Space run, and what the `./algebench` launcher does locally.

**The one required backend change.** Because there is no `StaticFiles` mount (§3.5), `static/dist/*.js` would 404. Serving it takes one line:

```python
fastapp.mount("/dist", StaticFiles(directory=static_dir / "dist"), name="dist")
```

A mount is preferred over another hand-written route: it is the conventional approach, gets `ETag`/`304` and range handling for free, and moves path confinement into Starlette's well-tested code — which also sidesteps the CodeQL `py/path-injection` false positives that `sanitize_path`-based routes attract in this repo. `static/dist/` is purely generated and wholly public, so no allowlist is warranted.

This is additive and changes no existing route or API contract. It is the **only** backend change the migration requires; every later phase must leave `backend/server.py` otherwise untouched, and that is an explicit exit criterion.

### 5.2 Optional Vite dev mode

```
browser → Vite dev server :5173 (HMR, sourcemaps)
            ├── serves index.html / prove.html / renderproof.html + TS from src/
            └── proxies → FastAPI  (/api, /proofs, /scenes, /domains, /objects,
                                    /coach, /graph-panel, /proof-animation,
                                    /gemini-live-tools, /fonts, /style.css,
                                    /tokens.css, /favicon.ico)
```

| Mode | Command | What runs |
|---|---|---|
| **Normal (default, = production)** | `./algebench` | FastAPI only, serving committed `static/dist/` |
| **Optional Vite dev** | `./algebench` **+** `npm run dev` | Vite :5173 in front, FastAPI behind it |

Neither mode is required by the other, and nothing in the FastAPI path checks for Vite.

Two dev-mode details to design and verify:

- `__APP_VERSION__` is substituted by the *server*. In dev Vite owns the HTML, so a small `transformIndexHtml` plugin must perform the identical substitution — otherwise dev pages carry a literal `__APP_VERSION__`.
- `/` and `/renderproof` are server routes returning HTML; in dev Vite owns those paths. The proxy table must exclude them, and the dev entry URLs (`/index.html`, `/prove.html`, `/renderproof.html`) documented.

---

## 6. CI/CD and deployment preservation

- **`tests.yml` (`pytest`) is a REQUIRED status check** under the "main protection" ruleset and always reports. Must stay green every phase.
- `audit-expressions.yml`, `semantic-graph.yml`, `validate-data.yml`, `validate-prebaked-graphs.yml`, `proof-animation.yml` — must stay green.
- **New `frontend` CI job** (Phase 2): `npm ci && npm run build && npm test`, and critically a **sync check** — build, then `git diff --exit-code -- static/`. That catches a stale committed bundle without making deployment depend on Node.

**Render** (`render.yaml`): `buildCommand: pip install -r requirements.txt` — **unchanged**. It serves the committed artifacts.

**Hugging Face** (`scripts/deploy_hf.sh`): builds a clean snapshot from a git ref's tree and strips the paths in `deploy/huggingface/exclude.txt`. Node is never invoked. Add `src`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.mts` to that list so the Space stays small — and verify the snapshot still boots with only `static/` present. Stripping `src/` breaks sourcemap resolution in production; acceptable, and documented. The script's >9MB hard-fail must still pass.

---

## 7. Testing strategy

Each phase adds **appropriate** verification for what that phase changed — no checkbox UI tests.

| Change type | Verification |
|---|---|
| Pure type work | `tsc --noEmit` |
| Build/config | build succeeds; `static/dist/` contents asserted; CI sync check |
| Leaf utility port (`coords`, `expr`, `trust`, …) | unit tests under `node --test` — cheapest, highest value |
| DOM-heavy port (`overlay`, `json-browser`) | targeted DOM tests where practical; otherwise scripted browser regression |
| Semantic graph | `./scripts/serve_sg_report.sh --port 5740` + screenshot |
| Anything touching `expr`/`trust`/bundling | re-run `audit-expressions` |

The baseline must be **stronger at the end of each phase than at the start**. Existing frontend and backend tests remain green throughout.

---

## 8. Performance and responsiveness safeguards

The migrated app must be **at least as responsive** as today's. During any port, do not:

- block the main thread that is currently unblocked;
- serialize work that is currently concurrent;
- add synchronous waits;
- change streaming behavior (chat/TTS streaming especially);
- "fix" a race by adding a wait instead of understanding it.

Where a port touches async code, the faithful-port rule dominates: preserve the existing ordering and concurrency exactly. Performance work is **not** a licence for unrelated refactoring; wins that fall out of the tooling are noted, not pursued.

---

## 9. Per-phase workflow

Every phase runs this gate. **No phase may be merged without steps 6 and 9.**

1. **Analyze** — files affected; runtime behavior; dependencies; backend/build/CI/deploy/CSP implications; risks; testing opportunities. No code yet.
2. **Present a breakdown** — exact scope; files expected to change; files explicitly expected **not** to change; approach; risks; verification strategy; tests to add; exit criteria; open uncertainties.
3. **Get approval** — implementation does not start before approval. Scope change → re-present.
4. **Implement** — only the approved scope. Intermediate commits are checkpoints, not merge permission.
5. **Developer verification** — build; `tsc --noEmit`; frontend tests; backend tests; static checks; exercise the affected flows; inspect browser console; verify CSP; verify **both** modes where relevant. Fix everything found *before* step 6.
6. **Preview/review** — the app is run and the affected functionality confirmed to behave normally.
7. **Strengthen automated verification** — add regression coverage for the migrated area; re-run the relevant suite.
8. **Phase report** — what changed; what intentionally did not; tests added; commands run; CI status; deployment-relevant changes; known limitations; deferred follow-ups.
9. **Merge gate** — exit criteria met **and** automated verification green **and** CI green **and** the running app reviewed and approved.

---

## 10. Phases

Exit criteria are observable and defined before implementation. "Migration complete" and "works correctly" are not acceptable criteria.

### Phase 0 — Record the decision *(docs only)*

This proposal, plus a note on #406 explaining that its Phase 3 is now viable and why. `ts-conversion-evaluation.md` is amended, not replaced.

**Exit:** proposal merged; #406 updated; no code or config touched.

### Phase 1 — Schema-generated types *(no Vite, no build step)*

Generate `src/types/lesson.d.ts` from `schemas/lesson.schema.json` (`json-schema-to-typescript`), plus a regeneration script. Highest value / lowest cost, and useful even if nothing else proceeds.

**Exit:** generated `.d.ts` committed, covering Scene/Step/Element/Proof/SemanticGraph; regeneration script exists and is idempotent (re-running produces no diff); `tsc --noEmit` passes over the `.d.ts` alone; **zero runtime files changed**; all existing CI green.

### Phase 2 — Vite groundwork + optional dev mode *(zero logic changes)*

- `package.json`: `dev`/`build`/`typecheck` scripts; devDeps `vite`, `typescript`.
- `vite.config.mts`: multi-page input; `outDir: 'static'`, `emptyOutDir: false`; `entryFileNames`/`chunkFileNames`/`assetFileNames` all under `dist/`; `minify: false`; `sourcemap: true`; **`modulePreload: { polyfill: false }`**; dev proxy per §5.2; `__APP_VERSION__` plugin for both modes.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `allowJs: true`, `checkJs: false`, `noEmit: true`.
- Move `static/*.js` → `src/` as **byte-identical git renames**; commit built output.
- The one backend change (§5.1): the `/dist` mount.
- `.gitignore`: `node_modules/`, `.vite/`. `exclude.txt`: dev-tooling paths. CI: `frontend` job + sync check.

**Exit:** `/`, `/prove`, `/renderproof?builtin=<slug>` all load and behave identically in **FastAPI-only mode with no Vite running**; **zero CSP violations** and zero new console errors on all three; Vite dev mode serves all three with working HMR and proxying, and `__APP_VERSION__` resolves in both modes; `node --test` green; `pytest` green; the `backend/server.py` diff is *exactly* the one additive mount; **no generated `.js` anywhere outside `static/dist/`**; CI `frontend` job green including the sync check; `deploy_hf.sh --dry-run` produces a snapshot that boots.

### Phase 3 — Type foundation

`src/globals.d.ts` (three@0.137 + controls, katex, marked, mathjs), hand-written `src/mathbox.d.ts`, wire in the Phase-1 schema types. Convert the leaf utilities 1:1: `coords`, `labels`, `expr`, `trust`, `theme`, `icons`.

**Exit:** those six files are `.ts` under `strict`; no `any` introduced except where explicitly justified in the PR; unit tests added for at least `coords`, `expr`, `trust`; `audit-expressions` green; all Phase-2 exit criteria still hold.

### Phase 4 — Feature-area conversions, 1:1, smallest first

One PR per area, each a faithful port with **no restructuring**:

`renderproof` / `prove` → `chat.js` (module-ize; keep its `window.*` surface intact) → `objects/` (24 repetitive files) → `domains/` → `scene-loader` / `sliders` / `proof` → `overlay` / `json-browser` / `context-browser` → `graph-view` / `d3-semantic-graph` / `graph-panel` → `camera` / `follow-cam`.

**Exit (per PR):** the area's flows verified live; zero new console errors; zero CSP violations; no behavior change identified; async/streaming behavior unchanged; appropriate tests added; `backend/server.py` unmodified; generated JS confined to `static/dist/`; full CI green; both modes verified where relevant. Semantic-graph PRs additionally require the `sg-report` screenshot.

### Phase 5 — Close out

Flip `checkJs` on (no JS left), or document deliberate holdouts. Update `AGENTS.md` / `README` with both dev modes and the source/output layout.

**Exit:** no `.js` remains under `src/` (or every exception is listed with a reason); `tsc --noEmit` passes with `allowJs` off; docs describe normal mode, optional Vite mode, and where generated output lives; full CI green.

---

## 11. Risks, and where to stop

| Risk | Mitigation | Stop point |
|---|---|---|
| Vite emits inline script → CSP blocks the app | `modulePreload.polyfill: false`; assert no inline `<script>` in emitted HTML; console checked every phase | Phase 2 exit |
| Committed bundle drifts from source | CI sync check (`build` then `git diff --exit-code -- static/`) | Phase 2 exit |
| `__APP_VERSION__` breaks in one mode | Build plugin + dev plugin, both verified | Phase 2 exit |
| A dynamic `import()` breaks at runtime (silent — no compile error) | Audit all 3 production sites in Phase 2, document each decision, exercise each path live | Phase 2 exit |
| MathBox `.d.ts` harder than estimated | Isolated to Phase 3; can ship loose and tighten later | Phase 3 |
| Bulk rename corrupts string literals | A regex-based rename can silently break CDN URLs, theme keys and element ids — all type-check fine and fail only at runtime. Use a string/comment-aware scanner, and assert affected literals still appear verbatim in the built output | any phase |
| Scale (36.5k lines) exceeds appetite | Phases are independent and additive | **Stop cleanly after Phase 1** (most of the type value, no build step at all) or **after Phase 2** (fully reversible: revert the renames, drop the mount) |

Phases 3–5 are the expensive tail and can be deferred indefinitely without leaving the codebase in a broken state.

---

## 12. Post-migration future work *(explicitly not part of this migration)*

Each to be considered only after the migration is complete and stable, as its own proposal:

- **Splitting the 1,100–1,900-line modules** (`graph-view`, `chat`, `json-browser`, `overlay`, `proof`), guarded by the type checker.
- **Issue #406's remaining work** — replacing the ~50 flat `window.*` cross-module calls with imports plus a single `AlgeBench` namespace.
- **Retiring `_TOP_LEVEL_MODULES` and the per-directory asset routes.** The allowlist does no security work: `/{name}.js` already gates on `re.fullmatch(r"[A-Za-z0-9_-]+")` — no `/`, no `.`, so traversal is impossible by construction — *and* then runs `sanitize_path`. Its only real effect today is keeping the 7 `static/*.test.js` files unserved: 39 root `.js` files, minus those 7 tests, minus `chat.js` (which has its own dedicated `/chat.js` route at `backend/server.py:1577`), leaves exactly the 31 names on the list — verified by set difference, with no dead entries. Every other asset route (`/objects/`, `/coach/`, `/graph-panel/`, `/domains/`, `/fonts/`) already uses confine-plus-suffix with no allowlist. Post-migration these can collapse into `StaticFiles` mounts — and Phase 2's git renames already move the test files under `src/`, removing the list's only justification.
- **Caching strategy.** All JS is served `no-cache, no-store, must-revalidate` today, so ~36k lines are re-fetched on every page load. Best practice is hashed filenames + `public, max-age=31536000, immutable`, but hashing fights committed output (new filenames every build = add/delete churn instead of readable diffs). Options: hashed and accept the churn, or stable filenames served under a version-scoped path (`/dist/{version}/…`, immutable) reusing the `VERSION` file that already drives `__APP_VERSION__`. Either makes `?v=__APP_VERSION__` obsolete and removes the plugin §3.4 requires. **Deliberately excluded from the migration** — caching is behavior.
- **OpenAPI-generated API types.** Generating TS types from FastAPI's schema (`openapi-typescript`) beats hand-written DTOs because they cannot drift. Not viable yet: 25 `/api` routes, **zero `response_model`**, 63 raw `JSONResponse` — response schemas would generate empty. Adding `response_model` is backend refactoring. Until then: hand-written DTOs plus the Phase-1 schema-generated lesson types.
- **Upgrading `three@0.137`** off the deprecated `examples/js/` controls path.
