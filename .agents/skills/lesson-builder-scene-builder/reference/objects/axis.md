# axis

```json
{"type":"axis","axis":"x","range":[-3,3],"color":"#ff4444","width":1.5,"label":"x"}
```

| Field | Default | Description |
|-------|---------|-------------|
| `axis` | `"x"` | `"x"`, `"y"`, or `"z"` |
| `range` | `[-5,5]` | Extent of the axis line in data space |
| `color` | per-axis | Hex string or `[r,g,b]` (0–1) |
| `width` | `2` | Line width (pixels) |
| `label` | axis letter | Label at positive end. Supports LaTeX |

Always include axes in base `elements` unless the outline says otherwise. Standard colors: x=`#ff4444`, y=`#44cc44`, z=`#4488ff`.
