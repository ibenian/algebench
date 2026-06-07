#!/bin/bash
# serve.sh — Generate the proof-animation page and serve it locally.
#
# Usage:
#   ./scripts/proof_animation/serve.sh [--port PORT] [--outdir DIR]
#   ./scripts/proof_animation/serve.sh --from-json /tmp/traj.json
#   ./scripts/proof_animation/serve.sh "a + b = c" "a = c - b"
#
# Generates a self-contained page (index.html + engine + animation.json) into
# DIR (default /tmp/proof_anim), then serves it on PORT (default 5750).

set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=5750
OUTDIR="/tmp/proof_anim"
ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port) PORT="$2"; shift 2 ;;
        --outdir) OUTDIR="$2"; shift 2 ;;
        *) ARGS+=("$1"); shift ;;
    esac
done

# With no args the report renders the curated test suite (tests/proof_animation/proof_animations.json).

echo "▶ Generating proof-animation page → $OUTDIR"
"$DIR/run.sh" scripts/proof_animation/report.py --outdir "$OUTDIR" ${ARGS[@]+"${ARGS[@]}"}

echo "▶ Serving on http://localhost:$PORT"
python3 -m http.server "$PORT" -d "$OUTDIR"
