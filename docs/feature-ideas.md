# AlgeBench — Feature Ideas

A living document of technical directions and creative ideas for making AlgeBench a
distinctive AI-guided math exploration tool. Nothing here is committed to — these are
seeds for discussion and experimentation.

---

## 1. AI Pedagogy

### Socratic Mode
Instead of explaining on demand, the AI asks guiding questions and waits for the student
to reason through each step. The AI only reveals the next piece when the student has
articulated the current one. The scene builds incrementally in response to student answers
rather than AI monologue.

### Misconception Radar
The AI monitors the student's questions and exploration choices against a library of known
mathematical misconceptions (e.g., "eigenvectors are always perpendicular," "determinant
zero means no solution"). When a likely misconception is detected, the AI proactively
addresses it with a targeted counterexample scene — without making the student feel
corrected.

### Adaptive Depth
The AI profiles explanation depth from early interactions: does the student ask for proofs,
prefer intuition, or want numerical examples? It adjusts vocabulary, step granularity, and
how much formalism it introduces — without the student having to set a "difficulty level."

### Teaching Persona Selection
Different mathematicians teach differently. Offer selectable AI personas:
- **The Geometer** — builds everything from visual intuition, avoids coordinates as long as possible
- **The Algebraist** — derives from axioms, loves abstraction
- **The Engineer** — shows the application before the theory
- **The Historian** — narrates the human story behind each concept before the math

Each persona uses the same Gemini model but with a distinct `prompt` preamble injected into
the system prompt.

### Exploration Memory Across Sessions
The AI remembers what the student has explored, what confused them, and what clicked.
On next session, it references earlier conversations naturally: "Last time we looked at
eigenvectors geometrically — want to see how the characteristic polynomial connects?"
Stored compactly in `localStorage` or a lightweight backend session.

---

## 2. 2D Plots & Domain-Specific Visualization

### 2D Plot Panel (Chart.js / D3.js)
A dedicated 2D plot panel — either as a collapsible side panel or a floating overlay —
rendered alongside the 3D viewport for concepts better communicated in 2D (histograms,
time-series, probability density curves) without embedding them awkwardly into 3D space.

**Architectural requirement: all non-viewport 2D plots must sync with the viewport in
real time.** Every slider value change propagates simultaneously to the 3D scene and to
all active 2D plots on the same animation frame. There is one shared slider state; plots
are just additional consumers of it. This makes the connection between the 3D geometry
and the 2D chart immediate and unambiguous — the student never wonders whether the two
views are showing the same state.

Scene JSON declares a `plots` array alongside `elements`:
```json
"plots": [
  {
    "type": "line_chart",
    "label": "f(x) = sin(k·x)",
    "x": { "sweep": [-6.28, 6.28], "steps": 200 },
    "y": "sin(k * x)",
    "color": "#44aaff"
  },
  {
    "type": "histogram",
    "data": "$sample_data",
    "bins": 20,
    "color": "#ff8844"
  }
]
```

The rendering library (Chart.js for simplicity, D3.js for flexibility) is chosen per plot
type and loaded on demand. When slider `k` changes, the line chart redraws and the 3D
surface updates on the same frame.

### Domain-Specific Visualization Elements

Beyond generic plots, several mathematical domains need their own visual idioms that
neither the 3D viewport nor a generic chart handles well:

**Probability & Statistics**
- Gaussian / normal distribution bell curves with shaded confidence intervals
- Bivariate Gaussians as 3D surfaces with marginal distribution plots on the sides
- Monte Carlo scatter plots showing convergence
- **Bayes Intuition Builder** — before any formula, build the intuition through concrete
  frequency scenarios. A 2D grid of dots (e.g. 1000 people) is partitioned visually:
  first by disease prevalence (prior), then by test accuracy (likelihood). The posterior
  falls out as a visible count — "of these 50 highlighted dots, only 9 actually have the
  disease." Sliders adjust prevalence and test sensitivity; the dot partition redraws in
  real time. The AI narrates the transition from the frequency picture to the formula
  $P(H|E) = \frac{P(E|H)P(H)}{P(E)}$ only after the intuition is established.
- **Bayesian Update Visualizer** — show prior, likelihood, and posterior as three overlaid
  distributions that animate as new evidence arrives. Sliders control the prior parameters
  and the observed data; the posterior updates live. A step-by-step lesson mode walks
  through each multiplication step of Bayes' theorem geometrically, making the "update"
  intuition visceral rather than algebraic.
- **Hypothesis Testing Visualizer** — interactive scene showing a null distribution with
  sliders for sample size, effect size, and significance level (α). Shaded rejection
  regions update live; a second curve shows the alternative distribution, making Type I /
  Type II errors and statistical power directly visible as overlapping areas. The AI can
  walk through a concrete test (t-test, z-test) step by step, animating where the test
  statistic falls and whether it crosses the critical value.

**Neural Networks**
- Layer-by-layer graph diagrams with animated activation flows
- Weight matrices visualized as heatmaps
- Decision boundary surfaces in 2D/3D input space
- Loss landscape as a 3D terrain (already partially possible with `surface` elements)

**Discrete Mathematics, Graphs & Knowledge**
- Venn diagrams (2 or 3 sets) with live set-operation shading driven by sliders
- Truth tables rendered as styled HTML tables alongside the scene
- **3D Graph / Knowledge Graph Visualizer** — a `graph3d` element type backed by
  [`3d-force-graph`](https://github.com/vasturiano/3d-force-graph) (already Three.js-based).
  Nodes rendered as labeled spheres, edges as lines with optional directional arrows and
  weight labels. Supports multiple layout algorithms: force-directed (organic clustering),
  hierarchical (layer-by-layer for neural nets / DAGs), and circular. Use cases:
  - **Knowledge graphs** — mathematical concept nodes connected by "used in", "generalizes",
    "special case of" edges. The AI builds and navigates the graph as topics are explored,
    letting students see where the current concept fits in the broader landscape.
  - **Neural network architecture** — layers as node clusters, weights as edges, animated
    forward-pass signal flow
  - **Markov chains** — state nodes with directed transition edges, probability weights,
    animated random walker
  - **Bayesian networks** — DAG of random variables with conditional dependency edges
  - **Proof dependency graphs** — theorems as nodes, "proof uses" as edges

  Scene JSON:
  ```json
  {
    "type": "graph3d",
    "nodes": [
      {"id": "eigval", "label": "Eigenvalues", "color": "#44aaff", "group": "linear-algebra"},
      {"id": "det",    "label": "Determinant",  "color": "#ff8844", "group": "linear-algebra"},
      {"id": "pca",    "label": "PCA",           "color": "#44cc88", "group": "statistics"}
    ],
    "edges": [
      {"from": "eigval", "to": "pca",    "label": "used in"},
      {"from": "det",    "to": "eigval", "label": "related"}
    ],
    "layout": "force"
  }
  ```
- Directed graphs for tree structures (binary trees, parse trees, decision trees)

**Signal Processing**
- Time-domain waveform + frequency-domain spectrum side by side (FFT visualization)
- Spectrogram as a 2D heatmap
- Filter frequency response curves

**Implementation approach:** A new `element` type `canvas_overlay` (or `plot`) that
renders into an absolutely-positioned HTML canvas layered over (or beside) the WebGL
viewport. The AI can emit these element types in `add_scene` just like any other element.
Libraries are loaded on demand from CDN to keep the base bundle small.

---

## 3. Scene & Visualization

### Scene Morphing Between Concepts
Smooth animated transitions between two mathematically related scenes — not just a camera
move, but a genuine geometric morphing that makes the relationship visible. Example: the
unit circle morphing into a sine wave as the projection is "unrolled," or a 3D surface
collapsing to its level curves as the viewpoint shifts from 3D to 2D top-down.

### Split Viewport Mode
The info overlay system already bridges geometry and algebra with live `{expr}` LaTeX
panels. The next step is a true split viewport: the 3D scene on one side, a 2D function
plot or symbolic expression tree on the other — both driven by the same sliders. Useful for showing e.g. a phase portrait alongside its
time-series solution simultaneously (ODE = Ordinary Differential Equation — an equation
relating a function to its derivatives).

### State-Machine Based Animation
The existing `steps` system is linear — forward and back only. A state-machine layer adds
branching, looping, and conditional transitions, enabling a much richer class of
visualizations: algorithms, iterative processes, physical phase transitions, and adaptive
lessons that respond to user interaction.

A scene declares a `stateMachine` block alongside `elements`:
```json
"stateMachine": {
  "initial": "start",
  "states": {
    "start": {
      "description": "Array unsorted. Press Next to begin.",
      "add": [{"id":"arr","type":"bar_chart","data":[5,2,8,1,9,3]}],
      "on": { "NEXT": "compare" }
    },
    "compare": {
      "description": "Comparing positions $i$ and $i+1$.",
      "add": [{"id":"hi","type":"highlight","targets":["arr[i]","arr[i+1]"]}],
      "on": { "SWAP": "swap", "NO_SWAP": "advance" }
    },
    "swap": {
      "description": "Out of order — swbing.",
      "on": { "DONE": "advance" }
    },
    "advance": {
      "on": { "MORE": "compare", "SORTED": "done" }
    },
    "done": {
      "description": "Sorted! $O(n^2)$ comparisons in the worst case."
    }
  }
}
```

**Transition triggers:**
- **`NEXT` / `BACK`** — user button press (same as current steps)
- **`AUTO`** — time-based, fires after a configurable delay
- **`CONDITION`** — guard expression evaluated against slider values
  (`"guard": "i >= n"` fires when slider `i` reaches `n`)
- **`AI`** — the AI agent fires a named event via a `fire_event` tool call, enabling
  AI-driven branching ("I see you're confused — let me show the base case first")
- **`CLICK`** — user clicks a specific element to trigger the transition

**Use cases:**
- **Algorithm animation** — bubble sort, merge sort, BFS/DFS, Dijkstra — each swap or
  visit is a state; the AI narrates the invariant at each state
- **Newton's method / iterative solvers** — each iteration is a state; loop until
  convergence, then transition to "done"
- **Physical phase transitions** — solid → liquid → gas with distinct visual states and
  animated transitions between them
- **Finite automata** — states are literal automaton states; input characters trigger
  transitions; accepted/rejected strings highlighted
- **Adaptive lessons** — if the student answers a prediction challenge correctly, the
  state machine branches to a harder follow-up; if not, it loops back with a hint

Technically: a small state-machine interpreter runs alongside the existing step navigator.
States map cleanly to the existing `add` / `remove` / `camera` / `sliders` / `info`
vocabulary — states are just non-linear steps with named outgoing transitions.

### Tree-Based Step Branching
Replace the linear `steps` array with a **step tree** — each step can have multiple named
children, letting a lesson fork into alternative paths and reconverge. The scene tree
panel on the left naturally visualizes the tree; users explore branches independently and
can backtrack to any node.

```json
"steps": [
  {
    "id": "intro",
    "title": "What is a determinant?",
    "description": "The determinant measures how much a matrix scales area.",
    "add": [...],
    "branches": [
      { "label": "Show me geometrically", "next": "geometric" },
      { "label": "Show me algebraically", "next": "algebraic" },
      { "label": "Give me an application", "next": "application" }
    ]
  },
  {
    "id": "geometric",
    "title": "Geometric View",
    "description": "The unit square transforms into a parallelogram...",
    "add": [...],
    "branches": [
      { "label": "What about 3D?", "next": "geometric-3d" },
      { "label": "Now show the algebra", "next": "algebraic" }
    ]
  },
  {
    "id": "algebraic",
    "title": "Algebraic Formula",
    "description": "$\\det(A) = ad - bc$ for a 2×2 matrix.",
    "add": [...],
    "next": "done"
  }
]
```

**Scene tree panel:** renders the step tree as a collapsible tree rather than a flat
list. Visited nodes are highlighted; unvisited branches are dimmed. Users can jump to
any previously visited node or peek at branch labels before committing.

**AI-guided branching:** the AI can recommend a branch based on the student's questions
("you asked about area — let me take you down the geometric path") or steer adaptively
based on what the student already understands. The `branches` array can include an
optional `"ai_hint"` field describing when the AI should suggest that path.

**Convergence:** branches can reconverge at a shared `next` node — multiple paths
leading into a common "summary" step, so authoring doesn't require duplicating content.

**Breadcrumbs & browser-style navigation:** a breadcrumb bar above the viewport shows the
path taken through the tree — "Intro › Geometric › 3D View" — each crumb clickable to
jump back to that node. Back (⬅) and Forward (➡) buttons mirror browser history,
traversing the student's personal exploration sequence regardless of tree structure. This
means forward/back reflects the order the student actually visited nodes, not the
authored tree order — the same mental model as browser tabs. The full visit history is
preserved in `sessionStorage` so it survives page refreshes.

**Relationship to state machines:** tree-based branching is the simpler, lesson-authoring
friendly version — no guards, no loops, no event triggers. State machines handle
algorithmic and iterative content; step trees handle narrative, pedagogical branching.
Both reuse the same `add` / `remove` / `camera` / `sliders` vocabulary.

### Proof Animation
A new scene type where each step of a mathematical proof corresponds to a visual
transformation. "Proof steps" work like the existing `steps` system but with richer
semantics: each step has a `claim`, a `justification`, and a visual `action`. The AI can
narrate each step as the user advances.

### Phase Portrait / Dynamical Systems Layer
A specialized element type for 2D ODEs — render the vector field, stream lines, fixed
points, and stable/unstable manifolds. The AI can explain stability, limit cycles, and
bifurcations by animating how the phase portrait changes as a parameter varies.

### Implicit Surface Rendering
A new element type `implicit_surface` defined by `f(x,y,z) = 0` using marching cubes.
Unlocks a huge class of surfaces that can't be expressed parametrically — Möbius-like
surfaces, knots, algebraic varieties.

### Fractal / Iterated Function System Layer
A dedicated element type for 2D fractals (Mandelbrot, Julia sets, IFS attractors) rendered
on a canvas overlay. The AI can explain self-similarity, iteration depth, and parameter
sensitivity through interactive exploration.

### Starfield / Ambient Environment
Already partially implemented in `rotating-habitat.json` — generalize into a reusable
scene-level `environment` field supporting: `starfield`, `grid-infinity` (infinite ground
plane), `void` (pure black), `fog`. Environments set the mood without cluttering the
coordinate system.

### Scene Diff / Comparison View
Show two scene states side by side (or as a transparent overlay) to visualize "before and
after" a transformation, approximation, or perturbation. Useful for Taylor approximations,
numerical methods, and error visualization.

---

## 4. Content & Scene Architecture

### Autonomous Scene Builder
An in-app agentic loop that researches a topic, designs, builds, validates, and refines a
complete scene file — without requiring an external coding agent or user intervention
beyond the initial request.

**Flow:**
1. **Research** — the AI expands the topic into key concepts, sub-concepts, and the most
   illuminating visual angles (e.g. "cross product" → magnitude as parallelogram area,
   right-hand rule, anti-commutativity)
2. **Design** — plans the scene structure: single scene vs. lesson, which element types,
   what the step progression should be, what sliders add value
3. **Generate** — emits the full scene JSON using its knowledge of the format
4. **Load & validate** — calls `add_scene` to render it; inspects the tool response and
   any render errors for structural problems (bad ranges, missing ids, expression syntax)
5. **Visual validate** — checks mathematical accuracy: are coordinates computed correctly?
   Do slider ranges cover the full extent of animated elements? Do step descriptions match
   what's on screen?
6. **Iterate** — fixes identified issues and re-renders, up to a configured retry limit
7. **Save** — writes the validated JSON to `scenes/` with a generated filename

The key capability this adds is a **feedback loop**: today `add_scene` renders whatever
JSON it receives with no error recovery. The scene builder treats rendering as a test step
and iterates until the scene is correct. Users get a publishable scene file from a single
natural-language request.

Technically: implemented as a Gemini multi-turn agent turn with a small set of dedicated
tools (`draft_scene`, `validate_scene`, `save_scene`) that wrap the existing scene
infrastructure. No backend changes required beyond a new endpoint to write JSON to
`scenes/`.

### LaTeX-to-Scene Compiler
Paste any LaTeX expression or equation — the system parses it and generates an appropriate
starter scene automatically. A matrix becomes a transformation scene. An integral becomes
an area-under-curve scene. A parametric curve definition becomes an animated parametric
scene. The AI fills in the explanation.

### Scene Branching / Learning Trees
Track the sequence of `add_scene` calls as a directed graph of exploration. Each node is a
scene; each edge is a question the student asked. At session end, render the tree as a
visual "map of what we explored today." Students can re-enter any node.

### AlgeBench Public Scene Repository
An official hosted scene gallery at a dedicated URL (e.g. `scenes.algebench.org`) separate
from the GitHub source repo. Anyone can browse, preview, and load scenes without installing
anything. Authors submit scenes via pull request or a web form; a lightweight review step
(AI checks mathematical accuracy + schema validity) gates publication.

**Features:**
- **Browse by topic** — tagged by subject area (linear algebra, calculus, probability,
  physics, CS) and level (intuition / undergraduate / graduate)
- **In-app integration** — a "Browse Gallery" panel fetches the index live; one click
  loads any scene into the running instance
- **Scene preview** — static thumbnail (rendered server-side) + short AI-generated
  description so users know what they're loading before they load it
- **Ratings & forks** — users can star scenes and fork them into their own local copy
  for modification via the direct scene editor
- **AI authorship attribution** — scenes built by the Autonomous Scene Builder are
  tagged as AI-generated; human-authored scenes are tagged separately
- **Version history** — each scene has a changelog; breaking schema changes are flagged

This is the ecosystem layer that makes the Autonomous Scene Builder and Direct Scene
Editor socially valuable — the output has somewhere to go.

### Community Scene Library
A lightweight scene registry (JSON index + GitHub-backed) where users can publish and
browse scenes by topic tag. The in-app "Browse Scenes" panel fetches the index and lets
users load community scenes in one click. Code agent skills make authoring easy enough that
community contribution is realistic.

### Scene Versioning with Diffs
Scenes stored with a version history. When the AI modifies an existing scene in response to
a follow-up question, the change is diffed and the student can scrub back through the
history like a timeline.

### Parametric Scene Templates
A library of half-finished scene templates parameterized by mathematical objects (a 2×2
matrix, a vector, a function). The AI fills in the template with the specific values from
the student's question, rather than generating JSON from scratch every time. Faster, more
consistent, lower hallucination risk.

---

## 5. Exploration & Discovery

### "What If" Mode
A dedicated UI mode where sliders are exposed for every numeric constant in the current
scene — even ones not originally intended as sliders. The student can ask "what if this
were different?" and explore parameter sensitivity without the AI needing to rebuild the
scene.

### Generalization Detector
When a student explores a specific numerical example, the AI detects the pattern and
proposes the general case: "You've seen this for $A = \begin{pmatrix}2&1\\0&2\end{pmatrix}$
— want to explore what happens for any Jordan block?" Then builds the generalized scene
with parameter sliders.

### Conjecture Mode
The student manipulates sliders and makes an observation. The AI helps them formalize it as
a conjecture, then either builds a proof sketch scene or constructs a counterexample. Turns
exploration into mathematical reasoning.

### Analogy Bridge
The AI proactively finds physical or intuitive analogies for abstract math and builds a
paired scene: "This is exactly like a spinning top — let me show you both side by side."
Eigenvalue decomposition ↔ principal stress axes in materials. Fourier transform ↔ prism
splitting light.

### Numerical Experiment Runner
A mode where the student poses a question like "does the Gram-Schmidt process always
produce orthogonal vectors even for nearly-linearly-dependent inputs?" The AI designs a
numerical experiment, runs it via `eval_math`, plots the results, and explains what it found.

---

## 6. Interaction & UX

### Visual AI Presence in the 3D World
The AI inhabits the mathematical scene as a visible entity — not a chat panel on the side,
but a character that moves through 3D space, points at objects, looks toward things of
interest, gestures, and speaks directly from within the world. The boundary between "AI
assistant" and "mathematical environment" dissolves.

**Representation:** the AI avatar is a deliberately abstract geometric form — a luminous
floating polyhedron, an orb with subtle particle trails, or a minimal humanoid wireframe —
readable as a presence without being distracting or cartoonish. Style is configurable;
the form should feel native to the mathematical aesthetic of the scene.

**Behaviors:**
- **Move** — glides smoothly to a position near the element being discussed;
  stands beside a vector to narrate it rather than describing it from outside the scene
- **Point** — extends a ray or beam toward a specific coordinate or element, serving as
  a precise in-world reference ("*this* vertex, right here")
- **Look** — rotates to face the student's camera or to gaze at an element, making
  attention direction legible
- **Gesture** — traces a curve with a motion arc, sweeps along a surface, draws a circle
  around a cluster of points to group them visually
- **React** — subtle idle animations shift when something changes (leans toward a new
  element, pulses when the student asks a question, stills when waiting)
- **Scale** — shrinks to fit a small local scene, expands for a large-scale environment
  like the rotating habitat

**Speech synchronization:** the avatar's gestures are timed to the TTS narration — it
points as the corresponding phrase is spoken, not before or after. A lightweight cue
system in the scene JSON (or emitted by the AI via a `gesture` tool call) maps narration
timestamps to gesture targets.

**AI tool interface:** the AI emits structured gesture commands alongside scene-building
calls:
```
avatar_move(position=[2, 1, 0])
avatar_point(target="vec-a", duration=2.0)
avatar_gesture(type="trace", element="surface-f", duration=3.0)
avatar_look(target="camera")
```

**Pedagogical impact:** pointing from *within* the scene is categorically different from
a text description. "Notice how this eigenvector doesn't rotate" lands differently when
the avatar stands beside the vector and gestures along its direction as it transforms.
The student's attention is directed precisely, without ambiguity about which element is
being discussed.

**VR / AR integration:** in VR mode the avatar is a full 3D presence the student can
walk around; in AR mode it appears on the physical desk surface next to the scene. The
avatar becomes the natural anchor for spatial audio narration in immersive modes.

### Direct Scene Editing
Users can select and manipulate scene elements directly in the 3D viewport without going
through the AI or editing JSON. Click an element to select it; a context panel shows its
editable properties. Drag handles on vectors and points let users reposition them in
data space.

**Element-level interactions:**
- **Vectors** — drag the tip to change direction and magnitude; the label and any
  dependent animated elements update live
- **Points** — drag to reposition; coordinates shown in a floating tooltip
- **Surfaces / curves** — click to inspect expression; edit the math.js expression
  inline and see the surface recompute in real time
- **Sliders** — double-click to edit min/max/step/label without rebuilding the scene
- **Labels** — click any label to edit the LaTeX string in place

**Step editing:**
- Click a step's description text in the scene tree to edit the narration inline
- Drag elements between steps (move an element from step 2 to step 3)
- Add a new step by clicking "+" between existing steps; the AI can suggest what to add
  based on the scene context
- Reorder steps via drag-and-drop in the scene tree

**Sync model:** edits mutate the live scene spec in memory and are immediately reflected
in the JSON (viewable in a "Source" tab). The AI is notified of each edit via a
`scene_edited` context event so it can comment: "you just made the two vectors parallel —
want to see what that does to the cross product?"

**Export:** edited scenes can be saved back to disk or shared as a URL-encoded JSON blob.

Technically: Three.js `DragControls` for pointer interactions, a lightweight property
panel component, and a bidirectional binding between the rendered scene and the in-memory
spec object.

### Point-and-Ask
Click or tap any point, element, or region in the 3D scene to direct a question at it.
Three.js raycasting identifies what was hit (surface, vector, curve, point) and its data
coordinates. That context is injected into the AI prompt automatically:

> *User clicked on surface "f(x,y) = sin(x)cos(y)" at data point (1.57, 0, 1.0)*

The AI answers specifically about that location — "you've clicked near a saddle point
where the gradient is zero" — without the student needing to describe what they're
looking at in words. A crosshair or pin marker drops at the clicked point so the AI and
student share an unambiguous reference.

Interaction modes:
- **Click + type** — click to set context, then type a question in the chat box
- **Click + voice** — click, then speak immediately; the click coordinates are prepended
- **Hover inspect** — hovering shows a live tooltip with coordinates, element id, and the
  expression value at that point (e.g. f(x,y) = 0.84)

Technically: a thin raycasting layer on the existing Three.js scene, feeding hit info into
`buildChatContext()` before the message is sent. No backend changes required.

### Voice-Driven Scene Building
Extend the existing voice input to support scene authoring commands: "add a red vector from
the origin to (2, 1, 0)" or "rotate the camera to look from above." The AI interprets
natural language geometry commands and translates them to `add_scene` / `set_camera` calls.

### Immersive VR / AR Experience
A WebXR mode that puts the student inside the mathematical scene. The existing Three.js
renderer already supports WebXR with minimal plumbing — the viewport becomes a stereo
view for VR headsets (Meta Quest, Vision Pro via browser) or an AR overlay for mobile.

**VR mode:**
- Walk around and inside 3D objects — stand inside an eigenvector transformation, walk
  along a parametric curve, look up at a towering surface
- Controller trigger selects elements (replacing mouse click for point-and-ask)
- Controller thumbstick drives sliders — one hand controls the visualization, the other
  reaches out to manipulate it
- The AI voice narration works naturally in VR; no screen needed
- Grab and drag vectors directly with the controller, replacing the desktop drag handle

**AR mode (mobile / passthrough headset):**
- Place an AlgeBench scene on a physical desk surface — a 3D vector field sitting on your
  table, scale it by moving your phone closer
- Combine with the physical world: point at a real spinning object, overlay the angular
  velocity vector and centripetal force arrows
- Shareable AR anchors — two students with phones can look at the same scene in shared
  physical space

**Classroom mode (VR):**
- Instructor projects from VR headset to a regular screen simultaneously
- Students on desktops see the same scene from their own free-roaming camera
- Instructor can "grab" and highlight elements visible to everyone

Technically: Three.js `WebXRManager` is already in the stack; the main work is controller
input mapping, a comfortable locomotion model, and UI panels that work without a mouse
(gaze-dwell or controller ray).

### Gesture Camera Control (Touch / Stylus)
Optimized two-finger and stylus gestures on tablet: two-finger twist rotates the scene,
pinch zooms, stylus tap places a labeled point. Designed for classroom use on iPad/Surface.

### Annotation Layer
Students can draw freehand on top of the 3D scene (using an SVG overlay), add sticky-note
annotations, and highlight elements. Annotations are stored with the session and can be
shared. The AI can read annotations and incorporate them into explanations.

### Replay / Presentation Mode
Record a full session (slider moves, camera transitions, step advances, AI narration) and
replay it as a narrated video or interactive walkthrough. Instructors can prepare a
"recorded exploration" that students can replay and branch off of at any point.

### Keyboard-Driven Exploration
Full keyboard navigation for the mathematically inclined: `j/k` to step through scenes,
`[1-4]` to jump to named views, `s` to focus the slider panel, `e` to toggle the Doc
panel. The 3D canvas should be operable without touching the mouse.

---

## 7. Integration & Ecosystem

### Direct GitHub Integration for Collaborative Scene Building
Connect AlgeBench directly to a GitHub repository so scenes and lessons are authored,
versioned, and shared through Git — without leaving the app or touching the command line.

**Authentication:** OAuth with GitHub. The app stores a scoped token (repo read/write on
selected repos only) in `localStorage` or a lightweight server session.

**Scene I/O:**
- **Open from GitHub** — browse any connected repo's `scenes/` directory and load a
  scene in one click; the AI sees the file provenance and can explain its history
- **Save to GitHub** — after editing or AI-generating a scene, commit it directly with
  an auto-drafted commit message ("Add eigenvalues lesson scene — 3 steps, 2 sliders")
- **Save as new file** — fork a scene into a new filename without leaving the app

**Collaborative workflows:**
- **Pull Request authoring** — the app can open a PR against the upstream
  `algebench` repo (or any configured repo) directly from the UI; the PR description
  is AI-drafted from the scene's title, markdown, and topic tags
- **Branch awareness** — switch between branches from the app; useful for teams
  maintaining separate topic branches ("linear-algebra", "probability-unit-3")
- **Conflict resolution** — if the remote file changed since last load, the app diffs
  and lets the user choose which version to keep or merge
- **Review mode** — load an open PR's changed scene files directly for review; leave
  inline comments that map to specific elements or steps

**Classroom / course use:**
- An instructor forks the public `algebench` repo and adds their own `scenes/`; students
  connect to the instructor's fork and see only the curated scene set
- Student-submitted scenes land as PRs on the instructor's fork; instructor approves
  (merges) or requests changes — familiar Git review flow applied to math content
- Lesson playlists defined as a JSON index file in the repo (`course.json`) listing
  scenes in order; the app renders this as a structured curriculum view

**Federated volunteer repo ecosystem:**
Individual repos are maintained independently by volunteers — teachers, research groups,
open courseware projects, math enthusiasts. Each repo owner decides its own curation
standards, topic focus, and contribution policy. AlgeBench imposes no central authority
over content.

Curated repos can apply to be listed in the **AlgeBench Repo Browser** — a lightweight
registry (a JSON index in the main `algebench` repo) of repos that meet a basic quality
bar (valid scene schemas, meaningful markdown, no unsafe scenes without explanation).
Listed repos appear in the in-app "Browse Repos" panel with a name, description, topic
tags, and scene count. Users connect any repo — listed or not — by pasting its GitHub
URL.

This keeps the ecosystem open and decentralized while giving the in-app browser a
curated starting point.

### Jupyter / Observable Notebook Export
Export any scene as a self-contained Jupyter notebook cell (Python + matplotlib/plotly) or
an Observable notebook. Students can take their visual explorations into a computational
environment for further analysis.

### SymPy / Wolfram Alpha Bridge
When the student asks for an exact computation (eigenvalues, integral, determinant), the AI
can dispatch to a SymPy backend (already partially available via `eval_math`) and render
the exact symbolic result as a formatted overlay — not just a decimal approximation.

### Desmos / GeoGebra Interop
Import a Desmos or GeoGebra construction as a AlgeBench 2D scene. Export a AlgeBench
scene definition back to those tools. Gives students a familiar on-ramp and a path to
deeper 3D exploration.

### LMS / Canvas Integration
An LTI module that embeds AlgeBench in a Canvas/Moodle course. The instructor pre-loads a
scene and a set of guiding questions. Student sessions are logged (anonymously) and the
instructor can review which concepts generated the most follow-up questions.

### ArXiv Scene Generation
Paste an ArXiv abstract or theorem statement. The AI reads it, identifies the key geometric
or algebraic objects, and builds an introductory visualization. A "tl;dr by picture" for
math papers.

---

## 8. Assessment & Progress

### Concept Map
A visual graph (rendered as a AlgeBench scene itself, or a separate panel) showing all
mathematical concepts the student has explored, connected by "used in" / "related to"
edges. Nodes glow when recently visited. Students can see their own growing map of
mathematical knowledge.

### Prediction Challenges
Before revealing the next step, the AI asks the student to predict: "Before we add
$\vec{b}$, where do you think the sum will land? Drag the dot." The student places their
prediction; the actual result appears; the delta is discussed. Turns passive watching into
active engagement.

### Spaced Repetition Integration
Track which scenes/concepts a student found difficult. Surface them again (in a new context
or with a different example) at spaced intervals. The AI opens sessions with: "Last week we
struggled a bit with the Gram-Schmidt step — want to try it from a different angle?"

### Instructor Dashboard
A separate view (password-protected, no student data stored server-side) showing aggregate
heatmaps: which concepts generate the most follow-up questions, which scenes are most
explored, where students tend to drop off. Purely aggregate and anonymous.

---

## 9. Physics Domain Libraries

### Quantum Mechanics Domain

A `quantum` domain library for visualizing wavefunctions and quantum phenomena — the
natural companion to the existing `astrodynamics` domain.

#### Atomic Orbitals
- **Hydrogen wavefunctions** — render |ψ|² as a 3D probability density cloud for
  s, p, d orbitals. Sliders for quantum numbers n, l, m. Color encodes phase angle
  (complex argument) using HSL mapping so interference patterns are visible.
- **Radial probability distribution** — 2D plot of r²|R(r)|² alongside the 3D cloud,
  highlighting radial nodes and the most probable radius.
- **Orbital transitions** — animate the electron "jumping" between energy levels;
  emit a colored photon whose hue corresponds to the transition frequency
  (E = hf = hc/λ). Connects spectroscopy to the orbital model directly.

**Slider contracts** (proposed):
| ID | Description | Default |
|---|---|---|
| `n` | Principal quantum number | 1 |
| `l` | Angular momentum quantum number | 0 |
| `m` | Magnetic quantum number | 0 |
| `r_scale` | Radial display scale (Bohr radii) | 10 |
| `iso_val` | Isosurface threshold for density cloud | 0.02 |

**Functions** (proposed):
- `psiR(r, n, l)` — radial wavefunction R_nl(r) via associated Laguerre polynomials
- `psiAng(theta, phi, l, m)` — real spherical harmonic Y_lm(θ, φ)
- `psiDensity(r, theta, phi, n, l, m)` — full |ψ|² probability density
- `energyLevel(n)` — E_n = -13.6 eV / n² (hydrogen energy levels)

#### Wave Mechanics
- **Particle in a box** — standing wave eigenstates ψ_n(x) = √(2/L) sin(nπx/L),
  energy levels E_n ∝ n². Sliders for n and box width L. Shows wavefunction,
  probability density, and energy eigenvalue simultaneously.
- **Quantum harmonic oscillator** — Hermite polynomial eigenstates; energy ladder
  visualization with equally spaced levels. Slider for n; overlay shows zero-point energy.
- **Double-slit interference** — 2D wave amplitude from two coherent sources; slider
  for slit separation d and wavelength λ. Overlay particle hit histogram to show
  wave-particle duality emerging statistically.
- **Quantum tunneling** — Gaussian wave packet incident on a rectangular potential
  barrier. Sliders for barrier width, barrier height, and incident energy. Animate
  transmitted vs. reflected probability current.

#### Spin & Measurement
- **Bloch sphere** — qubit state |ψ⟩ = cos(θ/2)|0⟩ + e^(iφ)sin(θ/2)|1⟩ on a
  Bloch sphere. Sliders θ and φ rotate the state vector; the scene labels |0⟩ and
  |1⟩ poles and shows the expectation values ⟨X⟩, ⟨Y⟩, ⟨Z⟩.
- **Stern-Gerlach** — visualize spin-up/spin-down beam splitting in a magnetic field
  gradient. Slider for field gradient; shows deflection proportional to m_s.

#### Implementation Notes
Atomic orbitals require associated Laguerre polynomials and real spherical harmonics —
both are closed-form polynomial evaluations, suitable for the expression sandbox.
The 3D density cloud is best rendered as a `surface` element on a spherical grid with
opacity driven by |ψ|², or as a `point_cloud` element with color-coded density.
Wavefunctions are unitless within the scene; physical units are noted in step descriptions.

---

### Orbital Mechanics Extensions (astrodynamics domain)

**New modes for the existing `astrodynamics` domain:**

- **Hohmann transfer** — two-burn transfer between two circular orbits.
  Phase 1: initial circular orbit. Phase 2: first burn raising apoapsis. Phase 3:
  coast on elliptical transfer orbit. Phase 4: second burn circularizing at target.
  Delta-v budget displayed as an overlay. Sliders for r_initial, r_target.
- **Gravity assist / slingshot** — extend to include a planet moving on its own orbit;
  the spacecraft's trajectory is deflected by the planet's gravity well. Slider for
  flyby altitude and approach angle.
- **Elliptical orbit parameters** — visualize semi-major axis a, eccentricity e,
  periapsis, apoapsis, argument of periapsis ω. Derive orbital period from Kepler's
  third law T² ∝ a³.

**New multi-body scenes (new domain or domain extension):**

- **Lagrange points** — compute L1–L5 equilibrium positions in a two-body system.
  Show effective potential landscape (gravity + centrifugal) as a height surface in
  the co-rotating frame. Slider for mass ratio.
- **Figure-8 three-body orbit** — the famous periodic choreography solution where
  three equal-mass bodies chase each other on a figure-8 path. Numerically integrated;
  demonstrates sensitivity to initial conditions.
- **Binary star system** — two bodies orbiting their common barycenter. Sliders for
  mass ratio and orbital separation. Connect to Kepler's laws.

---

### Bohr Model → Quantum Bridge Lesson

A multi-scene lesson tracing the conceptual evolution from classical to quantum:

1. **Classical orbit** — electron on a circular orbit around nucleus (astrodynamics
   domain, coast mode, scaled to atomic units). Stable but physically wrong.
2. **Quantized radii** — Bohr's rule L = nℏ selects discrete allowed radii r_n = n²a₀.
   Show only the orbits that "fit" whole wavelengths. Slider for n.
3. **de Broglie wave** — wrap a standing wave around each circular orbit; show how
   integer wavelength condition enforces quantization.
4. **Probability cloud** — replace the sharp orbit with a |ψ|² density cloud (quantum
   domain). The electron is not on a path — it has a probability distribution.
5. **Spectral lines** — connect energy level differences to photon colors; show the
   Balmer series in visible light.

This lesson explicitly bridges the classical (astrodynamics domain) and quantum (quantum
domain) libraries, demonstrating how domain libraries can be combined in a single lesson.

---

## 10. Experimental / Long Shot

### Agent-vs-Agent Math Debate
Two Gemini instances take opposing pedagogical stances on a concept ("is a matrix best
understood as a transformation or as a system of equations?") and visually argue their
case by building competing scenes. The student votes and asks questions.

### Student-Authored Scene Publishing
A "create mode" UI where students assemble scenes using a drag-and-drop element palette.
The AI reviews their scene for mathematical accuracy before publishing. Turns students
into content creators.

### 3D Printing Export
Export any surface or curve as an STL file for 3D printing. Hold the Möbius band or
Hopf fibration in your hands.

### Haptic Feedback (WebHID)
On supported devices (game controllers, haptic gloves), provide force feedback when
traversing a surface — steepness = resistance. Make gradient descent physically felt.

### AlgeBench Scene as Musical Score
Map mathematical structures to music: eigenvalue magnitude → pitch, matrix determinant →
harmony/dissonance, convergence rate → tempo. An experimental synesthetic layer for
exploring math through sound.

### Collaborative Multiplayer Session
Two students share a live session: they see each other's cursor in the 3D space, can each
drag sliders, and the AI addresses the group. Designed for paired problem solving or
remote tutoring.
