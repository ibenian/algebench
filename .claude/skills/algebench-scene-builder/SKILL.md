---
name: algebench-scene-builder
description: Complete reference for building AlgeBench scene JSON files. Covers scene format, all element types, steps, sliders, animated elements, the expression sandbox model, and best practices for creating accurate, safe, interactive 3D math visualizations.
---

# AlgeBench Scene Builder

AlgeBench renders interactive 3D mathematical visualizations from JSON scene definitions. Place `.json` files in `scenes/` or pass scene data directly to the app.

---

## Workflow Summary

1. **Understand the request** — identify the math concept, whether 2D or 3D, and which element types are needed.
2. **Compute coordinates** — work out exact numbers for vectors, ranges, and camera positions before writing JSON.
3. **Write the JSON** — start with axes + grid, then add elements, then steps/sliders if needed.
4. **Verify** — check the checklist at the bottom of this skill before finalizing.

---

## Scene File Format

Scenes are JSON files in `scenes/`. There are two formats:

### Single Scene
```json
{
  "title": "My Scene",
  "description": "Short caption shown below the viewport on load",
  "markdown": "# Full explanation with $LaTeX$",
  "range": [[-5,5],[-5,5],[-5,5]],
  "scale": [1,1,1],
  "camera": {"position":[5,3,5],"target":[0,0,0]},
  "cameraUp": [0,1,0],
  "views": [...],
  "elements": [...],
  "steps": [...]
}
```

### Lesson (multi-scene)
```json
{
  "title": "Lesson Title",
  "scenes": [
    {
      "title": "Scene 1",
      "description": "...",
      "markdown": "...",
      "range": [...],
      "camera": {...},
      "views": [...],
      "elements": [...],
      "steps": [...]
    }
  ]
}
```

The lesson format adds a left-side scene tree with collapse/expand per scene and per-step navigation. Users move with Prev/Next buttons.

---

## Top-Level Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Display title. Supports LaTeX: `"$\\vec{a} \\times \\vec{b}$"` |
| `description` | string | no | Short subtitle shown below viewport on first load |
| `markdown` | string | no | Full explanation for the Doc panel. Supports `$...$` and `$$...$$` LaTeX, bold, lists, code blocks |
| `prompt` | string | no | **Agent-only** — injected into the AI system prompt for this scene. Never shown to the user. Use for teaching hints, color conventions, follow-up exploration prompts |
| `range` | `[[xmin,xmax],[ymin,ymax],[zmin,zmax]]` | no | Data coordinate range. Default `[[-5,5],[-5,5],[-5,5]]`. All element coordinates live in this space |
| `scale` | `[sx,sy,sz]` | no | World-space scale factors. Default `[1,1,1]` |
| `camera` | object | no | Initial camera: `{"position":[x,y,z],"target":[x,y,z]}` — in **data space** |
| `cameraUp` | `[x,y,z]` | no | Up vector. Default `[0,1,0]`. Use `[0,0,1]` for geology/top-down conventions |
| `views` | array | no | Custom camera preset buttons. Omit to get 4 defaults (Iso, Front, Top, Right) |
| `unsafe` | boolean | no | Set `true` if scene uses native JS expressions. Shows trust dialog immediately (see Sandbox section) |
| `unsafe_explanation` | string | no | Shown in the trust dialog. Required when `unsafe: true` |

---

## Camera Views

```json
"views": [
  {"name":"Face On","position":[0,0,10],"target":[0,0,0],"description":"Face-on 2D view"},
  {"name":"Iso","position":[4,3,4],"target":[0,0,0],"description":"Isometric 3D view"},
  {"name":"Top Down","position":[0,8,0],"target":[0,0,0],"description":"Looking straight down"}
]
```

All positions are in **data space**. If `views` is omitted, four defaults are provided: **Iso** `[2.5,1.8,2.5]`, **Front** `[0,0,4.5]`, **Top** `[0,4.5,0.01]`, **Right** `[4.5,0,0]`.

### Follow Camera Views

A view entry can track an **animated element** in real time by setting `"follow"` to the element's `id`. The camera is placed at the element's world position plus a data-space `offset`, looking at the element.

