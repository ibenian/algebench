# parametric_surface

Surface defined by x(u,v), y(u,v), z(u,v) math.js expressions.

```json
{
  "type": "parametric_surface",
  "x": "sin(v) * cos(u)",
  "y": "cos(v)",
  "z": "sin(v) * sin(u)",
  "rangeU": [0, 6.2832],
  "rangeV": [0, 3.1416],
  "color": "#44aaff",
  "opacity": 0.7
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `x`, `y`, `z` | required | math.js expressions using variables `u` and `v` |
| `rangeU` | required | `[min, max]` for the u parameter |
| `rangeV` | required | `[min, max]` for the v parameter |
| `color` | required | Hex or `[r,g,b]` |
| `opacity` | `0.7` | 0–1 |
