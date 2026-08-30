# Transformer Architecture — Lesson Proposal

**Status:** proposal · **Phase:** research/design only — this document produces no scene JSON.
**Backlog entries this supersedes:** [`docs/lesson-ideas.md`](../lesson-ideas.md) "Attention & Transformers" (:754) and "The Transformer Architecture" (:840).

---

## 0. What this document decides

The backlog already asks for a transformer lesson. It does not say **what to teach**, and that is the expensive question: modern transformers contain far more mechanism than one lesson can hold, the corpus median lesson is 6 scenes / ~25 steps / 1500–3500 lines of JSON, and a mis-scoped lesson gets rewritten rather than patched.

A second constraint cannot be separated from the first. AlgeBench's element vocabulary is 3D geometry — 23 element types (`schemas/lesson.schema.json:233`), all three.js/MathBox. There is no matrix, heatmap, table, chart, or image element. **A topic is only worth including if it has an honest visual realization in that vocabulary.** So this document decides topic selection and visualization feasibility together.

It settles five things:

1. Which topics earn a scene, which become one-step deltas, which are cut, which become sibling lessons (§2)
2. The design principles that keep the lesson tangible rather than a slideshow (§1)
3. What must be mathematically true (§4), and what is actually provable (§5)
4. How each topic gets drawn, using primitives verified to exist (§6)
5. Where the numbers come from (§3) and what the renderer now provides (§7 — the prerequisite is resolved; `tensor` ships on `main`)

The scene-by-scene outline is §10. The eventual build uses `/algebench-lesson-builder` with this document passed as `constraints`.

---

## 1. The design spine

Everything below follows from these six principles. They come first because they are the reason the topic list looks the way it does.

### 1.1 One persistent object, annotated — never a gallery of pictures

The standard failure of transformer explainers is that each concept gets its own disconnected diagram, and the student never learns that they are all views of *one* computation.

AlgeBench is built for the opposite. Steps are cumulative — elements persist until explicitly removed (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md), "How a scene is built from root to steps"). So **the layer stack of §6.1 stays on screen for the whole lesson**, and each scene zooms into a different part of the same artifact. A step that introduces a fresh, unrelated picture is a design smell.

### 1.2 Four channels, four distinct jobs, no duplication

Every quantity that matters appears in three of these at once, consistently:

| Channel | Its job | Never |
|---|---|---|
| **3D viewport** | The object itself — only quantities with genuine geometric meaning (rotations, projections, convex combinations, trajectories) | A picture of numbers |
| **Info overlay** (`{{expr}}`) | The **instantiated** formula — live numbers substituted, from the same computation the viewport draws | The general symbolic form |
| **Proof panel** (`sceneStep`-bound) | The **general** statement and its derivation, in symbols | Numbers |
| **Doc panel** (`scene.markdown`) | The persistent map — where you are in the block, the actual weight matrices, the shapes | Anything that changes |

### 1.3 Colour is the binding

A proof step's `\htmlClass{hl-q}{q_i}` and the query vector in the viewport must be **the same colour**. Do this consistently and the symbol and the object stop being two things in the student's head.

The corpus already proves it works: [`scenes/special-relativity.json`](../../scenes/special-relativity.json) keeps the invariant-`c` thread one colour through every proof step and every scene step. Declare the convention once in the lesson-level `prompt` and hold it across all six scenes.

### 1.4 The binding is mechanical, not aspirational

- **`sceneStep`** on a proof step syncs the proof panel to the scene **bidirectionally** — click a proof step and the scene navigates; advance the scene and the proof follows.
- **`labelExpr`** puts the live number *on the object*. It is the only per-frame text path in the 3D view.
- **`prompt`** on an element gives it a per-object Ask-AI button, making the object itself interrogable.

### 1.5 The test for "tangible"

> **No symbol without a number, and no number without a place it came from.**

Every quantity should be showable three ways: geometry in the viewport, live value in the overlay, coloured symbol in the proof. **A quantity that cannot be shown all three ways is a candidate for cutting** — an independent second filter on §2.

### 1.6 The test for "interactive"

> **The student's hand is on the thing the sentence is about.**

Not "here is attention, and here is a slider." The slider *is* the claim. Dragging the `1/√d_k` control does not *illustrate* the variance argument — it **is** the argument, discovered by hand, with the proof panel then stating in symbols what the hand just found.

Operationally: **every step names one quantity the student manipulates and one quantity they watch respond.** A step without that pair is a lecture slide and does not belong in this renderer.

---

## 2. Topic inventory — keep, delta, cut, defer

The failure mode of transformer explainers is completeness, not omission. The cuts are as deliberate as the keeps.

### 2.1 Keep — the load-bearing spine