```json
{
  "name": "Ride Along",
  "description": "Camera follows the orbiting object from above",
  "follow": "my_animated_point",
  "offset": [0, 0, 20],
  "up": [0, 1, 0]
}
```

| Field | Description |
|-------|-------------|
| `follow` | `id` of the animated element to track. Can also be an array of ids — first resolvable one is used |
| `offset` | Data-space `[x, y, z]` offset from the element's position. Default `[0, 0, 30]` |
| `up` | Camera up vector. Default: inherits scene `cameraUp` |
| `angleLockAxis` | `[x,y,z]` — axis around which the camera rotates to stay oriented with the element's motion |
| `angleLockVector` | Element `id` (or array of ids) whose live direction drives the camera's orientation lock |
| `angleLockDirection` | Two-element array `[id_a, id_b]` — computes direction from element `id_a` tip toward `id_b` tip |

**Supported element types for follow:** `animated_vector`, `animated_point`, `animated_line` (follows the first point).

**Minimal follow-cam example:**
```json
"elements": [
  {"id":"orbiter","type":"animated_vector","from":[0,0,0],
   "expr":["cos(t)*3","sin(t)*3","0"],"color":"#ffcc00","width":5}
],
"views": [
  {"name":"Iso","position":[5,4,5],"target":[0,0,0],"description":"Overview"},
  {"name":"Ride Along","description":"Camera mounted to the orbiter",
   "follow":"orbiter","offset":[0,0,4],"up":[0,1,0]}
]
```

**Full follow-cam with orientation lock** (as in the rotating habitat scene):
```json
{
  "name": "Ride Along",
  "description": "Follow the person on the rotating rim — camera tracks from above along spin axis",
  "follow": "person_walk",
  "offset": [0, 0, 20],
  "angleLockAxis": [0, 0, 1],
  "angleLockVector": ["walk_vel_vec", "walk_vel_vec_full"],
  "angleLockDirection": ["person_walk", "person_walk_head"],
  "up": [0, 1, 0]
}
```

The ⟳ button in the toolbar toggles **angle-lock** on/off at runtime, letting users switch between "camera rotates with the object" and "camera follows position only."

---

### Camera Patterns

**2D scene (face-on):**
```json
"range": [[-4,4],[-4,4],[-0.5,0.5]],
"camera": {"position":[0,0,8],"target":[0,0,0]},
"views": [
  {"name":"Face On","position":[0,0,10],"target":[0,0,0],"description":"Face-on 2D view"},
  {"name":"Iso","position":[4,3,4],"target":[0,0,0],"description":"3D perspective"}
]
```

**3D scene (isometric):**
```json
"range": [[-1,5],[-1,5],[-1,4]],
"camera": {"position":[6,4,6],"target":[2,2,1.5]},
"views": [
  {"name":"Iso","position":[6,4,6],"target":[2,2,1.5],"description":"Isometric view"},
  {"name":"Front","position":[2,2,10],"target":[2,2,1.5],"description":"Front (XY plane)"},
  {"name":"Top","position":[2,10,1.5],"target":[2,0,1.5],"description":"Top (XZ plane)"},
  {"name":"Right","position":[10,2,1.5],"target":[2,2,1.5],"description":"Right (YZ plane)"}
]
```

---

## Element Types

`elements` is the **base layer** shown on load. Always start with axes and a grid:

```json
"elements": [
  {"type":"axis","axis":"x","range":[-5,5],"color":"#ff4444","width":1.5,"label":"x"},
  {"type":"axis","axis":"y","range":[-5,5],"color":"#44cc44","width":1.5,"label":"y"},
  {"type":"axis","axis":"z","range":[-5,5],"color":"#4488ff","width":1.5,"label":"z"},
  {"type":"grid","plane":"xy","range":[-5,5],"color":[0.3,0.3,0.5],"opacity":0.15,"divisions":10}
]
```

