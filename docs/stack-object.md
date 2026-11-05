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
  "showTop": false
}
```

Use `values` for static stacks, including an empty array. Dynamic stacks support
0–256 items. The last item is the top; index 0 is the bottom. Supply a new
sequence to visualize push/pop. Existing immutable `arrayValues` operations
can produce those sequences. The renderer does not mutate lesson data.

Cells have the same dimensions as arrays, with a 0.1-unit vertical gap.
Container geometry changes only when the length changes. Cell expressions and
change comparisons use the normal state-binding updates, not frame polling.
`showIndices` and `showTop` default to false. Array-style owned `markers`,
`color`, `highlightExpr`, and font options also apply.
With `showTop`, a marker reads `top slot = k`: the top's index, which seldom means
anything in the algorithm, so it is off unless a lesson asks for it.

A push or pop eases the container to its new length. A pop also shows a speech
bubble above the cell it left from, saying what left, until the run moves on;
stepping back through a push shows none, since nothing was popped.

Connections use the stack object's ID and `indexExpr`, exactly as for arrays.
Out-of-range targets disappear. Removing/hiding the stack controls all its
owned geometry and labels through the existing element lifecycle.
