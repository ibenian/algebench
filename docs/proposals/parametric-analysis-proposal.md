# Parametric Analysis Visualization — Proposal

> AI-assisted, multi-dimensional response charts that let learners *feel* how quantities relate in an equation. Sliders, animation drivers, dimension-pickers, and AI-suggested viewport sets, built on top of the existing semantic graph and proof structure.

> **AlgeBench's motto: AI for human understanding — not for outsourcing thought.**
> The AI's job here isn't to compute the answer or to render the curve. It's to pick *which* curve is worth showing, set up the apparatus, and step out of the way so the learner does the seeing.

---

## 1. What we're trying to do

Most proof steps in AlgeBench currently end with an equation: a relationship between symbols. The learner reads the equation, maybe inspects the semantic graph, and moves on. What's missing is the **felt sense** of the relationship — how output `y` actually responds when input `x` moves, what happens at limits, where the relationship is linear vs. exponential vs. saturating, which parameters dominate.

Goal: every proof step that contains a quantitative relationship should be one click away from an interactive viewport where the learner can drag sliders, watch the response surface deform, and build intuition. The AI's role is to set up the viewport intelligently — pick what to vary, what to pin, what range, what the pedagogically interesting story is — using the semantic graph and proof context that already exist.

---

## 2. Existing methods — survey

### 2.1 Manipulate-style sliders (e.g. Mathematica, Desmos, GeoGebra)

The classic interactive-function-plot pattern. Pick free vars, pin the rest, plot `y(x)`. Sliders update params live; the curve redraws.

- **Dimensions visualizable:** typically 1 input + 1 output on a 2D plot, or 2 inputs + 1 output on a 3D surface. Sliders for 2–10 additional pinned params.
- **How to use:** author writes the equation, declares which vars are free vs. pinned, sets slider ranges and defaults. Learner drags sliders and watches the plot update in real time.
- **Strengths:** lowest cognitive load, immediate cause-and-effect feedback, near-universally familiar UI pattern.
- **Weaknesses:** scales poorly past 2–3 free params; the author has to design every viewport by hand; "what's the right thing to plot" is a creative decision the tool doesn't help with.
- **Maps to AlgeBench:** **direct match for the user's original proposal.** This is the first thing to build.

### 2.2 Multi-viewport composition (the user's extended proposal)

Instead of one plot trying to show everything, use **several smaller viewports side-by-side**, each surfacing a different slice or projection of the parameter space. A 5-param equation might split into:

- viewport A: 3D surface of `y` vs `(x₁, x₂)` at fixed `(x₃, x₄, x₅)`
- viewport B: 2D plot of `y` vs `x₃` at the current `(x₁, x₂)` cursor
- viewport C: phase portrait if the relationship is dynamical
- viewport D: bar/heatmap showing relative sensitivities

Sliders are shared across viewports; touching one updates all of them in lockstep.

- **Dimensions visualizable per viewport:**
  - 2D plane: 2 dims (x, y)
  - 3D surface: 3 dims (x, y, z)
  - 3D + color: 4 dims (x, y, z, color = scalar field like temperature, energy)
  - 3D + color + point size: 5 dims (add mass, density, weight)
  - 3D + color + size + shape glyph: 6 dims
  - With multiple viewports, the *effective* dimensionality of what the learner can interrogate stretches further — they pick which slices they want to see.
- **How to use:** author or AI declares a "viewport bundle" — a list of viewports with their axis assignments. Learner picks which viewport to "drive" and the rest react.
- **Strengths:** sidesteps the high-dim-on-one-plot problem, leverages perceptual channels well (color = scalar quantity is a strong cue).
- **Weaknesses:** layout is hard, color/size encodings need careful legend design, learners can get overwhelmed if more than ~3 viewports are visible at once.
- **Maps to AlgeBench:** **the natural extension.** AlgeBench already has viewports (3D scene + chart panel), so the panel system can host these.

### 2.3 Animation drivers per parameter

Instead of (or in addition to) sliders, each free parameter can be hooked to an **animation function** — linear ramp, sine, log-sweep, parameterized-curve-through-config-space — so the parameter sweeps automatically and the learner watches the trajectory in the response space.

- **Dimensions:** any number of params, each with its own driver.
- **How to use:** learner picks a driver per parameter (e.g. "x sweeps linearly 0→10 over 5s, y oscillates as sin(t)"), watches the response surface trace out a path.
- **Strengths:** reveals trajectories and limit cycles that static slider-poking misses; makes time-dependence concrete.
- **Weaknesses:** can become hypnotic without conveying anything; requires careful default driver choices.
- **Maps to AlgeBench:** straightforward extension of slider model — slider becomes "param source" with a `kind: linear | sine | manual | …` selector.

### 2.4 User-pickable dimension assignment

Let the learner say "x of the equation goes to viewport's x-axis, height-of-bar maps to y, color maps to z, point size maps to mass." The viewport rebinds at runtime.