### axis
```json
{"type":"axis","axis":"x","range":[-3,3],"color":"#ff4444","width":1.5,"label":"x"}
```
| Field | Default | Description |
|-------|---------|-------------|
| `axis` | `"x"` | `"x"`, `"y"`, or `"z"` |
| `range` | `[-5,5]` | Extent of the axis line in data space |
| `color` | per-axis | Hex string or `[r,g,b]` (0–1) |
| `width` | `2` | Line width (pixels) |
| `label` | axis letter | Label at positive end. Supports LaTeX |

### grid
```json
{"type":"grid","plane":"xy","range":[-5,5],"color":[0.3,0.3,0.5],"opacity":0.15,"divisions":10}
```
| Field | Default | Description |
|-------|---------|-------------|
| `plane` | `"xy"` | `"xy"`, `"xz"`, or `"yz"` |
| `range` | `[-5,5]` | Single scalar applied to both axes of the plane |
| `opacity` | `0.15` | 0–1 |
| `divisions` | `10` | Number of grid lines per axis |

### vector
```json
{"type":"vector","from":[0,0,0],"to":[2,1,3],"color":"#0080ff","width":5,"label":"$\\vec{v}$"}
```
| Field | Default | Description |
|-------|---------|-------------|
| `from` | `[0,0,0]` | Tail position in data space |
| `to` | required | Tip position in data space |
| `color` | `"#ff8800"` | Hex or `[r,g,b]` |
| `width` | `3` | Shaft width (pixels) |
| `label` | none | Label at tip. Supports LaTeX |
| `opacity` | `1` | 0–1 |
| `id` | none | Unique string for referencing in steps |

### point
```json
{"type":"point","position":[2,1,0],"color":"#ffffff","size":8,"label":"$(2,1)$"}
```

### line
Draws a straight segment or polyline through many points:
```json
{"type":"line","points":[[0,0,0],[2,1,0],[3,3,0]],"color":"#aa66ff","width":2}
```
Pass many points (e.g., from `eval_math` sweep) to draw smooth curves.

### polygon
Filled convex polygon (parallelograms, triangular faces, etc.):
```json
{"type":"polygon","vertices":[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],"color":"#4466aa","opacity":0.3}
```

### plane
Infinite (clipped) plane:
```json
{"type":"plane","normal":[0,0,1],"point":[0,0,0],"color":"#4466aa","opacity":0.25,"size":6}
```
| Field | Default | Description |
|-------|---------|-------------|
| `normal` | required | Normal vector `[x,y,z]` |
| `point` | required | A point on the plane |
| `size` | `5` | Half-extent of the visible square |

### text
Static 2D text overlay anchored to a 3D position:
```json
{"type":"text","text":"$E = mc^2$","position":[1,2,0],"color":"#ffffff"}
```

### surface
Parametric surface defined by a math.js expression:
```json
{
  "type": "surface",
  "expression": "sin(x) * cos(y)",
  "rangeX": [-3,3],
  "rangeY": [-3,3],
  "color": "#4488ff",
  "opacity": 0.8,
  "shaded": true
}
```
`expression` receives `x` and `y` and must return `z`. Use math.js syntax: `sin(x)` not `Math.sin(x)`, `pi` not `Math.PI`.

### parametric_curve
```json
{
  "type": "parametric_curve",
  "x": "cos(t)",
  "y": "sin(t)",
  "z": "t / (2 * pi)",
  "range": [0,6.2832],
  "steps": 128,
  "color": "#ff8800",
  "width": 3
}
```
`x`, `y`, `z` are math.js expressions using variable `t` over `range`.

### parametric_surface
```json
{
  "type": "parametric_surface",
  "x": "sin(v) * cos(u)",
  "y": "cos(v)",
  "z": "sin(v) * sin(u)",
  "rangeU": [0,6.2832],
  "rangeV": [0,3.1416],
  "color": "#44aaff",
  "opacity": 0.7
}
```

### vectors (array of arrows)
Efficient for vector fields, function graphs, etc.:
```json
{
  "type": "vectors",
  "tos": [[1,0.84,0],[2,0.91,0],[3,0.14,0]],
  "froms": [[1,0,0],[2,0,0],[3,0,0]],
  "color": "#ff8800",
  "width": 3
}
```
`froms` defaults to all `[0,0,0]` if omitted. Typically generated via `eval_math` sweep.

