# animated_line

Polyline with expression-driven points — updates live with sliders/time.

```json
{
  "type": "animated_line",
  "points": [["0","0","0"],["k*2","k*1","0"]],
  "color": "#aa66ff",
  "width": 2
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `points` | required | Array of `[exprX, exprY, exprZ]` — each is a math.js expression string |
| `color` | required | Hex or `[r,g,b]` |
| `width` | `2` | Line width (pixels) |
| `opacity` | `1` | 0–1 |

Follow-cam supports tracking `animated_line` (follows the first point).
