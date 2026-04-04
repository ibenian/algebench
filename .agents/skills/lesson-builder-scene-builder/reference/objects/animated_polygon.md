# animated_polygon

Filled polygon with expression-driven vertices — updates live with sliders/time.

```json
{
  "type": "animated_polygon",
  "vertices": [["0","0","0"],["ax","ay","0"],["ax+bx","ay+by","0"],["bx","by","0"]],
  "color": "#ffcc00",
  "opacity": 0.2
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `vertices` | required | Array of `[exprX, exprY, exprZ]` — each is a math.js expression string |
| `color` | required | Hex or `[r,g,b]` |
| `opacity` | `0.2` | 0–1 |

Useful for morph/interpolation animations showing transformed shapes.