### vector_field
Auto-sampled vector field from math.js expressions:
```json
{
  "type": "vector_field",
  "fx": "y",
  "fy": "-x",
  "fz": "0",
  "density": 4,
  "scale": 0.3,
  "color": "#44aaff"
}
```
`fx`, `fy`, `fz` use math.js expressions with `x`, `y`, `z` and any slider ids. `density` = samples per axis, `scale` = arrow length scaling.

---

## Steps: Progressive Reveal

`steps` build up the scene incrementally. Base `elements` are shown on load; steps add/remove/animate on top.

Steps are **cumulative** — elements persist until explicitly removed. Users navigate with Prev/Next.

### Step Structure
```json
{
  "title": "Step Title — shown in scene tree",
  "description": "Narration shown below viewport when user reaches this step",
  "add": [...elements to add...],
  "remove": [...removal targets...],
  "camera": {"position":[x,y,z],"target":[x,y,z]},
  "sliders": [...slider definitions...],
  "info": [...info overlay definitions...]
}
```

All fields are optional. A step with only `description` is a narration beat.

### Remove Patterns
```json
{"id": "vec-a"}     // remove one element by id
{"id": "*"}         // remove ALL elements (clean slate)
{"type": "slider"}  // remove all active sliders
```

Give elements an `"id"` if you plan to remove them later.

### Full Steps Example
```json
"steps": [
  {
    "title": "Vector $\\vec{a}$",
    "description": "Here's $\\vec{a} = (2,1)$.",
    "add": [
      {"id":"va","type":"vector","from":[0,0,0],"to":[2,1,0],"color":"#ff6644","width":5,"label":"$\\vec{a}$"}
    ]
  },
  {
    "title": "The Sum",
    "description": "The sum $\\vec{a}+\\vec{b} = (3,4)$.",
    "add": [
      {"id":"vs","type":"vector","from":[0,0,0],"to":[3,4,0],"color":"#ffcc00","width":6,"label":"$\\vec{a}+\\vec{b}$"}
    ]
  },
  {
    "title": "Explore with Sliders",
    "description": "Drag to change $\\vec{a}$ in real time.",
    "remove": [{"id":"*"}],
    "add": [
      {"type":"axis","axis":"x","range":[-6,6],"color":"#ff4444","width":1.5,"label":"x"},
      {"type":"axis","axis":"y","range":[-6,6],"color":"#44cc44","width":1.5,"label":"y"},
      {"type":"grid","plane":"xy","range":[-6,6],"color":[0.3,0.3,0.5],"opacity":0.15,"divisions":12},
      {"type":"animated_vector","from":[0,0,0],"expr":["ax","ay","0"],"color":"#ff6644","width":5,"label":"$\\vec{a}$"}
    ],
    "sliders": [
      {"id":"ax","label":"$a_x$","min":-4,"max":4,"step":0.1,"default":2},
      {"id":"ay","label":"$a_y$","min":-4,"max":4,"step":0.1,"default":1}
    ]
  }
]
```

---

## Sliders & Animated Elements

Sliders let users drag a control to change values in real time. They work with **animated element types** that use math.js expressions referencing slider IDs.

### Slider Definition
```json
{"id":"k","label":"$k$","min":-3,"max":3,"step":0.1,"default":1}
```
| Field | Description |
|-------|-------------|
| `id` | Variable name used in expressions. Keep it short: `"k"`, `"theta"`, `"ax"` |
| `label` | Display label, supports LaTeX |
| `min` / `max` | Range |
| `step` | Drag resolution |
| `default` | Initial value |

### Auto-Play Slider
```json
{"id":"t","label":"$t$","min":0,"max":1,"step":0.01,"default":1,"animate":true,"duration":2500}
```
- `animate: true` adds a ▶/⏸ play button that ping-pong animates automatically
- `duration`: full cycle in milliseconds (default 2000)
- Set `default: 1` (max) so users see the final state first, then press ▶ to watch the transition

