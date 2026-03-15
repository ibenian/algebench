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
- **Scene files are JSON** in `scenes/` — no Python or JS changes needed for new lessons.
- **Pinned dependencies** — `requirements.txt` pins `gemini-live-tools` to a specific tag. Update the tag intentionally, don't switch back to `HEAD`.
- **JS from package** — `voice-character-selector.js` is served at runtime from the installed `gemini_live_tools` package via `get_static_content()`. Do not copy it into `static/`.
- **`.venv` is local** — recreate with `rm -rf .venv && ./algebench` if broken.
- **Security** — path traversal and XSS vulnerabilities were previously fixed. Be careful with user-supplied paths in the server and anything that renders untrusted expressions.
- **Branch protection** — `main` is protected. Always use a feature branch and open a PR; never push directly to `main`.
- **Merging PRs** — always use `gh pr merge --squash --admin` to bypass branch protection checks.

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

## In-App Agent Tools

See [`agent-tools-reference.md`](agent-tools-reference.md) for the full reference on tools available to the in-app Gemini agent (`add_scene`, `eval_math`, `set_sliders`, `navigate_to`, `set_camera`, `set_info_overlay`, `mem_get`/`mem_set`, `set_preset_prompts`).
