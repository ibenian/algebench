---
name: algebench-release
description: Release workflow for AlgeBench. Reconciles the VERSION file with the prod git tag, tags a new release on main, publishes a GitHub release, then bumps the VERSION file to the next dev version via a PR. Covers version discovery, tag naming conventions, merge checks, and GitHub release creation.
---

# AlgeBench Release

This skill guides the release process for AlgeBench. The **`VERSION` file at the
repo root is the single source of truth** for the version the app reports
(shown in the in-app About pill and at `/api/version`). Production is identified
by the latest `v*` git tag.

The lifecycle:

```
prod tag = v0.9.0          ← what is live in production (last release)
VERSION  = 0.10.0          ← what dev/staging have been building (the NEXT release)
                             │
   release ────────────────┤ tag v0.10.0, GitHub release
                             │
   post-release bump ───────┘ VERSION → 0.11.0 (via PR) so staging is ahead of prod again
```

So at any time, **staging runs a higher version than prod** because the VERSION
file is bumped immediately after each release.

Use the helper for all VERSION reads/writes — never hand-edit or `sed` the file:

```bash
./run.sh scripts/version.py --get                      # current VERSION
./run.sh scripts/version.py --next minor               # next minor (no write)
./run.sh scripts/version.py --next minor --from 0.9.0  # next relative to a base
./run.sh scripts/version.py --set 0.10.0               # write explicit
./run.sh scripts/version.py --bump minor               # bump + write, print new
```

---

## Step 1 — Check Current State

```bash
git checkout main
git fetch origin && git pull --ff-only origin main
git tag --sort=-version:refname | head -5     # → prod tag, e.g. v0.9.0
./run.sh scripts/version.py --get             # → VERSION file, e.g. 0.10.0
git log <prod-tag>..HEAD --oneline            # what's included since prod
```

Capture two numbers:

- **`PROD`** — the version part of the latest `v*` tag (e.g. `0.9.0`).
- **`FILE`** — the current `VERSION` file value (e.g. `0.10.0`).

---

## Step 2 — Determine the Release Version

The version you release is normally **`FILE`** — that is what dev and staging
have actually been running. The prod tag is a sanity check. Reconcile them:

| Situation | Action |
|---|---|
| `FILE` > `PROD` **and** `FILE` == `bump(PROD, minor)` (the expected next minor) | ✅ Release `FILE`. No question needed — this is the normal path. |
| `FILE` > `PROD` but `FILE` ≠ the inferred next minor (e.g. a patch or major was intended) | ⚠️ Show the user both: "VERSION file says `FILE`; bumping the prod tag would give `bump(PROD, minor)`. Release **`FILE`** (recommended — it's what staging runs) or a different version?" Default to `FILE`. |
| `FILE` ≤ `PROD` (file is stale — not bumped after the last release, or someone reset it) | ⛔ Do **not** auto-release. Tell the user the VERSION file looks stale and ask for the intended release version. |

Compute the inferred next for the comparison:

```bash
PROD=$(git tag --sort=-version:refname | head -1 | sed 's/^v//')
FILE=$(./run.sh scripts/version.py --get)
INFERRED=$(./run.sh scripts/version.py --next minor --from "$PROD")
echo "prod=$PROD  file=$FILE  inferred-next-minor=$INFERRED"
```

Let **`RELEASE`** be the agreed version (no leading `v`). It must be strictly
greater than `PROD`. If `RELEASE` ≠ `FILE`, first update the file on `main` (via
a small PR or folded into the release branch) so the tag and the file agree:

```bash
./run.sh scripts/version.py --set "$RELEASE"
# The VERSION file on main must equal RELEASE before tagging.
```

---

## Step 3 — Write a Release Summary

```bash
git log v<PROD>..HEAD --oneline
```

Draft a short summary (3–8 bullets): new features, notable fixes, breaking
changes / migration notes. **Show it to the user and confirm before tagging.**

---

## Step 4 — Create and Push the Tag

