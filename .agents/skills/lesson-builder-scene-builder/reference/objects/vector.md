# vector

Static arrow from tail to tip.

```json
{"type":"vector","from":[0,0,0],"to":[2,1,3],"color":"#0080ff","width":5,"label":"$\\vec{v}$"}
```

| Field | Default | Description |
|-------|---------|-------------|
| `from` | `[0,0,0]` | Tail position in data space |
| `to` | required | Tip position in data space |
| `color` | `"#ff8800"` | Hex or `[r,g,b]` |
| `width` | `3` | Shaft width (pixels) |
| `label` | none | Label at tip. Supports LaTeX |
| `opacity` | `1` | 0–1 |
| `id` | none | Unique string for referencing in steps |

For slider-driven vectors, use `animated_vector` instead.
