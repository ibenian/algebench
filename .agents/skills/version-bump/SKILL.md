# Version Bump

Check what has changed since the last tag, bump the version, tag it, and optionally publish a GitHub release.

---

## Version scheme

Standard semantic versioning: `v<MAJOR>.<MINOR>.<REVISION>`

Each term allows multiple digits: `v0.10.0`, `v1.0.12`, `v2.14.3` are all valid.

| Bump | Example | When to use |
|---|---|---|
| Revision | `v0.2.0` → `v0.2.1` | Quick fixes, minor polish, docs |
| Minor | `v0.2.1` → `v0.3.0` | New features |
| Major | `v0.3.0` → `v1.0.0` | Breaking changes |

---

## Step 1 — Check current state

```bash
git checkout main && git pull
git tag --sort=-version:refname | head -5
```

---

## Step 2 — Review changes and propose bump

```bash
git log <last-tag>..HEAD --oneline
```

Summarize the changes, suggest a bump level, and wait for the user to confirm the version.

---

## Step 3 — Tag and push

```bash
git tag -a v<NEW_VERSION> -m "<one-line summary>"
git push origin v<NEW_VERSION>
```

---

## Step 4 — Offer a GitHub release

Ask the user: **"Create a GitHub release for `v<NEW_VERSION>`?"**

If yes:

```bash
gh release create v<NEW_VERSION> \
  --title "v<NEW_VERSION>" \
  --notes "<bullet-point release notes>" \
  --latest
```

---

## Notes

- Always work from `main`. Never tag a feature branch.
- Use annotated tags (`-a`), not lightweight tags.
- Do not force-push existing tags.