| Topic | Why it earns a scene |
|---|---|
| **Tokens → embeddings → position** | Without it, attention operates on nothing concrete. Also where the permutation-invariance hook lives. |
| **Q, K, V as three projections of one vector** | The single most-missed idea. Students believe Q/K/V are three different *inputs*. |
| **Scaled dot-product attention + softmax + causal mask** | The mathematical heart. Everything else is plumbing around it. |
| **Vectorization — one query vs. all queries at once** | The step from `qᵢ·kⱼ` to `QKᵀ` as a single matmul. This is *why* the architecture won: the whole sequence processes in parallel, which an RNN structurally cannot do. It also reveals the causal mask's real job — training on every position in one pass is legal only because the mask forbids looking ahead. |
| **Multi-head → GQA** | Explains why one attention is not enough, and carries the KV-cache economics that define modern inference. |
| **The block: residual stream, normalization, FFN** | The residual stream is the object the whole model is organized around, and it is almost never visualized. |
| **Stacking + logits → sampling** | Closes the loop. Without it the lesson stops before anything is *predicted*. |

### 2.2 Keep — as modern deltas inside those scenes, not as scenes

Each is **one step and one before/after contrast**, driven by a toggle the student flips:

RoPE (belongs in the Q/K scene — it rotates Q and K, not the embeddings) · RMSNorm vs LayerNorm · pre-LN vs post-LN · SwiGLU vs ReLU/GELU FFN · GQA vs MHA · the KV cache.

### 2.3 Cut — real topics, wrong lesson

| Cut | Reason |
|---|---|
| Training / backprop / optimizers | A different kind of object — §2.5 |
| Scaling laws, emergent abilities | Empirical curves; no mechanism to show |
| RLHF / DPO | §2.5 |
| Tokenizer training (BPE) | Has its own backlog entry; this lesson needs only "tokens exist" |
| Induction heads / interpretability | Requires a real model at scale; would double the lesson |
| Mixture of Experts | A routing story layered on a block the student does not yet know |
| Flash-attention / IO-awareness | A systems optimization; changes no mathematics |
| Encoder–decoder cross-attention | Not part of the modern decoder-only architecture being taught |
| Dropout, weight tying | Training-time details, invisible in a forward pass |

### 2.4 Defer — cross-link, do not re-teach

**Softmax & temperature** ([`docs/lesson-ideas.md`](../lesson-ideas.md):774) and **positional encoding in depth** (:832) already have backlog entries. This lesson uses them and links out.

### 2.5 Training, fine-tuning, LoRA, RLHF — separate lessons

**Separate, without hesitation** — and the reason is not scope, it is that they are a different *kind* of object.

This lesson teaches a **forward pass**: a deterministic function from tokens to a distribution, where every quantity is displayable and every claim provable from linear algebra. Fine-tuning, LoRA and RLHF are all about **changing the weights** — optimization and statistics stories whose central objects (loss landscapes, gradient flow, preference distributions, low-rank subspaces) form a different vocabulary.

It also breaks §1.1 directly: the layer stack is coherent across six scenes *precisely because the weights are fixed*. The moment weights start moving, that object stops meaning what it meant. And there is a prerequisite argument — you cannot teach LoRA to someone who does not yet know what `W_Q` is. **This lesson is the prerequisite for all three.**

| Sibling lesson | Visual fit | Verdict |
|---|---|---|
| **Training — next-token prediction** | The loss, teacher forcing, and why the causal mask yields N training signals from one sequence. Picks up exactly where scene 6 ends. | Natural direct sequel |
| **Fine-tuning & LoRA** | **Outstanding fit — arguably better suited to this renderer than the transformer lesson itself.** `ΔW = BA` with rank `r ≪ d` is a rank-constrained subspace, and [`scenes/eigenvalues.json`](../../scenes/eigenvalues.json) / [`scenes/matrix-transformations.json`](../../scenes/matrix-transformations.json) already speak that language: column vectors, the parallelogram they span, the determinant collapsing as a matrix goes singular. A rank-1 update is literally a line; rank-2 is a plane. | **Greenlight next, on visual merit** |
| **RLHF / preference optimization** | Reward model, KL-constrained update, DPO. Largely distributional — closest to the [`scenes/conditional-probability.json`](../../scenes/conditional-probability.json) idiom. | Weakest visual fit; sequence last |

**Do not commit to the track up front.** Build this lesson, see how the layer stack and `tensor` hold up in practice, then decide.

---

## 3. The worked example — one toy model, carried end to end

A single fixed toy model is used in **every** scene, with real arithmetic. The recurring finding in the interactive-explainer literature (§8) is that schematic boxes do not teach and real numbers do.

```
tokens    n = 6
d_model   4
n_heads   2
d_k       2         (per head)
n_kv      1         (for the GQA delta: 2 query heads share 1 K/V head)
layers    3         (enough to show stacking; small enough to render)
```

`d_k ≠ d_model` is deliberate: it is what makes the `√d_k` scaling visibly about the **head** dimension, which is the usual error (§4).

### 3.1 Where the weights come from — the sharpest honesty risk in the lesson

Hand-picked weights produce attention patterns that mean nothing. A lesson advertising mathematical accuracy while showing invented attention patterns is dishonest at exactly the point it claims rigour.

But real trained weights at `d_model = 4` on a small corpus produce patterns that are largely **noise** — a toy that small does not learn crisp interpretable heads.

**Resolution: do both, and label them.**

