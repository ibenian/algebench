# AlgeBench Proof & Derivation Model

> Design document for the step-by-step mathematical proof system (Issue #51).

**Related docs:**

- [architecture.md](architecture.md) — Overall project architecture
- [sandbox-model.md](sandbox-model.md) — Expression evaluation and trust model
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — Scene format reference

---

## 1. Overview

The proof system adds first-class support for mathematical proofs and derivations in AlgeBench. Proofs are structured as a sequence of justified steps with LaTeX rendering, highlightable regions, optional scene-step linking, and AI agent integration.

**"Proof"** is the umbrella term for both proofs (establishing truth) and derivations (transforming expressions). The `tags` field on each step can distinguish the flavor when it matters pedagogically.

---

## 2. Embedding Levels

A proof can appear at three levels in the scene JSON hierarchy:


| Level     | Scope                               | `scene_step` meaning                              |
| --------- | ----------------------------------- | ------------------------------------------------- |
| **Root**  | Spans the entire lesson             | `"sceneIdx:stepIdx"` (cross-scene)                |
| **Scene** | Tied to one scene                   | `stepIdx` (integer, relative to containing scene) |
| **Step**  | Mini-derivation for a specific step | `stepIdx` (integer, relative to containing scene) |


```json
{
  "title": "Eigenvalues and the Characteristic Equation",
  "proof": { ... },
  "scenes": [
    {
      "title": "Setting up the problem",
      "proof": { ... },
      "elements": [ ... ],
      "steps": [
        {
          "title": "Why det(A-λI) = 0",
          "proof": { ... },
          "add": [ ... ]
        }
      ]
    }
  ]
}
```

**Single or multiple**: The `proof` field accepts either a single object or an array. The loader normalizes internally:

```js
const proofs = spec.proof == null ? []
    : Array.isArray(spec.proof) ? spec.proof : [spec.proof];
```

---

## 3. Proof Schema

### 3.1 Proof Object


| Field        | Type             | Required | Description                                            |
| ------------ | ---------------- | -------- | ------------------------------------------------------ |
| `id`         | string           | yes      | Unique identifier for agent references and step memory |
| `title`      | string           | yes      | Display name (shown in proof section header)           |
| `goal`       | string           | yes      | What the proof aims to show (LaTeX)                    |
| `prompt`     | string           | no       | Overall agent guidance for this proof                  |
| `scene_step` | number or string | no       | Scene step to sync to when viewing the goal (index -1) |
| `steps`      | array            | yes      | Ordered array of proof steps                           |


### 3.2 Proof Step


| Field           | Type             | Required | Description                                                                                      |
| --------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `id`            | string           | yes      | Unique step identifier for agent references and linking                                          |
| `type`          | string           | no       | `"given"`, `"step"`, `"conclusion"`, `"remark"` (defaults to `"step"`)                           |
| `label`         | string           | yes      | Short human-readable heading                                                                     |
| `math`          | string           | yes      | LaTeX expression, may include `\htmlClass{hl-name}{...}` regions                                 |
| `highlights`    | object           | no       | Map of region name → `{ color, label }`                                                          |
| `justification` | string           | no       | Rule or theorem licensing this step (supports inline LaTeX)                                      |
| `explanation`   | string           | no       | Prose explanation (rendered as markdown)                                                         |
| `prompt`        | string           | no       | Agent hint for when this step is active                                                          |
| `scene_step`    | number or string | no       | Scene step to sync to (integer for scene/step-level proofs, `"sceneIdx:stepIdx"` for root-level) |
| `tags`          | string[]         | no       | Semantic tags for styling and filtering                                                          |


### 3.3 Step Types


| Type         | Rendering                            | Use                                        |
| ------------ | ------------------------------------ | ------------------------------------------ |
| `given`      | Distinct style (e.g., border color)  | Starting assumptions, definitions          |
| `step`       | Default style                        | A transformation or deduction              |
| `conclusion` | Emphasized (e.g., box, green accent) | QED / final result                         |
| `remark`     | De-emphasized (italic, no border)    | Aside that isn't part of the logical chain |


---

## 4. Highlights

### 4.1 Mechanism

Highlights use KaTeX's `\htmlClass` directive to inject CSS classes into rendered math output. This keeps LaTeX source readable and gives full control over styling via CSS/JS.

```latex
= \frac{\htmlClass{hl-new}{P(B \mid A)\,P(A)}}{P(B)}
```

KaTeX renders normally but wraps the content in `<span class="hl-new">`. The `highlights` map defines each region's appearance:

```json
"highlights": {
  "new": { "color": "yellow", "label": "numerator rewritten via product rule" }
}
```

**Requires**: `trust: true` in the KaTeX render options (one-line change in `labels.js`).

### 4.2 Timing

1. **Step entry** — highlighted regions animate in (glow pulse, ~0.5s)
2. **Settle** — animation ends, regions keep a subtle background tint
3. **Next step** — previous step's highlights clear, new step's highlights animate

### 4.3 Highlight Label

The `label` string serves two purposes:

- **Clickable annotation** — click the highlighted region to reveal an inline label below the math
- **Agent context** — fed to the AI so it can reference the region by name

### 4.4 Capabilities

`\htmlClass` works on any **complete LaTeX group**:

```latex
\htmlClass{hl-x}{x}                              % single symbol
\htmlClass{hl-frac}{\frac{a}{b}}                  % whole fraction
\htmlClass{hl-num}{P(B \mid A)\,P(A)}             % sub-expression
\frac{\htmlClass{hl-top}{a}}{b}                   % just the numerator
\htmlClass{hl-a}{A} + \htmlClass{hl-b}{B}         % multiple independent regions
```

Constraint: the wrapped content must be a syntactically complete LaTeX expression.

---

## 5. Full Example

Deriving the quadratic formula (8 steps):

```json
{
  "proof": {
    "id": "quadratic-formula",
    "title": "Deriving the Quadratic Formula",
    "goal": "Derive $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ from $ax^2 + bx + c = 0$",
    "prompt": "Walk the student through completing the square. Emphasize why each move is valid and connect to the parabola visualization.",
    "scene_step": 0,
    "steps": [
      {
        "id": "start",
        "type": "given",
        "label": "General quadratic equation",
        "math": "\\htmlClass{hl-eq}{ax^2 + bx + c} = 0",
        "highlights": {
          "eq": { "color": "cyan", "label": "standard form quadratic" }
        },
        "explanation": "We start with the most general quadratic equation, where $a \\neq 0$.",
        "prompt": "Point out the parabola in the 3D view and how the roots are where it crosses the x-axis.",
        "scene_step": 0,
        "tags": ["given"]
      },
      {
        "id": "move_c",
        "type": "step",
        "label": "Isolate the quadratic and linear terms",
        "math": "ax^2 + bx = \\htmlClass{hl-moved}{-c}",
        "highlights": {
          "moved": { "color": "yellow", "label": "constant moved to right side" }
        },
        "justification": "Subtract $c$ from both sides",
        "explanation": "Move the constant term to the right to prepare for completing the square.",
        "tags": ["algebra"]
      },
      {
        "id": "div_a",
        "type": "step",
        "label": "Divide by the leading coefficient",
        "math": "x^2 + \\htmlClass{hl-coeff}{\\frac{b}{a}}x = -\\frac{c}{a}",
        "highlights": {
          "coeff": { "color": "yellow", "label": "coefficient normalized by a" }
        },
        "justification": "Divide both sides by $a$ (valid since $a \\neq 0$)",
        "explanation": "Normalizing the leading coefficient to 1 is required before completing the square.",
        "prompt": "If the student asks why we can divide by a, emphasize the a ≠ 0 precondition.",
        "tags": ["algebra"]
      },
      {
        "id": "complete",
        "type": "step",
        "label": "Complete the square",
        "math": "x^2 + \\frac{b}{a}x + \\htmlClass{hl-added}{\\frac{b^2}{4a^2}} = -\\frac{c}{a} + \\htmlClass{hl-added2}{\\frac{b^2}{4a^2}}",
        "highlights": {
          "added": { "color": "green", "label": "half the coefficient of x, squared" },
          "added2": { "color": "green", "label": "added to both sides to keep equality" }
        },
        "justification": "Add $\\left(\\frac{b}{2a}\\right)^2$ to both sides",
        "explanation": "The key insight: adding the square of half the linear coefficient creates a perfect square trinomial on the left.",
        "prompt": "This is the hardest step conceptually. Show the geometric meaning: we are literally completing a square in area.",
        "scene_step": 1,
        "tags": ["completing-the-square"]
      },
      {
        "id": "factor_left",
        "type": "step",
        "label": "Factor the perfect square",
        "math": "\\htmlClass{hl-square}{\\left(x + \\frac{b}{2a}\\right)^2} = \\frac{b^2 - 4ac}{4a^2}",
        "highlights": {
          "square": { "color": "cyan", "label": "perfect square trinomial factored" }
        },
        "justification": "Left: $(x + k)^2 = x^2 + 2kx + k^2$ with $k = \\frac{b}{2a}$. Right: common denominator.",
        "explanation": "The left side is now a perfect square. The right side simplifies to reveal the discriminant.",
        "scene_step": 2,
        "tags": ["factoring"]
      },
      {
        "id": "sqrt",
        "type": "step",
        "label": "Take the square root",
        "math": "x + \\frac{b}{2a} = \\htmlClass{hl-pm}{\\pm} \\frac{\\htmlClass{hl-disc}{\\sqrt{b^2 - 4ac}}}{2a}",
        "highlights": {
          "pm": { "color": "orange", "label": "square root gives two solutions" },
          "disc": { "color": "magenta", "label": "the discriminant determines the nature of the roots" }
        },
        "justification": "If $u^2 = v$ then $u = \\pm\\sqrt{v}$",
        "explanation": "Taking the square root introduces $\\pm$, giving us two solutions. The expression under the radical — the discriminant — determines whether the roots are real, repeated, or complex.",
        "prompt": "Connect the discriminant to the 3D view: positive = parabola crosses x-axis twice, zero = touches once, negative = no real crossing.",
        "scene_step": 3,
        "tags": ["square-root"]
      },
      {
        "id": "isolate_x",
        "type": "step",
        "label": "Isolate $x$",
        "math": "x = \\htmlClass{hl-shift}{-\\frac{b}{2a}} \\pm \\frac{\\sqrt{b^2 - 4ac}}{2a}",
        "highlights": {
          "shift": { "color": "yellow", "label": "vertex x-coordinate (axis of symmetry)" }
        },
        "justification": "Subtract $\\frac{b}{2a}$ from both sides",
        "explanation": "The $-\\frac{b}{2a}$ term is the x-coordinate of the vertex — the axis of symmetry of the parabola.",
        "tags": ["algebra"]
      },
      {
        "id": "qed",
        "type": "conclusion",
        "label": "The Quadratic Formula",
        "math": "\\htmlClass{hl-result}{x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}}",
        "highlights": {
          "result": { "color": "green", "label": "the quadratic formula" }
        },
        "justification": "Combine over a common denominator",
        "explanation": "Every quadratic equation $ax^2 + bx + c = 0$ has solutions given by this formula.",
        "prompt": "Summarize what each part means: -b/2a is the center, the ± part is the spread, and the discriminant tells us the nature of the roots.",
        "scene_step": 4,
        "tags": ["result"]
      }
    ]
  }
}
```

---

## 6. Bidirectional Sync

### 6.1 Proof → Scene

When navigating to a proof step that has `scene_step`:

1. Proof panel renders the new step
2. `navigateTo(currentSceneIndex, sceneStep)` is called
3. 3D scene updates to the corresponding visualization

At the goal level (index -1), the proof-level `scene_step` is used for sync.

For root-level proofs, `scene_step` uses string format `"sceneIdx:stepIdx"`:

1. Parse the string into scene index and step index
2. `navigateTo(sceneIdx, stepIdx)` navigates across scenes

### 6.2 Scene → Proof

When the user advances the scene step to index N:

1. Search active proof steps for `scene_step === N`
2. If found, scroll to / navigate to that proof step
3. Proof counter updates

### 6.3 Loop Prevention

A `_proofSyncInProgress` flag prevents infinite loops (proof nav → scene nav → proof nav). The guard is cleared synchronously in a `finally` block — no `setTimeout` delay.

### 6.4 Immediate Sync on Enable

When the user enables the sync toggle, the current proof step's `scene_step` is applied immediately (calls `navigateProof` with current index).

### 6.5 Independent Mode

With sync disabled, proof and scene navigate independently. Useful when:

- Re-reading a proof step without changing the 3D view
- The proof has more steps than the scene
- Exploring the visualization freely while reviewing the proof

---

## 7. Agent Integration

### 7.1 System Prompt Context

Proof context is injected into the agent's **system prompt** (not just the user message), so the AI always has full awareness. This context is also visible in the **CTX browser** for debugging.

The system prompt includes:

- All in-context proof titles, goals, and step counts
- The active proof's full step list (id, label, math, justification)
- The current proof step index and its content
- **Proof-level `prompt`** — overall guidance for the active proof
- **Step-level `prompt`** — specific hint for the current step

This is built in `build_system_prompt()` (Python) and `buildChatContext()` (JS), following the same pattern as scene/step context.

### 7.2 AI Ask Buttons

Proof steps have an **inline AI button** that appears on hover over the math row:


| Location         | Button        | Sends to chat                                                      |
| ---------------- | ------------- | ------------------------------------------------------------------ |
| Math row (hover) | **"Explain"** | "Explain this proof step: [label]. Justification: [justification]" |
| Proof goal       | **"Explain"** | "Explain the goal of this proof: [title]. Goal: [goal]"            |


Each button pre-fills a chat message with the proof and step `prompt` context already in the system prompt. The AI sees both the question and the author's pedagogical hints, so it can give targeted answers.

### 7.3 Tool: `navigate_proof`

```
navigate_proof(proof_id: string, step: int, reason?: string)
```

- `step = 0` → show goal overview
- `step = 1..N` → navigate to proof step (1-based for agent ergonomics)
- `proof_id` → which proof to navigate (required when multiple proofs exist)

### 7.4 Capabilities

With proof context, the agent can:

- **Narrate** — walk through each step with explanation and TTS
- **Answer questions** — "Why can we swap the order?" → references justification
- **Relate to geometry** — "Where is this term in the visualization?" → syncs scene
- **Summarize** — "What have we proved so far?" → recaps steps to current index

---

## 8. UI Layout

### 8.1 Proof Panel — Inside Chat Tab

The proof panel lives **inside the Chat tab**, splitting it vertically with a draggable divider. This lets the student step through a proof and ask the agent questions simultaneously without switching tabs.

**Collapsed state** (no proof, or user collapsed it): The proof panel collapses to a single **button** in the `#chat-tts-controls` bar, next to the Character/Voice/TTS mode controls. The button is only visible when proofs exist in the current context. The full chat area is available.

**Expanded state**: The Chat tab splits vertically — proof on top, chat on bottom.

```
┌───────────────────────────────────────────────────────────┐
│ [Doc] [Chat]                                              │
├───────────────────────────────────────────────────────────┤
│ [Character] [Voice ▾] [Read ▾]  [📐 Proof ▾]             │ ← proof toggle button
├───────────────────────────────────────────────────────────┤
│ Proof: Deriving the Quadratic Formula                     │
│ [Proofs in Context] [All Proofs]   [Progressive] [⇄ Sync]│
│                                                           │
│ Goal: Derive x = (-b ± √(b²-4ac)) / 2a                  │
│                                                           │
│ ┌─ ② Step: Complete the square ──────────── [✨ Explain]─┐│
│ │ x² + (b/a)x + b²/4a² = -c/a + b²/4a²                 ││
│ │ ▸ Add (b/2a)² to both sides                           ││
│ └────────────────────────────────────────────────────────┘│
│                                                           │
│          |‹   ‹   Step 3 of 8   ›   ›|                   │
├─── drag to resize ───────────────────────────────────────┤
│ Chat                                                      │
│                                                           │
│ 🤖 The key insight here is that adding (b/2a)² to both   │
│ sides creates a perfect square on the left...             │
│                                                           │
│ [Ask about this visualization...]                  [Send] │
└───────────────────────────────────────────────────────────┘
```

### 8.2 Proof Toggle Button

The proof button in the chat controls bar:


| State                       | Appearance                                          |
| --------------------------- | --------------------------------------------------- |
| No proofs in context        | **Hidden** — button not rendered                    |
| Proofs available, collapsed | **Visible** — `📐 Proof` button, click to expand    |
| Proofs available, expanded  | **Active** — `📐 Proof ▴` button, click to collapse |


Expand/collapse state is saved to `localStorage['algebench-proof-expanded']`.

### 8.3 Split Resize

When expanded, the proof/chat split has a **draggable horizontal divider**. The split ratio is saved to `localStorage['algebench-proof-split']`. Default: 50/50. The divider follows the same implementation pattern as the existing right-panel vertical resize handle.

### 8.4 Auto-Expand

When `navigateProof` is called (by user click, sync, or agent tool), the proof panel automatically expands if collapsed, and the active proof section is uncollapsed. This ensures the student always sees the step being navigated to.

### 8.5 Proof Panel Tabs

The proof panel has two tabs that share a **single DOM list** of proof sections. The tab selection controls visibility:


| Tab                   | Visibility Rule                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proofs in Context** | Shows proofs relevant to the current navigation state — file-level (always), scene-level (when in that scene), step-level (when on or past that step). The active proof is never hidden even if out of context. |
| **All Proofs**        | Shows every proof in the lesson, regardless of current position.                                                                                                                                                |


Both tabs use the same underlying DOM and interaction model — clicking a proof header, navigating steps, and all toolbar controls work identically in both modes. This is implemented by toggling a `_proofTabMode` state flag and re-running the visibility filter.

**Proofs in Context** shows proofs from all applicable levels simultaneously, each as a collapsible section:

- **File-level proofs** — always shown (lesson-wide proofs)
- **Scene-level proofs** — shown when in that scene
- **Step-level proofs** — shown when on or past that step

Multiple proofs at the same level are all listed. The student can expand/collapse each independently.

### 8.6 Per-Proof Step Memory

Each proof remembers its step position independently, keyed by `proof.id`. When the user switches to a different proof and later returns, their previous position is restored. This is stored in `state.proofStepMemory` (in-memory, not persisted to localStorage).

### 8.7 Proof Step Display

Each proof step in the list shows:

- Step number and type badge (given / step / conclusion / remark)
- Label text
- Rendered math (KaTeX with highlights)
- Justification (inline, prefixed with ▸)
- Explanation (rendered as markdown)
- AI ask button (appears on hover over the math row)
- Tags as pill badges

### 8.8 View Modes

- **Progressive** (default) — one step at a time with full detail, previous steps collapsed to label only, future steps hidden
- **Verbose** — all steps visible, current highlighted (`.active`), future dimmed

### 8.9 Toolbar

Inline in the proof panel header, right-aligned:


| Button                | Action                                                              |
| --------------------- | ------------------------------------------------------------------- |
| Progressive / Verbose | Toggle view mode                                                    |
| ⇄ Sync                | Toggle bidirectional scene linking (syncs immediately when enabled) |


### 8.10 Navigation

- **First/prev/next/last** buttons (`|‹`, `‹`, `›`, `›|`) in the proof nav bar, with disabled state when at boundaries
- Left/right arrow keys when proof panel is focused (does not conflict with scene nav which uses up/down)
- Step counter: "Step 3 of 8" or "Goal · 8 steps"
- Clicking any proof step navigates directly to it
- Clicking a proof section header switches the active proof (with step memory)

### 8.11 Smart Scroll-Into-View

When a proof step becomes active, the scrollable container adjusts to show the step fully:

- If the step fits in the viewport, scroll so the entire step is visible (prioritizing the bottom edge)
- If the step is taller than the viewport, align the top edge

### 8.12 Performance

Stepping through proof steps must be **instantaneous** — no perceptible delay. Key principles:

- **Pre-render all steps** on proof load. KaTeX rendering happens once when the proof is loaded, not on each navigation. All step HTML is cached in `_proofPreRenderedAll` keyed by proof id.
- **Clone and configure**. Navigation clones pre-rendered nodes, toggles CSS classes, and re-injects event listeners. No full innerHTML replacement on step change.
- **Highlight animations are CSS-only**. Adding/removing `.hl-active` class triggers CSS transitions — no JS animation loops.
- **Build once, toggle visibility**. The proof section list is built once per scene change. Step navigation only updates CSS visibility — no DOM rebuild.
- **Scene sync is guarded**. If a proof step triggers `navigateTo()` for scene sync, a `_proofSyncInProgress` flag prevents re-entry. The proof panel updates immediately.

---

## 9. Future Extensions

Deferred from initial implementation:

- **Branching proofs** — `branch` field for alternate paths (proof by contradiction vs. direct proof)
- **Student-constructed proofs** — editable steps validated by the agent
- **Proof templates** — reusable patterns (induction, contradiction) with fill-in-the-blank
- **Cross-proof references** — linking between proofs across scenes
- **Annotation lines** — visual arrows/labels drawn over highlighted regions (beyond tooltips)
- **Persistent step memory** — save per-proof step positions to localStorage

