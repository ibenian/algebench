# TypeScript Conversion Evaluation — AlgeBench Frontend

## Scope

This document evaluates whether converting the AlgeBench frontend (~17k lines of vanilla JavaScript across 47 files) to TypeScript is worthwhile. It is an honest cost/benefit analysis, not an implementation plan.

---

## Current Architecture at a Glance

| Aspect | Status |
|---|---|
| **Language** | ES6+ JavaScript (ES modules) |
| **Total JS files** | 47 |
| **Total lines** | ~17,000 |
| **Build tooling** | None — files served raw by FastAPI |
| **Bundler** | None |
| **Package manager** | None (CDN + Python-served JS) |
| **Type annotations** | Sparse JSDoc on a few files |
| **Frontend tests** | None |
| **Largest files** | graph-view.js (1,869), chat.js (1,425), json-browser.js (1,403), overlay.js (1,168), proof.js (1,109) |

### Module Breakdown by Category

| Category | Files | Lines | Complexity |
|---|---|---|---|
| Core UI & state | main.js, ui.js, state.js | ~672 | Low |
| 3D camera & coords | camera.js, coords.js, follow-cam.js | ~1,286 | Medium |
| Scene loading & data | scene-loader.js, expr.js, labels.js, sliders.js | ~2,144 | High — data shapes |
| Overlay & proof | overlay.js, proof.js, trust.js | ~2,408 | High — DOM heavy |
| Browsers & chat | json-browser.js, context-browser.js, chat.js | ~2,917 | High — state + DOM |
| Semantic graph | graph-view.js, d3-semantic-graph.js, graph-panel.js | ~3,371 | High — D3 + layout |
| 3D object renderers | 24 files in objects/ | ~3,058 | Low — repetitive |
| Domain libraries | 3 files in domains/ | ~1,212 | Medium — math |

---

## What We'd Gain

### 1. Type Safety for Data Shapes

The codebase passes complex nested JSON everywhere — lessons, scenes, steps, proofs, semantic graphs, elements. These shapes are already defined in `schemas/lesson.schema.json` but nothing enforces them at the JS level. A missing `node.id` or a misspelled `semanticGraph` field fails silently at runtime.

**TypeScript interfaces** for Scene, Step, Element, Proof, SemanticGraph would catch these at write time instead of debug time.

### 2. Better IDE Experience

VS Code autocomplete and inline documentation would improve significantly. Right now, jumping into `scene-loader.js` or `graph-view.js` means reading 1,000+ lines to understand what shape an object has. With TS, the type system documents it inline.

### 3. Refactoring Confidence

The five largest files (1,100–1,870 lines each) are overdue for splitting. Refactoring without types is risky — renaming a property in `graph-view.js` could silently break `d3-semantic-graph.js`. TypeScript makes cross-file renames safe.

### 4. Catching Real Bugs

Common bug patterns in the current codebase:
- Optional chaining forgotten on nullable fields (e.g., `step.proof.steps` when `proof` might be an array)
- D3 selection methods called on wrong selection types
- Three.js API misuse (wrong constructor args, missing `.dispose()` calls)
- Event handler `this` binding confusion

TypeScript would flag these statically.

### 5. JSON Schema ↔ TypeScript Parity

`lesson.schema.json` already defines the data model. We could auto-generate TypeScript interfaces from it, keeping the two in sync. Changes to the schema would immediately surface type errors in the renderer.

---

## What We'd Lose

### 1. Zero-Build Simplicity

Today: edit a `.js` file, refresh the browser, done. No compile step, no watching, no source maps to debug through. This is genuinely fast for iteration, especially on visual/3D work where you tweak constants and reload dozens of times per session.

Adding TypeScript means adding a build step. Even with fast tools (esbuild compiles in <100ms), it's a new moving part — a `tsconfig.json`, a build script, a `dist/` folder, source map configuration.

### 2. CDN Dependency Typing Overhead

All major libraries (Three.js, MathBox, D3, KaTeX, math.js, Marked) are loaded from CDN as globals or dynamic imports. TypeScript needs type declarations for each:

| Library | @types available? | Quality |
|---|---|---|
| Three.js | `@types/three` | Good, but version must match CDN |
| D3.js | `@types/d3` | Good |
| MathBox | None | Would need custom `.d.ts` |
| KaTeX | `@types/katex` | Good |
| math.js | Bundled | Good |
| Marked | Bundled | Good |
| Dagre | `@types/dagre` | Exists but sparse |