- **Dimensions visualizable:** 5+ on a single viewport when the perceptual channels are right (position x/y/z, color, size, shape, opacity, motion-trail).
- **How to use:** UI shows a binding panel — for each visual channel of the viewport, a dropdown of available semantic-graph quantities. Learner remixes.
- **Strengths:** the most exploratory mode; learner is doing visualization design, which is itself pedagogically valuable; works especially well when learner doesn't yet know what's important.
- **Weaknesses:** requires more UI scaffolding; bad bindings produce unreadable views (the AI can suggest defaults).
- **Maps to AlgeBench:** lives on top of (2.2) — once viewports support arbitrary axis-to-quantity binding, this is a UX feature.

### 2.5 Planar dissection of a higher-dim surface

If the response is a function of 3 inputs, the full graph is a 3D-input → 1-output hypersurface (4D). Instead of "3D surface at fixed third param," show:

- A **3D volume** colored by output (4D viz: x, y, z, color = output).
- A **2D plane** at user-chosen `z = z₀`, showing the cross-section.
- The plane is movable with a slider; learner sees the cross-section morph as the slice plane sweeps.

This is what the user described as "if user picks x, h as the plane, the surface chart draws it as a planar dissection."

- **Dimensions:** up to 4D in a single viewport.
- **How to use:** learner picks the slicing plane via slider; AI picks the default slice that's pedagogically interesting (often a regime boundary or a known physical case).
- **Strengths:** keeps the high-dim story present (the colored volume) while letting the learner zoom into specific slices.
- **Weaknesses:** volume rendering is GPU-expensive; learners need a moment to read the colorbar.
- **Maps to AlgeBench:** MathBox can do the 3D + plane intersection; the viewport just needs an extra "slice" mode.

### 2.6 Parallel coordinates

For high-dim data (5+ params), draw each parameter as a vertical axis; a single configuration is a polyline crossing all axes at its values. Brushing on one axis filters / highlights configurations that pass through.

- **Dimensions visualizable:** 5–20 dims comfortably.
- **How to use:** learner brushes on axes ("show me configurations where `β` is high and `v₀` is low"), and the response output highlights the matching set.
- **Strengths:** scales to many parameters; great for sensitivity intuition; reveals correlations between params.
- **Weaknesses:** abstract — feels like a database UI, not a physical phenomenon. Bad first-encounter for novices. Better as a complementary viewport once the learner already has intuition from the slider/surface views.
- **Maps to AlgeBench:** worth implementing as a *secondary* viewport mode for advanced lessons (e.g. once the learner has played with sliders, switch to parallel coords to discuss sensitivity).

### 2.7 Phase portraits / vector fields / nullclines

For ODE systems (`dx/dt = f(x, y)`, `dy/dt = g(x, y)`), draw the vector field over the (x, y) plane. Trajectories integrate forward in time; nullclines (where one component of the field is zero) partition the plane into regions of qualitatively different behavior.

- **Dimensions:** 2–3 state variables natively.
- **How to use:** sliders control the parameters of `f` and `g`; the field redraws live; learner clicks anywhere in the plane to launch a trajectory.
- **Strengths:** *the* canonical tool for dynamical systems pedagogy. Reveals fixed points, stability, bifurcations, limit cycles in a way that the equation alone never does.
- **Weaknesses:** only applies to ODE-shaped problems.
- **Maps to AlgeBench:** when the proof step's classification is `ODE`, the parametric viewport should default to a phase portrait. Already implied by `Classification.kind: "ODE"` in the schema.

### 2.8 Sensitivity / Sobol indices, tornado plots

Quantify "if I perturb param `i` by 10%, how much does output `y` change?" Variance-based decomposition (Sobol) attributes total output variance to each input.

- **Dimensions:** any number of inputs; output is a scalar bar chart.
- **How to use:** the AI runs a quick Monte Carlo and shows a sorted bar chart — "your output is 70% sensitive to `β`, 20% to `v₀`, 10% to the rest."
- **Strengths:** directly answers "which parameter matters most?" — cuts through the visual noise of high-dim systems.
- **Weaknesses:** quantitative, not visual; needs the underlying function to be cheaply evaluable.
- **Maps to AlgeBench:** great as a "summary" viewport that sits next to the interactive ones — it tells the learner where to focus their slider-poking attention.

### 2.9 Limiting / asymptotic behavior visualization

When a parameter is taken to a limit (→ 0, → ∞, → some critical value), the equation often **simplifies dramatically** or **changes qualitative character**. Pedagogically this is one of the highest-value moves available — it's how generations of physicists check that a formula is sensible ("does it reduce to Newton in the low-velocity limit?") and how learners discover that a complicated expression is really just a familiar one in disguise.

**Vocabulary** — different sub-fields use different names for the same phenomenon. The proposal uses these terms uniformly:

