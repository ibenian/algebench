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
from backend.experts.handlers.proof_animation.animation import build
from backend.experts.handlers.proof_animation.finalize import apply_term_descriptions
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
    and descriptions are then regenerated by ``--rebuild-suite``. ``change_type`` is
    recovered from the step's graded ``confidence.relation`` — a ``narrows`` step is
    a ``solve`` (e.g. picking √ roots), everything else a ``rewrite`` — so a rebuild
    doesn't silently re-grade solve steps as equivalence rewrites."""
    def _change_type(step: dict) -> str:
        rel = (step.get("confidence") or {}).get("relation")
        return "solve" if rel == "narrows" else "rewrite"
    steps = d["steps"]
    start, rest = steps[0], steps[1:]
    traj = {
        "kind": "proof_trajectory",
        "start_latex": start["input_latex"],
        "target_latex": (rest[-1] if rest else start)["input_latex"],
        "steps": [{"operation": s["operation"], "expr_latex": s["input_latex"],
                   "justification": s["justification"], "change_type": _change_type(s)}
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
    CI serves directly, without the model."""
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


def _rerender_one(old: dict, label: str = "") -> dict:
    """Surgically re-render one built-animation dict IN PLACE, returning it.

    Re-threads the registry over each step's ``input_latex`` with the current
    parser/renderer so a stale bake — an integral step that couldn't parse when it
    was first baked, or the newly id-tagged ``\\int`` sign — gets fresh annotated
    ``latex``/``plain`` and cleaner stable ids. Everything the render doesn't own is
    preserved verbatim: every extra top-level field (e.g. ``deeplink``), each step's
    graded ``confidence`` (so no LM/judge is needed and no tier regresses), and
    existing per-term ``description``s. Newly-surfaced terms get prose from a
    TARGETED LM pass over ONLY those ids (needs a key; left blank otherwise — the
    hover highlight still works). Raises ``KeyError`` if ``old`` isn't built (no
    ``steps``)."""
    if "steps" not in old:
        raise KeyError("not a built animation (no 'steps')")
    anim = _reanimate_from_built(old)
    built = build(anim.trajectory, anim.domain, anim.title,
                  start_operation=anim.start_operation,
                  start_justification=anim.start_justification)
    old_steps = old["steps"]
    for i, s in enumerate(built["steps"]):
        if i < len(old_steps) and "confidence" in old_steps[i]:
            s["confidence"] = old_steps[i]["confidence"]     # keep graded tier
    old_terms = old.get("terms") or {}
    new_terms = built.get("terms") or {}
    # Re-threading can RENAME a term's id (that's partly the point of this flag),
    # which would orphan its description under the old id. So carry prose forward
    # by id first, then fall back to the term's latex — a stable identity that
    # survives an id rename — so a renamed term keeps its prose instead of eating
    # an avoidable LM re-description (and a needless diff).
    by_latex = {}
    for ot in old_terms.values():
        d = (ot.get("description") or "").strip()
        if d:
            by_latex.setdefault((ot.get("latex") or "").strip(), d)
    missing = []
    for tid, t in new_terms.items():
        desc = ((old_terms.get(tid) or {}).get("description")
                or by_latex.get((t.get("latex") or "").strip()))
        if desc:
            t["description"] = desc                           # keep existing prose
        else:
            missing.append(tid)
    if missing and _ensure_lm():
        apply_term_descriptions({"terms": {t: new_terms[t] for t in missing}},
                                anim.domain, f"{anim.title} (domain: {anim.domain})")
    still = [t for t in missing if not (new_terms[t].get("description") or "").strip()]
    # Mutate the ORIGINAL dict so every unowned top-level field is preserved.
    old["steps"], old["terms"] = built["steps"], new_terms
    old.setdefault("overall_confidence", built.get("overall_confidence"))
    n = len(missing) - len(still)
    print(f"  · re-rendered {label or anim.title}"
          + (f"  (+{n} new term(s) described)" if n else "")
          + (f"  ⚠ undescribed: {still}" if still else ""))
    return old


def _rerender_builtin(path: Path) -> bool:
    """Re-render a proof JSON in place — either a single built-in (a dict with
    ``steps``) or the suite fixture (a LIST of built animations). Returns False if
    the file is neither. See ``_rerender_one`` for the surgical semantics."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):                               # the suite fixture
        built = [e for e in data if isinstance(e, dict) and "steps" in e]
        if not built:
            return False
        print(f"re-rendering {len(built)} animation(s) in {path}")
        for e in built:
            _rerender_one(e, e.get("title", ""))
    elif isinstance(data, dict) and "steps" in data:         # a single built-in
        print(f"re-rendering {path}")
        _rerender_one(data)
    else:
        return False
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def _rerender_builtins(paths: list[str]) -> int:
    """Re-render each given proof JSON in place (see ``_rerender_builtin``).

    Returns non-zero if ANY path failed — a missing/unreadable file, or a JSON
    that is neither a built animation nor a suite list — so CI and scripts see
    failure as failure rather than a silent success."""
    if not paths:
        print("--rerender-builtins needs one or more proof JSON paths "
              "(a proofs/domains/<domain>/<name>.json built-in, or the suite fixture)",
              file=sys.stderr)
        return 1
    rc = 0
    for p in paths:
        try:
            if not _rerender_builtin(Path(p)):
                print(f"⚠ not a built animation or suite (no 'steps'), skipped: {p}", file=sys.stderr)
                rc = 1
        except Exception as e:                               # unreadable / bad JSON / build error
            print(f"✗ {p}: {type(e).__name__}: {e}", file=sys.stderr)
            rc = 1
    return rc


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
      // Where Explore/AI asks should open. This report is NOT the app — locally
      // it's an http.server on a different port than AlgeBench; anywhere else it's
      // a static host (GitHub Pages). So resolve the app explicitly: run LOCAL →
      // the local app on its canonical port 8785 (server.py DEFAULT_PORT); else →
      // STAGING. Never prod, and never the report's own origin.
      const host = location.hostname;   // IPv6 comes back bracket-less, e.g. "::1"
      const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
      const localHost = host.includes(":") ? "[" + host + "]" : host;   // bracket IPv6 for a valid origin
      const askOrigin = isLocal
        ? location.protocol + "//" + localHost + ":8785"
        : "https://algebench-staging.onrender.com";
      window.animators = list.map((data) => {
        const h = document.createElement("h2");
        h.className = "pa-title";
        h.textContent = data.title || "derivation";
        const div = document.createElement("div");
        root.appendChild(h);
        root.appendChild(div);
        // liveTerms (no graph host here): each term gets the hover backlight + a
        // description tooltip. The app layers graph sync on top via SgProofManager.
        // enableTermAsk: show the per-term "Ask AI" button; with no aiAskButton
        // factory (standalone report) it routes via _routeAsk → askOrigin, so the
        // ask opens in the resolved app (staging on Pages, local :8785 in dev).
        return new ProofAnimator(div, data, { katex: window.katex, liveTerms: true,
          enableExplore: true, enableTermAsk: true, askOrigin });
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
                         "a proof/renderer change so CI can render the file directly, without the model.")
    ap.add_argument("--rerender-builtins", nargs="*", metavar="PROOF.json", default=None,
                    help="re-render the given proof JSON file(s) in place with the current "
                         "parser/renderer, then exit — a single built-in (proofs/domains/<d>/<n>.json) "
                         "OR the suite fixture (a list). Surgical: refreshes annotated latex + stable "
                         "ids while preserving confidence, descriptions, and metadata (e.g. deeplink). "
                         "Run after a renderer change (an LM key fills any newly-surfaced term prose).")
    args = ap.parse_args()

    global _DOMAIN_RESCUE
    _DOMAIN_RESCUE = not args.no_domain_rescue

    if args.rerender_builtins is not None:
        return _rerender_builtins(args.rerender_builtins)

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
