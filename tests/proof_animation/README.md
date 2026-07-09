# Proof Animation — test suite

`proof_animations.json` is the curated suite of proof animations rendered into an
interactive page — locally and on GitHub Pages — so the morph engine can be
eyeballed on a real, growing set of proofs for every PR and on `main`.

It is a JSON array of **final, built animations** — the exact same self-contained
shape as the shareable built-ins under `proofs/domains/**/*.json`. Everything the
engine needs is already in the file: each step's `\htmlData`-annotated `latex`,
the per-term descriptions, and the confidence tiers. So the report **renders it
directly — no parse, no build, no model call** (identical output locally and in
keyless CI). Producing a new/updated entry needs the model; *rendering the
committed suite does not*.

## Schema

Each array element is one built animation (see a built-in like
`proofs/domains/algebra/quadratic-formula.json` for a full example):

```jsonc
[
  {
    "title": "Isolate a",
    "domain": "algebra",
    "steps": [
      {
        "index": 0,
        "operation": "Given the equation",          // step caption
        "justification": "solve for $a$",            // inline $…$ LaTeX ok
        "input_latex": "a + b - c = 0",              // source LaTeX (the model's)
        "latex": "\\htmlData{n=…}{…}",               // annotated, per-glyph ids → FLIP morph
        "plain": "a + b - c = 0",                    // label/fallback
        "confidence": { "tier": "grounded", … }      // per-step CAS/domain verdict
      }
    ],
    "overall_confidence": { "tier": "grounded", "endpoint_reached": true, … },
    "terms": {
      "a": { "latex": "a", "name": "a", "description": "The variable to isolate." }
    },
    "goal": "…", "followups": ["…"], "prerequisites": ["…"]   // optional
  }
]
```

The only field a built-in carries that the suite doesn't is `deeplink` (a
share-URL for the full app) — irrelevant to the render gallery.

## Adding / refreshing a proof

Deriving and enriching run the model, so this happens **locally** (needs
`GEMINI_API_KEY` in `.env.local`). Two steps:

1. **Author a trajectory.** Derive one (the script prints a `ProofAnimation` with a
   raw `trajectory` — no `steps` yet), or hand-write one:

   ```bash
   ./run.sh scripts/proof_animation/derive.py "x^2 - 4 = 0" "x = 2" --title "Solve x^2 = 4"
   ./run.sh scripts/proof_animation/derive.py --prompt "derive Lorentz time dilation"
   ```

   Paste that raw entry into `proof_animations.json` (a trajectory entry still
   *previews* — the render auto-builds it when a key is present).

2. **Bake the suite into final form** and commit the result:

   ```bash
   ./run.sh scripts/proof_animation/report.py \
       --from-file tests/proof_animation/proof_animations.json --rebuild-suite
   ```

   `--rebuild-suite` rebuilds every entry (fresh render + descriptions) and writes
   the built animations back in place. Run it after a proof edit or a
   parser/renderer change you want the suite to pick up. `input_latex` is preserved
   on every step, so the suite is always its own source — no separate trajectory file.

## Rendering / checking

```bash
./scripts/proof_animation/serve.sh            # local preview on http://localhost:5750
# or the static site:
./run.sh scripts/proof_animation/report.py \
    --from-file tests/proof_animation/proof_animations.json --outdir _site
```

## Deployed pages

`.github/workflows/proof-animation.yml` renders this suite and publishes it to
GitHub Pages (mirroring the semantic-graph report):

- **main:** `https://ibenian.github.io/algebench/proof-animation/`
- **PRs:** `https://ibenian.github.io/algebench/proof-animation/pr-<N>/` (also
  posted as a PR comment)

The deploy job has no API key and never needs one: it renders the committed built
animations verbatim — same output everyone sees locally.

## Explore / Ask-AI

The gallery enables the per-term **Ask AI** button and the **Explore** pill
(Prerequisites / Explore-further followups). Because the report is served from a
static host — not the app — those asks are pointed at a real AlgeBench: a **local**
run opens the app on its canonical port (`localhost:8785`), any other host (e.g.
GitHub Pages) opens **staging** (`algebench-staging.onrender.com`) — never prod.
The engine takes this as an `askOrigin` option; the app/`renderproof` pass nothing
and keep their own origin.
