---
name: algebench-release
description: Release workflow for AlgeBench. Increments the version tag and creates a new release on main. Covers version discovery, tag naming conventions, merge checks, and GitHub release creation.
---

# AlgeBench Release

This skill guides the release process for AlgeBench — finding the current version, deciding the next version, tagging, and publishing a GitHub release.

---

## Step 1 — Check Current State

```bash
git checkout main
git pull
git log --oneline -10
git tag --sort=-version:refname | head -5
```

- Confirm you are on `main` and it is up to date.
- Find the latest tag (e.g. `v0.1.0`).
- Review recent commits to understand what is included in this release.

---

## Step 2 — Determine Next Version

AlgeBench uses **semantic versioning**: `vMAJOR.MINOR.PATCH`

| Change type | Bump |
|---|---|
| Bug fixes, minor polish, small improvements | PATCH (`v0.1.0` → `v0.1.1`) |
| New features, new element types, new domain libraries, new API endpoints | MINOR (`v0.1.0` → `v0.2.0`) |
| Breaking changes to scene JSON format, major architecture changes | MAJOR (`v0.1.0` → `v1.0.0`) |

If no tag exists yet, start at `v0.1.0`.

Ask the user which bump level if unclear.

---

## Step 3 — Write a Release Summary

Review commits since the last tag:

```bash
git log <last-tag>..HEAD --oneline
```

Draft a short release summary (3–8 bullet points) covering:
- New features
- Notable fixes
- Any breaking changes or migration notes

Show the draft to the user and confirm before proceeding.

---

## Step 4 — Create and Push the Tag

```bash
git tag -a v<NEW_VERSION> -m "<one-line summary>"
git push origin v<NEW_VERSION>
```

Use an annotated tag (`-a`) with a concise message summarizing the release.

---

## Step 5 — Create a GitHub Release

```bash
gh release create v<NEW_VERSION> \
  --title "v<NEW_VERSION>" \
  --notes "<release notes>" \
  --latest
```

Pass the release notes as the full bullet-point summary from Step 3.

If the release should not be marked latest (e.g. a patch on an older branch), omit `--latest`.

---

## Full Example

```bash
# Check state
git checkout main && git pull
git tag --sort=-version:refname | head -5
# → v0.1.0

# Review commits
git log v0.1.0..HEAD --oneline

# Tag
git tag -a v0.2.0 -m "v0.2.0 — astrodynamics domain library, scene scoring, trust system"
git push origin v0.2.0

# GitHub release
gh release create v0.2.0 \
  --title "v0.2.0" \
  --notes "$(cat <<'EOF'
- Domain library system with astrodynamics engine
- Scene scoring: interactiveness and agentic scores
- Trust system with domain library disclosure
- Domain API endpoints for agent discoverability
- Scene builder skill updated with domain library docs
EOF
)" \
  --latest
```

---

## Notes

- Always release from `main`. Never tag a feature branch directly.
- Always confirm the release summary with the user before tagging.
- Do not push the tag before confirming — tags on remote are hard to move.
- If the tag already exists on remote, do not force-push it. Create a new one with a corrected version.
