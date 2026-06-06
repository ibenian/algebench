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
    # append a freshly derived proof to the test suite
    ./run.sh scripts/proof_animation_derive.py "x^2 - 4 = 0" "x = 2" \\
        --title "Solve x^2 = 4" --append tests/proof_animation/proofs.json

    # one-off: print the ProofAnimation JSON (or write it with --out)
    ./run.sh scripts/proof_animation_derive.py "\\frac{d}{dx} x^2" "2 x" --title "Differentiate x^2"
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from _pc_env import load_env_local

load_env_local()

from backend.experts import init_experts  # noqa: E402
from proof_completion_derive import derive_trajectory  # noqa: E402  (sibling script)
from proof_animation_build import ProofAnimation  # noqa: E402  (sibling script)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("start", help="starting LaTeX expression")
    ap.add_argument("target", help="target LaTeX expression")
    ap.add_argument("--title", required=True, help="display title for the animation")
    ap.add_argument("--domain", default="algebra", help="parser domain (algebra, calculus, …)")
    ap.add_argument("--intent", default=None, help="what the derivation should accomplish")
    ap.add_argument("--program", default=None, help="optimized artifact to load")
    ap.add_argument("--baseline", action="store_true",
                    help="force the uncompiled model (ignore the default artifact)")
    ap.add_argument("--append", default=None,
                    help="proofs JSON (list of ProofAnimation) to append this animation to")
    ap.add_argument("--out", default=None, help="write the single ProofAnimation JSON here")
    args = ap.parse_args()

    init_experts()  # configure the DSPy LM
    try:
        traj = derive_trajectory(args.start, args.target, domain=args.domain,
                                 intent=args.intent, program=args.program,
                                 baseline=args.baseline)
    except ValueError as exc:
        print(exc)
        return 1
    if not traj.steps:
        print("the expert returned no steps.")
        return 1

    anim = ProofAnimation(title=args.title, domain=args.domain, trajectory=traj)

    if args.append:
        path = Path(args.append)
        existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        existing.append(anim.model_dump())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"appended '{args.title}' ({len(traj.steps)} step(s)) → {path}  "
              f"({len(existing)} proofs total)")
    elif args.out:
        Path(args.out).write_text(anim.model_dump_json(indent=2), encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(anim.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
