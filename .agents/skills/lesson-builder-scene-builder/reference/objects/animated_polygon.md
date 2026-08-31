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
| `color` | required | Hex or `[r,g,b]`. Also the legend swatch |
| `opacity` | `0.2` | 0–1, or a math.js expression string |

Useful for morph/interpolation animations showing transformed shapes.

## Drawing a matrix or heatmap? Use `tensor`

A grid of value-coloured cells is a **`tensor`**, not a stack of `animated_polygon`s — one element
instead of `rows × cols`, one compiled expression instead of hundreds, and one draw call.
See `tensor.md`. Hand-writing a lattice out of polygons is the anti-pattern that element exists to
remove.
