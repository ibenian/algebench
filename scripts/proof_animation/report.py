#!/usr/bin/env python3
"""Generate a self-contained proof-animation page (for the local launcher).

Mirrors semantic_graph_report.py: builds the animation data, copies the engine
JS/CSS, and writes an index.html into an output dir that ``serve.sh`` then serves
with ``python3 -m http.server``. The page loads KaTeX from CDN, imports the
engine, fetches animation.json, and instantiates ProofAnimator.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

from proof_animation.build import build, build_animation, ProofAnimation
from backend.experts.modules.proof_completion.outputs import ProofTrajectory, DerivationStep
from backend.experts.modules.proof_completion.wellformed import assert_well_formed
from backend.experts.llm_config import configure_dspy, is_configured
from backend.experts.handlers.proof_animation.term_descriptions import describe_terms

_LM_READY: bool | None = None


def _ensure_lm() -> bool:
    """Configure dspy once, best-effort. Returns False (and the report renders with
    highlights but no tooltip text) when no LM key is available — e.g. in CI."""
    global _LM_READY
    if _LM_READY is None:
        try:
            configure_dspy()
            _LM_READY = is_configured()
        except Exception:
            _LM_READY = False
    return _LM_READY


def _describe_terms(anim: dict) -> dict:
    """Fill in per-term tooltip descriptions on a built animation, in place.

    ``build()`` collects ``terms`` (id → {latex, name}) but doesn't describe them —
    that's an LM pass. Do it here so the standalone report's tooltips have content
    when an LM is configured; without one (e.g. CI), terms stay description-less and
    the page still shows the hover highlight, just no tooltip text."""
    terms = anim.get("terms")
    if terms and _ensure_lm():
        try:
            for tid, desc in describe_terms(terms, anim.get("domain") or "", "").items():
                if tid in terms and desc:
                    terms[tid]["description"] = desc
        except Exception:
            # Best-effort — the report still renders highlights without tooltip
            # text — but make the failure discoverable, not silent.
            log.warning("proof report: term-description pass failed for %r",
                        anim.get("title"), exc_info=True)
    return anim

_ROOT = Path(__file__).resolve().parent.parent.parent   # scripts/proof_animation/report.py → repo root
_ASSETS = _ROOT / "static" / "proof-animation"
# The curated test suite: a list of ProofAnimation objects we keep growing. The
# report renders these by default (and CI deploys them — see proof-animation.yml).
_FIXTURES = _ROOT / "tests" / "proof_animation" / "proof_animations.json"


def _animations_from_file(path: Path, domain: str) -> list[dict]:
    """Load a proofs JSON (list of ProofAnimation) and build each into animation data."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [_describe_terms(build_animation(ProofAnimation.model_validate(d))) for d in data]

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
    /* Match the proof container, which follows prefers-color-scheme: in dark mode
       the panels go dark (#1a1a2e), so the page sits a touch darker behind them. */
    @media (prefers-color-scheme: dark) {
      body { background: #12121c; color: #e5e7eb; }
      h1 { color: #cbd5e1; }
      .pa-title { color: #cbd5e1; }
      .hint { color: #9ca3af; }
    }
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
        // liveTerms (no graph host here): each term gets the hover backlight + a
        // description tooltip. The app layers graph sync on top via SgProofManager.
        return new ProofAnimator(div, data, { katex: window.katex, liveTerms: true });
      });
    })();
  </script>
</body>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("states", nargs="*", help="raw LaTeX states (a one-off derivation chain)")
    ap.add_argument("--domain", default="algebra")
    ap.add_argument("--title", default="")
    ap.add_argument("--from-file", default=None,
                    help="a proofs JSON (list of ProofAnimation) — the test suite to render "
                         f"(default: {_FIXTURES})")
    ap.add_argument("--from-json", default=None,
                    help="a single ProofTrajectory (JSON) to animate")
    ap.add_argument("--outdir", default="/tmp/proof_anim")
    args = ap.parse_args()

    if args.from_file:
        animations = _animations_from_file(Path(args.from_file), args.domain)
    elif args.from_json:
        with open(args.from_json, encoding="utf-8") as fh:
            traj = ProofTrajectory.model_validate_json(fh.read())
        # Hard edge (issue #372 §A): a hand-authored trajectory has no refinement
        # loop behind it, so malformed captions are an error here, not a low score.
        assert_well_formed(traj)
        animations = [_describe_terms(build(traj, args.domain, args.title or "derivation"))]
    elif args.states:
        traj = ProofTrajectory(
            start_latex=args.states[0],
            # ad-hoc chains carry no per-step claim; "rewrite" is the common
            # case (a non-rewrite step simply ranks Verified instead of Proven)
            steps=[DerivationStep(operation=f"step {i}", expr_latex=s,
                                  justification="(manual)", change_type="rewrite")
                   for i, s in enumerate(args.states[1:], start=1)],
        )
        animations = [_describe_terms(build(traj, args.domain, args.title))]
    elif _FIXTURES.exists():       # default: render the curated test suite
        animations = _animations_from_file(_FIXTURES, args.domain)
    else:
        ap.error(f"no proofs to render: pass --from-file/--from-json/states, or create {_FIXTURES}")

    out = render_site(animations, args.outdir)
    print(f"wrote {out}/  ({len(animations)} animation(s))")
    return 0


def render_site(animations: list[dict], outdir) -> Path:
    """Write a self-contained proof-animation page (index.html + data + engine).

    Reusable by other scripts (e.g. derive.py --render). ``animations``
    is a list of built animation dicts (as ``build()`` returns).
    """
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "animations.json").write_text(
        json.dumps(animations, indent=2, ensure_ascii=False), encoding="utf-8")
    shutil.copy(_ASSETS / "proof-animation.js", out / "proof-animation.js")
    shutil.copy(_ASSETS / "proof-animation.css", out / "proof-animation.css")
    # cache-bust the engine on every (re)generation so a reload never serves a
    # stale module (browsers cache ES modules aggressively).
    ver = str(int((out / "proof-animation.js").stat().st_mtime))
    html = (_INDEX
            .replace("./proof-animation.js", f"./proof-animation.js?v={ver}")
            .replace("./proof-animation.css", f"./proof-animation.css?v={ver}"))
    (out / "index.html").write_text(html, encoding="utf-8")
    return out


if __name__ == "__main__":
    raise SystemExit(main())
