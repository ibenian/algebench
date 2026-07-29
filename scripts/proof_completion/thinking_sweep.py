#!/usr/bin/env python3
r"""Benchmark ChainOfThought/Predict x thinking-budget for the derive expert (#510).

``ProofCompletionExpert`` is the last LM module still running
``dspy.ChainOfThought`` with Gemini's default (unbounded) thinking, and it has
never been measured. This sweeps the same 2x3 grid #509 used on the proof-edit
intent parser -- but the conclusion is NOT expected to transfer, because this
expert genuinely searches for a multi-step path rather than naming one move for
the CAS to perform. See docs/proposals/proof-completion/.

What is measured, and why it is measured this way:

* **The whole handler.** Timing wraps ``expert(...)``, so the refinement loop,
  its CAS grounding, and any adapter retries are all inside the number -- that
  is what a caller waiting on the Derive box actually experiences. Refinement
  runs at the SERVING default (``ALGEBENCH_PC_REFINE_ATTEMPTS``, normally 2),
  unlike ``evaluate.py`` which pins it to 1 to measure the raw predictor.
* **Serially.** ``evaluate.py`` fans out over 8 threads, which is fine for
  accuracy but destroys latency measurement (contention + provider rate
  limiting inflate per-call wall time). One call at a time here.
* **``cache=False``, per config.** A populated DSPy cache returned a cell in
  0.00 s in #509 and silently flattered the baseline by a third.
* **Accuracy on what this expert is for.** Not mechanical field checks: the
  endpoint match (did the trajectory reach the target graph), the per-state
  CAS tiers (refuted / unchecked / plausible / verified), and how often the
  refine loop had to retry. A configuration that is faster per call but burns
  a second attempt is not faster.

Usage:
    # screening pass over all five configurations
    ./run.sh scripts/proof_completion/thinking_sweep.py --n 12 \
        --out /tmp/pc_sweep/screen.json

    # repeat passes over the finalists (single samples do not separate configs)
    ./run.sh scripts/proof_completion/thinking_sweep.py --n 12 --passes 3 \
        --configs cot_default,predict_disable --out /tmp/pc_sweep/finalists.json
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict

from _pc_env import load_env_local  # noqa: E402

load_env_local()

import dspy  # noqa: E402

from backend.experts import init_experts  # noqa: E402
from backend.experts.llm_config import LM_MODEL  # noqa: E402
from backend.experts.modules.proof_completion import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion import dataset as D  # noqa: E402
from backend.experts.modules.proof_completion import module as pc_module  # noqa: E402
from backend.experts.modules.proof_completion.grounding_score import grounding_score  # noqa: E402
from backend.experts.modules.proof_completion.metric import extract_steps, score_components  # noqa: E402
from backend.experts.modules.proof_completion.signature import ProofCompletionSig  # noqa: E402
from backend.experts.modules.proof_completion.grounding import graph_to_sympy  # noqa: E402
from backend.experts.modules.proof_completion.model import GraphTransition  # noqa: E402
from backend.experts.modules.proof_completion.step_grounding import TIER_LABEL  # noqa: E402
from backend.semantic_graph.service import SemanticGraphService  # noqa: E402

# (predictor, reasoning_effort). ``None`` effort means "don't pass the
# parameter" -- Gemini's default, unbounded thinking. litellm maps the rest to a
# thinkingBudget: minimal->128, low->1024, medium->2048, high->4096,
# disable->0 with includeThoughts off.
CONFIGS: dict[str, tuple[str, str | None]] = {
    "cot_default": ("cot", None),          # SHIPPED
    "cot_disable": ("cot", "disable"),
    "predict_default": ("predict", None),
    "predict_disable": ("predict", "disable"),
    "predict_low": ("predict", "low"),
}


# --------------------------------------------------------------------------- #
# scenario selection
# --------------------------------------------------------------------------- #

def load_proofs(paths: list[str]) -> list:
    r"""Real saved derivations as scenarios -- the case #510 is actually about.

    ``eval.jsonl`` is machine-generated: one- to three-step algebraic rewrites
    that the model reaches in a single obvious move. That is the wrong shape for
    this question. The claim under test is that ``proof_completion`` "genuinely
    searches for a multi-step path", and only a real derivation (the quadratic
    formula in 9 steps, time dilation, particle-in-a-box) makes it do that. So
    the sweep runs BOTH tiers and reports them separately.

    Endpoints come from the proof's own first and last steps; there are no gold
    ops here, so ``op_f1`` is meaningless on these and is not reported. Endpoint
    match, per-transition CAS tiers, and the reward all still apply.
    """
    svc = SemanticGraphService()
    out = []
    for path in paths:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        steps = doc.get("steps") or []
        if len(steps) < 2:
            print(f"  skip {path}: fewer than 2 steps", file=sys.stderr)
            continue
        domain = doc.get("domain")

        def latex_of(step: dict) -> str:
            return str(step.get("input_latex") or step.get("plain") or "").strip()

        start_latex, target_latex = latex_of(steps[0]), latex_of(steps[-1])
        try:
            start, target = (svc.latex_to_graph(start_latex, domain=domain),
                             svc.latex_to_graph(target_latex, domain=domain))
        except Exception as exc:
            print(f"  skip {path}: endpoints did not parse ({exc})", file=sys.stderr)
            continue
        if start is None or target is None:
            print(f"  skip {path}: endpoints did not parse", file=sys.stderr)
            continue

        def sympy_str(graph):
            try:
                return str(graph_to_sympy(graph))
            except Exception:
                return None      # not sympy-convertible: `grounded` degrades to n/a

        title = str(doc.get("title") or os.path.basename(path)).strip()
        context = GraphTransition(start=start, target=target, domain=domain,
                                  intent=title[:400])
        goal = str(doc.get("goal") or "").strip()
        out.append(dspy.Example(
            context=context,
            context_id="root",
            lesson_context=goal,
            instruction=f"{title}: derive the target from the start.",
            gold_ops=[],
            domain=domain,
            n_steps=len(steps) - 1,          # transitions, matching the dataset
            start_expr=sympy_str(start),
            target_expr=sympy_str(target),
            source=os.path.basename(path),
        ).with_inputs("context", "context_id", "lesson_context", "instruction"))
    return out


def stratified(data: list, n: int) -> list:
    """Round-robin over domains, then chain length, so a small n stays broad.

    Deterministic: no RNG, so two runs of the sweep compare the same scenarios.
    A latency comparison across configurations is only meaningful on identical
    inputs, and the domains differ enormously in how hard they are to derive.
    """
    by_domain: dict = defaultdict(list)
    for i, ex in enumerate(data):
        by_domain[ex.context.domain].append((i, ex))
    for rows in by_domain.values():                 # harder chains first
        rows.sort(key=lambda r: (-(getattr(r[1], "n_steps", 0) or 0), r[0]))

    picked: list = []
    domains = sorted(by_domain)
    while len(picked) < n and any(by_domain[d] for d in domains):
        for d in domains:
            if by_domain[d] and len(picked) < n:
                picked.append(by_domain[d].pop(0))
    picked.sort(key=lambda r: r[0])                 # stable, source order
    return picked


# --------------------------------------------------------------------------- #
# one configuration
# --------------------------------------------------------------------------- #

def build_lm(effort: str | None) -> dspy.LM:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    kwargs = dict(api_key=api_key, temperature=0.7, max_tokens=32768, cache=False)
    if effort:
        kwargs["reasoning_effort"] = effort
    return dspy.LM(LM_MODEL, **kwargs)


def build_program(predictor: str) -> ProofCompletionExpert:
    """The serving expert, with the predictor swapped for ``predict`` configs.

    ``load_default=False`` forces the uncompiled baseline so a stray artifact
    cannot differ between configurations. Refinement is left at the serving
    default -- the loop is part of what we are timing.
    """
    prog = ProofCompletionExpert(load_default=False)
    if predictor == "predict":
        prog.predict = dspy.Predict(ProofCompletionSig)
    elif predictor != "cot":
        raise ValueError(f"unknown predictor {predictor!r}")
    return prog


def _reasoning_tokens(entry: dict) -> int:
    """Thinking tokens off a DSPy history entry, tolerating shape differences."""
    usage = entry.get("usage") or {}
    if not isinstance(usage, dict):
        usage = getattr(usage, "__dict__", {}) or {}
    details = usage.get("completion_tokens_details") or {}
    if not isinstance(details, dict):
        details = getattr(details, "__dict__", {}) or {}
    for key in ("reasoning_tokens", "thoughts_token_count"):
        val = details.get(key) or usage.get(key)
        if isinstance(val, (int, float)):
            return int(val)
    return 0


def run_cell(prog, lm, ex) -> dict:
    """One handler call: time it, score it, and record what the loop did."""
    captured: dict = {}
    orig_refine = pc_module.refine

    def spy(*args, **kwargs):
        outcome = orig_refine(*args, **kwargs)
        captured.update(attempts=outcome.attempts, passed=outcome.passed,
                        out_of_time=outcome.out_of_time,
                        reward=getattr(outcome.result, "score", None))
        return outcome

    pc_module.refine = spy
    before = len(lm.history)
    t0 = time.monotonic()
    error = None
    pred = None
    try:
        with dspy.context(lm=lm):
            pred = prog(context=ex.context, context_id=ex.context_id,
                        lesson_context=getattr(ex, "lesson_context", ""),
                        instruction=getattr(ex, "instruction", ""))
    except Exception as exc:                 # a failed derivation is a data point
        error = f"{type(exc).__name__}: {exc}"
    finally:
        elapsed = time.monotonic() - t0
        pc_module.refine = orig_refine

    new = lm.history[before:]
    rec = {
        "seconds": round(elapsed, 3),
        "error": error,
        "lm_calls": len(new),                # > attempts means adapter fallback
        "thinking_tokens": sum(_reasoning_tokens(e) for e in new),
        "refine_attempts": captured.get("attempts"),
        "refine_passed": captured.get("passed"),
        "refine_out_of_time": captured.get("out_of_time"),
        "reward": (None if captured.get("reward") is None
                   else round(captured["reward"], 4)),
    }

    steps = extract_steps(pred)
    rec["n_steps"] = len(steps)
    if pred is not None:
        comp = score_components(ex, pred)
        rec.update(exact=comp["exact"], coverage=round(comp["coverage"], 4),
                   step_grounded=round(comp["step_grounded"], 4),
                   grounded=comp["grounded"], groundable=comp["groundable"],
                   unconvertible=comp["n_failed_ops"])
        gs = grounding_score(ex.context.start, steps, ex.context.target,
                             domain=ex.context.domain)
        tiers = Counter(TIER_LABEL[p.tier].lower() for p in gs.report.pairs)
        rec["tiers"] = dict(tiers)
        rec["grounding"] = round(gs.score, 4)
    else:
        rec.update(exact=0.0, coverage=0.0, step_grounded=0.0, grounded=0.0,
                   groundable=0.0, unconvertible=0, tiers={}, grounding=0.0)
    return rec


# --------------------------------------------------------------------------- #
# aggregation + reporting
# --------------------------------------------------------------------------- #

def summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if r["error"] is None]
    secs = [r["seconds"] for r in rows]           # failures cost time too
    tiers: Counter = Counter()
    for r in rows:
        tiers.update(r.get("tiers") or {})
    n = len(rows) or 1
    return {
        "n": len(rows),
        "errors": len(rows) - len(ok),
        "mean_s": round(statistics.mean(secs), 2) if secs else 0.0,
        "median_s": round(statistics.median(secs), 2) if secs else 0.0,
        "max_s": round(max(secs), 2) if secs else 0.0,
        "sd_s": round(statistics.stdev(secs), 2) if len(secs) > 1 else 0.0,
        "total_s": round(sum(secs), 1),
        "exact": round(sum(r["exact"] for r in rows) / n, 3),
        "grounding": round(sum(r["grounding"] for r in rows) / n, 3),
        "step_grounded": round(sum(r["step_grounded"] for r in rows) / n, 3),
        "reward": round(statistics.mean([r["reward"] for r in rows
                                         if r["reward"] is not None] or [0.0]), 3),
        "retries": sum(1 for r in rows if (r["refine_attempts"] or 0) > 1),
        "lm_calls": sum(r["lm_calls"] for r in rows),
        "thinking": int(statistics.mean([r["thinking_tokens"] for r in rows] or [0])),
        "tiers": dict(tiers),
    }


_COLS = ("mean_s", "median_s", "max_s", "sd_s", "exact", "grounding",
         "step_grounded", "reward", "retries", "lm_calls", "thinking", "errors")


def print_table(summaries: dict[str, dict]) -> None:
    head = f"{'config':18}" + "".join(f"{c:>14}" for c in _COLS)
    print("\n" + head)
    print("-" * len(head))
    for name, s in summaries.items():
        print(f"{name:18}" + "".join(f"{s[c]:>14}" for c in _COLS))
    print("\ntier counts (per-transition CAS verdicts):")
    for name, s in summaries.items():
        parts = ", ".join(f"{k} {v}" for k, v in sorted(s["tiers"].items()))
        print(f"  {name:18} {parts or '(none)'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="data/proof_completion/eval.jsonl")
    ap.add_argument("--proofs", nargs="*", default=None,
                    help="saved proof JSONs to use INSTEAD of --data: real "
                         "multi-step derivations (the hard tier)")
    ap.add_argument("--n", type=int, default=12, help="scenarios per pass")
    ap.add_argument("--passes", type=int, default=1,
                    help="repeat passes; >1 is what separates configs on accuracy")
    ap.add_argument("--configs", default=",".join(CONFIGS),
                    help=f"comma-separated subset of: {', '.join(CONFIGS)}")
    ap.add_argument("--out", default=None, help="write per-call records here (JSON)")
    args = ap.parse_args()

    names = [c.strip() for c in args.configs.split(",") if c.strip()]
    unknown = [c for c in names if c not in CONFIGS]
    if unknown:
        print(f"unknown config(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    init_experts()
    if args.proofs:
        source = "proofs"
        data = load_proofs(args.proofs)
        if not data:
            print("no usable proof scenarios", file=sys.stderr)
            return 1
        picked = list(enumerate(data))[: args.n]
    else:
        source = args.data
        picked = stratified(D.load_jsonl(args.data), args.n)

    print(f"model {LM_MODEL} · source {source} · {len(picked)} scenarios × "
          f"{len(names)} configs × {args.passes} pass(es) = "
          f"{len(picked) * len(names) * args.passes} calls")
    print(f"refine_attempts={pc_module._REFINE_ATTEMPTS} "
          f"judge={pc_module._JUDGE_ENABLED} budget={pc_module._TIME_BUDGET}s")
    for i, ex in picked:
        label = getattr(ex, "source", None) or f"{ex.start_expr} -> {ex.target_expr}"
        print(f"  [{i:3}] {str(ex.context.domain):16} "
              f"steps={getattr(ex, 'n_steps', '?')} {label}")

    records: list[dict] = []
    for name in names:
        predictor, effort = CONFIGS[name]
        lm = build_lm(effort)
        prog = build_program(predictor)
        for p in range(args.passes):
            for i, ex in picked:
                rec = run_cell(prog, lm, ex)
                rec.update(config=name, predictor=predictor,
                           effort=effort or "default", pass_=p, example=i,
                           domain=ex.context.domain, intent=ex.context.intent)
                records.append(rec)
                flag = "ERR " if rec["error"] else ("" if rec["exact"] else "miss")
                print(f"  {name:18} p{p} [{i:3}] {rec['seconds']:6.1f}s  "
                      f"reward={rec['reward']}  att={rec['refine_attempts']}  "
                      f"think={rec['thinking_tokens']:5}  {flag}", flush=True)

    summaries = {n: summarize([r for r in records if r["config"] == n])
                 for n in names}
    print_table(summaries)

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"model": LM_MODEL, "source": source,
                       "n": args.n, "passes": args.passes,
                       "scenarios": [{"i": i, "domain": ex.context.domain,
                                      "intent": ex.context.intent,
                                      "n_steps": getattr(ex, "n_steps", None),
                                      "source": getattr(ex, "source", None),
                                      "start": ex.start_expr,
                                      "target": ex.target_expr}
                                     for i, ex in picked],
                       "summaries": summaries, "records": records}, fh, indent=2)
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
