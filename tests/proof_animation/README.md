# Proof Animation — test suite

`proof_animations.json` is the curated suite of proof animations. It's a plain list of
authored derivations that the proof-animation report renders into an interactive
page — locally and on GitHub Pages — so the morph engine can be eyeballed on a
real, growing set of proofs for every PR and on `main`.

The render path is **deterministic and LM-free**: a proof is parsed with the
sympy-backed `SemanticGraphService`, threaded for stable per-glyph ids, and
emitted as `\htmlData`-annotated LaTeX the engine FLIP-morphs. Deriving a *new*
proof needs the model; **rendering the committed suite does not**.

## Schema

`proof_animations.json` is a JSON array of `ProofAnimation` objects (the typed model in
`scripts/proof_animation/build.py`). The `trajectory` is the
`ProofCompletionExpert`'s own output type (`ProofTrajectory`) verbatim:

```jsonc
[
  {
    "title": "Isolate a",          // display heading
    "domain": "algebra",           // parser domain: algebra | calculus | rational | …
    "start_operation": "Given",        // caption for the initial state (step 0)
    "start_justification": "solve for $a$",
    "trajectory": {
      "kind": "proof_trajectory",
      "start_latex": "a + b - c = 0",     // the initial state (animation step 0)
      "target_latex": "a = c - b",        // the final expression (informational)
      "steps": [                          // each step = a complete reached state
        {
          "operation": "add $c$ to both sides",   // short label (inline $…$ LaTeX ok)
          "expr_latex": "a + b = c",              // COMPLETE LaTeX after this move
          "justification": "$c$ crosses the $=$ and flips sign"
        }
      ]
    }
  }
]
```

- `operation` and `justification` may contain inline `$…$` LaTeX — the engine
  renders it.
- Every `expr_latex` (and `start_latex`) must be a single, complete,
  sympy-parseable expression; the renderer fails loudly on anything it can't parse.

## Adding a proof

Derivation runs the model, so it happens **locally** (needs `GEMINI_API_KEY` in
`.env.local`). The derive script *prints* a `ProofAnimation` for review — you
then paste it into this file by hand (deliberately manual, so nothing unreviewed
lands in the suite):

```bash
# explicit endpoints (precise — you control exactly what's proven)
./run.sh scripts/proof_animation/derive.py "x^2 - 4 = 0" "x = 2" --title "Solve x^2 = 4"

# …or a single prompt (the model also picks the start/target/domain/title)
./run.sh scripts/proof_animation/derive.py --prompt "derive Lorentz time dilation"

# preview before pasting: derive + render, then refresh a running serve
./run.sh scripts/proof_animation/derive.py --prompt "expand (x+1)^2" --render
```

Review the output (start/target sane? steps valid?), paste the object into
`proof_animations.json`, and **commit** it. You can also hand-author an entry directly
(same schema). CI renders the committed file and never derives.

## Rendering / checking

Local preview (regenerates from this file, serves on :5750):

```bash
./scripts/proof_animation/serve.sh            # → http://localhost:5750
```

Or generate the static site without serving:

```bash
./run.sh scripts/proof_animation/report.py \
    --from-file tests/proof_animation/proof_animations.json --outdir _site
```

## Deployed pages

`.github/workflows/proof-animation.yml` renders this suite and publishes it to
GitHub Pages (mirroring the semantic-graph report):

- **main:** `https://ibenian.github.io/algebench/proof-animation/`
- **PRs:** `https://ibenian.github.io/algebench/proof-animation/pr-<N>/` (the
  workflow also posts the preview link as a PR comment)

The deploy job has no API key and uses `--from-file`, so it only parses and
renders the committed proofs — same output everyone sees locally.
