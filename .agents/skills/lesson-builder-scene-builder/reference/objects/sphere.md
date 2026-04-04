# sphere

3D sphere. Can be static or expression-driven.

```json
{"type":"sphere","center":[0,0,0],"radius":1,"color":"#3a7bd5"}
```

| Field | Default | Description |
|-------|---------|-------------|
| `center` | `[0,0,0]` | Static center position |
| `centerExpr` | none | Dynamic center as 3 math.js expressions — use for moving spheres |
| `radius` | required | Sphere radius in data space |
| `color` | required | Hex or `[r,g,b]` |
| `opacity` | `1` | 0–1 |
| `shader` | none | Optional `{"type":"phong","emissive":"#hex","shininess":N}` for lighting |

Spheres can be follow-cam targets (via `center` or `centerExpr`).

**Important**: Use equal axis spans in the scene `range` so spheres render undistorted.
