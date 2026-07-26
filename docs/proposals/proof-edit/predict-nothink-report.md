# Proof-Edit Expert — Predict / No-Thinking Report

*2026-07-25 · AlgeBench · branch `proof-edit-latency-opt` · model `gemini-2.5-flash`*

## 1. Executive summary

The proof-edit intent parser was benchmarked across **10 scenarios × 5 configurations** (single pass, cache off), then **3 repeat passes** over the three finalists — 190 handler calls in total. The adopted configuration — **bare `dspy.Predict` with Gemini internal thinking disabled** — runs at **mean 4.1 s/call (max 11.3 s)** against the shipped **11.7 s (max 60.4 s)**, and scored **164/164** mechanical checks against the shipped configuration's 160/164.

It is both faster *and* slightly more accurate than what ships today. The interesting part is why nothing was lost: the CAS in `ops.py` performs the mathematics and `validate.py` refutes anything it cannot verify, so this LM call is mostly **routing** (edit vs question vs clarify) and **naming an op** — not derivation.

**Configuration adopted:** `dspy.Predict(ProofEditSig)` + `reasoning_effort="disable"`, scoped to this call's LM so every other expert keeps full reasoning.

This mirrors the [expression-analysis finding](../expression-analysis/predict-nothink-report.md), but the reasoning is *not* transferable by analogy — that expert only selected from a CAS fingerprint, whereas this one can be asked to author LaTeX. See §5.

## 2. What was being paid for

The shipped parser paid for deliberation **twice**:

```
dspy.ChainOfThought(ProofEditSig)   ← an explicit `reasoning` output field
        +
Gemini default thinking             ← internal thinking tokens, unbounded
```

The five configurations separate those two costs:

| config | module | `reasoning_effort` |
|---|---|---|
| `cot_default` | `ChainOfThought` | (default) — **shipped** |
| `cot_disable` | `ChainOfThought` | `disable` |
| `predict_default` | `Predict` | (default) |
| `predict_disable` | `Predict` | `disable` — **adopted** |
| `predict_low` | `Predict` | `low` |

`reasoning_effort` is litellm's Gemini mapping to a `thinkingBudget`: `minimal`→128, `low`→1024, `medium`→2048, `high`→4096, `disable`/`none`→0 with `includeThoughts` off. Measured thinking tokens tracked those budgets closely (`low` averaged 832 against its 1024; `disable` produced exactly 0).

## 3. Performance

Wall time is measured around the **whole handler**, so CAS work, the refutation-retry loop, and adapter retries are all inside it — this is what a caller waits for, not the bare LM call.

### Single pass, all five configurations

```chartjs
{
  "type": "bar",
  "data": {
    "labels": ["add-both-sides","multiply-both-sides","solve-for","differentiate","substitute","side-scoped-expand","simplify-right","term-scoped","not-an-edit","under-determined"],
    "datasets": [
      {"label":"cot_default (shipped)","data":[10.02,5.92,56.22,8.48,9.86,5.50,16.86,5.02,1.07,5.91],"backgroundColor":"#ef5350"},
      {"label":"predict_default","data":[6.39,4.98,22.47,3.55,7.67,8.39,14.62,3.95,0.89,3.64],"backgroundColor":"#ffa726"},
      {"label":"predict_low","data":[11.18,4.71,17.89,5.83,14.04,10.75,10.02,5.62,2.10,6.65],"backgroundColor":"#ab47bc"},
      {"label":"cot_disable","data":[2.88,4.12,10.10,1.78,5.22,3.60,5.41,3.16,0.90,0.90],"backgroundColor":"#66bb6a"},
      {"label":"predict_disable (adopted)","data":[3.72,2.85,6.64,9.44,3.34,4.94,2.93,5.16,0.68,0.69],"backgroundColor":"#42a5f5"}
    ]
  },
  "options": {"scales": {"y": {"beginAtZero": true, "title": {"display": true, "text": "seconds"}}}}
}
```

### Aggregates over all passes (n = 40 calls per config for the finalists)

| Config | Mean | Median | Max | **Std dev** | Thinking (mean) | Checks |
|---|---|---|---|---|---|---|
| `cot_default` (shipped) | 11.65 s | 8.91 s | **60.43 s** | **12.31 s** | 1705 | 160/164 (97.6%) |
| `cot_disable` | 3.95 s | 3.30 s | 12.41 s | 2.73 s | 0 | 156/164 (95.1%) |
| **`predict_disable` (adopted)** | **4.14 s** | 3.94 s | **11.25 s** | **2.58 s** | 0 | **164/164 (100%)** |
| `predict_default` † | 7.65 s | 5.69 s | 22.47 s | 6.08 s | 1225 | 41/41 |
| `predict_low` † | 8.88 s | 8.34 s | 17.89 s | 4.54 s | 832 | 41/41 |

† single pass only — eliminated on latency before the repeat passes.

**The standard deviation is the headline, not the mean.** 12.3 s → 2.6 s. A user asking "multiply both sides by $a$" currently waits somewhere between 1 and 60 seconds with no way to predict which; after the change the same request lands in a 0.6–11.3 s band. Default thinking chose anywhere from 63 to 12,664 thinking tokens for the *same kind of task*.

## 4. Mechanical quality checks

Six checks per call, graded against per-scenario expectations: `is_edit`, whether a clarifying `question` was asked, exact `op` string, `side`, `variable`, and the handler's final outcome key (`variants` / `question` / `fallback_to_chat` / `reason`).

All three failures across 492 checks are worth naming individually — there were only three.

