---
name: algebench-deploy
description: Check deployment status and deploy AlgeBench — Render (staging and prod) and the Hugging Face Space (prod mirror). Production is a choose-host (Render/HF/both) and choose-source (current branch/main/staging) flow.
triggers:
  - deploy
  - render
  - deployment status
  - deploy to staging
  - deploy to prod
  - deploy to hugging face
  - huggingface
  - hf space
---

# AlgeBench Deploy

Manage AlgeBench deployments. Shows deployment status and pending changes, then
deploys: **staging** (Render-only, `main → staging`) or **production** (choose
host — Render, Hugging Face, or both — and choose source — current branch, main,
or staging).

## Environment Links

- **Production (Render)**: https://algebench.org/
- 🤗 **Production (Hugging Face mirror)**: https://huggingface.co/spaces/ibenian/algebench → https://ibenian-algebench.hf.space
- **Staging**: https://algebench-staging.onrender.com/
- **Developers Page**: https://ibenian.github.io/algebench/developers.html

## Branch Mapping

| Environment | Host | Deployed via | URL |
|---|---|---|---|
| Production | Render | `deploy/on-render` branch | https://algebench.org/ |
| Production mirror | 🤗 Hugging Face | `scripts/deploy_hf.sh` → Space `main`; logged on `deploy/on-huggingface` | https://ibenian-algebench.hf.space |
| Staging | Render | `deploy/on-render-staging` branch | https://algebench-staging.onrender.com/ |
| Source | — | `main` | — |

### 🤗 Hugging Face deploy convention (know this; explain it when relevant)

Hugging Face is a **production mirror** (staging is Render-only). HF builds from
the Space's own `main` and **rejects binaries anywhere in git history**, so we do
**not** push a normal branch. Instead `scripts/deploy_hf.sh`:

1. Builds a **clean snapshot** of the source tree (overlays the Dockerfile + HF
   README header, **strips** `docs/*.png` and dev tooling) via git plumbing.
2. Chains it as one commit onto **`deploy/on-huggingface`** — a *deploy-log*
   branch (not a dev branch; never hand-edit it). Each commit records
   `Source: <sha> <subject>`. History stays binary-free, so HF accepts it.
3. Pushes the **same commit object** to both the Space's `main` *and*
   `origin/deploy/on-huggingface`. So the record branch tip SHA **is** what HF
   serves — that's why Step 2 reads HF state from `origin/deploy/on-huggingface`
   (cross-check with `git ls-remote …/algebench main`).

Key points to surface **to the user when relevant** (deploying to HF, asked about
HF state, or asked why HF differs from Render):
- The deploy log lives at `deploy/on-huggingface` — `git log deploy/on-huggingface`
  shows every HF deploy and its source.
- Each commit is a **standalone snapshot** (binaries stripped); the upstream dev
  commits are not embedded (they live on `main`).
- Growth is a small delta per deploy (git dedupes). It can be trimmed with
  `scripts/deploy_hf.sh --keep N` (keeps the last N deploys; `--keep 1` = no history).
- Never push to the Space's `main` by hand — it would break the
  record-branch-equals-HF-state invariant.

See [deploy/huggingface/README.md](../../../deploy/huggingface/README.md).

## Workflow

When this skill is invoked, follow these steps **in order**:

### Step 1: Fetch Latest State

```bash
git fetch origin main deploy/on-render deploy/on-render-staging --tags
# deploy/on-huggingface may not exist until the first HF deploy — fetch it
# separately and non-fatally (a single fetch errors out if any named ref is missing).
git fetch origin deploy/on-huggingface 2>/dev/null || true
```

### Step 2: Gather Status Data

Run these commands to collect all the information needed for the status report:

```bash
# Latest tag (most recently created). Empty if the repo has no tags yet.
LATEST_TAG=$(git tag --sort=-creatordate | head -1)

# Commits on main not yet on staging
git log --oneline origin/deploy/on-render-staging..origin/main

# Commits on staging not yet on prod
git log --oneline origin/deploy/on-render..origin/deploy/on-render-staging

# Commits on main since last tag — only if a tag exists (otherwise all of main is "unreleased")
[ -n "$LATEST_TAG" ] && git log --oneline ${LATEST_TAG}..origin/main || git log --oneline origin/main

# Current HEAD of each branch
git rev-parse --short origin/main
git rev-parse --short origin/deploy/on-render-staging
git rev-parse --short origin/deploy/on-render
```

