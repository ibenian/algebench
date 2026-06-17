## Agent Tools Reference

**Always use tool calls — never write tool arguments as raw text in chat.**
The tools are the only way to actually affect the visualization. When in doubt, make a tool call.

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

Wipes every active info overlay. No parameters. Use to clean the slate before posting a fresh batch on a new topic.

---

### `eval_math` — Compute exact numbers

**Expression syntax is Python** (not math.js): `x**2` not `x^2`, `sin(x)` not `Math.sin(x)`.

```
eval_math(expression="sqrt(ax**2 + ay**2 + az**2)")
eval_math(expression="dot(a, b)", variables={"a":[1,2,3],"b":[4,5,6]})
eval_math(expression="sin(x)", sweep_var="x", sweep_start=0, sweep_end=6.28, sweep_steps=64, store_as="sin_pts")
eval_math(expression="norm(a - b)", variables={"a":[3,0,0],"b":[0,4,0]})
```

Use `store_as` for large sweep results to keep them out of the chat context; stored values are then available as variables in later `eval_math` calls.

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

### `derive_proof_animation` — Derive a proof on the graph

```
derive_proof_animation(target_latex="x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}", start_latex="a x^2 + b x + c = 0")
derive_proof_animation(target_latex="2x", start_latex="\\frac{d}{dx} x^2", prompt="differentiate using the power rule")
derive_proof_animation(target_latex="x = 2")   // target only — starts from the current proof's givens
```

Generates a SymPy-verified, step-by-step derivation and docks it into the **current step's** semantic graph — just like the user clicking a node's *Derive* button, but initiated by you. Fire-and-forget: the animation appears **on the graph, not in chat**, and persists on that step even if the user navigates away. After calling, briefly tell the user you're deriving it — **do not** write out the steps yourself. It auto-switches to the Math view to show the result (works even from the 3D scene); you don't need to open the graph first. The current step must have a semantic graph — if it doesn't, the tool reports back so you can ask the user to navigate to one.

---

### `mem_get` / `mem_set` — Agent memory

```
mem_get(key="?")               // list all stored keys
mem_get(key="basis_x")         // retrieve a stored value
mem_set(key="origin", value=[0,0,0])
```

Stored values are available as variables in `eval_math`.

---

### `set_preset_prompts` — Suggested follow-up chips

```
set_preset_prompts(prompts=["Show me a rotation matrix","What's the determinant?","Animate with a slider"])
```

Call **once** per response, after your main action. Keep each prompt under 60 characters.

---

### `control_coach` — Drive the guided tour

```
control_coach(action="reset")
control_coach(action="start")
control_coach(action="goto", step="math-tab")
control_coach(action="stop")
```

Controls the onboarding "Coach" overlay (reachable from the **Tour** button, top-right). Use it
**only to change the tour state** when the user asks — e.g. "reset the tour", "start the tour",
"take me to the proof step", "turn off the tour", "next tip".

- `action`: `start` (open/resume), `reset` (clear progress and start over), `stop` (dismiss/hide),
  `goto` (jump to a step — needs `step`), `next` / `prev`, or `status` (no-op).
- `step`: a step id (e.g. `scenes-panel`, `voice-controls`, `math-tab`, `graph-controls`,
  `proof-panel`, `viewport-sliders`), a 1-based number, or a fuzzy title.

To **answer questions** about the tour ("where am I?", "what's left?"), read the `coach` object in
the runtime context (it lists `active`, `currentStepId`, `completed`, `remaining`, and all
`steps`) — don't call the tool just to report status.

---

### math.js Expression Reference

Used in `{{expr}}` overlay placeholders (`set_info_overlay`).

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