| Config | Failure | Frequency |
|---|---|---|
| `cot_disable` | `simplify-right` → routed as **not an edit**, bounced to the tutor chat in ~1.3 s | **2 of 4 passes** |
| `cot_default` | `solve-for` → asked a clarifying question instead of setting `op=solve_for` | 1 of 4 passes |
| `predict_disable` | — | none |

### Why `cot_disable` was rejected despite being marginally faster

On the **single pass it scored a perfect 41/41** and had the best mean latency (3.81 s). Three repeat passes exposed a repeatable mis-route: *"simplify the right-hand side"* — an unambiguous, common operation — classified as `is_edit=False` and handed to the tutor chat. That is a hard user-visible failure (the edit silently doesn't happen), and it recurred in 2 of 3 tie-break passes.

**This is the single most important methodological point in the report.** At one sample per cell, all five configurations tied at 41/41 and the recommendation would have been the wrong one. Temperature is 0.7; single samples do not separate configurations on accuracy.

### The hard case: authoring LaTeX unaided

`term-scoped` ("expand only the $\left(\frac{b}{2a}\right)^2$ term, leave every other term exactly as it is") is finer-grained than a side, so the signature deliberately forbids a structural `op` — the model must copy the previous expression and change only the named term.

All five configurations produced **byte-identical output**:

```latex
x^{2} + \frac{b}{a} \cdot x + \frac{b^{2}}{4 \cdot a^{2}} = - \frac{c}{a} + \frac{b^{2}}{4 \cdot a^{2}}
```

— which matches the proof's real step 4 exactly. This is the strongest evidence in the report: thinking bought nothing even on the one path where the LM, not the CAS, is the mathematician.

## 5. Why thinking was safe to remove *here*

Not by analogy with the expression-analysis expert — that one only ranks CAS-detected features and cannot author mathematics at all. This expert can. The justification is structural:

- **The CAS does the math.** For the 7 op-mapped scenarios, `compute_step()` in `validate.py` has sympy perform the operation and the model's `steps[0]` is *discarded*. Correct by construction.
- **The CAS grades what it didn't compute.** Anything model-authored goes through `verify_candidate()`; `refuted` is disqualifying and `unknown` triggers a retry, then an explicit caveat.
- **What's left is classification.** Which of 12 op names; edit vs question vs clarify; which side. Short decisions with a closed vocabulary.

If the signature ever grows genuine derivation — asked to *find* a multi-step path rather than apply one named move — this measurement stops applying and thinking should be re-benchmarked.

## 6. Incidental findings (not addressed by this change)

- **DSPy adapter fallback re-runs calls.** `Failed to use structured output format, falling back to JSON mode` fires often enough to add ~30–50% extra LM calls (13–15 calls per 10 scenarios, across *every* config). It is config-independent so it did not affect the comparison, but with thinking on it re-burns the full thinking budget each time — this is what produced the 56 s and 60 s `solve-for` outliers. Worth its own issue.
- **A latent test defect, exposed by this change.** `test_unconfirmed_step_is_offered_with_a_caveat` passed only because `validate.resolve`'s retry path could never reach an LM under pytest (nothing calls `configure_dspy()` there). Giving this module its own LM turned that retry into a live network call from a unit test. Fixed by stubbing `validate.propose_edit` alongside `handler.propose_edit` in `_stub_proposal`; the file's docstring claim that "the LM is stubbed throughout" is now actually true, verified by passing with `GEMINI_API_KEY` unset.
- **`$…$`-wrapped LaTeX.** Models occasionally return `'$t = \frac{c t_0}{...}$'` in `expr_latex`. Every observed instance had `op` set, so the CAS discarded it — but it is the documented fallback when an op cannot be applied. `cot_disable` was the worst offender (4/10), the adopted config the cleanest (1/10). Not currently biting; worth a `strip('$')` in `_clean` eventually.

## 7. Verdict & caveats

**Adopted: `Predict` + thinking disabled.** ~2.8× faster than the shipped configuration, ~4.8× tighter latency spread, ~5.4× lower worst case, and 164/164 on mechanical checks versus 160/164.

Held honestly:

- **10 scenarios, 2 proofs.** All drawn from `quadratic-formula.json` and `time-dilation.json`. Longer derivations, other domains (quantum, series), and the `clarifications` round-trip are untested here.
- **Mechanical checks, not a formal eval.** They verify routing and op selection against expectations plus one hand-checked LaTeX comparison. They do not grade the *quality* of glue steps or summary prose.
- **4 passes on the finalists, 1 on the eliminated configs.** `predict_default` and `predict_low` were cut on latency alone; their single-pass 41/41 should not be read as an accuracy claim.
- **The `under-determined` scenario is genuinely ambiguous.** "integrate both sides" was scored as *should ask a clarifying question*, and configurations legitimately differ on whether the indefinite reading is obvious. It flipped between passes on the shipped config.
- **No env-var override.** Reverting is a one-line change to `reasoning_effort` in `_parser_lm()`, deliberately not a runtime knob.

## 8. Reproduction

The benchmark harness is not committed (machine-generated, and the decision it produced is recorded here). To rebuild it: drive `backend.experts.handlers.proof_edit.handler.proof_edit` directly with a swapped `intent._parser`, construct per-config `dspy.LM(..., cache=False)`, and time the whole handler call.

**`cache=False` is not optional.** A first attempt at this benchmark was discarded because an earlier smoke run had populated the DSPy cache: two baseline cells returned in 2.59 s and *0.00 s*, understating the shipped configuration's mean by roughly a third.
