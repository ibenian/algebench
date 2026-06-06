#!/usr/bin/env python3
"""Generate a self-contained proof-animation page (for the local launcher).

Mirrors semantic_graph_report.py: builds the animation data, copies the engine
JS/CSS, and writes an index.html into an output dir that ``serve_proof_animation.sh``
then serves with ``python3 -m http.server``. The page loads KaTeX from CDN,
imports the engine, fetches animation.json, and instantiates ProofAnimator.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from proof_animation_build import build, SAMPLE  # sibling script

_ROOT = Path(__file__).resolve().parent.parent
_ASSETS = _ROOT / "static" / "proof-animation"

_INDEX = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Proof Animation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <link rel="stylesheet" href="./proof-animation.css">
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
           margin: 0; padding: 40px 20px; background: #f6f7fb; color: #1a1a2e; }
    .wrap { max-width: 780px; margin: 0 auto; }
    h1 { font-size: 1.15rem; font-weight: 600; color: #374151; margin: 0 0 16px; }
    .hint { color: #6b7280; font-size: .9rem; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1 id="title">Proof Animation</h1>
    <div id="anim"></div>
    <p class="hint">Click any step (0,1,2,…) to jump there — the morph runs between
    the current state and the one you pick. Toggle “sequential” to stagger the moves.</p>
  </div>
  <script type="module">
    import { ProofAnimator } from "./proof-animation.js";
    (async () => {
      for (let i = 0; i < 100 && !window.katex; i++)
        await new Promise(r => setTimeout(r, 30));
      const data = await (await fetch("./animation.json")).json();
      document.getElementById("title").textContent = data.title || "Proof Animation";
      window.animator = new ProofAnimator(
        document.getElementById("anim"), data, { katex: window.katex });
    })();
  </script>
</body>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("states", nargs="*", help="LaTeX states (else --sample/--from-json)")
    ap.add_argument("--domain", default="algebra")
    ap.add_argument("--title", default="")
    ap.add_argument("--sample", action="store_true")
    ap.add_argument("--from-json", default=None)
    ap.add_argument("--outdir", default="/tmp/proof_anim")
    args = ap.parse_args()

    if args.from_json:
        traj = json.load(open(args.from_json))
        states = ([{"latex": traj["start_latex"], "operation": "start"}]
                  + [{"latex": s["expr_latex"], "operation": s.get("operation", ""),
                      "justification": s.get("justification", "")} for s in traj["steps"]])
        data = build(states, args.domain, args.title or traj.get("kind", ""))
    elif args.states:
        data = build([{"latex": s} for s in args.states], args.domain, args.title)
    else:  # default to the sample
        data = build(SAMPLE["states"], SAMPLE["domain"], args.title or SAMPLE["title"])

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "animation.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))
    shutil.copy(_ASSETS / "proof-animation.js", out / "proof-animation.js")
    shutil.copy(_ASSETS / "proof-animation.css", out / "proof-animation.css")
    (out / "index.html").write_text(_INDEX)
    print(f"wrote {out}/  ({len(data['steps'])} states)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
