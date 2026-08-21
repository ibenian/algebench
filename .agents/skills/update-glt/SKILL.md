---
name: update-glt
description: Update the pinned gemini-live-tools dependency to a PR branch, named branch, version tag, or latest release and verify the installed package.
args: "[target=<PR_NUMBER|BRANCH_NAME|TAG|latest>]"
---

# Update gemini-live-tools

Update the gemini-live-tools dependency — either to a PR branch for testing, a specific version tag, or the latest release.

---

## Usage

```
/update-glt [PR_NUMBER | BRANCH_NAME | TAG | "latest"]
```

Examples:
- `/update-glt 30` — install from PR #30's branch
- `/update-glt perf/reduce-pcm-buffer-latency` — install from a named branch
- `/update-glt v0.1.19` — pin to a specific tag
- `/update-glt latest` — upgrade to latest release (same as no argument)
- `/update-glt` — upgrade to latest release

---

## Steps

### 1. Resolve the target ref

- **No argument or "latest"**: Find the latest tag in gemini-live-tools:
  ```bash
  gh api repos/ibenian/gemini-live-tools/releases/latest --jq '.tag_name'
  ```
  If no releases, find the latest version tag:
  ```bash
  git -C /Users/ibenian/dev/gemini-live-tools tag -l 'v*' | sort -V | tail -1
  ```

- **Numeric argument (e.g. `30`)**: Look up the PR branch:
  ```bash
  gh pr view <NUMBER> --repo ibenian/gemini-live-tools --json headRefName --jq '.headRefName'
  ```

- **Starts with `v` + contains dots (e.g. `v0.1.19`)**: Use as a version tag directly.

- **Anything else**: Use as a branch name directly.

### 2. Pick the path — release vs. test drive

These are now genuinely different operations, because `requirements.lock` is
what actually gets installed (issue #593). Choose by what the ref *is*:

| Target | Path | Touches the repo? |
|---|---|---|
| A version **tag** (`v0.1.20`, `latest`) | **A — permanent pin** | yes: `requirements.txt` + `requirements.lock` |
| A **PR branch** or named branch | **B — temporary override** | no |

Never commit a lock that resolves a branch: the lock records the branch's
*current commit SHA*, so committing one silently pins the repo to a transient
commit that moves out from under everyone on the next push to that branch.

---

### Path A — permanent pin (tags only)

**A1.** Replace the `gemini-live-tools` line in `requirements.txt`:
```
gemini-live-tools @ git+https://github.com/ibenian/gemini-live-tools.git@<TAG>#subdirectory=python
```
For "latest", find the newest tag first:
```bash
git ls-remote --tags --refs https://github.com/ibenian/gemini-live-tools.git 'v*' \
    | awk -F/ '{print $NF}' | sort -V | tail -1
```

**A2.** Regenerate the lock — editing `requirements.txt` alone changes nothing:
```bash
cd /Users/ibenian/dev/algebench && uv pip compile requirements.txt -o requirements.lock \
    --universal --python-version 3.12 --no-header --upgrade-package gemini-live-tools
```
The lock records the resolved **commit SHA**, not the tag, so the diff on that file is how you
confirm the bump took. The 30-day cooldown from `uv.toml` does not apply to a git dependency —
it filters PyPI upload timestamps, and a git ref has none.

**A3.** Sync the venv:
```bash
cd /Users/ibenian/dev/algebench && ./scripts/setup-venv.sh
```

Commit `requirements.txt` and `requirements.lock` together — and both must reach the
`deploy/on-render*` branches together, since Render installs from the lock.

---

### Path B — temporary override (PR / branch testing)

Leave `requirements.txt` and `requirements.lock` **untouched**. Install the ref
straight over the top of the venv:

```bash
cd /Users/ibenian/dev/algebench && uv pip install --python .venv/bin/python3 \
    --force-reinstall "gemini-live-tools @ git+https://github.com/ibenian/gemini-live-tools.git@<REF>#subdirectory=python"
```

The override is sticky — `run.sh`'s staleness check only fires when the lock
file itself changes, so it survives normal use. To undo it and return to the
pinned SHA:

```bash
cd /Users/ibenian/dev/algebench && ./scripts/setup-venv.sh
```

An **unpushed** local commit cannot be installed this way — a git URL can only
reference something that exists on the remote. Push the branch first, or
install the local checkout directly:

```bash
cd /Users/ibenian/dev/algebench && uv pip install --python .venv/bin/python3 \
    -e /Users/ibenian/dev/gemini-live-tools/python
```

(also undone by `./scripts/setup-venv.sh`).

---

### 3. Verify

```bash
source /Users/ibenian/dev/algebench/.venv/bin/activate && python -c "from gemini_live_tools import get_static_content; get_static_content('tts-audio-player.js'); print('OK')"
```

### 4. Report

Tell the user:
- What ref was installed (branch, tag, or PR number + branch)
- What the previous ref was (from requirements.txt before the change)
- Which path was taken (A permanent pin, or B temporary override)
- For path A: that requirements.lock was recompiled, and the new resolved SHA
- For path B: that the override is temporary and `./scripts/setup-venv.sh` reverts it
- Remind them to restart algebench to pick up changes