### animated_vector
```json
{
  "type": "animated_vector",
  "from": [0,0,0],
  "expr": ["k * 2","k * 1","0"],
  "color": "#ff6644",
  "width": 5,
  "label": "$k\\vec{a}$"
}
```
- `from`: static tail
- `fromExpr`: `["ex","ey","ez"]` — dynamic tail driven by sliders
- `expr`: **required** — tip as 3 math.js expression strings. Slider IDs and `t` (time in seconds) available.

### animated_line
```json
{
  "type": "animated_line",
  "points": [["0","0","0"],["k*2","k*1","0"]],
  "color": "#aa66ff",
  "width": 2
}
```
Each point is an array of 3 math.js expression strings.

### animated_polygon
```json
{
  "type": "animated_polygon",
  "vertices": [["0","0","0"],["ax","ay","0"],["ax+bx","ay+by","0"],["bx","by","0"]],
  "color": "#ffcc00",
  "opacity": 0.2
}
```

### Slider Tips
- **Put sliders in the final step** after static steps build understanding
- **Expand axis ranges** to accommodate the full slider range (e.g., max scalar=3 on vector (2,1) → tip reaches (6,3) → use range ≥ 7)
- **Show a ghost** — static dimmer copy of the original alongside the animated one
- **Common ranges**: scalars `[-3,3]`, angles `[0,6.28]`, components `[-5,5]`
- **Matrix sliders**: always add an `info` overlay showing the live matrix with `{{slider_id}}` placeholders

---

## Morph / Interpolation Pattern

To animate a transformation smoothly, use a `t` slider (`0→1`) and lerp between identity and target:

Given $M = \begin{pmatrix}a & b\\ c & d\end{pmatrix}$, the interpolated matrix is $M(t) = (1-t)I + tM$.

Each vertex $(x, y)$ maps to $(M(t)\mathbf{v})$ at time $t$:
- $(1,0)$ → lerps to $(a,c)$: position at $t$ is $(1-t+ta,\ tc)$
- $(0,1)$ → lerps to $(b,d)$: position at $t$ is $(tb,\ 1-t+td)$
- Origin stays fixed always

```json
{
  "title": "Morphing Animation",
  "add": [
    {"id":"orig-sq","type":"polygon","vertices":[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],"color":"#4488ff","opacity":0.15},
    {"type":"animated_vector","from":[0,0,0],"expr":["1-t+t*a","t*c","0"],"color":"#ff6600","width":5,"label":"$T(\\mathbf{e}_1)$"},
    {"type":"animated_vector","from":[0,0,0],"expr":["t*b","1-t+t*d","0"],"color":"#00cc44","width":5,"label":"$T(\\mathbf{e}_2)$"},
    {"type":"animated_polygon",
     "vertices":[["0","0","0"],["1-t+t*a","t*c","0"],["1-t+t*(a+b)","1-t+t*(c+d)","0"],["t*b","1-t+t*d","0"]],
     "color":"#ffcc44","opacity":0.25}
  ],
  "sliders": [
    {"id":"t","label":"$t$","min":0,"max":1,"step":0.01,"default":1,"animate":true,"duration":2500},
    {"id":"a","label":"$a$","min":-2,"max":2,"step":0.1,"default":1.5},
    {"id":"b","label":"$b$","min":-2,"max":2,"step":0.1,"default":0.5},
    {"id":"c","label":"$c$","min":-2,"max":2,"step":0.1,"default":0.5},
    {"id":"d","label":"$d$","min":-2,"max":2,"step":0.1,"default":1.2}
  ],
  "info": [
    {"id":"matrix","content":"$$M(t) = \\begin{pmatrix}{1-t+t*a} & {t*b}\\\\ {t*c} & {1-t+t*d}\\end{pmatrix}$$"}
  ]
}
```

---

## Info Overlays

Info overlays are floating LaTeX panels on the canvas that update live as sliders change. They are step-scoped and auto-cleared on navigation.

### Defining in Step JSON
```json
{
  "title": "Interactive Transformation",
  "sliders": [
    {"id":"a","label":"$a$","min":-2,"max":2,"step":0.1,"default":1.5},
    {"id":"b","label":"$b$","min":-2,"max":2,"step":0.1,"default":0.5}
  ],
  "info": [
    {"id":"matrix","content":"$$M = \\begin{pmatrix}{{a}} & {{b}}\\\\ {{c}} & {{d}}\\end{pmatrix}$$"}
  ]
}
```

