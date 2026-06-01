---
name: deploy-to-render
description: Check deployment status and deploy AlgeBench to Render (staging and prod)
triggers:
  - deploy
  - render
  - deployment status
  - deploy to staging
  - deploy to prod
---

# Deploy to Render

Manage AlgeBench deployments to Render. Shows deployment status, pending changes, and deploys to staging or production.

## Environment Links

- **Production**: https://algebench.org/
- **Staging**: https://algebench-staging.onrender.com/
- **Developers Page**: https://ibenian.github.io/algebench/developers.html

## Branch Mapping

| Environment | Branch | URL |
|---|---|---|
| Production | `deploy/on-render` | https://algebench.org/ |
| Staging | `deploy/on-render-staging` | https://algebench-staging.onrender.com/ |
| Source | `main` | — |

## Workflow

When this skill is invoked, follow these steps **in order**:

### Step 1: Fetch Latest State

```bash
git fetch origin main deploy/on-render deploy/on-render-staging --tags
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
# Tag(s) pointing exactly at the prod commit (first one if several)
PROD_TAG=$(git tag --points-at origin/deploy/on-render | head -1)

# Only look up a GitHub release when a tag actually points at prod — avoids a hard error
[ -n "$PROD_TAG" ] && gh release view "$PROD_TAG" --json tagName,name,url,publishedAt,body

# If no tag points exactly at prod, find the nearest tag reachable from prod
# (returns nothing if the repo has no tags yet)
git describe --tags --abbrev=0 origin/deploy/on-render 2>/dev/null
```

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

#### Unreleased Features
- List all commits on `main` since the last release tag
- Group by type if possible (feat, fix, chore, docs)

#### Links
Always include clickable links:
- [Production](https://algebench.org/)
- [Staging](https://algebench-staging.onrender.com/)
- [Developers Page](https://ibenian.github.io/algebench/developers.html)
- GitHub compare links for each diff (e.g., `https://github.com/ibenian/algebench/compare/{base}...{head}`)

### Step 4: Offer Deployment Options

Use `AskUserQuestion` to present available actions based on what has pending changes.

Only offer options that have actual pending changes:

- **Deploy main → staging** — Only if there are commits on main not yet on staging. Uses `--force-with-lease`.
- **Deploy staging → prod** — Only if there are commits on staging not yet on prod. Uses `--force-with-lease`.
- **No action needed** — Always available.

If there are no pending changes anywhere, skip the question and report that everything is up to date.

### Step 5: Execute Deployment

Before executing, **always inform the user** what will happen:

#### Deploy to Staging
```
This will push the current HEAD of `main` to `deploy/on-render-staging`:

  git push --force-with-lease origin origin/main:deploy/on-render-staging

This deploys the following changes to staging:
<list of commits>
```

Then execute:
```bash
git push --force-with-lease origin origin/main:deploy/on-render-staging
```

#### Deploy to Production
```
This will push the current HEAD of `deploy/on-render-staging` to `deploy/on-render`:

  git push --force-with-lease origin origin/deploy/on-render-staging:deploy/on-render

This deploys the following changes to production:
<list of commits>
```

Then execute:
```bash
git push --force-with-lease origin origin/deploy/on-render-staging:deploy/on-render
```

### Step 6: Post-Deployment

After a successful deployment:
1. Confirm the push succeeded
2. Show the updated branch positions
3. Remind user to verify at the appropriate URL:
   - Staging: https://algebench-staging.onrender.com/
   - Production: https://algebench.org/
4. Note that Render typically takes 1–3 minutes to rebuild and deploy

### Step 7: Offer a Version Bump (Production deploys only)

A production deployment is the natural moment to cut a release tag. **After a successful
`staging → prod` deploy only** (skip this for staging deploys), offer to bump the version.

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

- **Never deploy without showing the user what will change first**
- **Always use `--force-with-lease`** (not `--force`) for safety
- **Always use remote refs** (`origin/main`, `origin/deploy/on-render-staging`) to avoid stale local state
- **Fetch before any status check** to ensure data is current
- **Use AskUserQuestion** for deployment decisions, not plain text prompts
- **Include GitHub compare links** so the user can review diffs in the browser
- **After a prod deploy, offer a version bump** via the `algebench-release` skill (Step 7) — never tag automatically without asking
