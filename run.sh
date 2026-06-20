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

if [ $# -eq 0 ]; then
    echo "Usage: ./run.sh <script.py> [args...]"
    echo "       ./run.sh -m <module> [args...]"
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
if [ ! -d "$VENV" ]; then
    echo "Setting up virtual environment (first run only)..."
    if command -v uv >/dev/null 2>&1; then
        PYVER="$(cat "$DIR/.python-version" 2>/dev/null || echo 3.13)"
        # only-managed forces a uv-managed CPython, which always matches the host
        # arch (arm64 on Apple Silicon) — avoids selecting an x86 Homebrew python.
        uv venv --python "$PYVER" --python-preference only-managed "$VENV"
        uv pip install --python "$VENV/bin/python3" -r "$DIR/requirements.txt"
    else
        echo "⚠️  uv not found — using 'python3 -m venv' (may be x86/Rosetta on Apple Silicon; see issue #388)."
        python3 -m venv "$VENV"
        "$VENV/bin/pip" install -r "$DIR/requirements.txt"
    fi
fi

# Ensure the repo root AND scripts/ are on PYTHONPATH so 'backend.*' imports
# resolve and scripts can import sibling helpers (e.g. _pc_env, proof_animation_build)
# even from subdirectories like scripts/proof_completion/.
export PYTHONPATH="${DIR}:${DIR}/scripts${PYTHONPATH:+:$PYTHONPATH}"

exec "$VENV/bin/python3" "$@"
