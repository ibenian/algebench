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

Every expression label supports direct dragging. Each row in a merged box moves its own label, so it can be dragged back out independently. Dragging changes presentation without modifying expression values. World labels keep their 3D placement; overlays stay at their screen position while the camera moves. Placements reset when the scene is rebuilt. The shared box follows the average of its members' screen anchors. Position slider changes restore the corresponding data anchor.

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

Dragging an expression label onto another label or a shared box snaps it to the box anchor. Drop above or below a row to choose its vertical position; dragging a shared row vertically reorders it. Snapping and ordering belong to the common presentation layer and do not alter expressions.

Each expression-label box has a Labels title bar. Dragging it moves all current members together, preserving their row order; dragging an individual row still detaches or reorders just that label.

The title bar also has a `3D`/`Overlay` toggle. `3D` follows the expression's world-space position during camera rotation. `Overlay` keeps the box fixed in screen coordinates and renders it with reduced opacity; switching back restores world tracking.

Screen overlays paint above all world labels and 3D geometry regardless of depth. World and screen annotations group separately. When every row contains an assignment form such as `i = 2`, the container title is `Vars`; mixed or arbitrary text uses `Labels`.

Dragging a row or title bar preserves its coordinate mode. World dragging moves its 3D placement along the camera-facing plane at its current depth; overlay dragging changes its screen position. Only the coordinate-mode toggle changes modes, and snapping targets containers in the same mode.

Container titles and controls rebuild only when row content, membership, order, or coordinate mode changes. Overlay styling is cached by mode, and label presentation writes are skipped when their values are unchanged. Camera projection still updates with the render loop.

Changing a label's position expression (for example with its X/Y sliders) returns that label to its data anchor. Text updates alone preserve its dragged screen placement.

## Scene code reference

A scene names the code it executes with `codeRef`. Files live in the lesson's top-level `codeFiles`; the scene points to one by id, so every active line belongs to an explicitly named file:

```json
"codeRef": {"file": "balanced", "lineExpr": "dataTable('trace', snapshot, 'pc')"}
```

When a trace moves between files, replace `file` with `fileExpr`, which returns the executing file's id at each state. A trace frame then carries both, like a debugger's file and line:

```json
"codeRef": {"fileExpr": "dataTable('trace', snapshot, 'file')", "lineExpr": "dataTable('trace', snapshot, 'line')"}
```

Exactly one of `file` and `fileExpr` is required. `lineExpr` is the one-based line in the active file; zero clears the marker. Expressions evaluate on navigation and slider changes, not every frame. There is no default file: an unknown id, or an expression that cannot evaluate yet, marks nothing.

The Code panel opens the active file when a scene is entered and whenever the active file changes. A reader may open another file in between; it stays open, unmarked, until execution moves to a different file. The line marker appears only in the active file.

A code file's `locations` serve only the reverse lookup: selecting a line offers the scenes, steps and snapshots where it executes. They never decide which file a scene shows.
