#!/usr/bin/env python3
"""Evaluate the ProofCompletionExpert on a held-out sympy dataset.

Reports the hard exact-match rate plus component metrics (structural coverage,
op-level F1) overall and broken down by domain and chain length. Run it on the
uncompiled expert for a baseline, and again with ``--program <artifact>`` after
optimization to measure the lift.

Usage:
    ./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl
    ./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl \\
        --program backend/experts/modules/proof_completion/artifacts/proof_completion.json
"""

from __future__ import annotations

import argparse
import os
from collections import defaultdict

from _pc_env import load_env_local, predict_all

load_env_local()

from backend.experts import init_experts  # noqa: E402
from backend.experts.modules.proof_completion import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion import dataset as D  # noqa: E402
from backend.experts.modules.proof_completion.metric import extract_ops, score_components  # noqa: E402


def _agg(rows: list[dict]) -> dict:
    if not rows:
        return {}
    keys = ("exact", "coverage", "op_f1", "step_grounded")
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
            f"op_f1 {d['op_f1']:.2f}  grounded {g}  "
            f"step_grounded {d['step_grounded']:.2f}  (n={d['n']})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="eval .jsonl")
    ap.add_argument("--program", default=None, help="compiled artifact to load")
    ap.add_argument("--baseline", action="store_true",
                    help="force the uncompiled model (ignore the default artifact)")
    ap.add_argument("--limit", type=int, default=None, help="cap examples")
    ap.add_argument("--tag", default=None, help="label this run in the results log")
    ap.add_argument("--results-log", default=None,
                    help="append a one-line JSON summary to this file")
    ap.add_argument("--per-example-log", default=None,
                    help="write one JSON record per example (predicted vs gold on failures)")
    args = ap.parse_args()

    init_experts()  # configures the DSPy LM + discovers registrations
    data = D.load_jsonl(args.data)
    if args.limit:
        data = data[: args.limit]

    prog = ProofCompletionExpert(artifact=args.program,
                                 load_default=not args.baseline)
    print(f"evaluating {len(data)} examples "
          f"(model: {prog.loaded_artifact or 'baseline (uncompiled)'})")
    preds = predict_all(prog, data, label="eval")

    rows = [score_components(ex, pred) for ex, pred in zip(data, preds)]
    for ex, r in zip(data, rows):
        r["domain"] = ex.context.domain
        r["n_steps"] = getattr(ex, "n_steps", None)

    overall = _agg(rows)
    print("\n=== OVERALL ===")
    print(" ", _fmt(overall))

    if args.results_log:
        import json
        rec = {
            "tag": args.tag or ("compiled" if args.program else "baseline"),
            "program": args.program,
            "n": overall["n"],
            "exact": round(overall["exact"], 4),
            "coverage": round(overall["coverage"], 4),
            "op_f1": round(overall["op_f1"], 4),
            "grounded": None if overall.get("grounded") is None else round(overall["grounded"], 4),
            "step_grounded": round(overall["step_grounded"], 4),
        }
        os.makedirs(os.path.dirname(args.results_log) or ".", exist_ok=True)
        with open(args.results_log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        print(f"  logged -> {args.results_log} (tag={rec['tag']})")

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

    # ----- per-example records + failure reporting -----
    def _reasons(r: dict) -> list:
        out = []
        if r["exact"] < 1.0:
            out.append("endpoint")          # didn't reach the target graph
        if r["step_grounded"] < 1.0:
            out.append("intermediate")      # some waypoint isn't valid math
        if r.get("groundable", 0.0) == 1.0 and r["grounded"] < 1.0:
            out.append("wrong_math")        # final graph grounds, but to the wrong thing
        if r["n_failed_ops"] > 0:
            out.append("illegal_ops")       # some op couldn't be applied
        return out

    records = []
    for i, (ex, pred, r) in enumerate(zip(data, preds, rows)):
        reasons = _reasons(r)
        rec = {
            "i": i, "domain": r["domain"], "intent": ex.context.intent,
            "n_steps": r["n_steps"],
            "exact": r["exact"], "coverage": round(r["coverage"], 3),
            "op_f1": round(r["op_f1"], 3), "grounded": r["grounded"],
            "step_grounded": round(r["step_grounded"], 3),
            "n_pred_ops": r["n_pred_ops"], "n_gold_ops": r["n_gold_ops"],
            "n_failed_ops": r["n_failed_ops"], "fail_reasons": reasons,
            "start_expr": ex.start_expr, "target_expr": ex.target_expr,
        }
        if reasons:  # attach trajectories only for failures, to keep files small
            rec["pred_ops"] = [op.model_dump(by_alias=True, exclude_none=True)
                               for op in extract_ops(pred)]
            rec["gold_ops"] = [op.model_dump(by_alias=True, exclude_none=True)
                               for op in ex.gold_ops]
        records.append(rec)

    failures = [r for r in records if r["fail_reasons"]]
    print(f"\n=== FAILURES: {len(failures)}/{len(records)} ===")
    for rec in failures[:25]:
        print(f"  [{rec['domain']:16}] {rec['intent'][:38]:38} steps={rec['n_steps']} "
              f"reasons={','.join(rec['fail_reasons'])}  "
              f"({rec['start_expr']} -> {rec['target_expr']})")
    if len(failures) > 25:
        print(f"  ... and {len(failures) - 25} more")

    if args.per_example_log:
        import json
        os.makedirs(os.path.dirname(args.per_example_log) or ".", exist_ok=True)
        with open(args.per_example_log, "w", encoding="utf-8") as fh:
            for rec in records:
                fh.write(json.dumps(rec) + "\n")
        print(f"  per-example records -> {args.per_example_log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