| Term | Meaning | When it applies |
|------|---------|-----------------|
| **Asymptotic analysis** | Umbrella term for studying behavior as a parameter → 0, → ∞, or → a critical value. | Any time a parameter has a natural extreme. |
| **Limiting behavior** / **limiting case** | The everyday phrase. "In the limit of small β..." | Day-to-day discourse; broadest scope. |
| **Limiting regime** | The *region* of parameter space, not the limit point. ("Drag-dominated regime.") | Discussing whole zones of validity. |
| **Regular limit** | Equation simplifies smoothly; recovers a known special case. | E.g. relativistic → Newtonian as v/c → 0. |
| **Singular limit** | Limit changes the *qualitative* nature of the equation (e.g. drops a derivative; introduces a boundary layer). | E.g. viscous → inviscid; quantum → classical. |
| **Boundary / edge / corner case** | Limit at the edge of validity. | Domain boundaries, physical extremes. |
| **Perturbation theory** | Systematic technique: expand the solution as a power series in a small parameter ε. *Singular perturbation* if there's a boundary layer. | Many ODE / PDE problems. |
| **Scaling limit** | Multiple quantities rescaled simultaneously as a parameter → limit. | Continuum, hydrodynamic, mean-field limits. |
| **Critical limit / critical regime** | Limit at a phase transition or bifurcation point. | Statistical mechanics; nonlinear dynamics. |

**Why this is a viewport mode, not just a slider extreme.** A slider can be dragged toward an endpoint, but several pedagogically important things are lost when you do:

1. The simplified expression that the equation *becomes* in the limit (Taylor expansion, dominant-balance argument).
2. The *rate* at which the limit is approached — power-law, exponential, oscillatory decay.
3. Whether the limit is regular or singular — does the curve smoothly approach the limiting case, or does some derivative blow up / drop out?
4. The *width* of the asymptotic regime — at what parameter values does the limiting behavior become a good approximation?

A dedicated **limiting-behavior viewport** surfaces all four. Concretely:

- **Side-by-side comparison.** Full expression curve overlaid with the limiting / leading-order curve. Shaded "regime of validity" region where they agree to within some tolerance.
- **Symbolic limit annotation.** "As β → 0, $\bar{a} \approx -V_t / \Delta t$." (Authored by AI from the proof step + semantic graph; renderable as LaTeX.)
- **Limit-direction slider.** A single slider that drives the *limit parameter* alone, while annotating which regime each value sits in ("subsonic", "transonic", "supersonic", "hypersonic"). Often more useful than free-axis sliders for the pedagogical question "what happens as I push X to its extreme?"
- **Loglog axes when appropriate.** Power-law approaches are invisible on linear axes; log-log makes them straight lines whose slope = the exponent. The AI proposer should pick log-axes automatically when the relationship is power-law-like.
- **Sanity-check overlay.** "Does it reduce to Newton in the limit v/c → 0?" Plot the limiting form on the same axes; verify they touch in the right regime. This is the canonical sanity-check move applied to a learner-facing tool.

- **Dimensions visualizable:** typically 1 input + 1 output + the limit-parameter as the slider; 2D plot. The richness comes from the *overlays* (full vs. limiting curve, regime shading, asymptotic annotation), not from extra spatial dimensions.
- **How to use:** AI identifies a parameter with a natural limit, picks the limiting expression (Taylor series, dominant-balance argument, or known special case), authors the regime labels and tolerances. Learner drags the limit slider and watches the full and limiting curves converge or diverge.
- **Strengths:** highest pedagogical density per pixel — directly answers "what does this equation become when X is small / large / critical?", which is one of the most under-served questions in math education. Makes regular-vs-singular distinction visceral.
- **Weaknesses:** requires the AI to do real symbolic work (deriving the limiting expression). A regular limit is straightforward; a singular limit is a research-grade question. Phase 5 territory for the hard cases.
- **Maps to AlgeBench:** the proposer agent gets a new responsibility — for every proposed `parametricView`, also propose a "limit story" (which parameter has an interesting limit, what the limiting expression is, what regime labels to apply). When present, the renderer adds a "limiting behavior" sub-viewport beside the main one.

```jsonc
{
  "id": "limit-story",
  "kind": "limiting-behavior",
  "limitParam": "v",
  "limitDirection": "to-zero",
  "limitingExpression": "F \\approx m a",
  "regimeLabels": [
    { "range": [0, 0.1],  "label": "Newtonian", "regime": "regular" },
    { "range": [0.1, 0.9], "label": "Relativistic correction", "regime": "transition" },
    { "range": [0.9, 1.0], "label": "Ultra-relativistic", "regime": "singular" }
  ],
  "rationale": "v/c → 0 recovers Newton's second law. Verifying this is the canonical sanity check for relativistic mechanics."
}
```

This unlocks a class of lessons that other tools handle poorly. Existing graphing tools (e.g. Desmos) can plot two curves side-by-side, but they don't explain *why* one is the asymptotic form of the other or annotate the regime structure. That annotation work is exactly the AI's job here — and it's directly downstream of the semantic graph and proof context AlgeBench already has.

#### 2.9.1 Bidirectional AI ↔ user interaction in the asymptotic viewport

The asymptotic viewport is the place where the *conversation* between AI and learner becomes most valuable. Two directions, both first-class:

