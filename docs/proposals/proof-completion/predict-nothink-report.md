# Proof-Completion Expert — Predict / No-Thinking Report

*2026-07-28 · AlgeBench · issue #510 · branch `perf/510-proof-completion-thinking-benchmark` · model `gemini-2.5-flash`*

## 1. Executive summary

`ProofCompletionExpert` — the derive expert, and the slowest LM path in the app — was the last module still running `dspy.ChainOfThought` with Gemini's default unbounded thinking, and had never been measured.

It was benchmarked on **two tiers**: the machine-generated `eval.jsonl` rewrites (12 scenarios × 5 configurations) and, because those turned out not to exercise what this expert is for, **eight real saved derivations** (8 scenarios × 5 configurations, then 3 repeat passes over the two finalists) — 148 handler calls in total, `cache=False` throughout.

On the tier that matters, **bare `dspy.Predict` with thinking disabled runs at 7.81 s/call against the shipped 20.58 s**, with the worst case cut from **71.1 s to 16.2 s** — and endpoint accuracy, step-convertibility, and grounding are all within one or two calls in 32, in both directions.

**Configuration adopted:** `dspy.Predict(ProofCompletionSig)` + `reasoning_effort="disable"`, scoped to the generation call so the optional judge and domain rescue keep full reasoning.

### Why this is not just #509 again

