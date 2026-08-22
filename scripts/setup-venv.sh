#!/bin/bash
# Create .venv and install requirements.lock into it.
#
# Run once after cloning, and again whenever requirements.lock changes:
#
#     ./scripts/setup-venv.sh
#
# Dependency *management* — locking and upgrading — is not here. Those are plain
# uv commands, documented in AGENTS.md. This only builds the environment.

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$DIR/.venv"
LOCK="$DIR/requirements.lock"

if [ ! -d "$VENV" ]; then
    echo "Creating virtual environment..."
    if command -v uv >/dev/null 2>&1; then
        PYVER="$(cat "$DIR/.python-version" 2>/dev/null || echo 3.13)"
        # only-managed forces a uv-managed CPython, which always matches the host
        # arch (arm64 on Apple Silicon). Bare `python3 -m venv` picks whatever is
        # first on PATH — often the x86 Homebrew build, which runs under Rosetta
        # and roughly halves sympy throughput (issue #388).
        # --seed installs pip, which the install step below needs.
        uv venv --seed --python "$PYVER" --python-preference only-managed "$VENV"
    else
        echo "⚠️  uv not found — using 'python3 -m venv' (may be x86/Rosetta on Apple Silicon; see issue #388)."
        python3 -m venv "$VENV"
    fi
fi

# Installed with pip, not uv, and deliberately so: uv applies uv.toml's 30-day
# cooldown to installs as well as resolutions, which makes an already reviewed
# lock unbuildable whenever it holds a pin younger than 30 days — e.g. aiohttp
# 3.14.3, taken on purpose as a CVE fix. The alternative was to set
# UV_EXCLUDE_NEWER="0 days" here, and that override is the user's call alone
# (see AGENTS.md), never something a script should do on their behalf. pip has
# no notion of exclude-newer, so the lock installs exactly as written.
echo "Installing requirements.lock..."
"$VENV/bin/pip" install -q -r "$LOCK"
cp "$LOCK" "$VENV/.lock-stamp"

echo "✓ .venv ready."
