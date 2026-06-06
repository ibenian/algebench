#!/usr/bin/env python3
"""Derive a proof animation from a (start, target) prompt via the expert.

Runs the ProofCompletionExpert on a START → TARGET prompt, wraps the resulting
ProofTrajectory as a ProofAnimation (title + domain + trajectory), and either
prints it or **appends it to a proofs JSON file** — the test suite that
``proof_animation_report.py`` renders. This is how new proofs get added to the
suite when the user asks.

Needs GEMINI_API_KEY (LM inference, loaded from .env.local). Manual/local — this
is NOT run in CI; CI only renders the committed suite.

Usage:
    # explicit endpoints (precise): START TARGET
    ./run.sh scripts/proof_animation_derive.py "x^2 - 4 = 0" "x = 2" \\
        --title "Solve x^2 = 4" --append tests/proof_animation/proofs.json

    # single natural-language prompt (the model picks the endpoints)
    ./run.sh scripts/proof_animation_derive.py --prompt "derive Lorentz time dilation" \\
        --append tests/proof_animation/proofs.json

    # one-off: print the ProofAnimation JSON (or write it with --out)
    ./run.sh scripts/proof_animation_derive.py "\\frac{d}{dx} x^2" "2 x" --title "Differentiate x^2"
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from _pc_env import load_env_local

load_env_local()

import dspy  # noqa: E402

from backend.experts import init_experts  # noqa: E402
from proof_completion_derive import derive_trajectory  # noqa: E402  (sibling script)
from proof_animation_build import ProofAnimation  # noqa: E402  (sibling script)


class _ProofPromptSig(dspy.Signature):
    """Name the exact start and target expressions a short request asks to derive.

    Given a brief topic/request (e.g. "derive Lorentz time dilation"), output the
    canonical STARTING expression and the canonical TARGET (result) expression of
    that derivation, both as plain LaTeX, plus a math domain and a short title.
    Both expressions must be complete, valid, parseable LaTeX — the actual
    endpoints a textbook would prove between (not the intermediate steps).
    """

    prompt: str = dspy.InputField(desc="the request, e.g. 'derive Lorentz time dilation'")
    start_latex: str = dspy.OutputField(desc="canonical starting expression, as LaTeX")
    target_latex: str = dspy.OutputField(desc="canonical target/result expression, as LaTeX")
    domain: str = dspy.OutputField(desc="math domain: algebra, calculus, etc.")
    title: str = dspy.OutputField(desc="short display title for the derivation")


def _endpoints_from_prompt(prompt: str) -> tuple[str, str, str, str]:
    """LM-propose (start, target, domain, title) for a natural-language request."""
    ep = dspy.Predict(_ProofPromptSig)(prompt=prompt)
    return (ep.start_latex.strip(), ep.target_latex.strip(),
            (ep.domain or "").strip(), (ep.title or "").strip())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("start", nargs="?", help="starting LaTeX expression (omit with --prompt)")
    ap.add_argument("target", nargs="?", help="target LaTeX expression (omit with --prompt)")
    ap.add_argument("--prompt", default=None,
                    help="derive endpoints from a natural-language request, e.g. "
                         "'derive Lorentz time dilation' (the model picks start/target)")
    ap.add_argument("--title", default=None,
                    help="display title (defaults to the prompt, or START → TARGET)")
    ap.add_argument("--domain", default=None,
                    help="parser domain (algebra, calculus, …); with --prompt the model may pick it")
    ap.add_argument("--intent", default=None, help="what the derivation should accomplish")
    ap.add_argument("--program", default=None, help="optimized artifact to load")
    ap.add_argument("--baseline", action="store_true",
                    help="force the uncompiled model (ignore the default artifact)")
    ap.add_argument("--append", default=None,
                    help="proofs JSON (list of ProofAnimation) to append this animation to")
    ap.add_argument("--out", default=None, help="write the single ProofAnimation JSON here")
    ap.add_argument("--render", action="store_true",
                    help="also render an HTML page via the report generator into --outdir "
                         "(renders the whole suite when --append'ing, else just this proof)")
    ap.add_argument("--outdir", default="/tmp/proof_anim",
                    help="output dir for --render (a running serve_proof_animation.sh picks it up)")
    args = ap.parse_args()

    init_experts()  # configure the DSPy LM

    # Resolve the endpoints: from a prompt (LM picks them) or explicit START/TARGET.
    if args.prompt:
        start, target, lm_domain, lm_title = _endpoints_from_prompt(args.prompt)
        if not (start and target):
            print("the model did not return both a start and a target expression.")
            return 1
        domain = args.domain or lm_domain or "algebra"
        title = args.title or lm_title or args.prompt
        print(f"prompt → start : {start}")
        print(f"prompt → target: {target}")
        print(f"prompt → domain: {domain}   title: {title}")
    else:
        if not (args.start and args.target):
            ap.error("provide START and TARGET positional args, or use --prompt")
        start, target = args.start, args.target
        domain = args.domain or "algebra"
        title = args.title or f"{start} → {target}"

    try:
        traj = derive_trajectory(start, target, domain=domain,
                                 intent=args.intent, program=args.program,
                                 baseline=args.baseline)
    except ValueError as exc:
        print(exc)
        return 1
    if not traj.steps:
        print("the expert returned no steps.")
        return 1

    anim = ProofAnimation(title=title, domain=domain, trajectory=traj)

    if args.append:
        path = Path(args.append)
        existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        existing.append(anim.model_dump())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"appended '{title}' ({len(traj.steps)} step(s)) → {path}  "
              f"({len(existing)} proofs total)")
    elif args.out:
        Path(args.out).write_text(anim.model_dump_json(indent=2), encoding="utf-8")
        print(f"wrote {args.out}")
    elif not args.render:
        print(anim.model_dump_json(indent=2))

    # --render: regenerate the HTML page via the report generator so a running
    # serve_proof_animation.sh / preview picks it up on refresh. With --append we
    # render the whole updated suite (the new proof in context); else just this one.
    if args.render:
        from proof_animation_build import build
        from proof_animation_report import render_site, _animations_from_file
        if args.append:
            animations = _animations_from_file(Path(args.append), domain)
        else:
            animations = [build(traj, domain, title)]
        out = render_site(animations, args.outdir)
        print(f"rendered {len(animations)} animation(s) → {out}/index.html  "
              f"(serve {out} to view, e.g. ./scripts/serve_proof_animation.sh)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
