# Contributing to AlgeBench

## Vision

My ultimate goal is to create an agentic system that can genuinely engage in the tangible learning process — fostering that explorative, experimental mindset, willing and courageous enough to ask daring questions freely, supported by an infinitely patient tutor that can meet you exactly where you are and take you wherever you want to go.

Every contribution brings that vision closer to reality.

---

## Project Stage

AlgeBench is in early and active development. The codebase is evolving quickly — APIs, scene format fields, and rendering behavior can change between commits. Keep this in mind if you are building on top of it.

## Where Help Is Most Needed

**The scene library is the heart of the project.** The most valuable thing you can contribute right now is a new lesson scene.

My belief, at this stage of the project, is that the best contributions come from people who are already working on a real math problem or teaching a real concept — not from someone looking for something to contribute. If you are using AlgeBench to explore a topic (orbital mechanics, Fourier analysis, linear algebra, differential equations, machine learning, whatever it may be) and find yourself wanting something the tool does not yet support, that is the right moment to engage:

- **Feature request** — open an issue describing your use case and what you were trying to visualize. The context of a real problem makes the request concrete and actionable.
- **Pull request** — if you built something that works and want to share it, submit it. A scene contributed from genuine use is almost always better than one written speculatively.

This context-driven model keeps collaboration grounded. A contributor who says "I am teaching a course on rotating reference frames and built this scene" is far easier to collaborate with than an abstract feature request in isolation.

**Most contributions don't require touching any Python or JavaScript.**
The two most impactful things you can contribute are new scenes and new voice characters.

## Adding a Scene

Scenes are plain JSON files in `scenes/`. Each one is a self-contained interactive lesson.

### How to Build a Scene

The recommended workflow for building a full-featured scene is to work collaboratively with a coding agent using the **`algebench-scene-builder`** skill for Claude Code. This skill gives the agent full knowledge of the scene format, element types, expression sandbox, slider system, animation model, and best practices — so you can describe what you want to visualize and iterate on the JSON together through conversation.

Start by describing your math topic and what you want to show. The agent will propose a scene structure, you review it, and you refine it together — adjusting element placement, step flow, slider ranges, labels, and the markdown explanation until it matches your intent. This back-and-forth is how the existing built-in scenes were built.

**Why not build scenes inside AlgeBench directly?**

The long-term goal is to build scenes entirely within AlgeBench through the embedded AI chat. The AI agent can already create scenes, set sliders, and adjust the camera in real time. However, at this stage the agentic capabilities are not yet sophisticated enough to produce the level of quality and depth needed for full-featured scenes — multi-step progressive reveals, well-tuned physics simulations, clean markdown explanations, and carefully designed slider interactions. Building that quality interactively requires a tighter iteration loop and better context than the in-app agent currently supports.

Until that gap closes, a coding agent with the `algebench-scene-builder` skill is the most productive path to a polished scene.

**Minimal scene:**

```json
{
  "title": "My Scene",
  "description": "A short description shown below the title.",
  "markdown": "## My Scene\n\nExplanation text with $\\LaTeX$ math support.",
  "range": [[-4, 4], [-4, 4], [-4, 4]],
  "camera": { "position": [2, 2, 3], "target": [0, 0, 0] },
  "views": [],
  "elements": [],
  "steps": []
}
```

**Scene fields:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Shown in the title bar |
| `description` | string | Short subtitle shown in UI |
| `markdown` | string | Full lesson text, rendered in the Doc panel. Supports LaTeX math (`$...$`) and Markdown. |
| `range` | `[[xmin,xmax],[ymin,ymax],[zmin,zmax]]` | Axis bounds |
| `camera` | `{position, target}` | Initial camera position |
| `elements` | array | Objects to display (vectors, planes, points, etc.) |
| `steps` | array | Progressive reveal steps for narrated walkthroughs |

**Choosing between static and animated elements**

Every element type comes in two flavors — static and animated. Picking the right one matters both for correctness and performance.

A **static** element is built once when the scene loads. Its position, size, and shape are fixed — they do not respond to slider changes or animation time. Use static elements for anything that does not need to move or update: a reference axis, a fixed plane, a sphere representing a planet, a background grid.

An **animated** element is re-evaluated on every frame. Its geometry is driven by **expression strings** — small math formulas that reference slider values (by their `id`) and the animation clock (`t`). Whenever a slider moves, the expressions are re-evaluated and the element updates in real time. Use animated elements whenever the shape or position should change live.

```
// Static — position is hardcoded, never changes
{ "type": "vector", "from": [0,0,0], "to": [1,0,0] }

// Animated — tip tracks slider values a, b, c in real time
{ "type": "animated_vector", "fromExpr": ["0","0","0"], "expr": ["a","b","c"] }
```

If a position could be hardcoded, use the static type. If it needs to respond to sliders or time, use the animated type. Unnecessary animated elements add per-frame evaluation cost that accumulates across a scene.

**Static element types** — built once, zero per-frame cost:

| Type | Description |
|---|---|
| `axis` | Coordinate axis line |
| `grid` | Reference grid on xy, xz, or yz plane |
| `vector` | Arrow from `from` to `to` |
| `vectors` | Batch of arrows from `froms`/`tos` arrays |
| `vector_field` | Dense arrow field from `fx`, `fy`, `fz` expressions |
| `point` | One or more points |
| `line` | Polyline through a list of points |
| `plane` | Finite plane by normal and point |
| `polygon` | Flat filled polygon from vertices |
| `cylinder` | Cylinder between two endpoints |
| `sphere` | Sphere mesh |
| `ellipsoid` | Ellipsoid with per-axis radii |
| `surface` | Height surface `z = f(x, y)` |
| `parametric_curve` | Curve from `x(t)`, `y(t)`, `z(t)` expressions |
| `parametric_surface` | Surface from `x(u,v)`, `y(u,v)`, `z(u,v)` expressions |
| `text` | 3D text label |
| `skybox` | Background — solid color, starfield, or gradient |

