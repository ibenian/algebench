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
import re
import shutil
import sys
from pathlib import Path

log = logging.getLogger(__name__)

from proof_animation.build import build_animation, build_described, ProofAnimation
from backend.experts.modules.proof_completion.outputs import ProofTrajectory, DerivationStep
from backend.experts.modules.proof_completion.wellformed import assert_well_formed
from backend.experts.llm_config import configure_dspy, is_configured
from backend.experts.modules.proof_completion.domain_rescue import RESCUE_ENABLED
from backend.experts.modules.proof_completion.judge import DomainStepJudge

_LM_READY: bool | None = None
_DOMAIN_RESCUE = True   # toggled off by --no-domain-rescue
_JUDGE = None           # lazily constructed DomainStepJudge


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


def _judge():
    """The shared DomainStepJudge, or None when the rescue is off / no LM.

    Default-on so offline-built built-ins match the live server, which always
    rescues CAS-uncheckable steps into the DOMAIN tier. Mirrors the handler's
    gate (RESCUE_ENABLED + is_configured); ``--no-domain-rescue`` forces it off."""
    global _JUDGE
    if not (_DOMAIN_RESCUE and RESCUE_ENABLED and _ensure_lm()):
        return None
    if _JUDGE is None:
        _JUDGE = DomainStepJudge()
    return _JUDGE



_ROOT = Path(__file__).resolve().parent.parent.parent   # scripts/proof_animation/report.py → repo root
_ASSETS = _ROOT / "static" / "proof-animation"
# Built-in shareable proofs live here; the /renderproof page loads them by
# ?builtin=<domain>/<name>. See docs/shareable-proof-animations.md.
_PROOFS_DIR = _ROOT / "proofs" / "domains"
_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$")


