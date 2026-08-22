# AlgeBench — Agent Guidelines

## Project Overview

AlgeBench is an interactive 3D math visualizer built on MathBox / Three.js, with AI chat and narrated lessons powered by Gemini. Scenes are plain JSON files. Expressions are evaluated via math.js.

## Running the Server

```bash
./algebench                        # start server (auto-creates .venv on first run)
./algebench scenes/eigenvalues.json  # open a specific scene
```

The server runs at `http://localhost:8785`.

### CAS execution guard (sympy timeouts)

Heavy sympy calls in the proof-grounding path (`solveset` / `simplify` / `limit`
/ …) have no termination guarantee and can peg a CPU core indefinitely. They run
through a **killable, process-isolated guard** (`backend/experts/modules/
proof_completion/cas_guard.py`, issue #386): a wall-clock budget actually
*stops* the computation — the worker is SIGTERM'd (graceful) then SIGKILL'd
(hard) and the core reclaimed. The client timeout (how long the caller waits) is
separate from this kill/respawn, so a derive never blocks on a pathological step.

All tunables are environment variables (sensible defaults; nothing to set for
normal use):

| Variable | Default | Meaning |
| --- | --- | --- |
| `ALGEBENCH_CAS_ISOLATION` | `process` | `process` (killable), `thread` (waits only, legacy), or `inline` (no isolation) |
| `ALGEBENCH_CAS_CLIENT_TIMEOUT` | `ALGEBENCH_VERIFY_TIMEOUT` (2.0s) | rung 1: how long the caller waits before degrading to "unknown" |
| `ALGEBENCH_CAS_GRACEFUL_TIMEOUT` | `1.0` | rung 2→3: SIGTERM grace before SIGKILL on a wedged worker |
| `ALGEBENCH_CAS_POOL_SIZE` | `min(4, cores−1)` | number of pre-warmed worker processes |
| `ALGEBENCH_CAS_MAX_CALLS` | `200` | recycle a worker after N calls (cache/memory hygiene; 0 = never) |
| `ALGEBENCH_CAS_START_METHOD` | `forkserver` (Linux) / `spawn` | multiprocessing start method |
| `ALGEBENCH_CAS_SPAWN_TIMEOUT` | `30` | max wait for a fresh worker to warm up (import), charged separately from a call |
| `ALGEBENCH_CAS_ACQUIRE_TIMEOUT` | client timeout | max wait for a free worker under load before degrading |
| `ALGEBENCH_CAS_MAX_OPS` | `2500` | complexity pre-gate: skip the CAS on expressions larger than this (0 = off) |

`ALGEBENCH_VERIFY_TIMEOUT` is still honored as the client-timeout default for
back-compat. The test suite runs in `thread` isolation (see `tests/conftest.py`).

### Running Scripts

**Always use `./run.sh` to run project Python scripts** — never call `.venv/bin/python` or `python3` directly. `run.sh` handles venv creation and dependency installation automatically.

```bash
./run.sh scripts/validate_schema.py -v scenes/*.json
./run.sh scripts/validate_content.py scenes/*.json
./run.sh scripts/extract_structure.py --catalog scenes/*.json
./run.sh scripts/assemble_scene.py lesson.json --add scene.json       # append scene
./run.sh scripts/assemble_scene.py lesson.json --add scene.json --at 3 # insert at index
./run.sh scripts/assemble_scene.py lesson.json --replace 2 scene.json  # replace scene
./run.sh scripts/assemble_scene.py lesson.json --remove 4              # remove scene
./run.sh scripts/assemble_scene.py lesson.json --list                  # list scenes
./run.sh scripts/lint_scene.py scene.json                              # lint a scene
./run.sh scripts/lint_scene.py --fix scene.json                        # lint + auto-fix
./run.sh scripts/latex_to_graph.py "F = m \cdot a"                     # LaTeX → semantic graph JSON
./run.sh scripts/latex_to_graph.py --pretty "E = mc^2"                 # pretty-printed output
./run.sh scripts/latex_to_graph.py -o graph.json "\frac{dv}{dt} = a"   # write to file
./run.sh scripts/graph_to_mermaid.py graph.json                        # semantic graph → Mermaid
./run.sh scripts/graph_to_mermaid.py --theme role-colored-light graph.json   # with a named theme
./run.sh scripts/graph_to_mermaid.py --label-mode latex graph.json     # LaTeX labels
./run.sh scripts/graph_to_mermaid.py --list-themes                     # list available themes
./run.sh scripts/latex_to_graph.py "F = m \cdot a" | ./run.sh scripts/graph_to_mermaid.py --wrap -  # full pipeline
./run.sh scripts/render_math.py "y = x^2 - 2x + 1"                    # render LaTeX → HTML in browser
./run.sh scripts/render_math.py "E = mc^2" --mermaid                   # LaTeX + Mermaid diagram
./run.sh scripts/render_math.py "F = m \cdot a" --mermaid --theme power-flow-light  # with named theme
./run.sh scripts/render_math.py "E = mc^2" --mermaid --no-latex        # Mermaid only
```

**Proof animation** (Manim-style derivation morphs) — the committed test suite is
`tests/proof_animation/proof_animations.json` (proof trajectories, hand-maintained):

```bash
./scripts/proof_animation/serve.sh                                     # render suite + serve on :5750
./run.sh scripts/proof_animation/report.py --from-file tests/proof_animation/proof_animations.json --outdir _site   # CI/Pages render (no LM)
# derive a proof (LM; needs GEMINI_API_KEY) — prints a ProofAnimation for review; paste into proof_animations.json by hand
./run.sh scripts/proof_animation/derive.py --prompt "derive Lorentz time dilation"
./run.sh scripts/proof_animation/derive.py "x^2 - 4 = 0" "x = 2" --title "Solve x^2=4" --render
```

**Re-baking stored proof verdicts** — a stored proof serves the `confidence` block it
was baked with, so a grading-rule change reaches the reader only after a re-bake:

```bash
./run.sh scripts/regrade_proofs.py proofs/domains/*/*.json --check      # report, exit 1 if stale
./run.sh scripts/regrade_proofs.py proofs/domains/*/*.json              # re-grade in place
```

Never hand-roll a re-grade loop over `ground_steps`. It needs inputs the CAS alone
does not have — the model's declared `change_type` (drop it and every mislabel
downgrade silently reverts) and which tiers came from the LM domain judge (offline
there is no judge, so they silently demote). `regrade_proofs.py` reads both from the
stored file and refuses to guess where they are missing; `ground_steps` itself warns
when called with no `change_types` (issue #542).

**Proof-completion expert** — sympy is ground truth; only inference/optimize call the LM:

```bash
./run.sh scripts/proof_completion/dataset.py --n 200 --seed 1 --out data/proof_completion/train.jsonl   # no LM
./run.sh scripts/proof_completion/optimize.py --train data/proof_completion/train.jsonl                  # train (LM)
./run.sh scripts/proof_completion/evaluate.py --data data/proof_completion/eval.jsonl                    # eval (LM)
./run.sh scripts/proof_completion_derive.py "\frac{d}{dx} x^2" "2 x"                                     # inference CLI (LM)
```

### Running Tests

**Always use `./run.sh -m pytest` to run tests** — never invoke `pytest` or `python -m pytest` directly (the tests import `scripts.*` modules through the venv and fail outside it).

```bash
./run.sh -m pytest tests/                      # run the full suite (sampled mode, fast)
./run.sh -m pytest tests/ --sampled 100        # quick check with 100 sampled combos
./run.sh -m pytest tests/ --exhaustive         # full cross-product (~504 combos, CI mode)
./run.sh -m pytest tests/test_render_math.py   # one file
./run.sh -m pytest tests/ -k 'mermaid'         # filter by name
./run.sh -m pytest tests/ -v                   # verbose
./run.sh -m pytest tests/ --tb=short           # shorter tracebacks
```

The semantic graph exhaustive test suite supports two modes via pytest flags:

- **`--sampled N`** (default, N=200) — random sample from the full cross-product. Use `--sampled 100` for quick local checks.
- **`--exhaustive`** — full structure × relation × var_style × nesting cross-product (~504 combos). **CI always runs exhaustive.** Only use locally if the user explicitly asks for it.

`--exhaustive` also widens the **proof-edit corpus sweep**
(`tests/backend/experts/test_proof_edit_variants.py`), which rebuilds committed
proofs through the CAS to prove a no-op edit is byte-identical. Every proof costs
a full chain re-grounding — seconds each on the long physics derivations — so the
default run samples four structurally varied proofs and `--exhaustive` takes all
of them. Anything that CAS-grades a whole proof per case belongs behind this flag
for the same reason.

Run the full suite before committing any change that touches `scripts/`, `server.py`, or theme JSON.

### Browser Testing

When you need to test the UI in a browser (e.g. debugging TTS, buttons, styles), navigate to `http://localhost:8785` using the Chrome browser tools. Switch to the **Chat** tab to interact with the AI chat and TTS controls. If the page doesn't load, find the actual port with `grep DEFAULT_PORT server.py`.

## Project Structure

```
algebench/         Launcher script
backend/
  server.py        Python HTTP server + WebSocket handler
  agent_tools.py   Tool definitions for the in-app AI agent
scenes/            Lesson JSON files
schemas/           JSON Schemas — the source of truth for src/types/
src/               Frontend SOURCE (TypeScript, handwritten)
  main.ts          Entry point — wires all modules, exposes globals
  chat.ts          AI chat panel, TTS, voice picker
  graph-panel/     Semantic-graph renderers, themes, layout engines
  proof-animation/ Realtime, Manim-style derivation morph engine (FLIP)
  objects/         Element renderers
  types/           GENERATED from schemas/ — never hand-edit
  *.test.ts        Node test suite (see Frontend TypeScript below)
static/
  dist/            BUILD OUTPUT from src/ — committed, do not hand-edit
  domains/         Domain library plugins (JavaScript by design — lesson content)
  index.html
  style.css
scripts/
  proof_animation/   Proof-animation data pipeline (build · report · derive · serve)
  proof_completion/  Expert train-eval pipeline (dataset · optimize · evaluate)
tests/proof_animation/proof_animations.json   Curated proof-animation test suite (trajectories)
docs/              Architecture, sandbox model, feature ideas
```

## Frontend TypeScript

The frontend is TypeScript. **Edit `src/`; never edit `static/dist/`** — that is
build output and gets overwritten.

**Two ways to run, and TypeScript is optional for both.** The committed bundle
under `static/dist/` is what the Python server serves, so `./algebench` needs no
Node toolchain. Vite is a convenience for frontend work, never a runtime or
deploy dependency:

```bash
./algebench scenes/foo.json     # Python server, serves the committed bundle
npm run dev                     # optional: Vite dev server with HMR
npm run build                   # rebuild static/dist/ — COMMIT the result
npm run typecheck               # both programs (see below)
npm test                        # Node test suite
```

**Rebuild and commit `static/dist/` whenever you change `src/`.** CI has a
bundle-sync check that rebuilds and fails if the committed output differs.

### Conventions

- **Import specifiers are server-root-absolute and keep a `.js` extension** —
  `import { state } from '/state.js'`, even though the file is `state.ts`. That
  is the path the Python server serves modules from; `tsconfig.json` `paths` and
  `vite.config.mts` both map it onto `src/`, and `scripts/node-test-resolver.mjs`
  does the same for the test suite. **Never rewrite these to `.ts`.**
- **`src/types/*.d.ts` is generated** from `schemas/*.json` by
  `scripts/generate_ts_types.mjs`. Before hand-writing an interface, check
  whether a generated one already exists — and prefer exporting a type from the
  module that owns it over restating its shape somewhere else.
- **Crash semantics are preserved deliberately.** Use `!` or an explicit cast,
  not `?.`, when a missing element should still throw as it did before; each `!`
  carries a comment naming the guard or invariant that justifies it.
- **One deliberate JavaScript holdout:** `static/domains/` — user-authored
  lesson content loaded at runtime, not application code. It sits outside
  `tsconfig.json`'s `include`.
- **Classic scripts build to `dist/` like everything else.** `embed-resizer`
  (runs on the third-party page embedding a proof) and `theme-init` (runs
  pre-paint in `<head>`) are import-free IIFEs loaded by a plain `<script>`
  tag rather than imported. Being a *classic script* is a property of the
  output, not a reason to bypass the build: both are TypeScript, both are
  ordinary Vite entries, and both are served from `/dist/` — which also means
  they get `?v=<version>` cache-busting and working sourcemaps for free.
- **Nothing may `import` a `SERVER_SERVED` path** (`/domains/*`,
  `/gemini-live-tools/*`) — Vite marks them external and the test resolver
  refuses them with a named error.
- **Don't start a comment line with the `@ts-expect-error` token unless you
  mean it.** TypeScript reads it as a real directive even mid-prose, so a
  wrapped sentence *mentioning* it will silently suppress the next error.

### Two tsconfigs

`tsconfig.json` is the **browser** program (`types: []`); `tsconfig.test.json` is
the **Node** program for `src/*.test.ts` (`types: ["node"]`). `npm run typecheck`
runs both.

The split is load-bearing. Putting `types: ["node"]` in a single shared config
pulls Node's globals into browser modules and redefines `setTimeout`'s return
type (`Timeout` vs `number`) — which broke 12 correct call sites when tried.
Timer handles are therefore annotated `ReturnType<typeof setTimeout>`, which is
right under both libraries. Scoping node types with a per-file
`/// <reference types="node" />` does **not** work: those register program-wide.

## Key Conventions

- **Never commit without explicit user instruction.** Wait for the user to say "ok commit", "commit it", or similar before running `git commit`.
- **Always announce who is committing before running `git commit`** — print a line in the format:
  `Committing on behalf of <name> (<email>)`
  using the output of `git config user.name` and `git config user.email`.
- **Co-author trailers** — each AI agent must append its own co-author trailer to all GitHub interactions (commits, PR descriptions, reviews, comments). See agent-specific instructions in `CLAUDE.md`, `GEMINI.md`, or `CODEX.md`.
- **Scene files are JSON** in `scenes/` — no Python or JS changes needed for new lessons.
- **LM response caching is OFF by default** — DSPy's own default is `cache=True`, which writes every prompt and completion to `~/.dspy_cache` as a pickle (the store CVE-2025-69872 concerns). `backend/experts/llm_config.py` does not inherit that; set `ALGEBENCH_LM_CACHE=1` to opt in. It is enabled on Render (staging + prod), where repeated identical derivations across users turn a cache hit into a Gemini call not made — though the container filesystem is ephemeral, so it only pays within one container's life. Enable it locally for `scripts/proof_completion/optimize.py` and eval sweeps, which re-run overlapping prompts and are what caching actually pays for. Leave it off for interactive work: with `temperature` non-zero, a cached response returns the *same* sample rather than a fresh one (DSPy's `rollout_id` is the supported way to vary that).

- **`requirements.lock` is what installs, not `requirements.txt`** — `run.sh`, `algebench`, CI, Render (prod + staging) and the HF Space all install from the lock. `requirements.txt` is the human-authored intent file; editing it changes nothing until the lock is regenerated. `run.sh` does not manage dependencies — that is plain `uv`, below.

- **Dependency commands** (run from the repo root):
  ```bash
  uv pip compile requirements.txt -o requirements.lock --universal --python-version 3.12 --no-header
  #   ...add --upgrade                  to move every package
  #   ...add --upgrade-package <name>   to move just one
  ./scripts/setup-venv.sh                                          # rebuild .venv from the lock
  ```
  Commit `requirements.txt` and `requirements.lock` together, in their own PR, so the resolved diff is reviewable.

- **⚠️ ALWAYS resolve with a 30-day cooldown. NEVER use `0 days` unless the user explicitly asks.** The cooldown is set once in `uv.toml` (`exclude-newer = "30 days"`) and uv applies it to every command in this project, so the commands above already honour it — you do not need to pass anything. Compromised packages are usually found and yanked within hours to days (litellm 1.82.7/1.82.8 were quarantined ~40 minutes after release), and this is what stops one being installed. **Do not set `UV_EXCLUDE_NEWER="0 days"`, and do not pass `--exclude-newer`, on your own initiative** — not to "get the latest", not to make a resolution succeed, not to work around an error. It is the user's call alone. An upgrade under the cooldown means *newest that is at least 30 days old*, and that is the intended behaviour, not a problem to route around.

- **The cooldown can push a package backwards.** If a pinned version is itself younger than 30 days (a security fix taken deliberately), it is not a legal candidate, so a relock picks an *older* release — e.g. `aiohttp 3.14.3 -> 3.14.2`, undoing the fix. Always read the version diff before committing a relock. Older releases carry more advisories, never fewer.

- **The cooldown does not cover `gemini-live-tools`.** It filters PyPI upload timestamps, and a git dependency has none. The lock pins it by immutable commit SHA instead, so review that SHA when the tag moves.

- **`run.sh` runs project Python and nothing else.** It does not create, sync or manage the venv — `./scripts/setup-venv.sh` does that, and dependency locking is plain `uv` (above). If `run.sh` warns that `requirements.lock` has changed, run setup-venv.
- **One report covers both questions:** `./run.sh scripts/dependency_audit_report.py DEPENDENCY-AUDIT-REPORT.md` — advisories against the pinned versions, *and* a current / allowed-under-cooldown / latest-on-PyPI table with a legend for reading it. Writes nothing but the markdown file; exits non-zero if an unignored advisory is found. CI runs the same script and publishes it to Pages.

- **Audit the pins:** `./run.sh scripts/dependency_audit_report.py DEPENDENCY-AUDIT-REPORT.md`. CI runs the same script (`.github/workflows/audit-python-deps.yml`) on every PR touching the lock, on push to main, and weekly — a lock that was clean when pinned does not stay clean, because advisories get published against versions you already hold. `PYSEC-2026-2447` is ignored by policy: `diskcache` (via `dspy`) has no patched release in any version — see CVE-2025-69872.
- **GitHub's dependency graph cannot see our Python pins.** It parses `requirements.txt`, `Pipfile.lock`, `Pipfile`, `setup.py` — not `requirements.lock`. Our `requirements.txt` holds 13 ranged entries; the 110 pinned transitive versions live only in the lock, and that is where every advisory has ever been found here. So `dependency-review.yml` is scoped to **npm only**, and Python is audited against its real lock by `audit-python-deps.yml`. Do not "fix" this by renaming files to suit the parser.

- **Pinned dependencies** — `requirements.txt` pins `gemini-live-tools` to a specific tag (the lock resolves it to an immutable commit SHA). Update the tag intentionally, don't switch back to `HEAD`, and recompile the lock afterwards — see the `update-glt` skill.
- **JS from package** — `voice-character-selector.js` is served at runtime from the installed `gemini_live_tools` package via `get_static_content()`. Do not copy it into `static/`.
- **`.venv` is local** — recreate with `rm -rf .venv && ./algebench` if broken.
- **Native arm64 venv via `uv`** — `run.sh`/`algebench` provision `.venv` with `uv` when available, on a uv-managed CPython pinned by `.python-version` (3.13). This keeps the venv native arm64 on Apple Silicon instead of an x86 Homebrew Python under Rosetta, which roughly halves sympy throughput (issue #388). Without `uv` they fall back to `python3 -m venv`. Verify with `.venv/bin/python3 -c "import platform; print(platform.machine())"` → `arm64`. Dev-only: cloud deploys (Render, HF) are native Linux and unaffected.
- **Security** — path traversal and XSS vulnerabilities were previously fixed. Be careful with user-supplied paths in the server and anything that renders untrusted expressions.
- **Sync `main` before branching.** Run `git fetch origin && git checkout main && git pull --ff-only origin main` *before* `git checkout -b <feature>`. Branching off a stale `main` invites needless rebases and merge conflicts later.
- **Always create a feature branch before starting work on an issue.** Create the branch immediately — before making any code changes — so all work is tracked from the start.
- **Branch protection** — `main` is protected. Always use a feature branch and open a PR; never push directly to `main`. Committing directly to `main` is a last resort (e.g., force-push recovery only).
- **PR base branch** — PRs must target `main` unless the user explicitly requests a different base. Merging into a feature branch that has already been merged to `main` will orphan the changes.
- **⚠️ PR workflow** — the standard flow is: create branch → commit → push → create PR → **STOP**. Never merge a PR immediately after creating it. PRs must go through review first. Only merge when the user explicitly says "merge it" or "ok merge" as a **separate instruction** after reviewing. "Commit and merge" means commit + create the PR, not merge it.
- **PR descriptions** — when creating or updating a PR, write a concise body using `## Summary` and `## Test plan` sections. Summaries should describe the user-visible behavior and key implementation points, not just restate commit subjects.
- **Closing issues** — if a PR resolves a GitHub issue, include `Closes #<number>` in the PR body so GitHub auto-closes the issue on merge.
- **PR labels** — always apply at least one label when creating a PR. Run `gh label list` to see available labels and pick the most appropriate one(s).
- **Merging PRs** — **NEVER merge a PR unless the user explicitly asks as a separate step after review.** Use `gh pr merge --squash`. If it fails due to branch protection, retry with `--admin` (available to repo admins only).

## Scene Format

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full scene format reference, element types, step system, slider API, and animated element expressions. For building scenes interactively, use the scene builder skill for your agent.

## GitHub Issues

When creating a GitHub issue, always apply a label. Run `gh label list` to see available labels and pick the most appropriate one. Common choices:

- `enhancement` — new feature or improvement request
- `bug` — something broken or incorrect
- `scene` — new or improved scene content
- `documentation` — docs additions or corrections
- `architecture` — design or structural decisions

Apply the label as part of the create command or immediately after with `gh issue edit <n> --add-label "<label>"`.

## Skills

Skills live in `.agents/skills/` (checked into the repo). Each agent platform symlinks them into its own config directory (e.g., `.claude/skills/` for Claude Code). To add a new skill: create `.agents/skills/<name>/SKILL.md`, then symlink it for your agent.

| Skill | When to use |
|---|---|
| `algebench-deploy` | Show deployment status and deploy AlgeBench. Staging is Render-only (`main → staging`); production is a choose-host (Render / Hugging Face / both) and choose-source (current branch / main / staging) flow. After a prod deploy, calls `algebench-release` to optionally cut a release. |
| `algebench-lesson-builder` | Build a complete multi-scene lesson end-to-end (orchestrator) |
| `algebench-release` | Tag a new release on main and publish a GitHub release. Invoked by `algebench-deploy` (Step 7) after a prod deploy, or run directly. |
| `algebench-scene-builder` | Build or edit scene JSON files interactively |
| `algebench-schema-generator` | Generate or update `schemas/lesson.schema.json` from code and scenes |
| `algebench-validate-lesson` | Validate scene/lesson JSON against the schema + content checks |
| `audit-expressions` | Audit expression sandbox coverage before merging scene changes |
| `debug-chrome` | Launch AlgeBench and debug the UI in Chrome |
| `lesson-builder-research` | Research Agent — gather math facts, theorems, proofs, citations for a topic |
| `lesson-builder-pedagogy` | Pedagogy Expert — design learning arc, scaffolding, proof placement |
| `lesson-builder-designer` | Lesson Designer — synthesize research + pedagogy into scene-by-scene blueprint |
| `lesson-builder-scene-builder` | Scene Builder — produce complete scene JSON from an outline |
| `lesson-builder-validator` | Syntax Validator — validate and auto-fix assembled lesson JSON |
| `lesson-builder-evaluator` | Pedagogical Evaluator — review lesson quality, flow, and completeness |
| `update-glt` | Update gemini-live-tools — install from a PR branch, version tag, or latest release |

## In-App Agent Tools

See [`agent-tools-reference.md`](agent-tools-reference.md) for the full reference on tools available to the in-app Gemini agent (`add_scene`, `eval_math`, `set_sliders`, `navigate_to`, `set_camera`, `set_info_overlay`, `clear_info_overlays`, `mem_get`/`mem_set`, `set_preset_prompts`).
