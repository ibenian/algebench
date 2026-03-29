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
  index.html
  style.css
docs/              Architecture, sandbox model, feature ideas
```

## Key Conventions

- **Never commit without explicit user instruction.** Wait for the user to say "ok commit", "commit it", or similar before running `git commit`.
- **Always announce who is committing before running `git commit`** — print a line in the format:
  `Committing on behalf of <name> (<email>)`
  using the output of `git config user.name` and `git config user.email`.
- **Codex-only co-author trailer** — when Codex creates a commit in this repo, append
  `Co-authored-by: Codex <codex@openai.com>`
  to the commit message so the commit clearly shows Codex participation in GitHub. Do not add Claude/Anthropic co-author trailers unless the user explicitly asks for that.
- **Gemini-only co-author trailer** — when Gemini creates a commit in this repo, append
  `Co-authored-by: gemini-cli <218195315+gemini-cli@users.noreply.github.com>`
  to the commit message so the commit clearly shows Gemini participation in GitHub.
- **Scene files are JSON** in `scenes/` — no Python or JS changes needed for new lessons.
- **Pinned dependencies** — `requirements.txt` pins `gemini-live-tools` to a specific tag. Update the tag intentionally, don't switch back to `HEAD`.
- **JS from package** — `voice-character-selector.js` is served at runtime from the installed `gemini_live_tools` package via `get_static_content()`. Do not copy it into `static/`.
- **`.venv` is local** — recreate with `rm -rf .venv && ./algebench` if broken.
- **Security** — path traversal and XSS vulnerabilities were previously fixed. Be careful with user-supplied paths in the server and anything that renders untrusted expressions.
- **Branch protection** — `main` is protected. Always use a feature branch and open a PR; never push directly to `main`. Committing directly to `main` is a last resort (e.g., force-push recovery only).
- **PR base branch** — PRs must target `main` unless the user explicitly requests a different base. Merging into a feature branch that has already been merged to `main` will orphan the changes.
- **⚠️ PR workflow** — the standard flow is: create branch → commit → push → create PR → **STOP**. Never merge a PR immediately after creating it. PRs must go through review first. Only merge when the user explicitly says "merge it" or "ok merge" as a **separate instruction** after reviewing. "Commit and merge" means commit + create the PR, not merge it.
- **Codex PR descriptions** — when Codex creates or updates a PR, replace any commit-list placeholder body with a concise writeup using `## Summary` and `## Testing` sections. Summaries should describe the user-visible behavior and key implementation points, not just restate commit subjects.
- **Closing issues** — if a PR resolves a GitHub issue, include `Closes #<number>` in the PR body so GitHub auto-closes the issue on merge.
- **PR labels** — always apply at least one label when creating a PR. Run `gh label list` to see available labels and pick the most appropriate one(s).
- **Merging PRs** — **NEVER merge a PR unless the user explicitly asks as a separate step after review.** Use `gh pr merge --squash`. If it fails due to branch protection, retry with `--admin` (available to repo admins only).

## Scene Format

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full scene format reference, element types, step system, slider API, and animated element expressions.

For building scenes interactively, use the **`algebench-scene-builder`** skill for Claude Code.

## GitHub Issues

When creating a GitHub issue, always apply a label. Run `gh label list` to see available labels and pick the most appropriate one. Common choices:

- `enhancement` — new feature or improvement request
- `bug` — something broken or incorrect
- `scene` — new or improved scene content
- `documentation` — docs additions or corrections
- `architecture` — design or structural decisions

Apply the label as part of the create command or immediately after with `gh issue edit <n> --add-label "<label>"`.

## Skills (Claude Code)

Skills live in `.agents/skills/` (checked into the repo) and are symlinked from `.claude/skills/`. To add a new skill: create `.agents/skills/<name>/SKILL.md`, then `ln -s ../../.agents/skills/<name> .claude/skills/<name>`.

| Skill | When to use |
|---|---|
| `algebench-release` | Tag a new release on main |
| `algebench-scene-builder` | Build or edit scene JSON files interactively |
| `audit-expressions` | Audit expression sandbox coverage before merging scene changes |
| `debug-chrome` | Launch AlgeBench and debug the UI in Chrome |
| `update-glt` | Update gemini-live-tools — install from a PR branch, version tag, or latest release |
| `version-bump` | Bump the version number |

## In-App Agent Tools

See [`agent-tools-reference.md`](agent-tools-reference.md) for the full reference on tools available to the in-app Gemini agent (`add_scene`, `eval_math`, `set_sliders`, `navigate_to`, `set_camera`, `set_info_overlay`, `mem_get`/`mem_set`, `set_preset_prompts`).
