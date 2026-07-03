---
name: algebench-prebake-graphs
description: Check an AlgeBench lesson for semantic-graph prebaking — validate which baked graphs are still correct, identify which steps need (re)baking, and bake them into the JSON so the server doesn't derive them at request time. Pass `enrich` to also fill node metadata (descriptions, units, dimensions, emoji, domain) in a second LM pass.
triggers:
  - prebake
  - prebake graphs
  - prebake semantic graphs
  - bake graphs
  - check graph prebaking
  - validate prebaked graphs
  - prebake and enrich
  - enrich graphs
  - enrich semantic graphs
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

**Two passes, one skill.** Prebaking bakes graph *structure* (nodes/edges) —
the nodes come out "bare". A separate **enrichment** pass
(`scripts/prebake_semantic_graph_enrichment.py`) fills the physics *metadata*
onto those nodes (`description`, `quantity`, `dimension`, `unit`, `emoji`, and
the graph `domain`) via an LM — this is what the hover tooltips and the AI tutor
read. Enrichment is **opt-in**: run it by passing **`enrich`** in the invocation
(e.g. `prebake enrich scenes/foo.json`). It runs *after* the structural bake
(you can only enrich graphs that exist) — see the [Enrichment](#enrichment-opt-in--pass-enrich) stage below.

## Inputs

- A scene/lesson JSON path (e.g. `scenes/atmospheric-entry-physics.json`).
  If the user didn't name one, ask which file to check.
- Optional **`enrich`** flag anywhere in the invocation → after prebaking, also
  run the enrichment pass (LM metadata). Without it, only structure is baked.

## Workflow

### Step 1 — Validate (read-only)

Always start here. Run the validate pass (explicit `--validate`) and capture
the JSON report:

```bash
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --validate --json
```

The report classifies every proof step that has `math`:

| Status         | Meaning                                                   |
|----------------|-----------------------------------------------------------|
| `valid`        | A baked graph exists and matches a fresh derivation — leave it |
| `stale`        | A baked graph exists but **differs** (math or parser changed) — needs rebaking |
| `missing`      | Derivable but **not yet baked** — baking would speed up loads |
| `errorBroken`  | **Had** a baked graph that no longer derives — a committed graph the parser can't reproduce (regression) |
| `errorUnbaked` | Never baked, parser can't derive it (unsupported LaTeX) — expected; fails the same at runtime |

Key fields: `counts`, `needsPrebake` (= stale + missing), `outOfSync`
(= stale + errorBroken — committed graphs the current parser can't reproduce;
the CI gate), `deriveSeconds` (full bake cost), `runtimeDeriveSeconds` (cost
the server still pays on every load — what baking eliminates), `recommendPrebake`,
and `recommendReason`.

> **CI:** `--validate --fail-on-stale` exits non-zero **only** when
> `outOfSync > 0`. The `validate-prebaked-graphs.yml` workflow runs it on
> changed scenes (and all baked scenes when the parser changes) and posts a
> compact PR comment — a TOTAL row + per-scene table, plus non-blocking
> **prebake suggestions** for un-baked scenes whose parse cost clears the
> threshold (`recommendPrebake`). `missing`/`errorUnbaked` never fail.

### Step 2 — Present the assessment

Report to the user, clearly separating the categories:

- **Valid** (N) — already baked and correct; nothing to do.
- **Stale** (N) — baked graphs that no longer match the math; list them
  (`scene.proof.step` + math preview). These are the riskiest: the lesson is
  shipping graphs that disagree with their expressions.
- **Missing** (N) — derivable steps with no baked graph; list a few.
- **errorBroken** (N) — a committed graph that no longer derives. **Flag these
  loudly** — a shipped lesson is carrying a graph the parser can't reproduce.
- **errorUnbaked** (N) — steps the parser can't handle and were never baked;
  they fail-fast at runtime regardless and can't be prebaked. Just note the count.

If `needsPrebake == 0` (everything already baked), say so and **stop** — do not
write. Otherwise continue to Step 2b to get a data-driven recommendation.

### Step 2b — Get the strategy proposal (dry-run)

When there's something to bake, run a dry-run to measure the actual trade-off
and let the script **propose the best strategy** from it:

```bash
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --write --dry-run --json
```

This computes (without writing):

- `load` — server parse time before → after (a real scene-load simulation),
  plus `speedup`.
- `sizes` — file size before → after with `pctIncrease`.
- `strategy` — `{recommendation, rationale}`, one of:
  - **`prebake`** — the load win (locally, and ~12× more on a free host)
    clearly outweighs the size growth. Recommend baking.
  - **`skip`** — load is already fast; baking mostly just adds bytes.
    Recommend leaving it (unless the user is targeting a very constrained host).
  - **`noop`** — nothing to bake.

**Present the strategy verbatim** — the rationale already quotes both the load
win and the size cost (e.g. *"Load 4.6s→0.05s locally (~55s→~0.6s on a free
host) for +269% size — the load win clearly outweighs the size cost"*). Lead
your recommendation with `strategy.recommendation`; don't second-guess it.

### Step 3 — Ask before writing

Frame the question around the proposed `strategy.recommendation` (make the
recommended action the first option). Prebaking overwrites data, so **never
write without explicit confirmation.**
Use `AskUserQuestion`. Only offer baking when there is something to bake
(`needsPrebake > 0`, or the user explicitly wants a full rebake):

- **Bake missing + stale** (recommended when `strategy` is `prebake`) — writes
  only the steps that need it, keeping the *graph* changes minimal. Maps to
  `--write`.
- **Rebake everything** — rewrites every derivable step (use when the parser
  changed and you want a clean, uniform pass). Maps to `--write --all`.
- **No — leave as is** — stop without writing (the natural default when
  `strategy` is `skip`).

> **Heads-up on the diff:** `--write` re-serializes the whole file (compact-leaves layout + canonical number formatting), so call out that the cosmetic reformatting is data-identical — it's round-trip-checked before saving.

### Step 4 — Bake

Run the chosen write command:

```bash
# missing + stale only (minimal diff)
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --write

# full rebake
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --write --all
```

`--write` reports the payoff directly:
- **load (server parse):** before → after, simulating a real scene load
  (`_autofill_semantic_graphs`, parse-if-missing) on the file before vs after
  baking, with the speedup (e.g. `5.19s → 0.06s (86× faster)`).
- **size:** before → after with % growth (graphs inline the JSON, so expect a
  meaningful size increase — e.g. `+269%` for a graph-dense lesson).

Relay both to the user — the trade is "bigger file, far faster load."
`--write --dry-run` reports the same numbers as a projection without writing.

### Step 5 — Verify

Re-run the validate pass and confirm the result:

```bash
./run.sh scripts/prebake_semantic_graphs.py <scene.json> --validate --json
```

After baking, expect `missing = 0`, `stale = 0` (only `valid` and any
`error` steps remain), and `needsPrebake = 0`. Report the before/after counts.

The load-time win was already measured and reported by `--write` in Step 4
(the before/after `load (server parse)` line), so no separate timing run is
needed.

## Enrichment (opt-in — pass `enrich`)

Only when the invocation includes **`enrich`**. Run this **after** the
structural bake above (Steps 1–5) — enrichment fills metadata onto *baked*
graphs, so anything still unbaked has nothing to enrich. Same shape as the bake:
status → present → confirm → write → verify, around
`scripts/prebake_semantic_graph_enrichment.py`.

Enrichment is an **LM pass** (real Gemini calls; needs `GEMINI_API_KEY`) — it
labels each node's `description`, `quantity`, `dimension`, `unit`, `emoji`, and
the graph `domain`. By default it only touches **unenriched** graphs; `--all`
re-enriches every baked graph.

### E1 — Status (read-only)

```bash
./run.sh scripts/prebake_semantic_graph_enrichment.py <scene.json> --status --json
```

Reports `counts` = `{enriched, unenriched, noGraph}`. If `unenriched == 0`,
say so and **stop** — everything is already enriched (or `--all` to redo).

### E2 — Confirm (LM cost)

Enrichment makes one LM call per unenriched graph (default concurrency 3, so a
big lesson is minutes and real tokens). **Confirm before writing** via
`AskUserQuestion`:

- **Enrich unenriched** (recommended) — fills only the graphs missing metadata.
  Maps to `--write`.
- **Re-enrich everything** — rewrites metadata on every baked graph (use after a
  domain/vocabulary change). Maps to `--write --all`.
- **No — leave as is** — stop.

`--dry-run` runs the LM but skips the write, if you want to preview cost/output
first. Tunables: `--concurrency N` (default 3), `--retries N` (output-validation
retries, default 2).

### E3 — Write

```bash
./run.sh scripts/prebake_semantic_graph_enrichment.py <scene.json> --write        # unenriched only
./run.sh scripts/prebake_semantic_graph_enrichment.py <scene.json> --write --all  # re-enrich all
```

The console line reports how many graphs it enriched, how many it left
untouched, how many **failed**, and the size delta. In `--json`, per-graph
failures are the **`errors`** array (each `{scene, proof, step, error}`), not a
`failed` key; `len(errors)` is what the console prints as "failed", and a nonzero
`errors` is the nonzero exit code. A failure is caught and counted — the rest
still process; **re-run to retry** (each retry re-attempts only what's still
unenriched).

### E4 — Verify

```bash
./run.sh scripts/prebake_semantic_graph_enrichment.py <scene.json> --status --json
```

Expect `unenriched == 0` (only `enriched` and any un-baked `noGraph` remain) —
**but only if the write had no failures.** Any graph that errored in E3 stays
`unenriched`, so a nonzero count here means "re-run to pick up the failures,"
not a bug. Also worth a final `validate_content.py` on the scene to confirm it
still passes with the enriched graphs.

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
- **Enrichment is opt-in and LM-backed.** Only run it when the invocation says
  `enrich`. It costs real Gemini tokens (one call per graph), so confirm before
  writing — and always **prebake first**: enrichment only fills metadata onto
  graphs that already exist. Unlike the structural bake (deterministic,
  byte-identical), enrichment output can vary run-to-run, so prefer
  "unenriched only" over `--all` unless the vocabulary/domain actually changed.
