#!/bin/bash
# serve_proof_animation.sh — Generate the proof-animation page and serve it locally.
#
# Usage:
#   ./scripts/serve_proof_animation.sh [--port PORT] [--outdir DIR] [--sample]
#   ./scripts/serve_proof_animation.sh --from-json /tmp/traj.json
#   ./scripts/serve_proof_animation.sh "a + b = c" "a = c - b"
#
# Generates a self-contained page (index.html + engine + animation.json) into
# DIR (default /tmp/proof_anim), then serves it on PORT (default 5750).

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
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

# default to the baked sample if no states/source given
if [[ ${#ARGS[@]} -eq 0 ]]; then ARGS=(--sample); fi

echo "▶ Generating proof-animation page → $OUTDIR"
"$DIR/run.sh" scripts/proof_animation_report.py --outdir "$OUTDIR" "${ARGS[@]}"

echo "▶ Serving on http://localhost:$PORT"
python3 -m http.server "$PORT" -d "$OUTDIR"