[#509](../proof-edit/predict-nothink-report.md) closed with an explicit boundary condition, and this expert is the case it named:

> if the signature ever grows genuine derivation (finding a multi-step path rather than applying one named move), this measurement stops applying and thinking must return for that call.

That reasoning genuinely does not carry here. In proof-edit the CAS performed the mathematics and the LM only routed and named an op; here the model really does search for a multi-step path, and `ops.py` is nowhere in the loop. Deliberation had every opportunity to earn its keep. **It did not** — see §5, where the two configurations turn out to be *identical* on 7 of 8 real derivations.

## 2. What was being paid for

```
dspy.ChainOfThought(ProofCompletionSig)   ← an explicit `reasoning` output field
        +
Gemini default thinking                   ← internal thinking tokens, unbounded
```

The five configurations separate those two costs:

| config | module | `reasoning_effort` |
|---|---|---|
| `cot_default` | `ChainOfThought` | (default) — **was shipped** |
| `cot_disable` | `ChainOfThought` | `disable` |
| `predict_default` | `Predict` | (default) |
| `predict_disable` | `Predict` | `disable` — **adopted** |
| `predict_low` | `Predict` | `low` |

## 3. Method

Reused from #509, with three deliberate changes:

- **The whole handler is timed**, at the **serving** `refine_attempts` (2). This is the important departure from `scripts/proof_completion/evaluate.py`, which pins refinement to 1 to measure the raw predictor. A configuration that is faster per call but burns a second attempt is not faster, so the loop has to be inside the number.
- **Serially.** `evaluate.py` fans out over 8 threads — fine for accuracy, fatal for latency, since contention and provider rate limiting inflate per-call wall time.
- **`cache=False` on every LM.** Not optional: a populated DSPy cache returned a cell in 0.00 s in #509 and understated the baseline by roughly a third.

Harness: `scripts/proof_completion/thinking_sweep.py` (committed — unlike #509's, because the two-tier scenario handling is worth keeping).

### The two tiers, and why the second one exists

**`eval.jsonl` is the wrong shape for this question.** It is machine-generated: one- to three-step rewrites like `6x - 5 ≥ 19 → x ≥ 4`, which the model reaches in a single obvious move. The shipped configuration cleared most of them in 4–7 s on ~400–650 thinking tokens — nothing like the "tens of seconds" #510 assumed. There is no multi-step path to search, so that tier cannot test whether removing thinking costs accuracy on genuine derivation.

The second tier uses eight real derivations from `proofs/domains/` — quadratic formula (9 steps), time dilation, energy–momentum, particle-in-a-box, chain rule, integration by separation, geometric series, isolate-a — with endpoints taken from each proof's own first and last step. No gold ops there, so `op_f1` drops out; endpoint match, per-transition CAS tiers, and the reward all still apply.

**Both tiers are reported. They disagree on the details and agree on the verdict.**

## 4. Performance

### Tier 2 — real derivations, finalists over 4 passes (n = 32 per config)

```chartjs
{
  "type": "bar",
  "data": {
    "labels": ["mean", "median", "std dev", "max"],
    "datasets": [
      {"label": "cot_default (was shipped)", "data": [20.58, 13.11, 17.77, 71.05], "backgroundColor": "#ef5350"},
      {"label": "predict_disable (adopted)", "data": [7.81, 6.79, 4.16, 16.19], "backgroundColor": "#42a5f5"}
    ]
  },
  "options": {"scales": {"y": {"beginAtZero": true, "title": {"display": true, "text": "seconds"}}}}
}
```

| Config | Mean | Median | Max | **Std dev** | Thinking (mean) | Retries |
|---|---|---|---|---|---|---|
| `cot_default` (was shipped) | 20.58 s | 13.11 s | **71.05 s** | **17.77 s** | 2887 | 7 |
| **`predict_disable`** (adopted) | **7.81 s** | 6.79 s | **16.19 s** | **4.16 s** | 0 | 5 |

**2.6× faster on the mean, 4.4× on the worst case, 4.3× tighter spread.** As in #509 the spread is the headline: the client allows 360 s (`DERIVE_TIMEOUT_MS`) and the loop budgets 240 s (`ALGEBENCH_PC_TIME_BUDGET`) precisely because the tail was unpredictable. It no longer is.

The retry counts matter as much as the latency: the adopted configuration needed **fewer** refine retries (5 vs 7), so its speed is not bought by handing worse first attempts to the loop.

### Tier 1 — `eval.jsonl`, all five configurations (12 scenarios, single pass)

| Config | Mean | Median | Max | Std dev | exact | grounding | Retries | Thinking |
|---|---|---|---|---|---|---|---|---|
| `cot_default` | 10.79 s | 6.39 s | 29.9 s | 8.04 | 0.583 | 0.924 | 1 | 1255 |
| `cot_disable` | 5.13 s | 4.26 s | 9.4 s | 2.09 | 0.750 | 0.983 | 0 | 0 |
| `predict_default` | 9.11 s | 4.42 s | 25.8 s | 8.72 | 0.750 | 0.932 | 2 | 1300 |
| **`predict_disable`** | **3.45 s** | **2.71 s** | **8.4 s** | **1.92** | 0.667 | 0.964 | 1 | 0 |
| `predict_low` | 11.53 s | 10.35 s | 17.5 s | 3.93 | 0.750 | 0.983 | 0 | 958 |

Same shape, larger ratio (3.1×). Two of these twelve scenarios are degenerate (`a² - b² → a² - b²`: sympy canonicalizes the factored form straight back to the start), so every configuration scores a miss on them regardless of output — the real denominator is 10, and the `exact` column here should not be read closely.

### Tier 2, all five configurations (8 scenarios, single pass)

| Config | Mean | Median | Max | Std dev | exact | grounding | step_gr | Retries |
|---|---|---|---|---|---|---|---|---|
| `cot_default` | 24.50 s | 14.66 s | 71.1 s | 22.68 | 0.625 | 0.748 | 0.925 | 3 |
| `cot_disable` | 9.44 s | 8.24 s | 19.7 s | 5.80 | 0.500 | 0.727 | 0.893 | 2 |
| `predict_default` | 25.82 s | 24.11 s | 47.0 s | 16.75 | 0.625 | 0.750 | 0.925 | 4 |
| **`predict_disable`** | **7.92 s** | 8.37 s | **12.4 s** | **4.11** | 0.500 | **0.773** | **0.931** | **1** |
| `predict_low` | 22.20 s | 21.17 s | 47.9 s | 13.70 | 0.500 | 0.750 | 0.917 | 3 |

`predict_low` is the interesting elimination: #510 floated "lower the budget rather than disable it" as a plausible outcome, and it is not — 1502 thinking tokens bought 22.2 s/call and *no* accuracy over disabling thinking outright.

## 5. Accuracy — and why the aggregate numbers mislead

Graded on what the expert is actually for: whether the trajectory reaches the target graph (`exact`), the per-transition CAS verdicts (`grounding`, mean tier over Grounded/Verified/Plausible/Unchecked/Refuted), and per-state sympy-convertibility (`step_grounded`).

| Config | exact | grounding | step_grounded |
|---|---|---|---|
| `cot_default` | 0.562 | **0.785** | **0.935** |
| `predict_disable` | **0.594** | 0.769 | 0.929 |

Each config leads on some metric by one or two calls in 32, in opposite directions. **Neither difference is a result.** The single pass had it the other way round (`exact` 0.625 vs 0.500) — which is exactly the #509 lesson repeating: at temperature 0.7, single samples do not separate configurations, and on n = 8 one example is 12.5 points.

**The per-scenario breakdown is the actual finding.** Endpoint match, out of 4 passes each:

| Scenario | `cot_default` | `predict_disable` |
|---|---|---|
| quadratic-formula | 2/4 | **3/4** |
| isolate-a | 4/4 | 4/4 |
| chain-rule | 4/4 | 4/4 |
| time-dilation | 4/4 | 4/4 |
| particle-in-a-box | 4/4 | 4/4 |
| integrate-by-separation | 0/4 | 0/4 |
| energy-momentum | 0/4 | 0/4 |
| geometric-finite | 0/4 | 0/4 |

**The two configurations are identical on 7 of 8 derivations.** Four succeed always under both; three fail always under both; the entire measured gap is the quadratic formula, and thinking-disabled won it 3/4 to 2/4.

### The three always-failing scenarios are harness artifacts, not model failures

All three fail identically under every configuration, so they cancel out of the comparison — but they depress both `exact` columns and must not be read as derivation failures:

- **energy-momentum** — the start endpoint parses as `Eq(exp(2), c⁴m² + c²p²)`. `E^2` is being read as the *exponential function* `e²` rather than the symbol `E` squared. Nothing can derive from a nonsense start. **This is a real semantic-graph parser bug** and deserves its own issue (§7).
- **integrate-by-separation** — the target is an unevaluated `Integral(...)`; the model's steps grade `grounded`/`plausible` but coverage against an unevaluated integral is 0.
- **geometric-finite** — the start graph is not sympy-convertible at all (`start_expr` is `None`). Coverage reaches **1.0** — the model got there structurally — but 5 intermediate states are not single-root convertible, so `exact` is 0.

### Hand-checked output

The adopted configuration, driven through `scripts/proof_completion_derive.py` on the quadratic formula, produces a 10-step derivation, **10/10 states convertible, endpoint reached, confidence Verified** — completing the square correctly, including the `√(b²-4ac)/(2√(a²)) → /(2a)` simplification. Note it reports `math correct ✓` with `exact graph ✗`: the final state is `(-b + √(-4ac + b²))/(2a)`, mathematically identical to the target but ordered differently. That is the same canonicalization strictness inflating the failure counts above.

## 6. Verdict & caveats

**Adopted: `Predict` + thinking disabled.** 2.6× faster on real derivations, 4.4× lower worst case, 4.3× tighter spread, fewer refine retries, and no measurable accuracy cost on any of the three grading axes.

Held honestly:

- **8 real derivations, 4 passes.** Broader than tier 1 but still small. Three of the eight are unusable for endpoint scoring (§5), so the effective accuracy denominator is **5**.
- **`grounding` is the one metric where the old configuration leads** (0.785 vs 0.769). It is a ~2% difference over 32 calls with both configurations producing the same tier mix; it is reported rather than explained away.
- **The judge was not measured.** `ALGEBENCH_PC_JUDGE` is off by default; when enabled it adds an LM call per generation, and it deliberately keeps the globally configured (full-reasoning) LM.
- **Compiled artifacts must be recompiled.** A compiled program carries its predictor's signature, so anything optimized against the old `ChainOfThought` is invalid. The artifacts directory was empty at the time of this change, so nothing needed migrating.
- **No env-var override.** Reverting is a one-line change to `_pc_lm()`, deliberately not a runtime knob — matching #509.
- **Gemini only.** `reasoning_effort="disable"` is litellm's Gemini mapping; `_pc_lm()` returns `None` for a non-Gemini `ALGEBENCH_LM_MODEL`, which means "use the global LM".

## 7. Incidental findings (not addressed by this change)

- **The DSPy adapter fallback is still re-running calls.** `Failed to use structured output format, falling back to JSON mode` fired on roughly a third of calls across *every* configuration. It is config-independent, so it did not affect the comparison, but with thinking on it re-burns the full thinking budget — it is the direct cause of the 71 s and 56 s outliers. #510 already flags this as deserving its own issue; this run is more evidence for it.
- **`E^2` parses as `exp(2)`.** The energy–momentum endpoint (§5) is silently mis-parsed by the semantic-graph LaTeX front end. Worth its own issue: any derivation using `E` for energy is affected, and the failure is silent — the graph builds, it just means something else.
- **The four `Predict` modules named in #510** (`judge.py` ×2, `prompt_endpoints.py`, `term_descriptions.py`) still run default thinking and remain unmeasured.
- **`exact` is a harsh proxy on real proofs.** It requires canonical graph equality, so a correct derivation that orders a sum differently scores 0 while `math correct` says ✓. For future work on real-proof scenarios, the CAS tier mix is the better primary signal.

## 8. Reproduction

```bash
# tier 1 — machine-generated rewrites, all five configurations
./run.sh scripts/proof_completion/thinking_sweep.py --n 12 --out /tmp/pc/easy.json

# tier 2 — real derivations, all five configurations
./run.sh scripts/proof_completion/thinking_sweep.py --n 8 --out /tmp/pc/hard.json \
  --proofs proofs/domains/algebra/quadratic-formula.json \
           proofs/domains/algebra/isolate-a.json \
           proofs/domains/calculus/chain-rule.json \
           proofs/domains/calculus/integrate-by-separation.json \
           proofs/domains/physics/time-dilation.json \
           proofs/domains/physics/energy-momentum.json \
           proofs/domains/quantum/particle-in-a-box.json \
           proofs/domains/series/geometric-finite.json

# tier 2 — 3 repeat passes over the finalists (this is what separates them)
./run.sh scripts/proof_completion/thinking_sweep.py --n 8 --passes 3 \
  --configs cot_default,predict_disable --proofs <same eight> --out /tmp/pc/finalists.json
```

Raw per-call records for every run in this report: `sweep_easy_results.json`, `sweep_hard_results.json`, `sweep_finalists_results.json` (alongside this file).
