# grid

```json
{"type":"grid","plane":"xy","range":[-5,5],"color":[0.3,0.3,0.5],"opacity":0.15,"divisions":10}
```

| Field | Default | Description |
|-------|---------|-------------|
| `plane` | `"xy"` | `"xy"`, `"xz"`, or `"yz"` |
| `range` | `[-5,5]` | Single scalar applied to both axes of the plane |
| `opacity` | `0.15` | 0–1 |
| `divisions` | `10` | Number of grid lines per axis |

Always include a grid in base `elements` unless the outline says otherwise.
