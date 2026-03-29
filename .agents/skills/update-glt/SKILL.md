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

### 2. Update requirements.txt

Replace the `gemini-live-tools` line in `/Users/ibenian/dev/algebench/requirements.txt` with:
```
gemini-live-tools @ git+https://github.com/ibenian/gemini-live-tools.git@<REF>#subdirectory=python
```

### 3. Install into venv

```bash
source /Users/ibenian/dev/algebench/.venv/bin/activate && pip install --force-reinstall "gemini-live-tools @ git+https://github.com/ibenian/gemini-live-tools.git@<REF>#subdirectory=python"
```

### 4. Verify

```bash
source /Users/ibenian/dev/algebench/.venv/bin/activate && python -c "from gemini_live_tools import get_static_content; get_static_content('tts-audio-player.js'); print('OK')"
```

### 5. Report

Tell the user:
- What ref was installed (branch, tag, or PR number + branch)
- What the previous ref was (from requirements.txt before the change)
- Remind them to restart algebench to pick up changes
