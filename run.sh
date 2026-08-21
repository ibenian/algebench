#!/bin/bash
# run.sh — Run any project Python script through the .venv.
#
# Usage:
#   ./run.sh schemas/validate.py scenes/*.json
#   ./run.sh schemas/validate.py --check-schema
#   ./run.sh backend/server.py
#   ./run.sh -m pytest tests/
#
# Handles venv creation and dependency install on first use.

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$DIR/.venv"

# Dev servers, folded in from the old top-level `run` script (deleted — nothing
# referenced it and its name only caused confusion with this file).
case "${1:-}" in
    landing-page|landing-page-with-algebench)
        CMD="$1"; shift
        PORT=5760; APP_PORT=5751
        while [ $# -gt 0 ]; do
            case "$1" in
                --port) PORT="$2"; shift 2 ;;
                --app-port) APP_PORT="$2"; shift 2 ;;
                *) echo "Unknown arg: $1" >&2; exit 1 ;;
            esac
        done
        if [ "$CMD" = "landing-page-with-algebench" ]; then
            if curl -s -o /dev/null "http://localhost:$APP_PORT/" 2>/dev/null; then
                echo "▶ AlgeBench app already running on :$APP_PORT — reusing it"
            else
                APP_LOG="/tmp/algebench-$APP_PORT.log"
                echo "▶ Starting AlgeBench app → http://localhost:$APP_PORT  (logs: $APP_LOG)"
                "$DIR/algebench" --server-only --skip-tour --port "$APP_PORT" >"$APP_LOG" 2>&1 &
                # Only stop the app WE started; a pre-existing one is untouched.
                trap 'kill $! 2>/dev/null || true' EXIT INT TERM
                printf "  waiting for app to be ready"
                for _ in $(seq 1 40); do
                    curl -s -o /dev/null "http://localhost:$APP_PORT/" 2>/dev/null && break
                    printf "."; sleep 0.5
                done
                echo " ✓"
            fi
        fi
        echo "▶ Landing page → http://localhost:$PORT"
        exec python3 -m http.server "$PORT" --directory "$DIR/docs/landing-page"
        ;;
esac

if [ $# -eq 0 ]; then
    echo "Usage: ./run.sh <script.py> [args...]"
    echo "       ./run.sh -m <module> [args...]"
    echo "       ./run.sh landing-page [--port P]"
    echo "       ./run.sh landing-page-with-algebench [--port P] [--app-port P]"
    echo ""
    echo "Runs Python scripts using the project .venv."
    echo ""
    echo "Examples:"
    echo "  ./run.sh schemas/validate.py scenes/*.json"
    echo "  ./run.sh schemas/validate.py --check-schema"
    echo "  ./run.sh schemas/validate.py -v scenes/eigenvalues.json"
    echo ""
    echo "Testing:"
    echo "  ./run.sh -m pytest tests/                    # run all tests"
    echo "  ./run.sh -m pytest tests/test_render_math.py # run one test file"
    echo "  ./run.sh -m pytest tests/ -k 'test_style'    # run tests matching name"
    echo "  ./run.sh -m pytest tests/ -v                 # verbose output"
    echo "  ./run.sh -m pytest tests/ --tb=short         # shorter tracebacks"
    exit 0
fi

# Create venv if missing. Prefer `uv` so the venv is built on a native CPython
# (arm64 on Apple Silicon), pinned by .python-version. Bare `python3 -m venv`
# resolves to whatever python3 is first on PATH — on Apple Silicon that's often
# the x86 Homebrew build, which runs everything under Rosetta and roughly halves
# sympy throughput (issue #388). Fall back to python3 if uv is unavailable.
# .venv is built by scripts/setup-venv.sh, not here. This script only runs
# project Python through it. Dependency locking and upgrading are plain uv
# commands — see AGENTS.md.
if [ ! -d "$VENV" ] || [ ! -x "$VENV/bin/python3" ]; then
    echo "No .venv found. Create it with:" >&2
    echo "    ./scripts/setup-venv.sh" >&2
    exit 1
fi

# The lock moved since this venv was built (pulled a change, switched branches).
# Warn rather than install — installing is setup-venv.sh's job, not this one's.
if [ -f "$DIR/requirements.lock" ] && ! cmp -s "$DIR/requirements.lock" "$VENV/.lock-stamp"; then
    echo "⚠️  requirements.lock has changed since .venv was built." >&2
    echo "    Run ./scripts/setup-venv.sh to catch up." >&2
fi

# Ensure the repo root AND scripts/ are on PYTHONPATH so 'backend.*' imports
# resolve and scripts can import sibling helpers (e.g. _pc_env, proof_animation_build)
# even from subdirectories like scripts/proof_completion/.
export PYTHONPATH="${DIR}:${DIR}/scripts${PYTHONPATH:+:$PYTHONPATH}"

exec "$VENV/bin/python3" "$@"
