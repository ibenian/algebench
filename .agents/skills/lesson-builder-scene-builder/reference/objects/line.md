# line

Straight segment or polyline through many points.

```json
{"type":"line","points":[[0,0,0],[2,1,0],[3,3,0]],"color":"#aa66ff","width":2}
```

| Field | Default | Description |
|-------|---------|-------------|
| `points` | required | Array of `[x,y,z]` data-space positions |
| `color` | `"#aa66ff"` | Hex or `[r,g,b]` |
| `width` | `2` | Line width (pixels) |
| `opacity` | `1` | 0–1 |

Pass many points to draw smooth curves.
