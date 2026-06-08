# AlgeBench — Agent Guidelines

## Project Overview

AlgeBench is an interactive 3D math visualizer built on MathBox / Three.js, with AI chat and narrated lessons powered by Gemini. Scenes are plain JSON files. Expressions are evaluated via math.js.

## Running the Server

```bash
./algebench                        # start server (auto-creates .venv on first run)
./algebench scenes/eigenvalues.json  # open a specific scene
./algebench --update               # upgrade dependencies
```

The server runs at `http://localhost:8785`.

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

Run the full suite before committing any change that touches `scripts/`, `server.py`, or theme JSON.

### Browser Testing

When you need to test the UI in a browser (e.g. debugging TTS, buttons, styles), navigate to `http://localhost:8785` using the Chrome browser tools. Switch to the **Chat** tab to interact with the AI chat and TTS controls. If the page doesn't load, find the actual port with `grep DEFAULT_PORT server.py`.

## Project Structure

```
algebench/         Launcher script
server.py          Python HTTP server + WebSocket handler
agent_tools.py     Tool definitions for the in-app AI agent
scenes/            Lesson JSON files
static/
  app.js           3D scene rendering, sliders, camera
  chat.js          AI chat panel, TTS, voice picker
  proof-animation/ Realtime, Manim-style derivation morph engine (FLIP)
  index.html
  style.css
scripts/
  proof_animation/   Proof-animation data pipeline (build · report · derive · serve)
  proof_completion/  Expert train-eval pipeline (dataset · optimize · evaluate)
tests/proof_animation/proof_animations.json   Curated proof-animation test suite (trajectories)
docs/              Architecture, sandbox model, feature ideas
```

## Key Conventions

- **Never commit without explicit user instruction.** Wait for the user to say "ok commit", "commit it", or similar before running `git commit`.
- **Always announce who is committing before running `git commit`** — print a line in the format:
  `Committing on behalf of <name> (<email>)`
  using the output of `git config user.name` and `git config user.email`.
- **Co-author trailers** — each AI agent must append its own co-author trailer to all GitHub interactions (commits, PR descriptions, reviews, comments). See agent-specific instructions in `CLAUDE.md`, `GEMINI.md`, or `CODEX.md`.
- **Scene files are JSON** in `scenes/` — no Python or JS changes needed for new lessons.
- **Pinned dependencies** — `requirements.txt` pins `gemini-live-tools` to a specific tag. Update the tag intentionally, don't switch back to `HEAD`.
- **JS from package** — `voice-character-selector.js` is served at runtime from the installed `gemini_live_tools` package via `get_static_content()`. Do not copy it into `static/`.
- **`.venv` is local** — recreate with `rm -rf .venv && ./algebench` if broken.
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
