# parametric_curve

Curve defined by x(t), y(t), z(t) math.js expressions.

```json
{
  "type": "parametric_curve",
  "x": "cos(t)",
  "y": "sin(t)",
  "z": "t / (2 * pi)",
  "range": [0, 6.2832],
  "samples": 128,
  "color": "#ff8800",
  "width": 3
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `x`, `y`, `z` | required | math.js expressions using variable `t` |
| `range` | required | `[tMin, tMax]` parameter range |
| `samples` | `128` | Number of sample points (more = smoother) |
| `color` | required | Hex or `[r,g,b]` |
| `width` | `2` | Line width (pixels) |
| `opacity` | `1` | 0–1 |
| `label` | none | Supports LaTeX |

Expressions can also reference slider IDs for interactive curves.
