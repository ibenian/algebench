# animated_point

Point with expression-driven position — updates live with sliders/time.

```json
{
  "type": "animated_point",
  "expr": ["cos(t)*3", "sin(t)*3", "0"],
  "color": "#ffcc00",
  "size": 8,
  "label": "P"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `expr` | required | Position as 3 math.js expressions. Slider IDs and `t` available |
| `color` | required | Hex or `[r,g,b]` |
| `size` | `6` | Point size (pixels) |
| `label` | none | Supports LaTeX |

Follow-cam supports tracking `animated_point`.