**Direction A — AI proposes, learner picks.**
The proposer agent enumerates a *menu* of interesting asymptotic setups for the current step, with one-line rationales each:

> 1. **v/c → 0** — recovers Newton's second law. *(Sanity check.)*
> 2. **β → ∞** — drag dominates; terminal velocity emerges. *(Regular limit, builds intuition for terminal-velocity concept.)*
> 3. **Δt → 0** — impulsive limit; force becomes a delta function. *(Singular limit; introduces the impulse concept.)*
> 4. **m → 0** — massless-particle limit; equation degenerates. *(Singular; useful for showing why classical mechanics has a domain of validity.)*

The learner clicks one and the viewport reconfigures: the named limit parameter becomes the slider, the regime labels load, the limiting expression renders, the side-by-side overlay turns on. AI commentary streams alongside ("notice how the curves agree to within 1% once v/c < 0.05 — that's why Newton was 'right enough' for 200 years"). This is the **guided** mode: the AI is teaching with a syllabus.

**Direction B — Learner picks params, AI interprets.**
The learner drags sliders manually — maybe wandering, maybe targeted. As the configuration changes, the AI **classifies the current regime in real time** and surfaces commentary:

> *"You're now in the supersonic / pre-shock regime. The drag coefficient $C_d$ has just crossed its peak around Mach 1. Notice the surface curvature flipping sign — that's the transonic singularity making itself known."*

> *"Both β and v are now small — you've entered the regime where neither term dominates and the equation doesn't simplify. Most lessons skip this corner because it's the boring case, but it's also the most physically common."*

The AI's job here is **regime recognition**, not picking. It needs to know which slice of parameter space the learner is in and what's interesting about that slice. This is the **exploratory** mode: the AI is reading along over the learner's shoulder.

**Inquiry as a first-class interaction.**
Either direction admits a question loop. The learner can ask:

- "Why does the curve flatten here?"
- "What happens if I push β even further?"
- "Is this regime physically realizable?"
- "What approximation am I implicitly making by sitting here?"

…and the AI answers in context, optionally adjusting the viewport (zooming, switching to log-axes, overlaying a comparison curve) to support the answer. This is what the existing chat agent does for prose; this proposal extends it to the parametric viewport so the learner can talk *about the slider position itself*.

**Three modes, one viewport.**

| Mode | Initiator | AI's role | Learner's role |
|------|-----------|-----------|----------------|
| **Guided** | AI | Propose setup + run commentary | Pick from menu, watch, ask follow-ups |
| **Exploratory** | Learner | Classify the current regime, narrate | Drag sliders freely |
| **Inquiry** | Either | Answer questions about current state | Ask questions |

All three should compose freely — the learner can start guided, pivot to exploratory, then ask an inquiry question, all without leaving the viewport.

**Schema implications.**
The `parametricViews[].kind: "limiting-behavior"` block already supports the *guided* mode (the `regimeLabels` and `limitingExpression` fields). To support exploratory + inquiry, the proposer must additionally output a **regime map** — a partition of the full parameter space into named regions with characterizations:

```jsonc
{
  "regimeMap": [
    {
      "id": "newtonian",
      "predicate": "v/c < 0.05",
      "label": "Newtonian regime",
      "story": "Classical mechanics applies; relativistic corrections < 1%."
    },
    {
      "id": "transition",
      "predicate": "0.05 <= v/c < 0.5",
      "label": "Mild relativistic correction",
      "story": "Lorentz factor γ becomes noticeable; momentum and energy formulas diverge from Newtonian by a few percent."
    },
    {
      "id": "ultra-relativistic",
      "predicate": "v/c >= 0.9",
      "label": "Ultra-relativistic",
      "story": "γ → ∞; rest mass becomes negligible compared to kinetic energy. Singular limit at v = c."
    }
  ]
}
```

The renderer evaluates each `predicate` against the live slider state and surfaces the matching regime's `label` + `story` as live commentary. The chat agent gets the regime ID injected into its context so questions like "what regime am I in?" are answered without round-tripping through Gemini just to look up coordinates. Inquiry questions still go to Gemini, but with the regime ID and current parameter values pre-populated in the prompt — so the answer is tailored to *exactly where the learner is sitting* rather than being a generic textbook response.

This separation matters: it keeps the *cheap* commentary (regime labels) instant and offline, and reserves *expensive* AI calls for genuine inquiries the learner explicitly asks. Same architectural principle as the existing semantic-graph enrichment — pre-compute the cacheable parts at authoring time, run the model only for live questions.

### 2.10 Explorable Explanations