### Overlay Fields
| Field | Description |
|-------|-------------|
| `id` | Unique identifier — reuse to update, different ids for multiple overlays |
| `content` | LaTeX/markdown. Use `{{slider_id}}` or `{{expression}}` for live values |
| `position` | `top-left` (default), `top-right`, `top-center`, `bottom-left`, `bottom-right` |

### Live Placeholder Syntax
Use `{{expr}}` to insert any **math.js expression** evaluated against current slider values:

| Placeholder | Result |
|------------|--------|
| `{{a}}` | Current value of slider `a` |
| `{{1-t+t*a}}` | Interpolated value |
| `{{a*d - b*c}}` | Determinant of 2×2 matrix |
| `{{toFixed(sqrt(a^2+b^2), 2)}}` | Formatted magnitude, 2 decimal places |
| `{{v > 0 ? "stable" : "unstable"}}` | Conditional string |

### When to Use Info Overlays
- **Always** when sliders define a matrix — show the live matrix so users see what they're tuning
- When a formula has slider-driven parameters — display it live
- For transformation scenes — show det, trace, eigenvalue formulas
- Keep concise — one formula or small matrix per overlay, not paragraphs

---

## Markdown Panel

The `markdown` field populates the **Doc** panel on the right side. In JSON, escape backslashes: `"$\\vec{v}$"`.

```json
"markdown": "# Concept Name\n\n**Definition**: $...$\n\n## This Example\n\nWith $\\vec{a} = (2,1,0)$:\n\n$$\\vec{a} + \\vec{b} = (3, 3, 1)$$\n\n## Key Properties\n\n- **Property 1**: ...\n- **Property 2**: ...\n\n> **Geometric insight**: ..."
```

---

## The `prompt` Field (Agent Instructions)

`prompt` is an optional string at the **scene level** injected into the AI chat agent's system prompt when that scene is active. **Never shown to the user.**

Use it to:
- Guide follow-up examples to build
- Specify consistent color conventions
- Provide exploration prompts the agent can offer
- Suggest related topics to introduce naturally

```json
"prompt": "You are teaching eigenvalues for this scene.\n\n## Follow-Up Patterns\nWhen the student asks to explore:\n- Build a slider that animates the matrix transformation\n\n## Color Convention\nKeep: eigenvector 1 = gold, eigenvector 2 = cyan, non-eigenvectors = grey\n\n## Related Topics\nNaturally suggest: diagonalization, PCA, SVD"
```

---

## Expression Sandbox Model

### ⚠ Security — Always Use math.js Syntax

AlgeBench uses a **two-tier evaluation model**. Always default to math.js; only use native JS when absolutely necessary.

**Tier 1 — math.js sandbox (default, safe):**
- No `eval` or `new Function`
- No access to `window`, `document`, `fetch`, or any browser API
- Full math library: `sin`, `cos`, `sqrt`, `pow`, `pi`, `e`, etc.
- Scope: `t` (animation time) + any slider ids

**Tier 2 — native JS (requires user trust):**
- Triggered when expressions contain `Math.`, `let`, `const`, `return`, `for(`, `while(`, `=>`, `function`, or method calls like `.toFixed(`
- Shows a trust dialog before executing
- Use only for algorithms with no closed form (e.g., iterative gradient descent)

### math.js Expression Reference

| Old (JavaScript) | Correct (math.js) |
|---|---|
| `Math.sin(t)` | `sin(t)` |
| `Math.cos(t)` | `cos(t)` |
| `Math.pow(x, n)` | `pow(x, n)` or `x^n` |
| `Math.sqrt(x)` | `sqrt(x)` |
| `Math.abs(x)` | `abs(x)` |
| `Math.PI` | `pi` |
| `Math.E` | `e` |
| `Math.min(a,b)` | `min(a, b)` |
| `Math.max(a,b)` | `max(a, b)` |
| `Math.floor(x)` | `floor(x)` |
| `x.toFixed(n)` | `toFixed(x, n)` |
| `t**2` | `t^2` or `pow(t, 2)` |

