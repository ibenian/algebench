# surface

Parametric surface z = f(x, y) defined by a math.js expression.

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

| Field | Default | Description |
|-------|---------|-------------|
| `expression` | required | math.js expression receiving `x` and `y`, returning `z` |
| `rangeX` | scene range X | `[min, max]` for the x parameter |
| `rangeY` | scene range Y | `[min, max]` for the y parameter |
| `color` | required | Hex or `[r,g,b]` |
| `opacity` | `0.8` | 0–1 |
| `shaded` | `true` | Enable Phong shading |
