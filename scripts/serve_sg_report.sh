#!/bin/bash
# serve_sg_report.sh — Generate the semantic graph report and serve it locally.
#
# Usage:
#   ./scripts/serve_sg_report.sh [--port PORT] [--theme THEME] [--outdir DIR]
#
# Generates the structured report to /tmp/sg_report (or DIR), then starts
# a local HTTP server on the specified port (default: 5740).

set -euo pipefail

PORT=5740
OUTDIR="/tmp/sg_report"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port) PORT="$2"; shift 2 ;;
        --theme) EXTRA_ARGS+=(--theme "$2"); shift 2 ;;
        --outdir) OUTDIR="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "▶ Generating semantic graph report → $OUTDIR"
./run.sh scripts/semantic_graph_report.py --outdir "$OUTDIR" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

echo "▶ Serving on http://localhost:$PORT"
python3 -m http.server "$PORT" -d "$OUTDIR"
