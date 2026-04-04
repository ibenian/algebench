# vectors

Batch of arrows — efficient for vector fields, function graphs, etc.

```json
{
  "type": "vectors",
  "tos": [[1,0.84,0],[2,0.91,0],[3,0.14,0]],
  "froms": [[1,0,0],[2,0,0],[3,0,0]],
  "color": "#ff8800",
  "width": 3
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `tos` | required | Array of tip positions `[x,y,z]` |
| `froms` | all `[0,0,0]` | Array of tail positions (same length as `tos`) |
| `color` | required | Hex or `[r,g,b]` |
| `width` | `3` | Shaft width (pixels) |
