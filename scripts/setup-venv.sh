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

# Minimum uv. Two independent reasons land on the same floor:
#
#   * SECURITY. uv <0.11.15 is affected by two advisories with no fix in any
#     earlier line — arbitrary file deletion via RECORD entries (GHSA-pjjw-68hj-v9mw,
#     fixed 0.11.6) and arbitrary file write via entry point names
#     (GHSA-4gg8-gxpx-9rph, fixed 0.11.15). Both land while INSTALLING a package,
#     which is precisely the moment uv.toml's cooldown exists to protect.
#   * FUNCTION. `exclude-newer` only accepts relative durations ("30 days") from
#     uv 0.9.17 (astral-sh/uv#16814). Older uv fails to parse uv.toml at all —
#     every uv command in the project dies with a TOML error that names a line
#     number rather than the cause.
#
# 0.11.32 (2026-07-23) is the newest release that is both clear of every known
# advisory and older than the 30-day cooldown this project applies to its own
# dependencies — the consistent choice, so it is what the message suggests.
UV_MIN="0.11.15"

# True when $1 is older than $2. sort -V is version-aware, so 0.11.9 < 0.11.15
# sorts correctly where a string compare would not.
uv_older_than() {
    [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]
}

if command -v uv >/dev/null 2>&1; then
    UV_VER="$(uv --version 2>/dev/null | awk '{print $2}')"
    if [ -n "$UV_VER" ] && uv_older_than "$UV_VER" "$UV_MIN"; then
        echo "❌ uv $UV_VER is too old — this project needs >= $UV_MIN."
        echo
        echo "   Below $UV_MIN, uv is affected by two advisories that trigger while"
        echo "   installing a package (GHSA-pjjw-68hj-v9mw, GHSA-4gg8-gxpx-9rph), and"
        echo "   it cannot parse uv.toml's \"30 days\" cooldown, so every uv command"
        echo "   in this project fails with a TOML parse error."
        echo
        echo "   Upgrade:  uv self update    (or reinstall from https://astral.sh/uv)"
        echo "   Suggested: 0.11.32 — newest release clear of all known advisories"
        echo "              and past this project's own 30-day cooldown."
        exit 1
    fi
fi

# Keyed on the interpreter and pip, NOT on the directory existing. An
# interrupted first-time setup leaves .venv/ present but without bin/python3,
# and a directory-only check then skips creation and dies further down on a raw
# "no such file" from bin/pip. Same failure shape as the one fixed in the
# algebench launcher: an existence test standing in for a usability claim.
if [ ! -x "$VENV/bin/python3" ] || [ ! -x "$VENV/bin/pip" ]; then
    CLEAR=""
    if [ -d "$VENV" ]; then
        echo "⚠️  .venv exists but is incomplete (no interpreter or pip) — recreating."
        # --clear rather than `rm -rf`: each tool's own supported way to replace
        # an existing environment, so nothing here deletes a directory by hand.
        # uv refuses to write into a populated venv dir without it.
        CLEAR="--clear"
    fi
    echo "Creating virtual environment..."
    if command -v uv >/dev/null 2>&1; then
        PYVER="$(cat "$DIR/.python-version" 2>/dev/null || echo 3.13)"
        # only-managed forces a uv-managed CPython, which always matches the host
        # arch (arm64 on Apple Silicon). Bare `python3 -m venv` picks whatever is
        # first on PATH — often the x86 Homebrew build, which runs under Rosetta
        # and roughly halves sympy throughput (issue #388).
        # --seed installs pip, which the install step below needs.
        # shellcheck disable=SC2086  # CLEAR is empty or --clear, intentionally unquoted
        uv venv $CLEAR --seed --python "$PYVER" --python-preference only-managed "$VENV"
    else
        echo "⚠️  uv not found — using 'python3 -m venv' (may be x86/Rosetta on Apple Silicon; see issue #388)."
        # shellcheck disable=SC2086
        python3 -m venv $CLEAR "$VENV"
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
