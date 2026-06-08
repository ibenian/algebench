#!/usr/bin/env python3
"""CI aggregator for prebaked-graph validation.

Runs the prebake validator (``analyze``) over one or more scene files and emits
a single compact Markdown report (to stdout) with:

  - an overall verdict (in sync / out of sync),
  - a per-scene table plus a TOTAL row,
  - non-blocking prebake suggestions for un-baked scenes whose parse cost is
    above the worth-it threshold.

Exit code is 1 iff any committed graph is out of sync (stale or broken) — the
CI gate. Prebake suggestions never affect the exit code.

Usage:
    ./run.sh scripts/ci_validate_prebaked.py scenes/a.json scenes/b.json
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import json  # noqa: E402
from scripts.prebake_semantic_graphs import analyze  # noqa: E402


def main(paths):
    rows = []          # (name, report)
    out_of_sync = 0
    suggestions = []
    for p in paths:
        name = Path(p).name
        try:
            spec = json.loads(Path(p).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"::warning:: skipping {p}: {e}", file=sys.stderr)
            continue
        rep = analyze(spec)
        rows.append((name, rep))
        out_of_sync += rep["outOfSync"]
        if rep["recommendPrebake"]:
            suggestions.append((name, rep))

    # ---- totals ----
    keys = ("valid", "stale", "errorBroken", "missing", "errorUnbaked")
    totals = {k: sum(r["counts"][k] for _, r in rows) for k in keys}
    total_graphs = totals["valid"] + totals["stale"] + totals["errorBroken"]

    # ---- table ----
    hdr = f"{'scene':<42}{'valid':>6}{'stale':>6}{'broken':>7}{'missing':>8}{'unsup':>6}"
    sep = "─" * len(hdr)
    lines = [hdr, sep]
    for name, r in rows:
        c = r["counts"]
        flag = "" if c["valid"] + c["stale"] + c["errorBroken"] else "  (not baked)"
        lines.append(f"{name[:42]:<42}{c['valid']:>6}{c['stale']:>6}"
                     f"{c['errorBroken']:>7}{c['missing']:>8}{c['errorUnbaked']:>6}{flag}")
    lines.append(sep)
    lines.append(f"{'TOTAL':<42}{totals['valid']:>6}{totals['stale']:>6}"
                 f"{totals['errorBroken']:>7}{totals['missing']:>8}{totals['errorUnbaked']:>6}")
    table = "\n".join(lines)

    # ---- verdict ----
    if out_of_sync:
        header = f"❌ Prebaked Graphs — {out_of_sync} committed graph(s) out of sync (no longer match their math)"
    else:
        header = "✅ Prebaked Graphs — in sync"

    body = [
        "<!-- prebaked-graphs-report -->",
        f"**{header}**",
        "",
        f"<details><summary>{len(rows)} scene(s) · {total_graphs} baked graph(s) checked</summary>",
        "",
        "```",
        table,
        "```",
        "",
        "</details>",
    ]

    if suggestions:
        body += ["", "💡 **Prebake suggested** (advisory):"]
        for name, r in suggestions:
            body.append(f"- `{name}` — {r['recommendReason']}; run "
                        f"`scripts/prebake_semantic_graphs.py <scene> --write`")

    body += [
        "",
        "<sub>Fails only on **stale**/**broken** — a committed graph the current "
        "parser can't reproduce. Suggestions are non-blocking.</sub>",
    ]
    print("\n".join(body))
    return 1 if out_of_sync else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: ci_validate_prebaked.py <scene.json> [scene.json ...]", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