Confirm `main` is up to date and `VERSION` on `main` equals `RELEASE`, then:

```bash
git tag -a v<RELEASE> -m "v<RELEASE> — <one-line summary>"
git push origin v<RELEASE>
```

Use an annotated tag (`-a`). Do not push before the user confirms the summary —
remote tags are hard to move.

---

## Step 5 — Create a GitHub Release

```bash
gh release create v<RELEASE> \
  --title "v<RELEASE>" \
  --notes "<release notes from Step 3>" \
  --latest
```

Omit `--latest` for a patch on an older branch.

---

## Step 6 — Bump VERSION to the Next Dev Version (PR)

Immediately after the release, bump the `VERSION` file so staging/dev move ahead
of prod again. **Default: minor bump** (start of the next feature cycle). Ask the
user for the bump level if a patch or major cycle is intended.

```bash
NEXTDEV=$(./run.sh scripts/version.py --next minor --from "$RELEASE")   # e.g. 0.11.0
git checkout -b chore/bump-version-v$NEXTDEV
./run.sh scripts/version.py --set "$NEXTDEV"
git add VERSION
# Announce committer per AGENTS.md before committing:
git commit -m "chore: bump VERSION to $NEXTDEV for next dev cycle"
git push -u origin chore/bump-version-v$NEXTDEV
gh pr create --base main \
  --title "chore: bump VERSION to $NEXTDEV (post-v$RELEASE)" \
  --body "$(cat <<EOF
## Summary
Post-release version bump. v$RELEASE has been tagged and released, so this
moves the working version to $NEXTDEV. After merge, staging runs $NEXTDEV while
prod stays on $RELEASE until the next release.

## Test plan
- \`./run.sh scripts/version.py --get\` → $NEXTDEV
- App About pill / \`GET /api/version\` reports $NEXTDEV after deploy

🤖 Co-Authored-By: Claude <81847+claude@users.noreply.github.com>
EOF
)" \
  --label chore
```

**STOP after creating the PR** — do not merge it. Per AGENTS.md, the user merges
explicitly after review. The next release will read this bumped `VERSION` as its
`FILE` value in Step 1.

---

## Full Example

```bash
# 1. State
git checkout main && git fetch origin && git pull --ff-only origin main
PROD=$(git tag --sort=-version:refname | head -1 | sed 's/^v//')    # 0.9.0
FILE=$(./run.sh scripts/version.py --get)                           # 0.10.0
INFERRED=$(./run.sh scripts/version.py --next minor --from "$PROD") # 0.10.0
# FILE == INFERRED and FILE > PROD → normal path, RELEASE=0.10.0

# 2/3. Summary, confirm with user

# 4. Tag
git tag -a v0.10.0 -m "v0.10.0 — About pill + VERSION-file release flow"
git push origin v0.10.0

# 5. GitHub release
gh release create v0.10.0 --title "v0.10.0" --notes "$(cat <<'EOF'
- In-app About pill in the status bar (product + version)
- VERSION file as the single source of truth for the app version
- Release flow reconciles VERSION with the prod tag and auto-bumps next dev version
EOF
)" --latest

# 6. Next dev bump (PR)
git checkout -b chore/bump-version-v0.11.0
./run.sh scripts/version.py --set 0.11.0
git add VERSION && git commit -m "chore: bump VERSION to 0.11.0 for next dev cycle"
git push -u origin chore/bump-version-v0.11.0
gh pr create --base main --title "chore: bump VERSION to 0.11.0 (post-v0.10.0)" --body "..." --label chore
```

---

## Notes

- Always release from `main`. Never tag a feature branch directly.
- `VERSION` on `main` must equal the version you tag — the file and tag agree at release time, then the file races ahead via Step 6.
- Always confirm the release summary with the user before tagging.
- Do not push the tag before confirming — remote tags are hard to move.
- If the tag already exists on remote, do not force-push it. Create a corrected version.
- Verify a deploy with `curl -s <host>/api/version` — staging should report the bumped dev version, prod the released version.