Then check whether the **currently deployed production commit** has an associated release:

```bash
# Tag(s) pointing exactly at the prod commit — most recently created if several
PROD_TAG=$(git tag --points-at origin/deploy/on-render --sort=-creatordate | head -1)

# Only look up a GitHub release when a tag actually points at prod — avoids a hard error
[ -n "$PROD_TAG" ] && gh release view "$PROD_TAG" --json tagName,name,url,publishedAt,body

# If no tag points exactly at prod, find the nearest tag reachable from prod
# (returns nothing if the repo has no tags yet)
git describe --tags --abbrev=0 origin/deploy/on-render 2>/dev/null
```

Then check **what the Hugging Face mirror currently runs** via the
`deploy/on-huggingface` log (each deploy records its source as
`Source: <full-40-char-sha> <subject>` — read it from `origin`, no HF fetch needed):

```bash
# Source commit of the latest HF deploy (empty if the mirror was never deployed)
HF_SRC=$(git log -1 --format=%B origin/deploy/on-huggingface 2>/dev/null \
  | sed -n 's/^Source: \([0-9a-f]\{7,\}\).*/\1/p')
echo "HF mirror built from: ${HF_SRC:-never deployed}"

# Browse the full deploy log if useful:
git log --oneline origin/deploy/on-huggingface 2>/dev/null | head

# If known, list commits on Render prod not yet mirrored to HF:
[ -n "$HF_SRC" ] && git log --oneline ${HF_SRC}..origin/deploy/on-render
```

If `HF_SRC` is empty, the mirror hasn't been deployed via the script yet — offer
the HF deploy and note there's no prior deploy to diff against.

### Step 3: Present Status Report

Display a clear status report with sections:

#### Production Status
- Current commit on `deploy/on-render`
- Last release tag and what it points to
- Changes since last release tag (on main) — these are **unreleased features**
- **Associated release** — check whether the deployed prod commit maps to a release:
  - If a tag points **exactly** at the prod commit and has a GitHub release, show:
    - A clickable link to the release (the `url` from `gh release view`)
    - The release name/tag and publish date
    - A short summary of the release notes (`body`) — trim to a few bullet points
  - If **no** tag points exactly at prod, state that prod is running **unreleased commits**
    ahead of the nearest release (`git describe` result), so there is no release to link.
  - If `gh release view` finds the tag but no published release exists for it, say the tag
    exists but has no GitHub release.

#### Staging Status
- Current commit on `deploy/on-render-staging`
- Changes on staging that are **not yet on prod** (staging → prod diff)
- Changes on main that are **not yet on staging** (main → staging diff)

#### 🤗 Hugging Face Mirror Status
- Source commit the live Space snapshot was built from (`HF_SRC` from Step 2)
- Whether Render prod is **ahead of** the HF mirror (the `${HF_SRC}..origin/deploy/on-render` list)
- If `HF_SRC` is unknown (e.g. first-ever deploy), state that the mirror has not been deployed via the script yet

#### Unreleased Features
- List all commits on `main` since the last release tag
- Group by type if possible (feat, fix, chore, docs)

