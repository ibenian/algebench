# proof-animation

Realtime, Manim-style morphing of a derivation — terms slide / fade / appear as
the expression transforms, step to step. Built like `graph-panel`: a
framework-free ES-module engine that's **embeddable in the AlgeBench app** and
**runnable standalone from a local launcher**. (App embedding comes later; this
is the core engine.)

## Files
- `proof-animation.js` — `export class ProofAnimator` (the engine).
- `proof-animation.css` — themeable styles (CSS vars).

## Data contract
```js
new ProofAnimator(containerEl, data, { katex: window.katex });
```
`data = { title, steps: [ { index, operation, justification, latex, plain } ] }`
where each `latex` is **annotated** — every sub-expression wrapped in
`\htmlData{n=<id>}{...}` (KaTeX renders it to `data-n="<id>"`), and a
sub-expression that **persists across steps carries the same `<id>`** (threaded
server-side). That stable id *is* the correspondence.

Build `data` with `scripts/proof_animation/build.py` (it parses each state with
`SemanticGraphService.latex_to_graph`, threads stable ids via `graph_ops.diff`,
and renders annotated LaTeX via `backend/semantic_graph/latex_renderer.to_latex`).

## How the morph works (FLIP)
Between the current and target state, on the **leaf** `data-n` spans (tokens):
- id in **both** → tween old → new position (match / **move**)
- id only in **target** → fade / grow in (insert)
- id only in **current** → ghost fade out (delete)

Leaf-level avoids nested-span transform compounding. Because the id is the key,
**any-to-any jumps** work (0→5, 5→2, …) — the morph always runs between the
current state and the one you pick. `mode: 'parallel'` (default) animates all
tokens at once; `'sequential'` staggers them.

## Run it locally
```bash
./scripts/proof_animation/serve.sh                 # the test suite, http://localhost:5750
./scripts/proof_animation/serve.sh "a + b = c" "a = c - b"   # your own chain
./scripts/proof_animation/serve.sh --from-json /tmp/traj.json  # a ProofTrajectory JSON
```
(or the `proof-animation` config in `.claude/launch.json`).

## Status / next
- ✅ engine: KaTeX render + leaf-FLIP morph + any-to-any + parallel/sequential.
- ⏳ later (see issue #353): GumTree-quality matching (better sibling/move
  disambiguation), negated/inverse moves, SymPy-verified badges, app embedding.
