# Stack object

`stack` displays a one-dimensional sequence bottom to top. It owns an open
container, a base extending along Z, its title, empty-state text, and a top
index marker. It reuses array cell sizes, typed values, and illumination.

```json
{
  "id": "stack",
  "type": "stack",
  "origin": [7, -2, 0],
  "itemType": "number",
  "cellSize": 1.35,
  "fontSize": 16,
  "lengthExpr": "arrayCount(dataTable('trace', frame, 'stack'))",
  "valueExpr": "arrayAt(dataTable('trace', frame, 'stack'), idx)",
  "label": "stack",
  "containerColor": "#77bfae",
  "emptyText": "empty",
  "showTop": true
}
```

Use `values` for static stacks, including an empty array. Dynamic stacks support
0–256 items. The last item is the top; index 0 is the bottom. Supply a new
sequence to visualize push/pop. Existing immutable `arrayValues` operations
can produce those sequences. The renderer does not mutate lesson data.

Cells have the same dimensions as arrays, with a 0.1-unit vertical gap.
Container geometry changes only when the length changes. Cell expressions and
change comparisons use the normal state-binding updates, not frame polling.
`showIndices` defaults to false; `showTop` defaults to true. Array-style owned
`markers`, `color`, `highlightExpr`, and font options also apply.
The marker reads `top slot = k` to distinguish the stack slot from variables
that store an input position or the value read by a peek.

Connections use the stack object's ID and `indexExpr`, exactly as for arrays.
Out-of-range targets disappear. Removing/hiding the stack controls all its
owned geometry and labels through the existing element lifecycle.
