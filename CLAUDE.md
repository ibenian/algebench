# Claude Code Instructions

Read **[AGENTS.md](AGENTS.md)** before making any changes to this project.

## Co-author Trailer

Append this trailer to GitHub interactions — commits, PR descriptions and review comments:
`🤖 Co-Authored-By: Claude <81847+claude@users.noreply.github.com>`

## Semantic Graph Report (Visual Testing)

The **sg-report** launch config generates a structured per-domain report and serves it locally for visual inspection of the semantic graph renderer.

### Workflow

1. **Generate + serve** (one command):
   ```bash
   ./scripts/serve_sg_report.sh --port 5740
   ```
   This runs `semantic_graph_report.py --outdir /tmp/sg_report` first, then starts `http.server` on port 5740.

2. **Preview**: open `http://localhost:5740` — the index page links to each domain sub-report.

3. **Regenerate only** (server already running):
   ```bash
   ./run.sh scripts/semantic_graph_report.py --outdir /tmp/sg_report
   ```
   The HTTP server serves fresh files from disk on every request — no restart needed. Just regenerate and refresh the browser.

### Important

- Always **generate before serving**. The launch config handles this automatically via `serve_sg_report.sh`.
- Never serve a stale `/tmp/sg_report` directory without regenerating — the report must reflect the current parser/renderer state.
- Use `--theme <name>` to test a specific theme (default: `default-dark`).

## Skills (Claude Code)

1. Create the skill in `.agents/skills/<name>/SKILL.md`
2. Symlink it from `.claude/skills/<name>` → `.agents/skills/<name>`
