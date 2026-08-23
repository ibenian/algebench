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

# Minimum uv. The floor is set by the LATER of two independent requirements, so
# which one applies depends on how old the installed uv is:
#
#   * FUNCTION, below 0.9.17. `exclude-newer` gained relative durations
#     ("30 days") in 0.9.17 (astral-sh/uv#16814). Below that, uv cannot parse
#     uv.toml at all and every uv command in the project dies with a TOML error
#     naming a line number rather than the cause.
#   * SECURITY, below 0.11.15. Two advisories, with DIFFERENT fixed versions —
#     they do not both apply to every lower release:
#       - below 0.11.6  — arbitrary file deletion via RECORD entries
#                         (GHSA-pjjw-68hj-v9mw)
#       - below 0.11.15 — arbitrary file write via entry point names
#                         (GHSA-4gg8-gxpx-9rph)
#     So 0.11.6-0.11.14 is affected by the second only. Both land while
#     INSTALLING a package, which is precisely the moment uv.toml's cooldown
#     exists to protect — hence the floor rather than a warning.
#
# 0.11.32 (2026-07-23) is the newest release both clear of every known advisory
# and older than the 30-day cooldown this project applies to its own
# dependencies — the consistent choice, so it is what the message suggests.
UV_MIN="0.11.15"
UV_DURATION_MIN="0.9.17"   # below this, uv.toml itself will not parse

# True when $1 is older than $2, comparing major.minor.patch numerically.
#
# NOT `sort -V`: that is a GNU extension. macOS's sort (2.3-Apple) does implement
# it, so the pipeline works here — but a gate deciding whether to run a
# known-vulnerable uv should not depend on which sort happens to be first on
# PATH. `cut` is base POSIX and needs no such caveat.
#
# The important property is that this FAILS CLOSED. A version string it cannot
# parse is treated as too old, so an unrecognised uv is refused rather than
# waved through. The previous form did the opposite: any failure in the pipeline
# produced an empty string, the comparison went false, and an old uv passed the
# security gate silently.
uv_older_than() {
    _a="$1"; _b="$2"
    for _i in 1 2 3; do
        _av="$(printf '%s' "$_a" | cut -d. -f"$_i")"
        _bv="$(printf '%s' "$_b" | cut -d. -f"$_i")"
        # Non-numeric or missing component: refuse rather than guess.
        case "$_av" in ''|*[!0-9]*) return 0 ;; esac
        case "$_bv" in ''|*[!0-9]*) return 1 ;; esac
        [ "$_av" -lt "$_bv" ] && return 0
        [ "$_av" -gt "$_bv" ] && return 1
    done
    return 1   # all three components equal — not older
}

if command -v uv >/dev/null 2>&1; then
    UV_VER="$(uv --version 2>/dev/null | awk '{print $2}')"
    if [ -n "$UV_VER" ] && uv_older_than "$UV_VER" "$UV_MIN"; then
        echo "❌ uv $UV_VER is too old — this project needs >= $UV_MIN."
        echo
        # Say which requirement this version actually fails. Most rejected
        # versions parse uv.toml perfectly well and are refused on security
        # grounds alone; claiming otherwise sends people chasing a config error.
        if uv_older_than "$UV_VER" "$UV_DURATION_MIN"; then
            echo "   It cannot parse uv.toml's \"30 days\" cooldown (relative durations"
            echo "   need uv >= $UV_DURATION_MIN), so every uv command in this project fails"
            echo "   with a TOML parse error. It is also affected by the advisories below."
        else
            echo "   It parses uv.toml fine — this is a security floor. uv below $UV_MIN"
            echo "   is affected by an arbitrary file write via entry point names"
            echo "   (GHSA-4gg8-gxpx-9rph, fixed $UV_MIN); below 0.11.6 also by an"
            echo "   arbitrary file deletion via RECORD entries (GHSA-pjjw-68hj-v9mw)."
            echo "   Both trigger while INSTALLING a package."
        fi
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