**Animated element types** — re-evaluated every frame, driven by slider values and time `t`:

| Type | Description |
|---|---|
| `animated_vector` | Arrow driven by `expr`/`fromExpr` expressions |
| `animated_point` | Point driven by `expr` position expressions |
| `animated_line` | Polyline with per-vertex `points` expression arrays |
| `animated_cylinder` | Cylinder driven by `fromExpr`/`toExpr`/`radiusExpr` |
| `animated_polygon` | Filled polygon with per-vertex `vertices` expression arrays |

**How a scene is built from root to steps**

Understanding this model is essential for designing scenes correctly.

When a scene loads, the renderer first builds the **root layer** — all elements defined in the top-level `elements` array. This is the permanent base of the scene: axes, the planet sphere, a reference grid, background elements that should always be visible.

Steps are then applied **incrementally on top**. Each step has two operations that happen in order:
1. **`remove`** — hide elements from previous layers that are no longer needed
2. **`add`** — render new elements for this step, register new sliders

This means elements accumulate by default. An element added in step 1 is still visible in step 2, step 3, and beyond — unless explicitly removed. The scene at any step is the result of the root layer plus every step applied so far.

```
Root elements:   [axis, sphere, grid]
After step 1:    [axis, sphere, grid] + [vector_a, vector_b]
After step 2:    [axis, sphere, grid] + [vector_a, vector_b] + [plane]     ← remove: nothing
After step 3:    [axis, sphere] + [result_vector]                          ← remove: grid, vector_a, vector_b, plane
```

Navigating **forward** applies the next step's removes and adds on top of the current state.
Navigating **backward** automatically undoes the last step — its added elements are hidden and its removes are restored. This makes the scene fully reversible without any extra authoring work.

**Practical implications:**
- Put permanent context (axes, reference objects, background) in the root `elements` — never in steps
- Only add to steps what is specific to that conceptual moment
- Be explicit about removes — if an element has served its purpose, remove it before the next idea
- Don't rely on elements disappearing automatically — they persist until removed

**Steps (progressive reveal):**

```json
{
  "steps": [
    {
      "caption": "Start with a vector **v**.",
      "add": ["v1"],
      "remove": [],
      "sliders": []
    },
    {
      "caption": "Now add a second vector **w**.",
      "add": ["v2"],
      "remove": [],
      "sliders": []
    }
  ]
}
```

**Using `remove` to keep steps focused**

Each step can remove elements that are no longer relevant before introducing new ones. This is important — a cluttered canvas confuses the viewer. Every element on screen competes for attention, so a good scene only shows what is needed for the current idea.

`remove` is an array of targets. Each target is matched by `id`, by `type`, or with a wildcard:

```json
{ "remove": [
    { "id": "intro_vector" },        // hide a specific element
    { "type": "animated_line" },     // hide all elements of a type
    { "type": "slider" },            // hide all sliders
    { "id": "*" }                    // hide everything (clean slate)
] }
```

Removes are automatically undone when the user navigates backward, so the scene stays consistent in both directions.

**Scene hygiene principles:**
- Each step should show only the elements relevant to the concept being introduced at that moment
- Remove helper elements (construction lines, intermediate annotations) once they have served their purpose
- A clean canvas at the start of a new idea is almost always better than carrying everything forward
- Use `{"id": "*"}` at the start of a step when you want a full reset before introducing a new concept

Use the built-in scenes in `scenes/` as reference — `eigenvalues.json` and `matrix-transformations.json` show sliders and animated elements.

**Tips:**
- `caption` supports Markdown and LaTeX math
- Use `"remove": ["*"]` to clear all elements in a step
- Sliders: add `"sliders": [{"id": "t", "label": "t", "min": 0, "max": 1, "value": 0.5}]`
- Animated sliders: add `"animate": true, "duration": 2000` to a slider def
- Dynamic labels: add `"labelExpr": "'Value: ' + toFixed(x*100, 1) + '%'"` to any animated element — the label text updates each frame based on slider values and time

---

## Ideas and Roadmap

If you are looking for inspiration, or want a sense of the directions the project is considering:

- **[docs/feature-ideas.md](docs/feature-ideas.md)** — Platform and UX feature ideas: AI pedagogy, visualization element types, scene architecture, and longer-shot experimental ideas.
- **[docs/lesson-ideas.md](docs/lesson-ideas.md)** — Lesson concepts and content proposals: probability & statistics, machine learning, calculus, linear algebra, physics, complex analysis, and more.

Nothing in those documents is committed to — they are collections of seeds. If something there resonates with your interests or expertise, that is a good signal that a contribution in that area would be genuinely useful rather than speculative.

For system architecture and technical reference, see [docs/architecture.md](docs/architecture.md).

---

## Adding a Voice Character

Voice characters are defined in [`gemini-live-tools`](https://github.com/ibenian/gemini-live-tools) — see the contributing guide there and open a PR.

---

## License

By submitting a contribution (including pull requests), you agree that your contribution will be licensed under the same MIT License that covers this project.
