# Codex Instructions

Read **[AGENTS.md](AGENTS.md)** before making any changes to this project.

## UI Testing

When testing the UI, always start AlgeBench with:

```bash
./algebench <filepath> --server-only --debug --port 8785
```

Then open `http://localhost:8785` in the in-app browser. The `--server-only`
flag prevents the launcher from opening a second browser window outside Codex.

## Co-author Trailer

Append this trailer to GitHub interactions — commits, PR descriptions and review comments:
`🤖 Co-authored-by: Codex <codex@openai.com>`
