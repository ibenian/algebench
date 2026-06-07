#!/usr/bin/env python3
"""Derive a proof animation from a (start, target) prompt via the expert.

Runs the ProofCompletionExpert on a START → TARGET prompt, wraps the resulting
ProofTrajectory as a ProofAnimation (title + domain + trajectory), and prints it
(or writes it with --out) for review. To add it to the test suite, paste the JSON
into tests/proof_animation/proof_animations.json by hand once you're happy with it.

Needs GEMINI_API_KEY (LM inference, loaded from .env.local). Manual/local — this
is NOT run in CI; CI only renders the committed suite.

Usage:
    # explicit endpoints (precise): START TARGET
    ./run.sh scripts/proof_animation/derive.py "x^2 - 4 = 0" "x = 2" --title "Solve x^2 = 4"

    # single natural-language prompt (the model picks the endpoints)
    ./run.sh scripts/proof_animation/derive.py --prompt "derive Lorentz time dilation"

    # derive + preview in the browser (refresh a running serve)
    ./run.sh scripts/proof_animation/derive.py --prompt "expand (x+1)^2" --render
"""
from __future__ import annotations

import argparse
from pathlib import Path

from _pc_env import load_env_local

load_env_local()

import dspy  # noqa: E402

from backend.experts import init_experts  # noqa: E402
from proof_completion_derive import derive_trajectory  # noqa: E402  (top-level sibling)
from proof_animation.build import ProofAnimation  # noqa: E402


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
    start_note: str = dspy.OutputField(
        desc="one short line describing the starting expression / what is given "
             "(may use inline $…$ LaTeX)")


def _endpoints_from_prompt(prompt: str) -> tuple[str, str, str, str, str]:
    """LM-propose (start, target, domain, title, start_note) for a request."""
    ep = dspy.Predict(_ProofPromptSig)(prompt=prompt)
    return (ep.start_latex.strip(), ep.target_latex.strip(),
            (ep.domain or "").strip(), (ep.title or "").strip(),
            (ep.start_note or "").strip())


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
    ap.add_argument("--out", default=None, help="write the ProofAnimation JSON here (else print)")
    ap.add_argument("--render", action="store_true",
                    help="also render this proof to an HTML page (via the report generator) into --outdir")
    ap.add_argument("--outdir", default="/tmp/proof_anim",
                    help="output dir for --render (a running serve picks it up on refresh)")
    args = ap.parse_args()

    init_experts()  # configure the DSPy LM

    # Resolve the endpoints: from a prompt (LM picks them) or explicit START/TARGET.
    if args.prompt:
        start, target, lm_domain, lm_title, lm_note = _endpoints_from_prompt(args.prompt)
        if not (start and target):
            print("the model did not return both a start and a target expression.")
            return 1
        domain = args.domain or lm_domain or "algebra"
        title = args.title or lm_title or args.prompt
        start_justification = lm_note or "the starting expression"
        print(f"prompt → start : {start}")
        print(f"prompt → target: {target}")
        print(f"prompt → domain: {domain}   title: {title}")
    else:
        if not (args.start and args.target):
            ap.error("provide START and TARGET positional args, or use --prompt")
        start, target = args.start, args.target
        domain = args.domain or "algebra"
        title = args.title or f"{start} → {target}"
        start_justification = args.intent or "the starting expression"

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

    anim = ProofAnimation(title=title, domain=domain, trajectory=traj,
                          start_operation="Given", start_justification=start_justification)

    # Output the ProofAnimation JSON for review — paste it into the test suite
    # (tests/proof_animation/proof_animations.json) by hand once you're happy with it.
    if args.out:
        Path(args.out).write_text(anim.model_dump_json(indent=2), encoding="utf-8")
        print(f"wrote {args.out}")
    elif not args.render:
        print(anim.model_dump_json(indent=2))

    # --render: render this proof to an HTML page via the report generator so a
    # running serve / preview picks it up on refresh.
    if args.render:
        from proof_animation.build import build_animation
        from proof_animation.report import render_site
        out = render_site([build_animation(anim)], args.outdir)
        print(f"rendered → {out}/index.html  (serve {out} to view)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