**Full trig:** `sin` `cos` `tan` `asin` `acos` `atan` `atan2(y,x)`

**Power/roots:** `pow(x,n)` or `x^n` · `sqrt` · `cbrt` · `exp` · `log` · `log2` · `log10`

**Rounding:** `floor` · `ceil` · `round` · `fix` (truncate)

**Misc:** `abs` · `sign` · `min` · `max` · `hypot`

**Constants:** `pi` (= π) · `e` (= 2.718…)

**Ternary:** `cond ? a : b` — works natively, including with string values

**AlgeBench Extensions to math.js:** `toFixed(val, n)` — format to `n` decimal places. Do NOT write `val.toFixed(n)`.

**What is NOT allowed in math.js expressions:**
- `Math.sin(x)`, `Math.PI` — use `sin(x)`, `pi`
- `x.toFixed(n)` — use `toFixed(x, n)`
- `let`, `const`, `return`, `for(`, `while(`, `function`, `=>` — these route to JS fallback (trust dialog)
- `.constructor`, `.toString`, any other method call
- `document`, `window`, `fetch` — blocked entirely in sandbox

### When Unsafe JS Is Necessary
Set `"unsafe": true` and provide a clear `"unsafe_explanation"` when scenes require:
- Iterative algorithms (e.g., gradient descent, Newton's method)
- Any loop or recursion with no closed-form equivalent

```json
{
  "unsafe": true,
  "unsafe_explanation": "This scene uses loop-based gradient descent animation requiring native JS. Scenes 1 and 2 use only the math.js sandbox.",
  "title": "Gradient Descent",
  ...
}
```

## Domain Libraries

Domain libraries extend the expression sandbox with pre-built simulation functions for specific science or engineering domains. They are the right tool when a simulation requires persistent state, iterative integration, or shared caches that cannot be expressed as a closed-form math.js expression.

### Discovering Available Domains

Before building a scene that might use domain functions, **query the API** to see what is available:

```
GET /api/domains
```

Returns a list of all installed domains with their name, description, and function names:

```json
[
  {
    "name": "astrodynamics",
    "description": "Orbital mechanics simulation engine...",
    "functions": ["orbitX", "orbitY", "orbitR", "orbitVr", "orbitVt", "orbitHit", "orbitOutcome"]
  }
]
```

### Getting Full Docs for a Domain

```
GET /api/domains/<name>
```

Returns the full documentation object for that domain, including:
- **`sliderContracts`** — every slider ID the domain reads, with description, default value, and which modes use it
- **`functions`** — every function: signature, param descriptions, return type, which sliders it depends on, and a usage example
- **`modes`** — named modes and what they mean

**Always read the domain docs before writing expressions or sliders.** The slider IDs listed in `sliderContracts` are the implicit API — the domain reads these by name from scene slider state. If a required slider is missing or misnamed, the function silently falls back to its default.

### Using a Domain in a Scene

Add the `"import"` field at the top level of the scene JSON:

```json
{
  "title": "My Orbital Scene",
  "import": ["astrodynamics"],
  ...
}
```

For a lesson (multi-scene format), `"import"` goes at the lesson root level (outside `"scenes"`):

```json
{
  "title": "Orbital Flight Simulation",
  "import": ["astrodynamics"],
  "scenes": [...]
}
```

The named functions become available in the expression sandbox for all animated elements in the scene. They use **math.js call syntax** — no `Math.` prefix needed.

### Slider Naming Contract

Domain functions pull slider values by hardcoded ID. You **must** name your sliders to match the domain's `sliderContracts`. Example — to use `orbitX(t, 0)`, the scene must define sliders named `Rp`, `Gs`, `Mx`, `h`, `T`, `phi`, and `vlaunch` (for coast mode).

If a slider is not present, the domain uses the documented default — the simulation still runs, but that parameter is no longer interactive.

### Example — Astrodynamics

```json
{
  "title": "Coast Trajectory",
  "import": ["astrodynamics"],
  "range": [[-15000,15000],[-15000,15000],[-15000,15000]],
  "elements": [
    {"type":"sphere","id":"planet","radius":6371,"color":"#3a7bd5"},
    {
      "type": "animated_point",
      "id": "spacecraft",
      "expr": ["orbitX(t,0)", "orbitY(t,0)", "0"],
      "color": "#ffcc00",
      "size": 8
    }
  ],
  "steps": [
    {
      "caption": "Adjust launch speed and angle.",
      "sliders": [
        {"id":"vlaunch","label":"Launch speed (km/s)","min":0,"max":12,"value":7.8,"step":0.1},
        {"id":"phi","label":"Launch angle (deg)","min":-90,"max":90,"value":0,"step":1},
        {"id":"T","label":"Duration (s)","min":60,"max":7200,"value":3600,"step":60}
      ]
    }
  ]
}
```

### Safety Note

Domain libraries are built-in, server-shipped code — they are **not** user-authored expressions. Importing a domain does **not** require `"unsafe": true`. The trust dialog is only for scenes that contain native JS expressions written directly in the scene JSON (e.g. in `scene.functions` or animated element expressions using `let`, `for`, `=>`, etc.).

---

## LaTeX in Labels

Element `label` fields support LaTeX via KaTeX. Always double-escape backslashes in JSON:

| Math | JSON string |
|------|-------------|
| `$\vec{v}$` | `"$\\vec{v}$"` |
| `$\lambda_1$` | `"$\\lambda_1$"` |
| `$\vec{a} \times \vec{b}$` | `"$\\vec{a} \\times \\vec{b}$"` |
| `$(x_0, y_0)$` | `"$(x_0, y_0)$"` |

---

## Axis Range vs Scene Range

The **scene `range`** defines the data coordinate system. The **axis `range`** is just how far the visual line extends. Keep them consistent:

```json
"range": [[-3,3],[-3,3],[-3,3]],
"elements": [
  {"type":"axis","axis":"x","range":[-3,3],...},
  {"type":"axis","axis":"y","range":[-3,3],...}
]
```

---

## Loading Scenes

1. **Built-in scenes** — place `.json` in `scenes/` directory and restart server. Appears in "Built-in Scenes" dropdown.
2. **Load JSON button** — users load any `.json` from disk via toolbar.
3. **URL parameter** — `?scene=filename` (without `.json`) loads on startup. `?step=N` starts at a specific scene index.
4. **AI agent** — `add_scene` tool creates scenes dynamically from conversation.

---

## Checklist for Every Scene

- [ ] `title` set
- [ ] `markdown` written with LaTeX explanation in the Doc panel
- [ ] `elements` starts with axes + grid
- [ ] axis `range` matches scene `range`
- [ ] camera `position` and `target` in **data space**
- [ ] Custom `views` with `description` tooltips if scene needs specific angles
- [ ] If 2D: narrow Z range (`[-0.5,0.5]`) and face-on camera
- [ ] If steps: each step has a `title` (scene tree) and `description` (narration)
- [ ] If sliders: axis range covers full slider extent
- [ ] If sliders define a matrix/formula: add `"info"` overlay with live `{{slider_id}}` content
- [ ] If morph animation: `t` slider with `default: 1`, `animate: true`
- [ ] Element `id`s on anything that will be removed by a step
- [ ] LaTeX backslashes double-escaped in JSON strings
- [ ] All expressions use **math.js syntax** (not `Math.sin`, not `x.toFixed(n)`)
- [ ] If native JS is required: `"unsafe": true` and `"unsafe_explanation"` set

---

## Common Mistakes to Avoid

| Wrong | Right |
|-------|-------|
| `Math.sin(t)` in expr | `sin(t)` |
| `Math.PI` | `pi` |
| `x.toFixed(2)` | `toFixed(x, 2)` |
| `t**2` | `t^2` |
| Axis range `[-5,5]` but scene range `[-3,3]` | Match them |
| Slider max=4 on vector `[2,1]`, range only to 5 | Range needs to reach `[8,4]` → use 9+ |
| Writing scene JSON as raw text in chat | Always use `add_scene` tool call |
| `navigate_to` after `add_scene` | `add_scene` auto-navigates |
| `{a}` in overlay content | `{{a}}` |
| Camera position outside data range | Keep position in same scale as range |
