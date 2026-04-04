# text

Static 2D text overlay anchored to a 3D position.

```json
{"type":"text","text":"$E = mc^2$","position":[1,2,0],"color":"#ffffff"}
```

| Field | Default | Description |
|-------|---------|-------------|
| `text` | required | Display text. Supports LaTeX via `$...$` |
| `position` | required | `[x,y,z]` anchor in data space |
| `positionExpr` | none | Dynamic position as 3 math.js expressions |
| `color` | `"#ffffff"` | Hex string |

Position labels to avoid overlapping elements. Use `positionExpr` for labels that track animated elements.
