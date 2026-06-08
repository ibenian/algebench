# Hugging Face Space deploy

AlgeBench's production app is mirrored to a **Hugging Face Space** (Docker SDK)
in addition to Render. Staging stays Render-only; Hugging Face is a **production
mirror**.

- **Space:** https://huggingface.co/spaces/ibenian/algebench
- **App URL:** https://ibenian-algebench.hf.space

## Why a script instead of a deploy branch

Render auto-builds from a long-lived branch (`deploy/on-render`). Hugging Face
can't work that way here: a Space builds from **its own `main`**, and its
pre-receive hook **rejects binary files anywhere in git history** (the
`docs/*.png` images live in our history). So instead of pushing a branch, we
push a **single clean snapshot commit**:

```
scripts/deploy_hf.sh [--source <ref>] [--dry-run] [--yes]
```

It builds the snapshot in a throwaway git worktree (never touches your
checkout), overlays the files in this directory, strips the excluded paths, and
pushes the commit to the Space's `main`. The Space is a deploy mirror — GitHub
keeps the full history.

**Deploy log:** each deploy is chained onto a **`deploy/on-huggingface`** branch
(parent = previous deploy) and pushed to `origin`, so you can see exactly what
was deployed and when: `git log deploy/on-huggingface` — every commit carries a
`Source: <sha> <subject>` line. Because each commit is already a clean snapshot
(binaries stripped), the whole branch history stays binary-free and HF accepts
it. The commit is created with plumbing (`commit-tree` + `update-ref`) — no
branch is ever checked out, so an interrupted run can't leave anything behind.

The script pushes the **same commit object** to both the Space's `main` and
`origin/deploy/on-huggingface`, so the branch tip SHA *is* what HF serves (verify
any time with `git ls-remote https://huggingface.co/spaces/ibenian/algebench main`).
This invariant holds only because every HF deploy goes through this script —
never push to the Space's `main` by hand.

**Trimming the log (`--keep N`):** the log grows by a small delta per deploy
(git dedupes unchanged files by content; the binaries are stripped). If you ever
want to cap it, `--keep N` keeps the most recent N deploys and re-roots the rest
away — safe, because every commit is a complete standalone snapshot, so dropping
old commits never changes what's deployed. `--keep 1` makes each deploy a single
root commit (no history); `--keep 0` (default) keeps the full log. Pruning
rewrites the branch, so the origin push uses `--force-with-lease`.

By default `--source` is `origin/deploy/on-render`, so **HF deploys exactly what
Render production runs**. Use `--dry-run` to build and inspect without pushing.

## Files here

| File | Purpose |
|---|---|
| `Dockerfile` | Copied to the snapshot root. Python 3.12, UID 1000, serves `backend.asgi:app` on port 7860. |
| `space-header.md` | YAML metadata header prepended to `README.md` (HF reads `sdk`, `app_port`, title, etc.). |
| `exclude.txt` | Paths removed from the snapshot (the binary `docs/` images + dev-only tooling). |

The script also **hard-fails if any file >9MB survives**, so a stray large
binary is caught even if it isn't listed in `exclude.txt`.

## Auth (one-time)

The push needs your Hugging Face **write** token. Pick one:

**A. Store it in the macOS keychain once (recommended — no prompts ever again):**

```bash
printf 'protocol=https\nhost=huggingface.co\nusername=ibenian\npassword=YOUR_HF_WRITE_TOKEN\n' \
  | git credential-osxkeychain store
# then just:
scripts/deploy_hf.sh --source origin/main
```

**B. Pass it inline for a single deploy:**

```bash
HF_TOKEN=hf_xxx scripts/deploy_hf.sh --source origin/main --yes
```

The token reaches git via `GIT_ASKPASS` (never the command line), but the
**inline `HF_TOKEN=` does land in your shell history** — clear that entry
afterward with the offset of the last command:

```bash
history -d "$(history 1 | awk '{print $1}')"
```

(Option **A** avoids this entirely — the token lives only in the keychain.)

## Secrets on the Space

`GEMINI_API_KEY` must be set as a **secret** in the Space (Settings → Variables
and secrets). Optional tuning vars: `ALGEBENCH_RATELIMIT_CHAT`,
`ALGEBENCH_RATELIMIT_TTS`, `ALGEBENCH_RATELIMIT_ENRICH`, `ALGEBENCH_TTS_REALTIME`.
These live on the Space, not in this repo.
