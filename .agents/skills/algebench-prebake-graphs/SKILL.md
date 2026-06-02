---
name: algebench-prebake-graphs
description: Check an AlgeBench lesson for semantic-graph prebaking — validate which baked graphs are still correct, identify which steps need (re)baking, and bake them into the JSON so the server doesn't derive them at request time.
triggers:
  - prebake
  - prebake graphs
  - prebake semantic graphs
  - bake graphs
  - check graph prebaking
  - validate prebaked graphs
---

# Prebake Semantic Graphs

At runtime the AlgeBench server derives a semantic graph for **every proof
step that has `math` but no `semanticGraph`** (`_autofill_semantic_graphs` in
`backend/server.py`). For a large lesson that is dozens of derivations on
every load — several seconds of CPU, far worse on a constrained host (a free
Render instance can take ~60s for a big lesson). **Prebaking** runs those
derivations once, offline, and writes the `{"graph": {…}}` blocks into the
scene JSON so the server skips them and the lesson loads near-instantly.

Prebaking **overwrites** the `semanticGraph` of each step it touches, so this
skill always runs a **validate pass first**: it re-derives each step and
compares against any already-baked graph, classifying every step before
anything is written. The user is asked before any file is modified.

The skill is a thin orchestrator around `scripts/prebake_semantic_graphs.py`
(which reuses the backend's exact derivation + highlight pipeline, so a baked
graph is byte-identical to what the server would produce — baking changes
*when* the work happens, never the result).

## Inputs

- A scene/lesson JSON path (e.g. `scenes/atmospheric-entry-physics.json`).
  If the user didn't name one, ask which file to check.

## Workflow

### Step 1 — Validate (read-only)

Always start here. Run the validate pass (explicit `--validate`) and capture
the JSON report:

```bash
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --validate --json
```

The report classifies every proof step that has `math`:

| Status    | Meaning                                                        |
|-----------|----------------------------------------------------------------|
| `valid`   | A baked graph exists and matches a fresh derivation — leave it |
| `stale`   | A baked graph exists but **differs** (math or parser changed) — needs rebaking |
| `missing` | Derivable but **not yet baked** — baking would speed up loads  |
| `error`   | Derivation fails (unsupported LaTeX) — **cannot** be baked     |

Key fields: `counts`, `needsPrebake` (= stale + missing), `deriveSeconds`
(cost to derive *everything* — the full bake cost), `runtimeDeriveSeconds`
(cost the server still pays on every load — i.e. the steps that aren't
validly baked; this is what baking eliminates), `recommendPrebake`, and
`recommendReason`.

### Step 2 — Present the assessment

Report to the user, clearly separating the categories:

- **Valid** (N) — already baked and correct; nothing to do.
- **Stale** (N) — baked graphs that no longer match the math; list them
  (`scene.proof.step` + math preview). These are the riskiest: the lesson is
  shipping graphs that disagree with their expressions.
- **Missing** (N) — derivable steps with no baked graph; list a few.
- **Error** (N) — steps the parser can't handle; these will be derived (and
  fail fast) at runtime regardless — they can't be prebaked. Just note them.

Then state the **recommendation**:

- **Prebake suggested** when `needsPrebake > 0` (there are stale or missing
  graphs); the script sets `recommendPrebake` accordingly. Mention the
  load-time win: baking removes ~`runtimeDeriveSeconds` of work from every
  scene load (and several times that on a constrained host like a free
  Render instance).
- **No prebake needed** when everything is already baked (`needsPrebake == 0`).
  Say so and stop — do not write. (A fully-baked lesson derives ~0s at runtime
  regardless of how long a full re-derive would take.)

### Step 3 — Ask before writing

Prebaking overwrites data, so **never write without explicit confirmation.**
Use `AskUserQuestion`. Only offer baking when there is something to bake
(`needsPrebake > 0`, or the user explicitly wants a full rebake):

- **Bake missing + stale** (recommended) — writes only the steps that need it,
  keeping the *graph* changes minimal. Maps to `--write`.
- **Rebake everything** — rewrites every derivable step (use when the parser
  changed and you want a clean, uniform pass). Maps to `--write --all`.
- **No — leave as is** — stop without writing.

> **Heads-up on the diff:** `--write` rewrites the whole file via
> `json.load`→`json.dump`, so Python re-emits *every* numeric literal in its
> canonical form (e.g. `0.00007292115` → `7.292115e-05`). These are **cosmetic
> and numerically identical** — no value changes — but they add noise beyond
> the added `semanticGraph` blocks. Mention this when presenting the diff so a
> reviewer isn't alarmed by "changed" physics constants.

If the user wants to preview the exact change first, run with `--write
--dry-run` (reports what would change, writes nothing).

### Step 4 — Bake

Run the chosen write command:

```bash
# missing + stale only (minimal diff)
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --write

# full rebake
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --write --all
```

### Step 5 — Verify

Re-run the validate pass and confirm the result:

```bash
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --validate --json
```

After baking, expect `missing = 0`, `stale = 0` (only `valid` and any
`error` steps remain), and `needsPrebake = 0`. Report the before/after counts.

Optionally confirm the load-time win by timing the server autofill — it should
now skip the baked steps:

```bash
./run.sh -c "import json,time; from backend.server import _autofill_semantic_graphs; s=json.load(open('<scene.json>')); t=time.time(); _autofill_semantic_graphs(s); print('autofill: %.3fs'%(time.time()-t))"
```

## Important rules

- **Validate before writing — always.** The validate pass is the safety check
  that tells the user which baked graphs are still correct vs. stale.
- **Never write without explicit confirmation** (prebaking overwrites the
  `semanticGraph` blocks). Use `AskUserQuestion`, not a plain prompt.
- **`error` steps are expected and fine** — they can't be parsed, so they're
  left for the runtime path (which fails fast). Don't treat them as blockers.
  A per-step failure never aborts the run: each one is caught, counted as
  `error`, and the rest of the lesson still processes.
- **Expect numeric-literal reformatting in the diff** — `--write` re-emits the
  whole file, so floats get Python's canonical form (cosmetic, values
  unchanged). Don't try to "fix" it; call it out when reviewing the diff.
- **Prefer "missing + stale"** over a full rebake unless the parser/derivation
  logic changed — it keeps the *graph* changes in the diff reviewable.
- Baked graphs match server output exactly; if a re-validate ever shows
  `stale` right after baking, that's a bug in the derivation pipeline, not the
  scene — surface it rather than rebaking in a loop.
