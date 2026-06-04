#!/usr/bin/env python3
"""Generate a sympy-grounded dataset for the ProofCompletionExpert.

Each example is a real algebraic transformation (start graph → target graph)
with a self-consistent gold trajectory of atomic graph edits. No LLM is used —
sympy is the ground truth.

Usage:
    ./run.sh scripts/proof_completion_generate.py --n 200 --seed 1 \\
        --out data/proof_completion/train.jsonl
    ./run.sh scripts/proof_completion_generate.py --n 60 --seed 2 \\
        --out data/proof_completion/eval.jsonl
"""

from __future__ import annotations

import argparse
import os
import statistics
from collections import Counter

from backend.experts.proof_completion import dataset as D
from backend.experts.proof_completion.graph_ops import apply, canonical_equal
from backend.experts.proof_completion.grounding import is_grounded, step_groundings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=200, help="number of examples")
    ap.add_argument("--seed", type=int, default=1, help="random seed (train/eval differ)")
    ap.add_argument("--max-steps", type=int, default=1, help="rewrites per chain")
    ap.add_argument("--max-ops", type=int, default=40, help="reject larger trajectories")
    ap.add_argument("--domains", nargs="*", default=None,
                    help="subset of: algebra rational calculus")
    ap.add_argument("--out", required=True, help="output .jsonl path")
    args = ap.parse_args()

    exs = D.generate(args.n, args.seed, domains=args.domains,
                     max_steps=args.max_steps, max_ops=args.max_ops)
    if not exs:
        print("no examples generated", flush=True)
        return 1

    # (1) trajectory consistency: start + gold ops == target (canonically)
    bad = sum(
        0 if canonical_equal(apply(e.context.start, e.gold_ops), e.context.target) else 1
        for e in exs
    )
    # (2) grounding: each graph -> sympy aligns with the source sympy expression
    g_start = sum(1 for e in exs if is_grounded(e.context.start, e.start_expr) is True)
    g_target = sum(1 for e in exs if is_grounded(e.context.target, e.target_expr) is True)
    # (3) per-step grounding: every waypoint of every gold trajectory grounds
    step_ok = step_total = 0
    for e in exs:
        sg = step_groundings(e.context.start, e.gold_ops, e.step_exprs)
        step_ok += sum(1 for s in sg if s is True)
        step_total += len(sg)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    D.save_jsonl(exs, args.out)

    lens = [len(e.gold_ops) for e in exs]
    print(f"wrote {len(exs)} examples -> {args.out}")
    print(f"  trajectory-consistent (start+gold==target): {len(exs) - bad}/{len(exs)}")
    print(f"  grounded to sympy:  start {g_start}/{len(exs)}  target {g_target}/{len(exs)}")
    print(f"  per-step grounded (every waypoint): {step_ok}/{step_total}")
    print(f"  chain steps (n_steps): {dict(sorted(Counter(e.n_steps for e in exs).items()))}")
    print(f"  by domain: {dict(Counter(e.context.domain for e in exs))}")
    print(f"  gold ops: min {min(lens)} median {int(statistics.median(lens))} "
          f"mean {statistics.mean(lens):.1f} max {max(lens)}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
