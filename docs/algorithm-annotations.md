# Algorithm annotations

The draft `scenes/draft/test-code-panel.json` includes a bracket-stack lesson and an **Index and label playground**. Code is display-only; lesson state drives expression bindings.

`step_marker` anchors a badge and arrow at `position` or `positionExpr`. It accepts `text`/`textExpr`, `visibleExpr`, and `color`. For named array indices, supply all three fields:

```json
{
  "id": "read-index",
  "type": "step_marker",
  "indexName": "i",
  "indexExpr": "i",
  "indexGroup": "input-data",
  "positionExpr": ["-3 + 2 * i", "1", "0"]
}
```

`indexGroup` identifies the **data sequence**, not another visual object. Two markers in the same group at the same integer index combine into `i = j = 2`. Different values or different data groups never become an equality; spatially overlapping badges retain separate rows. Indices must be nonnegative integers. Use `visibleExpr` to hide a cursor beyond the sequence's end.

`expression_label` displays any expression result as plain text, retaining decimal numbers, strings, booleans, null, and JSON-compatible arrays/objects. Expression output is never interpreted as HTML. For example:

```json
{
  "id": "stack-size",
  "type": "expression_label",
  "position": [2, -1.8, 0],
  "textExpr": "concat('size = ', dataTable('trace', snapshot, 'n'))"
}
```

Overlapping expression labels share one box with a row for each label. Markers and expression labels form separate presentation groups. Ordinary math labels retain the existing decluttering behavior.

Expressions compile once when the object is created and reevaluate through the existing state binding updates. They do not run on every animation frame. Camera projection remains in the common label layer; intrinsic text sizes are cached until content or label scale changes. Grouping is recomputed only when projected geometry, visibility, or content changes. These are state-driven annotations, not continuously time-animated text.

The stack in this draft still uses the tensor renderer. This change positions it separately from the input array and puts its variable labels beside it. A dedicated stack renderer and large-scene performance qualification remain future work.

## Array-owned markers

An array may include a `markers` list. Each entry uses the same `step_marker` component, but the array supplies its layout, grouping identity, and update/cleanup lifecycle:

```json
{
  "id": "input",
  "type": "array",
  "itemType": "character",
  "values": ["A", "B", "C", "D"],
  "origin": [-3, 1, 0],
  "cellSize": 2,
  "markers": [
    {"type": "step_marker", "indexName": "i", "indexExpr": "i"},
    {"type": "step_marker", "indexName": "j", "indexExpr": "j"}
  ]
}
```

Owned markers accept `color` and `visibleExpr`. They do not accept manual positions or grouping identities. The array derives anchors from its origin and cell size and hides negative, fractional, or out-of-range indices. Separate arrays receive separate grouping identities, even when the displayed index values match. Independent scene-level markers remain supported as described above. Array origin and cell size are currently static scene properties; changing the scene definition and rebuilding the array also repositions its markers.
