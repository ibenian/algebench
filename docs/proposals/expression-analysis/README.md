# Expression-Analysis Expert — Artifacts

Companion material for the `expression_analysis` expert
(`POST /api/expert/expression_analysis`; code under
`backend/experts/modules/expression_analysis/`) and the
[equation-behavior pedagogy proposal](../equation-behavior-pedagogy-proposal.md).
User-facing feature name: **Function Analysis** (deliberately *not*
"functional analysis", which names the Banach/Hilbert-space branch of
mathematics).

## Contents

| File | What it is |
|---|---|
| [`expert-ui-mockup.html`](expert-ui-mockup.html) | Self-contained hypothetical UI consuming the expert's real outputs for 10 scenarios — story badge, ranked-feature chips, proposed viewports with live charts and numeric feature re-detection, sliders at the proposer's pins, predict-before-reveal probes. Open directly in a browser. |
| [`predict-nothink-report.md`](predict-nothink-report.md) | Performance/quality report for the adopted LM configuration (bare `Predict`, Gemini thinking disabled): the 30-call benchmark, mechanical quality checks, all 10 scenario outputs, hard-case findings, verdict and caveats. |
| [`batch_ab_results.json`](batch_ab_results.json) | Full data for the 10-scenario × 3-thinking-config benchmark (30 LM calls): latency, token usage, mechanical checks, complete outputs per call. |
| [`proposer_ab_results.json`](proposer_ab_results.json) | The earlier 5-config × 2-scenario experiment (Predict/CoT × default/low/disabled thinking) that motivated the batch — includes the CoT `reasoning_field` texts. |
| [`ui_data.json`](ui_data.json) | The adopted config's outputs for the 10 scenarios, extracted for the mockup. |
| `sample-*.json` | Raw end-to-end HTTP responses (`{characteristics, proposal}`) from the live endpoint at various stages: with lesson context, after the Predict swap, and after the symbol-contract fix. |

## Reproducing

CAS-only report (fast, no LM):

```bash
curl -s -X POST http://localhost:8785/api/expert/expression_analysis \
  -H 'Content-Type: application/json' \
  -d '{"latex": "v_0 t - \\frac{1}{2} g t^2", "variable": "t", "propose": false}'
```

Full analysis with the pedagogical proposal (~4–8 s):

```bash
curl -s -X POST http://localhost:8785/api/expert/expression_analysis \
  -H 'Content-Type: application/json' \
  -d '{"latex": "v_0 t - \\frac{1}{2} g t^2", "variable": "t", "context": "Projectile motion lesson."}'
```

LM configuration is overridable per-expert via `ALGEBENCH_PROPOSER_REASONING`
(`disable` — the measured default — `low`, `high`, or `default` for the
globally configured LM).
