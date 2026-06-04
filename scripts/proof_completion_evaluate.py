#!/usr/bin/env python3
"""Evaluate the ProofCompletionExpert on a held-out sympy dataset.

Reports the hard exact-match rate plus component metrics (structural coverage,
op-level F1) overall and broken down by domain and chain length. Run it on the
uncompiled expert for a baseline, and again with ``--program <artifact>`` after
optimization to measure the lift.

Usage:
    ./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl
    ./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl \\
        --program backend/experts/artifacts/proof_completion.json
"""

from __future__ import annotations

import argparse
from collections import defaultdict

from _pc_env import load_env_local, predict_all

load_env_local()

from backend.experts import init_experts  # noqa: E402
from backend.experts.modules.proof_completion import ProofCompletionExpert  # noqa: E402
from backend.experts.proof_completion import dataset as D  # noqa: E402
from backend.experts.proof_completion.metric import score_components  # noqa: E402


def _agg(rows: list[dict]) -> dict:
    if not rows:
        return {}
    keys = ("exact", "coverage", "op_f1")
    out = {k: sum(r[k] for r in rows) / len(rows) for k in keys}
    # grounding rate is over the groundable subset
    groundable = [r for r in rows if r.get("groundable", 0.0) == 1.0]
    out["grounded"] = (sum(r["grounded"] for r in groundable) / len(groundable)
                       if groundable else None)
    out["pct_groundable"] = sum(r.get("groundable", 0.0) for r in rows) / len(rows)
    out["n"] = len(rows)
    return out


def _fmt(d: dict) -> str:
    if not d:
        return "(none)"
    g = "n/a" if d.get("grounded") is None else f"{d['grounded']:.2f}"
    return (f"exact {d['exact']:.2f}  coverage {d['coverage']:.2f}  "
            f"op_f1 {d['op_f1']:.2f}  grounded {g}  (n={d['n']})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="eval .jsonl")
    ap.add_argument("--program", default=None, help="compiled artifact to load")
    ap.add_argument("--limit", type=int, default=None, help="cap examples")
    args = ap.parse_args()

    init_experts()  # configures the DSPy LM + discovers registrations
    data = D.load_jsonl(args.data)
    if args.limit:
        data = data[: args.limit]
    print(f"evaluating {len(data)} examples "
          f"({'compiled: ' + args.program if args.program else 'baseline (uncompiled)'})")

    prog = ProofCompletionExpert(artifact=args.program)
    preds = predict_all(prog, data, label="eval")

    rows = [score_components(ex, pred) for ex, pred in zip(data, preds)]
    for ex, r in zip(data, rows):
        r["domain"] = ex.context.domain
        r["n_steps"] = getattr(ex, "n_steps", None)

    print("\n=== OVERALL ===")
    print(" ", _fmt(_agg(rows)))

    by_domain = defaultdict(list)
    for r in rows:
        by_domain[r["domain"]].append(r)
    print("\n=== BY DOMAIN ===")
    for dom in sorted(by_domain):
        print(f"  {dom:10} {_fmt(_agg(by_domain[dom]))}")

    by_steps = defaultdict(list)
    for r in rows:
        by_steps[r["n_steps"]].append(r)
    print("\n=== BY CHAIN LENGTH ===")
    for s in sorted(by_steps, key=lambda v: (v is None, v)):
        print(f"  steps={s}  {_fmt(_agg(by_steps[s]))}")

    avg_pred = sum(r["n_pred_ops"] for r in rows) / len(rows)
    avg_gold = sum(r["n_gold_ops"] for r in rows) / len(rows)
    avg_fail = sum(r["n_failed_ops"] for r in rows) / len(rows)
    print(f"\nops: avg predicted {avg_pred:.1f}  avg gold {avg_gold:.1f}  "
          f"avg failed-to-apply {avg_fail:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