Less a "method" and more a **design philosophy** ([Wikipedia: Explorable explanation](https://en.wikipedia.org/wiki/Explorable_explanation)). The thesis: traditional symbol-pushing math is opaque to most humans not because they lack intelligence, but because static symbols give no feedback. Replace the static symbol with a manipulable visual representation, and intuition follows.

Notable artifacts in this lineage:
- Bret Victor — coined the *Explorable Explanations* phrase and authored foundational essays on interactive representation (e.g. *Up and Down the Ladder of Abstraction*, *Scrubbing Calculator*).
- Nicky Case's *Parable of the Polygons*, *Evolution of Trust* — narrative-driven explorables.
- Bartosz Ciechanowski's articles (clocks, internal combustion engine, GPS) — gold-standard execution: every concept introduced is a manipulable widget the reader plays with before moving on.
- Distill.pub (now archived) — mostly ML, but the format set the standard for academic explorables.

- **Dimensions:** as many as the author wants; each widget is custom.
- **How to use:** read the prose, hit a widget, play, move on. Reading-and-playing is interleaved.
- **Strengths:** the gold-standard format for self-taught understanding. Proven across thousands of readers.
- **Weaknesses:** **enormous authoring cost.** Every widget is hand-built. Doesn't scale. This is precisely the bottleneck AlgeBench's AI-assist can break.
- **Maps to AlgeBench:** this is the *target form factor*. AlgeBench scenes already function as explorables (prose + manipulable visualization). Adding parametric viewports moves the per-step density of explorability from "one MathBox scene" to "one MathBox scene + N response surfaces + sliders." The AI does the per-widget design work that, in the Ciechanowski model, takes weeks of human effort.

---

## 3. The AlgeBench-specific opportunity

AlgeBench has three primitives no other tool in the survey above has co-located:

1. **Semantic graph per equation** — every quantity is typed (scalar, vector, derivative), dimensioned, named, role-classified (independent var, parameter, derived). The "what to vary, what to pin" decision can be derived, not authored.
2. **Proof / scene context** — the equation isn't free-floating. We know what regime it's valid in, what the prior step established, what the next step will use. The AI can pick *pedagogically* interesting axes, not just mathematically valid ones.
3. **Gemini enrichment loop** — already running per-step, already producing per-symbol descriptions. Extending the enrichment to also propose `parametricView` configs is a natural step on a path we're already walking.

The novel contribution of AlgeBench in this space isn't a new visualization technique. It's **automating the per-widget authoring cost** that explorable explanations have always been gated on.

This connects directly to the project motto:

> **AI for human understanding — not for outsourcing thought.**

The AI doesn't tell the learner what the relationship between `β` and stopping distance is. It builds the apparatus that lets the learner *feel* the relationship for themselves. Computation, plotting, axis-picking, sensible defaults — those are scut work the AI is happy to do. The understanding is non-transferable; only the learner can do it, and they do it by interacting with the apparatus.

---

## 4. Proposed architecture

### 4.1 Scene-JSON shape

Add an optional `parametricViews` block to a proof step:

Each `symbol` field references a node id from the proof step's parsed semantic graph (so the example below uses the same `V_i`, `V_f`, `\Delta t` that appear in the equation):

```jsonc
{
  "label": "Average acceleration",
  "math": "\\bar{a} = \\frac{V_f - V_i}{\\Delta t}",
  "parametricViews": [
    {
      "id": "primary",
      "kind": "surface-3d",
      "axes": {
        "x": { "symbol": "V_i",       "range": [10, 50],     "unit": "m/s" },
        "y": { "symbol": "\\Delta t", "range": [0.05, 0.5],  "unit": "s"   },
        "z": { "symbol": "\\bar{a}",  "kind": "derived"                    }
      },
      "pinned": [
        { "symbol": "V_f", "value": 0 }
      ],
      "marker": { "kind": "current-config" },
      "rationale": "Stopping g-load is most sensitive to the impact velocity / stop-time tradeoff; this surface makes the trade visible."
    },
    {
      "id": "secondary",
      "kind": "plane-2d",
      "axes": {
        "x": { "symbol": "\\Delta t", "range": [0.05, 0.5] },
        "y": { "symbol": "\\bar{a}",  "kind": "derived"    }
      },
      "pinned": [
        { "symbol": "V_i", "bound": "primary.x" },
        { "symbol": "V_f", "value": 0 }
      ]
    }
  ],
  "sliders": [
    { "symbol": "V_i",       "min": 5,    "max": 60, "default": 13.3, "driver": "manual" },
    { "symbol": "\\Delta t", "min": 0.01, "max": 1,  "default": 0.5,  "driver": "manual" },
    { "symbol": "V_f",       "min": 0,    "max": 0,  "default": 0,    "driver": "manual" }
  ]
}
```

Key fields:
- `parametricViews[].kind`: `surface-3d | plane-2d | volume-3d | phase-portrait | parallel-coords | sensitivity-bars | dissection | limiting-behavior`. (Kebab-case throughout for consistency.)
- `axes.{x,y,z,color,size,shape}`: each maps a visual channel to a semantic-graph symbol. `color` and `size` extend dimensionality without using spatial axes.
- `pinned`: symbols held fixed for this view, with optional `bound: "<other-view>.<axis>"` for cross-viewport coupling.
- `marker.kind`: `current-config` (a dot showing where the current slider state lands) or `trajectory` (when an animation driver is sweeping).
- `rationale`: AI-authored, surfaced in the UI as a tooltip — explains *why* this view was chosen.
- `sliders[].driver`: `manual | linear | sine | log-sweep | path:<config-trajectory>`.

### 4.2 AI agent: parametric-view proposer

A new agent (sibling to `SemanticGraphEnrichmentAgent`) that takes:
- The proof step's equation, semantic graph, and surrounding context.
- A list of available view kinds and their dimensionality budgets.

…and returns a ranked list of candidate `parametricView` configs with rationales. The author picks one (or accepts the top), and it lands in the scene JSON. The agent runs offline at authoring time, not on every page load — same model as the lesson-builder pipeline.

For ODE-classified steps, the default proposer should weight `phase-portrait` heavily. For algebraic relations with 2 free params, `surface-3d`. For 4+ free params, `parallel-coords` + a `sensitivity-bars` summary.

### 4.3 Renderer: viewport composition

The existing chart panel becomes a **viewport stack** — multiple viewports arranged in a small grid (1, 2, or 4-up depending on count). Sliders live in a shared dock below. Touching a slider updates all viewports simultaneously.

Each viewport kind is a separate ES module under `static/` (matching the existing vanilla-JS module pattern — `sliders.js`, `graph-view.js`, etc.); the renderer dispatches on `parametricViews[].kind`. The 3D modes reuse the existing MathBox infrastructure; the 2D and parallel-coords modes pull in a lightweight chart library (D3 or Observable Plot — choice deferred to Phase 1 implementation).

### 4.4 Handling proportionality and qualitative relations

Not every relationship is `y = f(x)` with concrete numbers. Some proof steps establish *proportionality* (`y ∝ x²`) without nailing down a constant. The visualization should still convey the *shape*:

- For proportionality, pick a representative constant (1.0) and label the axes as "arbitrary units" — the shape is what matters, not the scale.
- For implications (`x large ⇒ y small`), draw the conceptual region rather than a precise function — shaded zones, monotone arrows, regime boundaries.
- The AI proposer should classify the relationship's "concreteness" (`exact | proportional | qualitative`) and pick a visualization mode that doesn't oversell the data. Showing a three-decimal-place axis on a qualitative claim is itself a pedagogical lie.

This connects back to the motto: the apparatus should be **honest about what's known**. Don't fake precision the math doesn't have.

---

## 5. Phasing

**Phase 1 — single-viewport `Manipulate`.** Surface3D and Plane2D modes only. Author-authored `parametricViews` config (no AI yet). Sliders, manual driver. Goal: prove the renderer infrastructure on a couple of hand-authored scenes (splashdown ā vs Δt; ballistic coefficient lift curve).

**Phase 2 — AI proposer at authoring time.** New agent that takes a step + semantic graph and proposes `parametricViews` configs. Author reviews and accepts. Phase plays well with the existing lesson-builder skill chain.

**Phase 3 — multi-viewport composition.** Coupled viewports, shared sliders, marker-on-surface for current config. Adds Phase Portrait mode for ODE-classified steps.

**Phase 4 — user-pickable dimensions, animation drivers, dissection planes.** Once the basics are solid and learners are using them, layer in the exploratory features. Parallel coords and sensitivity bars land here as advanced viewport kinds.

**Phase 5 — qualitative / proportional relations.** Concreteness classification in the AI proposer; "honest" visualization modes for relations that don't have exact numerical form.

**Phase 6 — limiting / asymptotic behavior viewports.** AI proposer derives limiting expressions (regular limits via Taylor expansion, common-limit lookup; singular limits via dominant-balance heuristics where tractable). Side-by-side full-vs-limiting curve overlays with regime shading and annotated regime labels. Log-axis auto-selection for power-law approaches. Sanity-check mode for "does this reduce to the known special case?". Singular-limit detection (curve diverges from limiting form on one side; flag visually). This is the highest-leverage pedagogical move on the list — every introductory physics derivation is gated on "and in the limit, this recovers...".

---

## 6. Open questions

- **Performance.** A 3D surface with 4-channel encoding plus a vector field re-evaluated on every slider tick can be expensive. How aggressive should we be with caching / coarse evaluation during drag, fine evaluation on release?
- **Default ranges.** Picking slider min/max well is half the battle. The AI proposer needs reasonable defaults from the equation's units and the proof's regime context. How far can we lean on Gemini to get this right vs. needing a curated unit-database?
- **Cross-step persistence.** When the learner moves to the next step, do the slider values carry over (continuity of mental model) or reset (clean slate)? Probably configurable per lesson.
- **When NOT to show a viewport.** Some steps are purely symbolic transformations (`a + b = b + a`) where there's nothing to vary. The proposer needs to know when to abstain.
- **Exploration vs. directed learning.** Sliders invite play, which is great for self-taught learners but can derail a directed lesson. The narrator agent should be aware of which viewport the learner is interacting with and tailor commentary accordingly.

---

## 7. Acceptance criteria for the proposal landing

- [ ] Scene JSON schema accepts `parametricViews` and `sliders` blocks (additive, optional).
- [ ] At least one hand-authored Phase-1 example renders correctly (proposed: splashdown ā surface, since we just touched that lesson).
- [ ] Schema validator does not regress on existing scenes.
- [ ] Motto added to README in a visible spot.
- [ ] This proposal lives under `docs/proposals/` and is linked from the README's "Vision" section so contributors can find it.

---

## 8. Future ideas — companion methods worth exploring

These are sibling ideas that share the same architectural premise (AI sets the apparatus, learner does the seeing) and reuse the same primitives (semantic graph, proof structure, Gemini enrichment, interactive viewports). They're not in scope for the initial parametric-analysis work — but they're the natural next moves once the foundation lands. Each is sized as "could be its own future proposal."

Roughly ordered by leverage / how directly they exploit data we already have.

### 8.1 Dimensional-analysis viewport

Show the equation rewritten as **dimensionless groups** (Buckingham-Π). Sliders for each Π-group; learner sees that two physically different setups (different mass, different gravity, same Froude number) produce *identical* dynamics. Reynolds, Mach, Froude, Péclet, Knudsen — these are the unifying numbers of physics, and most curricula just announce them without showing *why* they're the right grouping.

- **Why high-leverage:** Buckingham-Π enumeration is mechanical from the semantic graph (units are already typed). The AI doesn't have to think — it has to count. The pedagogical payoff is enormous: dimensional analysis is the single most powerful "is this answer plausible?" tool in physics.
- **Maps to:** unit-aware enrichment we already do. Mostly a renderer + Π-group derivation script.

### 8.2 Bifurcation atlas

For families of dynamical systems indexed by a parameter μ, the AI auto-computes fixed points, classifies them (saddle, node, focus, center), and plots the **bifurcation diagram**. Learner drags μ across a critical value and watches a saddle-node birth or a Hopf bifurcation in real time, with the *qualitative* story (number of equilibria, stability) annotated alongside the quantitative trajectory.

- **Why high-leverage:** the moment when a system *changes character* is the single most under-served moment in dynamical-systems pedagogy. A bifurcation diagram makes it visceral; almost no classroom tool offers this.
- **Maps to:** extends the phase-portrait viewport (§2.7). Symbolic + numerical equilibrium-finding can lean on SymPy.

### 8.3 Approximation-quality heatmap

For an approximation (small-angle, paraxial, weak-field, low-Mach), color the parameter space by *how good* the approximation is — green where exact ≈ approximate, red where they diverge. The learner sees **the boundary of validity** of every approximation as a region, not as a verbal disclaimer.

- **Why high-leverage:** the direct generalization of the asymptotic-regimes idea (§2.9), applied to *any* approximation, not just limits. Almost free architecturally once §2.9 lands.
- **Maps to:** new viewport mode, builds on `regimeMap` machinery from §2.9.1.

### 8.4 Counterfactual / "what if you change the equation" mode

Not "what if you change the parameters" — what if you change the **operator** in the equation. The AI auto-derives sibling equations (drop a term, swap a sign, replace `^2` with `^3`, change Newtonian `F=ma` to relativistic `F=γma`) and shows the response surface for each side-by-side. Learner sees that "F = ma + ε·m·a²" deforms the parabola only slightly until ε grows.

- **Why high-leverage:** the formal version of what physicists do mentally all the time. *The* tool for building intuition about which terms matter.
- **Maps to:** AI-side mutation of the semantic graph + multi-viewport composition.

### 8.5 Conservation-law dashboard

For dynamical systems: live readout of every conserved quantity (energy, momentum, angular momentum, probability, mass, charge) as the simulation runs. When a slider perturbs the system, the learner sees which conservations hold and which break. Crucial for ODE / Hamiltonian pedagogy and almost never offered in classroom tools.

- **Maps to:** new sidebar widget; conservation laws can be auto-derived from Noether's theorem when symmetries are declared, or specified explicitly per scene.

### 8.6 Symmetry-and-invariance exploration

Apply a group action (rotation, scaling, Lorentz boost, gauge transformation) and watch what stays the same. Live overlay of "this quantity is invariant; this isn't." Connects Noether's theorem to a tangible widget — symmetry → conservation, *visible*.

- **Maps to:** transformation playground viewport; pairs naturally with §8.5.

### 8.7 Order-of-magnitude estimator (Fermi-style)

Learner punches in rough values for each variable; the AI shows the **log-decade** the answer lives in, with a sensitivity bar showing which inputs dominate. Targeted at developing the intuition Enrico Fermi was famous for and that almost no curriculum teaches.

- **Why high-leverage:** physics/engineering students often manipulate symbols fluently but freeze when asked "is that answer sane?" This widget *is* the missing instinct, externalized.
- **Maps to:** lightweight panel, runs cheap (just orders of magnitude, not full simulation).

### 8.8 Inverse / "find the parameters" mode

Show a **target curve**; learner drags sliders trying to match it. AI scores the fit live and gives hints ("you're close on the slope, off on the offset"). Reverses the usual "I give you parameters, you predict the response" loop into "I give you the response, you find the parameters" — which is what real experimental science actually does.

- **Maps to:** parametric viewport with overlay-match scoring; works on top of any §2.x viewport.

### 8.9 Worked-example variation generator

For a given proof step, AI auto-generates 3–5 numerically distinct worked examples that all instantiate the same structure. Learner clicks through them; pattern recognition kicks in. The pedagogical move: show the concrete instance, then the next, then the next, until the abstraction emerges from the comparison.

- **Maps to:** AI-side scene-instance generator; reuses scene-builder pipeline.

### 8.10 Live derivation-by-question

Instead of pre-authoring every proof step, the learner asks "but why does *that* step follow?" and the AI inserts a **new sub-step with its own viewport** between the current step and the next. Proofs become elastic — they expand on demand at exactly the level of detail the learner needs.

- **Why high-leverage:** structural, not just visual. The proof model itself becomes interactive. Connects directly to the proof-structure-v2 proposal (sub-proofs and branching).
- **Maps to:** extension to the proof-structure-v2 model + chat agent that can author new steps.

### 8.11 "Interrogate the formula" panel

Click on the `m` in `F=ma`, get a popup that answers: *what units? what physically? what range is realistic? what happens if I set this to zero?* — without leaving the equation. Makes the symbolic surface **probeable**, like inspecting a DOM element.

- **Why high-leverage:** lowest-effort, highest-frequency interaction on this list. You'd use it constantly. Most of the data is already in the semantic-graph enrichment; just needs UI.
- **Maps to:** click handler + popover; data comes from existing enrichment.

### 8.12 Cross-domain analogy viewport

The same equation appears in many domains. The AI surfaces the analogues: "this LRC circuit is structurally identical to a damped harmonic oscillator; here are both side-by-side with corresponding sliders." Two viewports, locked, different cosmetic skins, same underlying math.

- **Why high-leverage:** the *most* pedagogically valuable thing physics teaching does and the *least* well-supported by tooling. The "same equation, different costume" insight is what separates someone who memorizes physics from someone who *understands* it.
- **Maps to:** cross-scene linking + AI-side analogy detection.

### 8.13 Sensitivity-driven slider ordering

Trivial UX detail with outsized impact: order the sliders in the panel by *how much they affect the output right now*, not alphabetically or by appearance order. The learner's eye goes to the most consequential knob first. Recompute on every interaction.

- **Maps to:** small renderer change; reuses §2.8 sensitivity machinery.

### 8.14 Numerical-vs-analytical comparison view

For ODEs/PDEs, plot the analytical solution (where one exists) overlaid with the numerical integration. Slider for step size or solver tolerance. Learner sees numerical error grow, sees Euler diverge where RK4 stays bounded. Demystifies "numerical methods" as a topic.

- **Maps to:** dual-curve viewport, integrator selector dropdown.

### 8.15 Causal-chain mode for the semantic graph

You already render the semantic graph. Add a **trace mode**: click an output node, and the upstream contributions light up with their *current numerical contributions* annotated on each edge. Live sensitivity, structural — connects the symbolic graph view to the numeric viewport.

- **Maps to:** extension to the existing graph renderer; reuses sensitivity numbers.

### 8.16 Derivation-trajectory replay

Re-run a proof step-by-step and **plot the consequence at each intermediate form**. The viewport's curve morphs as the proof advances — "here we assumed small angle, watch the curve straighten" or "here we dropped the higher-order term, watch the tail change." Makes derivation *choices* visible instead of buried.

- **Maps to:** extends parametric viewports with a per-step rendering mode; data already in proof-step structure.

---

**Triage of the above** (one author's gut, not a commitment):

| Idea | Leverage | Cost | When |
|------|----------|------|------|
| §8.1 dimensional analysis | very high | medium | next major work after parametric-analysis ships |
| §8.3 approximation heatmap | high | low (extends §2.9) | bundle with phase-6 of this proposal |
| §8.11 "interrogate the formula" | medium-high | very low | could ship as a side PR anytime |
| §8.13 sensitivity-driven ordering | low-medium | very low | bundle with §2.8 when it lands |
| §8.2 bifurcation atlas | high | medium-high (needs symbolic equilibrium-finding) | own future proposal |
| §8.4 counterfactual mode | high | medium-high | own future proposal |
| §8.10 derivation-by-question | very high | very high (changes proof model) | overlaps with proof-structure-v2 |
| §8.12 cross-domain analogy | very high | very high (analogy detection is hard) | own future proposal |

The rest are good ideas that can wait for someone to feel inspired. None of them are foundational; all of them benefit from the parametric-analysis infrastructure landing first.

---

## 9. Why this fits AlgeBench's mission

Every other tool surveyed above either (a) requires a human to design every widget, or (b) offloads understanding to the AI ("just ask the chatbot"). AlgeBench is positioned to do something neither does: **automate the apparatus, preserve the work**. The AI sets the table; the learner does the eating. The understanding stays in the learner's head, where it's always belonged.

> **AI for human understanding — not for outsourcing thought.**
