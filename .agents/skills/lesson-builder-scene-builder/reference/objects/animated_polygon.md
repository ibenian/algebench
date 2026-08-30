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
| `color` | required | Hex or `[r,g,b]`. Also the legend swatch, and the fallback when `colorExpr` is absent or fails |
| `opacity` | `0.2` | 0–1, or a math.js expression string |
| `colorExpr` | — | math.js expression returning a **scalar**, mapped through `colorMap` and re-evaluated every frame |
| `colorMap` | `"viridis"` | `"viridis"`, `"magma"`, `"blueRed"`, or `{"stops":[{"t":0,"color":"#…"}, …]}`. Inert without `colorExpr` |
| `colorDomain` | `[0,1]` | Range `colorExpr` is normalized over before mapping. Values outside clamp |

Useful for morph/interpolation animations showing transformed shapes.

## Data-driven colour (heatmaps)

One cell per matrix entry, each colouring itself from its own value:

```json
{
  "type": "animated_polygon",
  "vertices": [["2.55","3.55","0"],["3.45","3.55","0"],["3.45","4.45","0"],["2.55","4.45","0"]],
  "color": "#3b528b",
  "colorExpr": "dataTable('attn', 3, 'w5')",
  "colorMap": "viridis",
  "colorDomain": [0, 0.6],
  "shader": { "type": "basic", "ignorePlaneOpacity": true }
}
```

Rules that bite:

- **Pick the ramp for the data.** `viridis` / `magma` are sequential — right for a non-negative
  quantity (a weight, a probability). `blueRed` is diverging and *implies a sign*, so it is only
  correct for signed data.
- **Give heatmap cells `labelExpr`, never `label`.** The legend groups by `label` + `color`, so
  64 labelled cells produce 64 legend rows.
- **`shader.type: "basic"`** skips the lighting and UV work per cell — worth it at grid scale.
- **`ignorePlaneOpacity: true`** keeps cells at their own opacity when the viewer drags the global
  *Planes* opacity control down.
- An expression that trips the JS-only guard (`if(...)`, `w.toFixed(2)`) compiles **silently to 0**
  in an untrusted scene — a uniformly cold heatmap and a clean console. Use the ternary
  `w > 0.5 ? 1 : 0` and the free function `toFixed(w, 2)`.
- The cells are the cost, not the colour: each cell already evaluates 12 vertex expressions per
  frame, so keep grids modest (an 8×8 is ~830 evaluations/frame).
