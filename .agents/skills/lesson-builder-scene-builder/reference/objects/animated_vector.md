# animated_vector

Slider/time-driven arrow with expression-based tip (and optional tail).

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

| Field | Default | Description |
|-------|---------|-------------|
| `from` | `[0,0,0]` | Static tail position |
| `fromExpr` | none | Dynamic tail as 3 math.js expressions |
| `expr` | required | Tip position as 3 math.js expressions. Slider IDs and `t` (time in seconds) available |
| `color` | required | Hex or `[r,g,b]` |
| `width` | `3` | Shaft width (pixels) |
| `label` | none | Supports LaTeX |
| `opacity` | `1` | 0–1 |
| `arrowScale` | `1` | Scale factor for arrow head size. Use < 1 for smaller heads on long vectors |
| `arrow` | `true` | Set `false` to hide the arrow head entirely |
| `shader` | none | Optional `{"emissive":"#hex","shininess":N}` for lit appearance |

## Follow-cam support

`animated_vector` is a supported target for follow-cam views. The camera tracks the tip position.

## Example: dynamic tail and tip

```json
{
  "type": "animated_vector",
  "fromExpr": ["cos(t)", "sin(t)", "0"],
  "expr": ["cos(t) + vx", "sin(t) + vy", "0"],
  "color": "#ffcc00",
  "width": 4
}
```