**MathBox has no type definitions.** We'd need to write a custom `.d.ts` for it. MathBox's API is unusual (chained builder pattern with dozens of methods) — this alone could take a day or two.

### 3. Expression Sandbox is Inherently Untyped

`expr.js` evaluates user-authored math.js expressions at runtime (`"sin(t) * cos(2*t)"`). TypeScript can type the evaluation wrapper, but the expressions themselves are strings — runtime errors from bad expressions won't be caught by the compiler. The value of types here is limited to the plumbing, not the core functionality.

### 4. Effort vs. Runway

**Rough effort estimate:**

| Phase | Scope | Effort |
|---|---|---|
| Build setup | tsconfig, esbuild/Vite, source maps, FastAPI integration | 1–2 days |
| Type foundations | Interfaces for Scene, Element, Step, Proof, Graph | 1–2 days |
| Utility modules | coords, labels, expr, trust, state (low risk) | 2–3 days |
| Object renderers | 24 files, repetitive but numerous | 2–3 days |
| Data-heavy modules | scene-loader, sliders, proof | 3–4 days |
| UI/DOM modules | overlay, json-browser, chat, context-browser | 3–5 days |
| Graph modules | graph-view, d3-semantic-graph, graph-panel | 3–4 days |
| Camera & 3D | camera, follow-cam, domains | 2–3 days |
| MathBox `.d.ts` | Custom type declarations | 1–2 days |
| **Total** | | **~18–28 days** |

This is 3–5 weeks of focused work that produces zero new features. During that time, the app's capabilities don't advance.

### 5. Cognitive Overhead for Contributors

The codebase is currently approachable — anyone who knows JavaScript can contribute. TypeScript adds generics, utility types, declaration files, and build complexity. For a small team or solo project, this overhead is proportionally higher.

---

## Factors That Make This Codebase Atypical

| Factor | Implication |
|---|---|
| **No npm / no package.json** | Can't just `npm install typescript` — need to set up the entire Node toolchain |
| **FastAPI serves JS directly** | Build output needs to integrate with Python server's routing |
| **CDN globals** | TypeScript `declare` statements needed for Three, MathBox, etc. |
| **No frontend tests** | Can't verify conversion correctness via test suite — only manual testing |
| **Complex runtime evaluation** | expr.js, math.js sandbox — types don't help with runtime expression errors |
| **Rapid visual iteration** | Build step friction multiplied by high refresh frequency during 3D development |

---

## Alternatives to Full Conversion

### Option A: JSDoc Type Checking (Low Cost, Medium Benefit)

Add `// @ts-check` to individual files and use JSDoc `@typedef` / `@param` / `@returns` annotations. TypeScript's compiler can check `.js` files without converting them.

- **No build step needed**
- **Gradual** — one file at a time
- **VS Code picks it up immediately**
- **Limitation:** Verbose syntax, some TS features unavailable

### Option B: `.d.ts` Sidecar Files (Low Cost, Targeted Benefit)

Write TypeScript declaration files for the core data shapes (Scene, Element, Step, Proof) without converting any `.js` files. VS Code reads `.d.ts` files and provides autocomplete/checking in JS.

- **Zero runtime impact**
- **Focuses effort on highest-value types** (data shapes)
- **Compatible with current no-build architecture**

### Option C: TypeScript for New Code Only

Keep existing JS as-is. Write new modules in TypeScript. Set up a minimal build step that only compiles `.ts` → `.js` for new files.

- **No rework of existing code**
- **Build complexity contained to new modules**
- **Risk:** Two languages in one project; inconsistency over time

---

## Verdict

| Criterion | Score | Notes |
|---|---|---|
| Bug prevention value | **Medium** | Real bugs exist, but most are caught during visual testing |
| Developer productivity gain | **Medium-High** | Autocomplete and refactoring confidence are genuine wins |
| Effort required | **High** | 3–5 weeks, zero features shipped during that time |
| Risk of regression | **Medium** | No test suite to validate conversion correctness |
| Architecture fit | **Low-Medium** | No-build, CDN-heavy, FastAPI-served — fighting the grain |

**Bottom line:** The strongest case for TypeScript is the data model — Scene/Step/Element/Proof shapes flowing through 47 files with no compile-time validation. The weakest case is the build toolchain overhead for a codebase that thrives on zero-build simplicity.

If the goal is type safety without disrupting the development workflow, **Option B (`.d.ts` sidecar files)** gives ~60% of the benefit at ~10% of the cost. Full conversion makes more sense if/when the project adds npm dependencies, a bundler, or frontend tests — at that point the marginal cost of TypeScript drops significantly.
