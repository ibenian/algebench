#!/bin/bash
# run.sh — Run any project Python script through the .venv.
#
# Usage:
#   ./run.sh schemas/validate.py scenes/*.json
#   ./run.sh schemas/validate.py --check-schema
#   ./run.sh server.py
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

# Create venv if missing
if [ ! -d "$VENV" ]; then
    echo "Setting up virtual environment (first run only)..."
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -r "$DIR/requirements.txt"
fi

exec "$VENV/bin/python3" "$@"