1. **Constructed weights for the mechanism scenes (1–5)**, chosen so the patterns are legible, and *explicitly labelled on screen* as designed-for-teaching rather than learned. This is honest, and it is what makes the mechanism visible at all.
2. **One real-model beat**, at the end of scene 4 or 6: actual attention maps pulled from a real pretrained small model, shown beside the toy. The contrast — clean constructed pattern vs. messy real one — is itself a teaching moment, and it inoculates the student against believing real attention maps look like textbook diagrams.

Both halves are baked into the lesson's `data` block as static tables, read with `dataTable(name, row, col)`. Nothing is computed at runtime that is not reproducible offline. **Record the generation script's provenance in the lesson so the numbers can be regenerated and checked.**

---

## 4. Mathematical accuracy contract

Each item states the error it prevents. The scene author must satisfy all of them.

| # | Must be true | Error it prevents |
|---|---|---|
| 1 | Softmax rows sum to 1 — **asserted on screen** (`Σⱼ αᵢⱼ = 1.000`), not merely claimed | Treating the matrix as arbitrary weights |
| 2 | The causal mask is applied to the **scores, before** softmax (as `−∞`), never to probabilities after | The single most common visualization error; masking after softmax leaves rows not summing to 1 |
| 3 | `1/√d_k` uses the **per-head** dimension, not `d_model` | The usual conflation; the reason §3 sets `d_k ≠ d_model` |
| 4 | Attention output is a **convex combination** of the value rows — it lies in their hull | Believing attention can produce anything |
| 5 | Heads are concatenated **then** projected by `W_O`; the residual width never changes | Believing multi-head widens the stream |
| 6 | RMSNorm subtracts **no** mean and has **no** bias | Treating it as a cheaper LayerNorm with the same form |
| 7 | RoPE rotates 2D coordinate pairs, applied to **Q and K only** — never to V | A very common implementation and explanation bug |
| 8 | GQA requires `n_kv_heads | n_heads`; state the sharing pattern explicitly | Hand-waving "heads share keys" |
| 9 | SwiGLU is `(Swish(xW₁) ⊙ xW₃)W₂`, hidden width scaled by ~2/3 to hold parameter count constant | Presenting it as a drop-in activation swap |
| 10 | Pre-LN vs post-LN: state exactly what the residual branch carries in each | The diagrams are near-identical and routinely drawn wrong |
| 11 | Temperature: `T→0` ⇒ argmax, `T→∞` ⇒ uniform | Treating temperature as a vague "creativity" knob |

**On item 3 specifically** — the justification stated must be the *variance* argument, not "prevents vanishing gradients". For `q, k` with i.i.d. zero-mean unit-variance components, `Var(q·k) = d_k`; dividing by `√d_k` restores unit variance. The gradient consequence follows from that, and stating only the consequence is what makes the fact folklore. See proof 2 in §5.

---

## 5. Proofs — what is actually provable here

The corpus splits cleanly. Pure-math lessons (`eigenvalues`, `fourier-series`, `matrix-transformations`, `gradient-descent-terrain`) carry **zero** proof blocks; the physics narratives carry 3–11 each. Structurally this lesson is a narrative, so it belongs with the physics group: **4–6 proof blocks**, bound to scene steps via `sceneStep`.

Worth stating in the lesson itself: transformers are usually taught with *no* proofs at all, which is why several of these facts survive as folklore.

### 5.1 Flagship proofs

| # | Statement | Why it earns a block | Binds to |
|---|---|---|---|
| 1 | **Attention is permutation-equivariant.** Permuting the input sequence permutes the output identically and changes nothing else. | *The* theorem that motivates positional encoding. Prove it while the shuffled tokens are on screen showing it. | Scene 1, predict/reveal |
| 2 | **The `√d_k` scaling.** For `q, k` i.i.d. zero-mean unit-variance, `Var(q·k) = d_k`; dividing by `√d_k` restores unit variance. | The most hand-waved fact in the field. Four or five clean steps. | Scene 3, scaling slider |
| 3 | **RoPE gives relative position.** `⟨R_m q, R_n k⟩ = ⟨R_{m−n} q, k⟩`, from `R_mᵀR_n = R_{n−m}`. | Short, exact, and the viewport can *show* the rotation while the proof states it. | Scene 2, RoPE step |
| 4 | **The output lies in the convex hull of the value rows** — weights non-negative, summing to 1. | Turns a geometric fact the viewport already displays into a stated theorem. | Scene 3, output step |
| 5 | **Softmax is shift-invariant:** `softmax(z + c·1) = softmax(z)`. | Two lines, and it justifies both the numerically-stable implementation and why `−∞` masking works at all. | Scene 3, mask step |

### 5.2 Held in reserve