def _save_builtin(anim: dict, slug: str) -> Path:
    """Write one built animation dict to proofs/domains/<domain>/<name>.json.

    ``slug`` is ``<domain>/<name>`` and is validated against the same regex the
    /renderproof page and the server route enforce, so a generated file is always
    reachable by ``?builtin=<slug>`` and never escapes the proofs dir."""
    if not _SLUG_RE.match(slug):
        raise ValueError(
            f"--save-builtin must be <domain>/<name> matching {_SLUG_RE.pattern!r}, got {slug!r}")
    domain, name = slug.split("/", 1)
    out = _PROOFS_DIR / domain / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(anim, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out
# The curated test suite: a list of ProofAnimation objects we keep growing. The
# report renders these by default (and CI deploys them — see proof-animation.yml).
_FIXTURES = _ROOT / "tests" / "proof_animation" / "proof_animations.json"


def _animations_from_file(path: Path, domain: str) -> list[dict]:
    """Load the proof-animation suite and return renderable animation dicts.

    The committed suite is stored as **final built animations** (the same
    self-contained shape as ``proofs/domains/*.json`` built-ins: ``steps`` with
    annotated ``latex`` + per-term ``terms`` incl. descriptions + confidence). So
    rendering just returns them verbatim — no build, no LM, reproducible in CI.

    A raw ``ProofTrajectory`` entry (no ``steps`` — e.g. one freshly pasted from
    ``derive.py``) is still built on the fly so the suite can be previewed before
    it's re-persisted; that path uses the LM when a key is present."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for d in data:
        if "steps" in d:                      # already a built animation → render as-is
            out.append(d)
        else:                                  # a raw ProofAnimation/trajectory → build it
            out.append(build_animation(ProofAnimation.model_validate(d),
                                       judge=_judge()))
    return out


def _reanimate_from_built(d: dict) -> ProofAnimation:
    """Reconstruct the source ``ProofAnimation`` from a built animation dict.

    A built step keeps its ``input_latex`` (the expression the model wrote), so the
    trajectory is fully recoverable — the render (``latex``/``plain``), grounding,
    and descriptions are then regenerated by ``--rebuild-suite``."""
    steps = d["steps"]
    start, rest = steps[0], steps[1:]
    traj = {
        "kind": "proof_trajectory",
        "start_latex": start["input_latex"],
        "target_latex": (rest[-1] if rest else start)["input_latex"],
        "steps": [{"operation": s["operation"], "expr_latex": s["input_latex"],
                   "justification": s["justification"], "change_type": "rewrite"}
                  for s in rest],
        "goal": d.get("goal"),
        "followups": d.get("followups") or [],
        "prerequisites": d.get("prerequisites") or [],
    }
    return ProofAnimation(
        title=d["title"], domain=d.get("domain", "algebra"),
        start_operation=start.get("operation", "Start"),
        start_justification=start.get("justification", "the starting expression"),
        trajectory=ProofTrajectory.model_validate(traj))


def _rebuild_suite(path: Path) -> int:
    """Regenerate *path* in place as final built animations (render + descriptions).

    The suite's analog of ``--save-builtin``: run once locally (needs a key) after
    a proof/renderer change so the committed file stays the ready-to-render form
    CI serves without any module calls."""
    if not _ensure_lm():
        print("--rebuild-suite needs an LM key (GEMINI_API_KEY / GOOGLE_API_KEY).",
              file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    judge = _judge()
    built = []
    for d in data:
        anim = _reanimate_from_built(d) if "steps" in d else ProofAnimation.model_validate(d)
        built.append(build_animation(anim, judge=judge, describe=True))
    path.write_text(json.dumps(built, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"rebuilt {len(built)} proofs → {path}")
    return 0


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
        return new ProofAnimator(div, data, { katex: window.katex, liveTerms: true, enableExplore: true });
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
    ap.add_argument("--save-builtin", default=None, metavar="DOMAIN/NAME",
                    help="instead of rendering a /tmp site, save the single built animation as a "
                         "shareable built-in proof at proofs/domains/<domain>/<name>.json "
                         "(reachable via /renderproof?builtin=<domain>/<name>)")
    ap.add_argument("--no-domain-rescue", action="store_true",
                    help="disable the DOMAIN-tier rescue of CAS-uncheckable steps. By default "
                         "(when an LM is configured) the rescue runs so built-ins match the live "
                         "server; pass this to get pure-CAS confidence instead.")
    ap.add_argument("--rebuild-suite", action="store_true",
                    help="regenerate the --from-file suite in place as final built animations "
                         "(render + LM descriptions), then exit. Needs GEMINI_API_KEY. Run after "
                         "a proof/renderer change so CI can render the file with no module calls.")
    args = ap.parse_args()

    global _DOMAIN_RESCUE
    _DOMAIN_RESCUE = not args.no_domain_rescue

    if args.rebuild_suite:
        return _rebuild_suite(Path(args.from_file) if args.from_file else _FIXTURES)

    if args.from_file:
        animations = _animations_from_file(Path(args.from_file), args.domain)
    elif args.from_json:
        with open(args.from_json, encoding="utf-8") as fh:
            traj = ProofTrajectory.model_validate_json(fh.read())
        # Hard edge (issue #372 §A): a hand-authored trajectory has no refinement
        # loop behind it, so malformed captions are an error here, not a low score.
        assert_well_formed(traj)
        animations = [build_described(traj, args.domain, args.title or "derivation",
                                      judge=_judge(),
                                      lesson_context=f"{args.title or 'derivation'} (domain: {args.domain})")]
    elif args.states:
        traj = ProofTrajectory(
            start_latex=args.states[0],
            # ad-hoc chains carry no per-step claim; "rewrite" is the common
            # case (a non-rewrite step simply ranks Verified instead of Proven)
            steps=[DerivationStep(operation=f"step {i}", expr_latex=s,
                                  justification="(manual)", change_type="rewrite")
                   for i, s in enumerate(args.states[1:], start=1)],
        )
        animations = [build_described(traj, args.domain, args.title,
                                      judge=_judge(),
                                      lesson_context=f"{args.title} (domain: {args.domain})")]
    elif _FIXTURES.exists():       # default: render the curated test suite
        animations = _animations_from_file(_FIXTURES, args.domain)
    else:
        ap.error(f"no proofs to render: pass --from-file/--from-json/states, or create {_FIXTURES}")

    if args.save_builtin:
        # A built-in proof is exactly one self-contained animation dict. When the
        # input produced several (e.g. the default fixture suite), require the
        # caller to narrow it down — saving an ambiguous bundle would be a footgun.
        if len(animations) != 1:
            ap.error(f"--save-builtin needs exactly one proof, got {len(animations)}; "
                     "pass --from-json/states (or a single-entry --from-file)")
        out = _save_builtin(animations[0], args.save_builtin)
        print(f"saved built-in proof → {out}  (/renderproof?builtin={args.save_builtin})")
        return 0

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
