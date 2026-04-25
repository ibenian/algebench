## Agent Tools Reference

**Always use tool calls — never write scene JSON as raw text in chat.**
The tools are the only way to make visualizations actually render. When in doubt, make a tool call.

---

### `add_scene` — Build a visualization

Pass scene fields as direct top-level arguments. The client auto-navigates after adding — do NOT call `navigate_to` afterwards.
For interactive controls, place sliders under `steps[].sliders` (not top-level `sliders`).

```
add_scene(
  title="Cross Product $\\vec{a} \\times \\vec{b}$",
  description="Two vectors and their cross product.",
  range=[[-3,3],[-3,3],[-3,3]],
  camera={"position":[4,3,5],"target":[0,0,0]},
  elements=[
    {"type":"axis","axis":"x","range":[-3,3],"color":"#ff4444","width":1.5,"label":"x"},
    {"type":"axis","axis":"y","range":[-3,3],"color":"#44cc44","width":1.5,"label":"y"},
    {"type":"axis","axis":"z","range":[-3,3],"color":"#4488ff","width":1.5,"label":"z"},
    {"id":"va","type":"vector","from":[0,0,0],"to":[2,1,0],"color":"#ff6644","width":5,"label":"$\\vec{a}$"},
    {"id":"vb","type":"vector","from":[0,0,0],"to":[1,2,0],"color":"#44aaff","width":5,"label":"$\\vec{b}$"}
  ],
  steps=[
    {
      "title":"The Cross Product",
      "description":"$\\vec{a}\\times\\vec{b}$ is perpendicular to both — it points in the $z$ direction here.",
      "add":[
        {"id":"vc","type":"vector","from":[0,0,0],"to":[0,0,3],"color":"#ffcc00","width":5,"label":"$\\vec{a}\\times\\vec{b}$"}
      ]
    }
  ],
  markdown="# Cross Product\n\n$\\vec{a}\\times\\vec{b}$ gives a vector perpendicular to both..."
)
```

**Animated elements** — use math.js expressions (scope: `t` + slider ids):
```
{"type":"animated_vector","from":[0,0,0],"to":["cos(t)","sin(t)","0"],"color":"#ff6644","width":5}
{"type":"animated_point","position":["a*cos(t)","a*sin(t)","0"],"color":"#ffcc00","size":8}
{"type":"parametric_curve","x":"cos(u)","y":"sin(u)","z":"u/pi","range":[0,6.28],"steps":128,"color":"#44aaff"}
{"type":"vector_field","fx":"-y","fy":"x","fz":"0","density":4,"scale":0.3,"color":"#44aaff"}
```

**Sliders (inside a step):**
```
{
  "steps": [
    {
      "title": "Interactive controls",
      "sliders": [
        {"id":"a","label":"Amplitude $a$","min":0.5,"max":3,"value":1,"step":0.01},
        {"id":"t","label":"$t$","min":0,"max":1,"value":0,"step":0.01,"animate":true,"duration":2000}
      ]
    }
  ]
}
```

---

### `set_info_overlay` — Live LaTeX panel on the canvas

```
set_info_overlay(id="matrix", content="$$M = \\begin{pmatrix}{{a}} & {{b}}\\\\ {{c}} & {{d}}\\end{pmatrix}$$")
set_info_overlay(id="det", content="$\\det(M) = {{a*d - b*c}}$", position="top-right")
set_info_overlay(id="mag", content="$\\|\\vec{v}\\| = {{toFixed(sqrt(vx^2+vy^2+vz^2), 2)}}$")
set_info_overlay(id="omega", content="$\\omega = {{toFixed(2*pi*rpm/60, 3)}}\\text{ rad/s}$")
set_info_overlay(id="status", content="Status: {{v > 0 ? \"stable\" : \"unstable\"}}")
```

`id` and `content` are required. Reuse the same id to update an existing overlay; pick a new id for a distinct one.
`{{expr}}` placeholders use math.js syntax and update live as sliders move.
Write `{{a}}`. Do not use single-brace `{a}` placeholders.
Always add a matrix overlay when sliders define a matrix.

### `clear_info_overlays` — Remove all info overlays

```
clear_info_overlays()
```

Wipes every active info overlay. No parameters. Use to clean the slate before posting a fresh batch on a new topic. (The legacy `set_info_overlay(clear=True)` form still works for backwards compatibility but is deprecated — prefer `clear_info_overlays`.)

---

### `eval_math` — Compute exact numbers

**Expression syntax is Python** (not math.js): `x**2` not `x^2`, `sin(x)` not `Math.sin(x)`.

```
eval_math(expression="sqrt(ax**2 + ay**2 + az**2)")
eval_math(expression="dot(a, b)", variables={"a":[1,2,3],"b":[4,5,6]})
eval_math(expression="sin(x)", sweep_var="x", sweep_start=0, sweep_end=6.28, sweep_steps=64, store_as="sin_pts")
eval_math(expression="norm(a - b)", variables={"a":[3,0,0],"b":[0,4,0]})
```

Use `store_as` for large sweep results — reference them in `add_scene` as `"$key"`:
```
eval_math(expression="[cos(t), sin(t), 0]", sweep_var="t", sweep_start=0, sweep_end=6.28, sweep_steps=64, store_as="circle_pts")
add_scene(title="Circle", elements=[{"type":"line","points":"$circle_pts","color":"#44aaff"}])
```

---

### `set_sliders` — Animate slider values

```
set_sliders(values={"a": 2.0, "theta": 1.57})
set_sliders(values={"t": 0})
```

Only call when sliders are active (listed in Current State).

---

### `navigate_to` — Move between scenes and steps

```
navigate_to(scene=1, step=0)   // root of scene 1
navigate_to(scene=2, step=3)   // scene 2, third step
```

Steps: `0` = base scene, `1` = first step, etc. Check Current State for your current position first.

---

### `set_camera` — Adjust viewing angle

```
set_camera(view="top")
set_camera(view="iso")
set_camera(position=[5,3,4], target=[0,0,0])
set_camera(position=[0,0,8], target=[0,0,0], zoom=1.5)
```

---

### `mem_get` / `mem_set` — Agent memory

```
mem_get(key="?")               // list all stored keys
mem_get(key="basis_x")         // retrieve a stored value
mem_set(key="origin", value=[0,0,0])
```

Stored values are available as variables in `eval_math` and as `"$key"` in `add_scene` fields.

---

### `set_preset_prompts` — Suggested follow-up chips

```
set_preset_prompts(prompts=["Show me a rotation matrix","What's the determinant?","Animate with a slider"])
```

Call **once** per response, after your main action. Keep each prompt under 60 characters.

---

### math.js Expression Reference

Used in animated element fields, `parametric_curve`, and `{{expr}}` overlay placeholders.

| Category | Functions |
|----------|-----------|
| Trig | `sin` `cos` `tan` `asin` `acos` `atan` `atan2(y,x)` |
| Power / roots | `pow(x,n)` or `x^n` · `sqrt` · `cbrt` · `exp` |
| Log | `log` · `log2` · `log10` |
| Rounding | `floor` · `ceil` · `round` · `fix` |
| Misc | `abs` · `sign` · `min` · `max` · `hypot` |
| Constants | `pi` · `e` |
| Ternary | `cond ? a : b` (works with strings too) |
| Formatting | `toFixed(val, n)` — n decimal places as string |

**Do NOT use:** `Math.sin` / `Math.PI` / `x.toFixed(n)` / `let` / `return` / `=>` / `function`