Include if budget allows; cut first if not. Sinusoidal `PE_{pos+k}` as a linear function of `PE_pos` (the angle-addition identity — the 2017 paper's own claim) · the softmax Jacobian `∂pᵢ/∂zⱼ = pᵢ(δᵢⱼ − pⱼ)` and its saturation as the logit gap grows, which is the *gradient* half of proof 2 · the pre-LN identity path and why gradients survive depth · RMSNorm coinciding with LayerNorm on zero-mean input.

### 5.3 CAS-verified standalone artifacts

The corpus distinguishes **lesson-embedded proofs** (hand/agent-authored LaTeX, *not* CAS-verified) from **`/prove` artifacts** under `proofs/domains/`, which sympy grounds and grades with an honest confidence badge.

Two of the five are genuinely sympy-friendly and worth promoting: **#2** (a variance computation) and **#3** (a trig identity — exactly what the CAS is good at). Proposal: a new `proofs/domains/ml/` domain, built with `/algebench-prove`, linked from the lesson via the `pa=ml/<name>` deeplink parameter.

### 5.4 Authoring mechanics

- Proof `goal` **needs** `$` delimiters; proof step `math` must have **none** (the renderer wraps in `$$`).
- Every `\htmlClass{hl-X}` needs a matching `highlights.X` entry, and vice versa.
- Any proof block means budgeting for the `prebake_semantic_graphs.py` pass, which stops the server re-deriving a graph per step on every page load.

---

## 6. Visualization strategy

### 6.0 The governing principle

> Anything whose meaning is **topological** — what connects to what, the block diagram, the "you are here" map — belongs in the doc panel or the semantic-graph dock. Anything whose meaning is **geometric or numeric** — this rotation, this projection, this convex combination, this trajectory — belongs in the 3D view.

AlgeBench is a 3D data-space renderer, not a diagramming tool; bending it into one produces a bad version of both. The lesson is good exactly to the degree that it puts the transformer's *real geometry* in the viewport and leaves the wiring diagram to a static panel.

### 6.1 Layers — a plane per layer (the primary visual)

**This is the spine.** Each layer is a translucent sheet stacked along one axis; on each sheet sit the token representations as points; between consecutive sheets run weighted edges.

| Piece | Primitive | Verified anchor |
|---|---|---|
| The sheet | `polygon` (bounded) or `grid` (wireframe) | `grid` takes **per-axis** `range` (`[[a,b],[c,d]]`) and **per-axis** `divisions` (`[nx,ny]`) — `src/objects/grid.ts:69–110` |
| Tokens on a sheet | one `point` element with **`positions[]`** — all N in a single draw call | `src/objects/point.ts:23` |
| Edges between sheets | `animated_cylinder` with `fromExpr`/`toExpr` and **`radiusExpr`** ∝ weight; radius → 0 to vanish | `src/objects/animated-cylinder.ts:44`, `:54` |
| Live values | `labelExpr` on the points | — |

**The critical design decision: the points on the plane are tokens, not neurons.**

- For the **FFN sublayer**, the classic neurons-in-layers picture is *correct* — `d_model → d_ff → d_model` is a genuine dense layer with fixed learned weights, and planes-per-layer renders it honestly.
- For **attention**, it is *wrong*, and wrong in exactly the way §9 flags as a misconception. Attention is not a fixed weight matrix between two neuron sets; its edges are **computed from the data at runtime**. So the sheets hold token positions, and the edges are attention weights that visibly redraw when the input changes.

Making that contrast visible — fixed wiring in the FFN, live wiring in attention — is a teaching opportunity, not a compromise.

Done this way one object carries three things at once: the residual stream as the vertical axis, the token representations as the points, and attention as the live connectivity between sheets.

**Feasibility limits to respect:**

- At `n = 6` and 3 layers, all-pairs wiring is 2 gaps × 36 = 72 cylinders; at 6 layers it is 180 — above the corpus maximum of ~24 simultaneously-live animated elements. **Show one gap at a time**, driven by a `layer` slider, or one token's fan-in.
- Stacked translucent sheets z-fight without `shader.depthWrite: false` plus `renderOrder`/`depthZ` staggering.
- The global `planeOpacity` display control dims sheets usefully. It composes as `elementBase × planeOpacity` and is the **only** display param whose default is not neutral (`0.2`; every other opacity defaults to `1.0`, `src/state.ts:389-390`), so an authored `opacity` renders at a fraction of its written value. `animated_polygon` and `tensor` both fold it into their initial paint; set `shader.ignorePlaneOpacity: true` to opt a lattice out (§7).
- `text` labels are HTML overlays that always face the camera and never occlude, so a deep stack piles them up. Keep labels sparse; prefer `labelExpr` on the few that matter.
- The camera wants a mild isometric preset. Face-on collapses the stack to nothing.

**Two supporting recipes for depth:** *layer as an axis* (one token's representation traced through the stack as an `animated_line` with per-vertex expressions — the geometry then shows how a representation moves with depth), and *layer as a slider* (scrub depth; also the mitigation for the edge-count limit above).

### 6.2 Weight matrices — three modes

| Mode | When | Notes |
|---|---|---|
| **Column vectors + the parallelogram they span** | **Preferred.** When the matrix's *action* is the point | The repo's single most-repeated idiom ([`scenes/matrix-transformations.json`](../../scenes/matrix-transformations.json)). A matrix *is* its action on the basis. A strong argument for keeping `d_model` at 3–4, since that is the only range where this view exists at all |
| **Cell grid coloured by value** | When the *pattern* matters, not the action (attention matrix, positional-encoding matrix) | Picture-of-numbers mode. **Must never substitute for the action view when the action view is possible** |
| **Doc-panel HTML table** | Static reference — "here is the actual `W_Q` we are using" | `scene.markdown` passes raw HTML through `marked` unsanitized, so a styled `<table>` with inline backgrounds is legitimate and costs zero render budget |

### 6.3 Connections — and the trap

`animated_cylinder` with `radiusExpr` is quantitative and instantly readable; `animated_vector` when direction matters (arrowhead, optional trail).

**Never draw full connectivity.** N×N token edges at `n = 6` is 36 cylinders — fine. A dense FFN layer is `d × d_ff` edges — thousands, and illegible even if it rendered. The recipe is **one neuron's fan-in at a time, selected by a slider.** That is both honest and the only legible option.

### 6.4 Heatmaps — yes, with discipline

Heatmaps are the field-standard encoding for attention and this lesson should use them. Four rules:

1. **Sequential scale, single hue, anchored at zero.** Post-softmax weights are non-negative and sum to one; a diverging red↔blue map implies a signed quantity and is simply wrong for them. Use the *same* scale in every scene so cells stay comparable across the lesson. **The one exception:** the raw pre-softmax scores genuinely are signed, and a diverging map is correct there — and only there.
2. **Three matrices, not one.** The sequence *dot product → scaled + masked → softmax*, shown as three adjacent heatmaps with the transformation animated between them, is what teaches. A single final heatmap hides the entire mechanism.
3. **Rows, not columns.** The matrix is row-stochastic; comparing intensities down a column is meaningless. Say so, orient the layout so rows read naturally, and keep the `Σⱼ αᵢⱼ = 1.000` assertion visible.
4. **Attention weights are not explanations.** Worth one `remark` proof step. Jain & Wallace showed different attention distributions can yield the same predictions, and adversarial attention patterns leave outputs unchanged; Wiegreffe & Pinter rebut in part. The lesson teaches the *mechanism* — it must not imply the heatmap says why the model produced what it did.

**Where heatmaps belong:** the three attention-score matrices, the positional-encoding matrix (position × dimension), the pattern view of a weight matrix. **Where they do not:** anything with a geometric reading available.

**Mechanism:** one `tensor` element per matrix (§7), plus a doc-panel HTML table for static reference. One element, not one per cell — a 6×6 attention matrix is a single JSON object, and the renderer expands it to a merged lattice at render time.

### 6.5 The block diagram

The one place a box-and-arrow picture is genuinely wanted (attention → add & norm → FFN → add & norm). Two routes:

- **Semantic-graph dock** — real D3+dagre auto-layout, KaTeX labels, edge labels, collapse/expand. *But* it lives in a side tab, shows one proof step at a time, and `scripts/ci_validate_prebaked.py` will flag a hand-authored graph as out of sync with the LaTeX-derived one.
- **Hand-authored `<svg>` in `scene.markdown`** — static, but legible, persistent, and zero tooling risk.

**Recommendation: the SVG.** The block diagram's job is to be the persistent "you are here" map (§1.2, doc-panel row), which is precisely what the dock cannot do.

### 6.6 Per-topic recipe summary

| Topic | Recipe |
|---|---|
| Attention matrix | One `tensor` (`src/objects/tensor.ts`), `shape: [6,6]` + `valueExpr` with `row`/`col`/`idx` bound per cell, `colorMap` + `colorDomain` for value→colour, `axes` for the token labels. **Ships on `main`** (§7) |
| Attention edges | `animated_cylinder`, `radiusExpr` ∝ `αᵢⱼ` (`src/objects/animated-cylinder.ts:44`) |
| Residual stream | `animated_vector` with a `trail`, or a chain of `animated_point`s with `labelExpr`, running down the stack while sublayers write increments |
| RoPE | A rotation in a 2D subspace — the one thing this renderer does natively and beautifully (the `R_z(θ)` idiom in `matrix-transformations.json`). A strong argument for keeping RoPE |
| Live numbers | `labelExpr` (per frame). **`{{expr}}` overlays evaluate `t` as 0** (`src/overlay.ts:506`) — they update on slider change but never on the clock |

**Verified absent** (do not assume otherwise): no table/chart/image element · no `colorExpr` (`grep -rn colorExpr src/ schemas/ scripts/` → zero hits; abandoned, see §7) · no curved connectors · no arrowhead on `animated_line` · no decimal `textExpr` (integer `%d` only).

**Superseded since the first draft:** this section originally read "no matrix/heatmap element". That is no longer true — `tensor` is element type #24 (`schemas/lesson.schema.json:238`, `src/objects/index.ts:59`), landed in #622. Every recipe below that once said "grid of cells" now says "one `tensor`".

**Corrected from an earlier survey:** `grid` **does** support non-square ranges and per-axis divisions on `main` — see `src/objects/grid.ts:69–110` and commit `a44016eb` (#616). An N×M cell lattice is therefore drawable with a real `grid` element.

**Hard renderer rule:** every scene needs at least one MathBox element (`grid`/`axis`/`point`/`surface`) or the loading splash never dismisses. A scene built only from three.js elements hangs.

---

## 7. Prerequisite — resolved. `tensor` ships on `main`

**This section previously specified a `colorExpr` PR that had to land before the lesson. That approach was abandoned, and something better shipped instead.** The lesson has no remaining renderer prerequisite.

`colorExpr` would have coloured a *grid of `animated_polygon` cells* — 36 elements for one 6×6 attention matrix, repeated per scene. That is the anti-pattern, not the fix: the JSON becomes unreadable, and the cost is the cells, not the colour. So the work became a **composite element** instead. `tensor` (#622) is one JSON object that the renderer expands into a merged lattice at render time — a single non-indexed `BufferGeometry` with a vertex-colour attribute, so one mesh, one material, one draw call.

`colorExpr` was then dropped rather than shipped alongside: zero scenes used it, and its only motivating case was the pattern `tensor` removes. `grep -rn colorExpr src/ schemas/ scripts/` → still zero hits, deliberately.

### 7.1 The contract the lesson authors against

One element per matrix. `shape` is any rank; the grid layout draws the last dimension horizontally and the one before it vertically.

- **Three value sources**, all normalized to flat + `shape` internally:
  - `valueExpr` — **live**, one math.js expression evaluated per cell per frame with `row`, `col`, `idx` bound (0-based). This is the softmax/attention case.
  - `values` — **static** literals, nested (`[[1,2],[3,4]]`) or flat row-major. Built once, zero per-frame cost. This is the causal mask.
  - `dataTable('name', row, col)` inside `valueExpr` — **baked**, reading the scene's `data` block. This is how real model weights enter the lesson (§3.1): shipped in the JSON, reproducible offline, nothing invented at render time.
- **Colour:** `colorMap` (named ramp or `{stops:[{t,color}]}`) + `colorDomain` `[lo,hi]`, normalized then clamped.
- **Labels:** `axes` — per-axis metadata, `axes[k]` describes `shape[k]`, positioned automatically against the lattice. This is where the token strings go; **do not** put a `label` on cells (§7.2).
- **Layout:** `cellSize` (data-space pitch, default 1) and `gap` (fraction of `cellSize`, default 0.08, so spacing survives a `cellSize` change).
- **Opacity:** honours the global Planes control as `opacity × planeOpacity`; `shader.ignorePlaneOpacity: true` opts out, which is what the demo scene uses — a lattice at the 0.2 default is hard to read.

Reference: [`tensor.md`](../../.agents/skills/lesson-builder-scene-builder/reference/objects/tensor.md) in the scene-builder skill, and [`scenes/draft/tensor-demo.json`](../../scenes/draft/tensor-demo.json), which exercises all three value sources plus a rank-1 row.

### 7.1a The three pre-existing bugs — all fixed

This section listed three bugs the work would expose. Each landed, verified against `main`:

1. ~~`validate_content.py` / `lint_scene.py` keep hardcoded `EXPR_KEYS` with no `*Expr` catch-all~~ — **fixed** (#622). Both now derive from the shared `is_expression_key`, so the rule lives in one place.
2. ~~`audit_expressions.py` tests `field_key in _SCANNED_KEYS`, misclassifying every `*Expr` field as `js_uncovered`~~ — **fixed** (#622). Now `_carries_expressions(field_key)`, mirroring `src/trust.ts`.
3. ~~`animated_polygon` never sets `userData.targetOpacity` / `ignorePlaneOpacity`~~ — **fixed** (#622, #623). #623 went further than this note anticipated: the same base also has to reach `fadeInTracker`, or a step-added lattice fades in fully opaque and stays there. The note's claim that a drag "blanks polygon cells permanently" was itself wrong — the drag restored, but at the slider's value rather than the element's own, discarding authored opacity.

### 7.2 Authoring gotchas to carry into the lesson

- An expression matching `_JS_ONLY_RE` (`src/expr.ts:131`) compiles **silently to `0`** in an untrusted scene. For a `valueExpr` that means a uniformly dark lattice at whatever colour `colorDomain`'s low end maps to, and a clean console.
- That regex includes `\bif\b` and `\.method(` — so `if(w>0.5,1,0)` and `w.toFixed(2)` both trip it. Use the ternary `w > 0.5 ? 1 : 0` and the free function `toFixed(w, 2)`.
- Label a lattice through `axes`, **never** by giving cells a `label` — the legend keys on `label` + `color`, so labelled cells produce one legend row each.
- 8-digit hex alpha validates against the schema but is discarded by `parseColor` (`src/labels.ts:230`), which reads only bytes 0–5. Put alpha on `opacity`.

---

## 8. Prior art — what the good explainers actually encode

| Source | What it does | Take |
|---|---|---|
| **Transformer Explainer** (poloclub; CHI 2026, arXiv 2408.04619; 90-participant study) | Every matrix on one purple sequential scale; self-attention view animates dot-product → scale+mask → softmax as three adjacent matrices; intermediate ops **collapsed by default**, expandable on demand; hover any cell for its value; repeated blocks collapsed, heads stacked; live GPT-2 in the browser | The three-matrix sequence (§6.4) and collapse-by-default |
| **Bycroft, LLM Visualization** | Fully 3D walkthrough of a working GPT-style model — zoom into every layer, head and matmul | Closest prior art to what this renderer natively does; evidence the layer-stack of §6.1 is a proven form, not an invention |
| **BertViz** | The standard attention-pattern tool (head / model / neuron views) | Also the source of the honesty caveat in §6.4 — its own docs point users at saliency methods for real attributions |
| **3Blue1Brown, attention chapter** | The `KᵀQ` grid-of-all-dot-products framing; builds from a single query before generalizing | The scene-3 ordering: one query first, then vectorize |
| **AnimatedLLM** (arXiv 2601.04213) | Deliberately targets an *intermediate* abstraction level, between box diagrams and full matrix detail | Precedent for the collapse/expand decision |

**Transferable conclusions:** collapse by default and expand on demand; show the intermediate matrices, not only the result; use real numbers; keep one visual language across the whole lesson.

### 8.1 Source hierarchy — and what each tier may be used for

A tiered table rather than an unranked bibliography, so "is book X relevant?" has a standing answer.

| Tier | Source | May be used for | May **not** be used for |
|---|---|---|---|
| **1 — architecture spine** | Murphy, *PML: An Introduction* (2022) §15.4–15.5; Vaswani et al. 2017 | Definitions, shapes, the classic block | The modern deltas — predates them |
| **1 — modern deltas** | Primary papers: RoPE (Su et al.), RMSNorm (Zhang & Sennrich), SwiGLU (Shazeer), GQA (Ainslie et al.); Raschka, "The Big LLM Architecture Comparison" | Everything in the modern half; the delta list | Pedagogical ordering |
| **2 — probabilistic framing** | Murphy, *PML: Advanced Topics* (2023) §16.2.7 (attention layers), §22.4 (transformers, inside autoregressive models) | The chain-rule closing frame; the causal-mask justification (§8.2) | Teaching order; the modern deltas |
| **2 — visual design** | Transformer Explainer; Bycroft LLM-Viz; BertViz; 3Blue1Brown | Visual encodings, abstraction levels, collapse/expand | Mathematical claims |
| **2 — implementation / ground truth** | Foster, *Generative Deep Learning* 2e (2023) ch. 9 — builds GPT from scratch in Keras. Cuenca et al., *Hands-On Generative AI with Transformers and Diffusion Models* (2024) — HF ecosystem | **Producing §3's numbers**: Foster for the from-scratch toy whose weights get baked in; Hands-On for pulling real attention maps off a pretrained model for the reality-check beat | Architecture claims and derivations — both are framework-flavoured implementation books |
| **3 — background only** | Russell & Norvig, *AIMA* 4e (2020) | The historical arc (n-grams → RNNs → attention) for scene 1's opening beat | Anything in §4, any proof in §5, and the entire modern half |

**Considered and not used.** Iusztin & Labonne, *LLM Engineer's Handbook* (2024) — an MLOps/production book about the lifecycle *around* a model (data pipelines, RAG, SFT/DPO, quantization, deployment). No derivations; nothing in §4 or §5 could be sourced from it. Its one adjacent contribution is KV-cache economics, for which the GQA paper is the better citation. Recorded so the decision is not re-made.

*Verification notes.* Murphy section numbers are from the freely-available online editions, which are revised periodically — re-check before citing. AIMA's exact subsection could not be confirmed during this research (`aima.cs.berkeley.edu` refused the connection); it is the deep-learning-for-NLP chapter in the 4e numbering, and the section number needs checking against the book.

### 8.2 The probabilistic frame — and why scene 6 needs it

Murphy's *Advanced Topics* places transformers inside **autoregressive models**, and that framing fixes a real weakness in the outline. The architecture is a parameterization of `p(xₜ | x_<t)`; the whole model is a device for representing the chain-rule factorization `p(x) = Πₜ p(xₜ | x_<t)`.

Two consequences worth teaching:

- **The causal mask stops being a trick.** It is exactly what makes it legal to train on every position in a single parallel pass: each position conditions only on its own prefix, so one forward pass evaluates every factor of the product at once. This is the honest answer to "why mask instead of just not showing the model the future", and it ties directly to the vectorization topic in §2.1.
- **Scene 6 gets a real ending.** "Sample a token" is thin. "Everything you have just seen is machinery for parameterizing one conditional distribution, and generation is repeated sampling from a chain-rule factorization" is a substantially better final beat — and it is one equation.

---

## 9. Pedagogy

### 9.1 Progressive disclosure

The overview-plus-on-demand-detail structure validated by Transformer Explainer's user study maps directly onto the cumulative step model: the layer stack is the overview, and each scene expands one part of it without discarding the whole.

### 9.2 Predict-before-reveal — four points

Following the [`scenes/special-relativity.json`](../../scenes/special-relativity.json) idiom: neutral-coloured candidates, a PREDICT step whose `prompt` explicitly forbids the tutor from answering, then a REVEAL step that removes and re-adds the elements recoloured.

| # | Prediction | Reveals |
|---|---|---|
| 1 | Shuffle the tokens — does the output change? | Permutation equivariance; motivates positional encoding (proof 1) |
| 2 | What happens to a softmax row if we drop `1/√d_k`? | The variance argument (proof 2) |
| 3 | Which token will head 2 attend to? | Heads specialize differently |
| 4 | What does the causal mask forbid, and why not just hide the future? | The chain-rule/parallel-training answer (§8.2) |

### 9.3 Misconception targets

Each tied to the step that kills it:

| Misconception | Killed by |
|---|---|
| Q, K, V are three different inputs | Scene 2, step 1 — one vector, three projections |
| Attention weights are learned parameters | Scene 3 — edges redraw as the input changes (§6.1) |
| The mask is applied after softmax | Scene 3, mask step — rows stop summing to 1 |
| `√d_k` refers to `d_model` | Scene 3 — `d_k ≠ d_model` by construction (§3) |
| Multi-head means multiple models | Scene 4 — one residual stream, concatenate then project |
| Positional encoding is concatenated | Scene 1 — it is added |
| An attention heatmap explains the prediction | Scene 3 remark step (§6.4 rule 4) |

---

## 10. Scene-by-scene outline

Six scenes. Each names its **manipulated** and **watched** quantity per §1.6.

### Scene 1 — Words become vectors
Tokens as IDs → embedding lookup → the permutation problem → positional encoding.
**Predict/reveal 1.** **Proof 1** (permutation equivariance).
*Manipulate:* token order · *Watch:* the vector set (unchanged), then the encoded set (changed).
Modern delta: sinusoidal PE introduced here; RoPE previewed and deferred to scene 2.

### Scene 2 — Q, K, V
One vector, three projections. `W_Q` shown as its column vectors and the parallelogram they span (§6.2). Rotate the query, watch which keys align.
**Modern delta: RoPE.** **Proof 3** (relative position).
*Manipulate:* query direction, RoPE position · *Watch:* alignment with each key; the score depending only on the gap.

### Scene 3 — Scaled dot-product attention *(the heart)*
Raw scores → the `1/√d_k` slider → softmax → causal mask → output in the convex hull. Three heatmaps side by side (§6.4 rule 2). Then **vectorization**: one query generalizes to `QKᵀ`, shapes annotated.
**Predict/reveal 2 and 4.** **Proofs 2, 4, 5**, plus the "not explanation" remark.
*Manipulate:* query index, scaling, mask toggle · *Watch:* row sharpness, row sum, the output point moving inside the value hull.

### Scene 4 — Multi-head → GQA
Two heads as two subspaces with different patterns; concatenate then project by `W_O`. Then the KV-cache question and **GQA** as the answer, with the saving quantified.
**Predict/reveal 3.** Candidate site for the **real-model beat** (§3.1).
*Manipulate:* head selector, KV-group size · *Watch:* the pattern; the cache size.

### Scene 5 — The block
The residual stream as the stack's vertical axis, with sublayers writing increments. Post-LN vs pre-LN. LayerNorm vs RMSNorm. FFN as a genuine dense layer (§6.1 — the one place the neuron picture is correct), then SwiGLU.
*Manipulate:* norm placement, norm type, activation · *Watch:* what the residual branch carries; how little RMSNorm changes the direction.

### Scene 6 — Stack and sample
Repeat the block; representations drift with depth. Final norm → unembedding → logits → temperature. Closes with the chain-rule frame (§8.2) and a modern-deltas summary table of everything already seen.
*Manipulate:* layer, temperature · *Watch:* the trajectory through depth; the distribution sharpening and flattening.

---

## 11. Open questions

1. ~~**`colorExpr` PR scope**~~ — **resolved.** `colorExpr` was abandoned in favour of the `tensor` composite element (#622), and all three §7.1a bugs landed with it and #623. No renderer prerequisite remains; the lesson is unblocked.
2. **The `transformer` domain library** (§12) — its own PR, or bundled with the lesson?
3. **Build the softmax/temperature sibling lesson first?** Scene 3 and scene 6 both lean on it.
4. **`proofs/domains/ml/`** — create the domain now with proofs 2 and 3, or after the lesson ships?
5. **Real-model beat placement** — scene 4 (next to multi-head patterns) or scene 6 (as the closing reality check)?

---

## 12. Appendix — how the forward pass gets computed

Three options; the third is recommended.

| Option | Verdict |
|---|---|
| Inline math.js expressions | Honest, but unwritable at 6×6 attention |
| Scene `functions` with IIFE JavaScript | Works ([`scenes/gradient-descent-terrain.json`](../../scenes/gradient-descent-terrain.json) does this) but forces `unsafe: true` and a trust dialog on the whole lesson |
| **A domain library** at `static/domains/transformer/index.js`, imported via `"import": ["transformer"]` | **Recommended.** Registers `attn(i,j)`, `score(i,j)`, `qv(i,d)`, `rope(...)`, `ffn(...)`, `softmaxT(...)` into the sandbox, computing a real forward pass in JS with slider-keyed caching — the pattern `static/domains/astrodynamics/index.js` already uses. **Importing a domain does not require `unsafe`.** Reusable by every future ML lesson |

Document the `sliderContracts` block alongside it; `static/domains/astrodynamics/docs.json` is the format.