#### Links
Always include clickable links:
- [Production](https://algebench.org/)
- [Staging](https://algebench-staging.onrender.com/)
- [Developers Page](https://ibenian.github.io/algebench/developers.html)
- GitHub compare links for each diff (e.g., `https://github.com/ibenian/algebench/compare/{base}...{head}`)

### Step 4: Offer Action

Use `AskUserQuestion` to present the top-level action. Only offer what applies:

- **Deploy to staging** — Only if main has commits not yet on staging. Staging is
  **Render-only** and always `main → deploy/on-render-staging` (no sub-questions).
- **Deploy to production** — Offer whenever a production target could change:
  staging is ahead of prod, the HF mirror is behind prod, or there are unreleased
  commits on main. This opens the **production sub-flow** in Step 5 (choose
  host(s), then source). 
- **No action needed** — Always available.

If nothing is pending anywhere (staging, Render prod, and HF mirror all current),
skip the question and report that everything is up to date.

### Step 5: Execute Deployment

**Always show the exact commands and the list of commits being deployed, and get
confirmation, before running anything.**

#### 5A. Deploy to staging (Render-only)

```
This pushes the current HEAD of `main` to `deploy/on-render-staging`:
  git push --force-with-lease origin origin/main:deploy/on-render-staging
Changes deployed to staging:
<commit list: origin/deploy/on-render-staging..origin/main>
```
Then:
```bash
git push --force-with-lease origin origin/main:deploy/on-render-staging
```

After the staging push succeeds, **offer a dev version bump** (see Step 6.5).

#### 5B. Deploy to production (branching flow)

A production deploy is **two decisions**, asked with `AskUserQuestion` in order:

**① Which host(s)?**
- **Render** — push the source to `deploy/on-render`; Render auto-builds.
- 🤗 **Hugging Face** — squash-push the source to the Space via `scripts/deploy_hf.sh`.
- **Both** — do Render and Hugging Face from the same source (keeps them in lockstep).

**② Which source?**
- **Current branch** (`<name>` — show the actual current branch) — deploy exactly
  what is checked out locally. Uses the **local** branch HEAD.
- **main** — deploy `origin/main` (latest integrated work).
- **Staging** — deploy `origin/deploy/on-render-staging` (what's been validated on staging).

Resolve the chosen source to a ref `SRC`:

| Source choice | `SRC` |
|---|---|
| Current branch | the local branch name, e.g. `feat/foo` (must be committed; push it to `origin` first if Render is a target) |
| main | `origin/main` |
| Staging | `origin/deploy/on-render-staging` |

Then, for each selected host, show the plan + commit list and execute:

**Render target:**
```
This pushes <SRC> to `deploy/on-render` (Render auto-builds):
  git push --force-with-lease origin <SRC>:deploy/on-render
Changes deployed to Render prod:
<commit list: origin/deploy/on-render..<SRC>>
```
```bash
git push --force-with-lease origin <SRC>:deploy/on-render
```

**🤗 Hugging Face target** (run from a checkout that has `deploy/huggingface/`, i.e. `main`):
```
This builds a clean snapshot commit of <SRC>, appends it to the deploy/on-huggingface
log, and pushes that commit to the Space's main:
  scripts/deploy_hf.sh --source <SRC>
Changes deployed to the HF mirror:
<commit list: ${HF_SRC}..<SRC>>
```
```bash
scripts/deploy_hf.sh --source <SRC> --yes
```

HF notes:
- Needs the HF **write token** — macOS keychain (recommended, no prompt) or
  `HF_TOKEN=hf_xxx` inline. See [deploy/huggingface/README.md](../../../deploy/huggingface/README.md).
- Preview first with `--dry-run` (builds the snapshot, pushes nothing).
- The script builds the snapshot from the **`--source` ref's committed tree** (a
  worktree of that ref), but reads the Dockerfile/header/exclude config from your
  **current checkout's** `deploy/huggingface/`. So deploy any source from a branch
  that has that folder.
- Rebuilds the Docker image (~3–6 min). Verify at https://ibenian-algebench.hf.space.
- The `GEMINI_API_KEY` secret must already be set on the Space.
- Each deploy appends to the `deploy/on-huggingface` log (and pushes it to origin).
  To cap log growth, add `--keep N` (keeps the last N deploys; `--keep 1` = no history).
  Mention this if the user worries about repo size — growth is a small per-deploy delta.

> **Lockstep tip:** When the user picks **Both**, deploy Render first, then HF from
> the **same `SRC`**, so the two hosts run identical code.

### Step 6: Post-Deployment

After a successful deployment:
1. Confirm the push succeeded
2. Show the updated branch positions
3. Remind user to verify at the appropriate URL:
   - Staging: https://algebench-staging.onrender.com/
   - Production (Render): https://algebench.org/
   - 🤗 Production (Hugging Face mirror): https://ibenian-algebench.hf.space
4. Note rebuild times: Render typically takes 1–3 minutes; the Hugging Face Docker Space takes ~3–6 minutes (longer on a cold build).

### Step 6.5: Offer a Dev Version Bump (Staging deploys only)

A staging deploy is the moment fresh work goes live for validation, so it's the
natural point to advance the **dev** version ahead of prod. **After a successful
staging deploy only**, propose upgrading the `VERSION` file and opening a PR.

Use `AskUserQuestion`:

- **Yes — bump the dev version** → compute the next version with the helper and
  open a PR (do **not** merge it).
- **No — keep it** → finish without bumping.

Default to a **minor** bump; mention patch/major if the user wants a different
level. Then:

```bash
CUR=$(./run.sh scripts/version.py --get)                 # e.g. 0.10.0
NEXTDEV=$(./run.sh scripts/version.py --next minor)      # e.g. 0.11.0
git checkout -b chore/bump-version-v$NEXTDEV
./run.sh scripts/version.py --set "$NEXTDEV"
git add VERSION
# Announce committer per AGENTS.md before committing.
git commit -m "chore: bump VERSION to $NEXTDEV for next dev cycle"
git push -u origin chore/bump-version-v$NEXTDEV
gh pr create --base main \
  --title "chore: bump VERSION to $NEXTDEV (post-staging deploy)" \
  --body "$(cat <<EOF
## Summary
Staging now runs $CUR. This advances the working/dev version to $NEXTDEV so main
moves ahead of staging again. The About pill / \`GET /api/version\` reflects
$NEXTDEV once this merges and is redeployed.

## Test plan
- \`./run.sh scripts/version.py --get\` → $NEXTDEV

🤖 Co-Authored-By: Claude <81847+claude@users.noreply.github.com>
EOF
)" \
  --label chore
```

**STOP after creating the PR** — never merge it (per AGENTS.md, the user merges
explicitly after review). Only offer this once per staging deploy.

### Step 7: Offer a Version Bump (Production deploys only)

A production deployment is the natural moment to cut a release tag. **After a successful
production deploy only** (any host/source; skip this for staging deploys), offer to bump the version.

Use `AskUserQuestion` to ask whether to tag this release:

- **Yes — bump the version** → invoke the **`algebench-release`** skill, which reviews changes
  since the last tag, drafts release notes, proposes a semver bump, tags `main`, and creates a GitHub release.
- **No — skip for now** → finish without tagging.

Only offer this when there are actually new commits since the latest tag (the
`${LATEST_TAG}..origin/main` list from Step 2 is non-empty). If `main` is already
at the latest tag, skip the offer.

> **Note:** Tagging is a release *marker* — it does **not** trigger a Render deploy.
> The code is already live from the `staging → prod` push above.

## Important Rules

- **Production is a two-question flow** — always ask host(s) (Render / Hugging Face /
  Both) **and** source (current branch / main / staging) before deploying to prod.
  Staging is Render-only and skips both questions.
- **Never deploy without showing the user what will change first**
- **Render pushes use `--force-with-lease`** (not `--force`) for safety. The HF
  script appends one snapshot commit per deploy onto the binary-free
  `deploy/on-huggingface` log (default `--keep 0`); `--keep 1` makes it a
  single-commit mirror instead.
- **Prefer remote refs** (`origin/main`, `origin/deploy/on-render-staging`) to avoid
  stale local state — the one exception is the **current branch** source, which
  deliberately deploys the local branch HEAD (push it to `origin` first for Render).
- **Keep Render prod and the HF mirror in lockstep** — deploy both from the same source.
- **Fetch before any status check** to ensure data is current
- **Use AskUserQuestion** for deployment decisions, not plain text prompts
- **Include GitHub compare links** so the user can review diffs in the browser
- **After a staging deploy, offer a dev version bump PR** (Step 6.5) — propose upgrading the `VERSION` file via the `scripts/version.py` helper and open a PR; never merge it automatically
- **After a prod deploy, offer a version bump** via the `algebench-release` skill (Step 7) — never tag automatically without asking
- **Hugging Face is a prod mirror, never staging** — only ever deploy production content to it, and always via `scripts/deploy_hf.sh` (preview with `--dry-run` first)
- **Explain the HF deploy-log convention when relevant** — when deploying to HF, reporting HF state, or when the user asks about it: HF state == `deploy/on-huggingface` tip (same commit), each deploy is a stripped standalone snapshot, and the log is trimmable with `--keep N`. Never push to the Space's `main` by hand.
- **Keep the HF mirror in lockstep with Render prod** — after a `staging → prod` deploy, deploy the mirror too so both hosts run the same commit
