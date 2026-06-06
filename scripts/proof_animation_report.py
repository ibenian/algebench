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

from proof_animation_build import build, SAMPLES  # sibling script
from backend.experts.modules.proof_completion.outputs import ProofTrajectory, DerivationStep

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
    h1 { font-size: 1.15rem; font-weight: 600; color: #374151; margin: 0 0 8px; }
    .pa-title { font-size: 1rem; font-weight: 600; color: #4b5563; margin: 28px 0 8px; }
    .hint { color: #6b7280; font-size: .9rem; margin: 0 0 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Proof Animation — examples</h1>
    <p class="hint">Click any step (0,1,2,…) to jump there — the morph runs between
    the current state and the one you pick. Toggle “sequential” to stagger the moves.</p>
    <div id="root"></div>
  </div>
  <script type="module">
    import { ProofAnimator } from "./proof-animation.js";
    (async () => {
      for (let i = 0; i < 100 && !window.katex; i++)
        await new Promise(r => setTimeout(r, 30));
      const list = await (await fetch("./animations.json")).json();
      const root = document.getElementById("root");
      window.animators = list.map((data) => {
        const h = document.createElement("h2");
        h.className = "pa-title";
        h.textContent = data.title || "derivation";
        const div = document.createElement("div");
        root.appendChild(h);
        root.appendChild(div);
        return new ProofAnimator(div, data, { katex: window.katex });
      });
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
        with open(args.from_json, encoding="utf-8") as fh:
            traj = ProofTrajectory.model_validate_json(fh.read())
        animations = [build(traj, args.domain, args.title or "derivation")]
    elif args.states:
        traj = ProofTrajectory(
            start_latex=args.states[0],
            steps=[DerivationStep(step=i, operation=f"step {i}", expr_latex=s,
                                  justification="(manual)")
                   for i, s in enumerate(args.states[1:], start=1)],
        )
        animations = [build(traj, args.domain, args.title)]
    else:  # default: render all the demo samples (typed ProofAnimation objects)
        animations = [build(s.trajectory, s.domain, s.title) for s in SAMPLES]

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "animations.json").write_text(json.dumps(animations, indent=2, ensure_ascii=False))
    shutil.copy(_ASSETS / "proof-animation.js", out / "proof-animation.js")
    shutil.copy(_ASSETS / "proof-animation.css", out / "proof-animation.css")
    # cache-bust the engine on every (re)generation so a reload never serves a
    # stale module (browsers cache ES modules aggressively).
    ver = str(int((out / "proof-animation.js").stat().st_mtime))
    html = (_INDEX
            .replace("./proof-animation.js", f"./proof-animation.js?v={ver}")
            .replace("./proof-animation.css", f"./proof-animation.css?v={ver}"))
    (out / "index.html").write_text(html)
    print(f"wrote {out}/  ({len(animations)} animation(s), v={ver})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
