# plane

Infinite (clipped) plane in 3D space.

```json
{"type":"plane","normal":[0,0,1],"point":[0,0,0],"color":"#4466aa","opacity":0.25,"size":6}
```

| Field | Default | Description |
|-------|---------|-------------|
| `normal` | required | Normal vector `[x,y,z]` |
| `point` | required | A point on the plane |
| `color` | required | Hex or `[r,g,b]` |
| `size` | `5` | Half-extent of the visible square |
| `opacity` | `0.25` | 0–1 |
