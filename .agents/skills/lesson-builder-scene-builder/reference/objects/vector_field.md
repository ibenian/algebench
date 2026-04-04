# vector_field

Auto-sampled vector field from math.js expressions.

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

| Field | Default | Description |
|-------|---------|-------------|
| `fx`, `fy`, `fz` | required | math.js expressions using `x`, `y`, `z` and slider ids |
| `density` | `4` | Samples per axis |
| `scale` | `0.3` | Arrow length scaling factor |
| `color` | required | Hex or `[r,g,b]` |
