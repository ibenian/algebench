# tensor

A lattice of cells whose colour carries a value — **the heatmap / matrix-grid element**.
Reach for it any time you want to show a matrix as coloured cells: an attention matrix, a
positional-encoding matrix, a transition or confusion matrix, a mask.

One `tensor` replaces what would otherwise be `rows × cols` near-identical `animated_polygon`
elements. Use it instead of hand-writing cells — always.

```json
{
  "id": "attn",
  "type": "tensor",
  "shape": [6, 6],
  "origin": [0, 0, 0],
  "cellSize": 1,
  "valueExpr": "dataTable('attn', row, concat('w', col))",
  "colorMap": "viridis",
  "colorDomain": [0, 1],
  "label": "attention weights"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `shape` | required | Logical shape, any rank. The grid layout draws the **last** dimension horizontally and the one before it vertically: `[6]` is a row of 6 cells, `[6,6]` a 6×6 matrix. Higher ranks are accepted and only their trailing 2D slice is drawn for now |
| `values` | — | Literal values, nested `[[1,2],[3,4]]` **or** flat `[1,2,3,4]`. Both normalize to flat + `shape`, so the spellings are interchangeable. **Static path — costs nothing per frame** |
| `axes` | — | Per-axis metadata; `axes[k]` describes `shape[k]`. See below |
| `valueExpr` | — | One math.js expression, evaluated per cell with `row`, `col` and `idx` bound. Live path, and how a tensor acts as a **view over data held elsewhere** |
| `origin` | `[0,0,0]` | Near corner of the lattice: `[horizontal, vertical, normal]` in the chosen `plane` |
| `cellSize` | `1` | Data-space pitch between cell centres |
| `gap` | `0.08` | Gap as a *fraction* of `cellSize`, so spacing survives a `cellSize` change |
| `plane` | `"xy"` | `"xy"`, `"xz"` or `"yz"` |
| `colorMap` | `"viridis"` | `"viridis"`, `"magma"`, `"blueRed"`, or `{"stops":[{"t":0,"color":"#…"}, …]}` |
| `colorDomain` | `[0,1]` | Range values are normalized over. Outside values clamp |
| `color` | `"#3b528b"` | Fallback colour for cells with no usable value; also the legend swatch |
| `opacity` | `0.95` | 0–1 |
| `widthExpr` | `1 − gap` | Per-cell **width** as a fraction of `cellSize` (0–1), with `row`, `col`, `idx` and `value` bound. See *Channels* |
| `heightExpr` | `1 − gap` | Per-cell **height**, same scope. Independent of width |
| `axisLabels` | `plane` | `plane`: labels and titles drawn on the lattice plane, like cell text. `screen`: HTML labels facing the camera. See *Axis labels* |
| `anchor` | `center` | Which edge a shrunken cell keeps: `bottom`, `top`, `left`, `right`, or a pair like `bottom-left`. See *Channels* |
| `depthExpr` | `0` | Per-cell **depth** off the lattice plane as a fraction of `cellSize` (−3..3), same scope. Positive rises, negative sinks; either way a solid box with shaded walls |
| `textExpr` | — | Text drawn **inside** each cell, same scope. Plain text, fitted to the cell, on the lattice plane |
| `textColor` | auto | Colour for cell text. Omit for automatic contrast per cell |
| `label` | — | **One** legend entry for the whole tensor |
| `prompt` | — | **One** Ask-AI button for the whole tensor |

## Static or live — pick by which input you give

There is no `animated_tensor`. The renderer decides:

- **`values`** → built once, no per-frame updater, **zero** ongoing cost. Use this for any matrix
  that does not change (a fixed weight matrix, a causal mask).
- **`valueExpr`** → one updater, `rows × cols` evaluations per frame. Use this only when the matrix
  should respond to a slider or to `t`.

`values` is ignored when `valueExpr` is present.

### Shape and values are independent

Values are normalized to a flat row-major array plus `shape`, so the same data can be viewed at
different ranks — `[1,2,3,4,5,6]` is a valid `values` for `shape: [6]`, `[2,3]`, `[3,2]` or
`[1,2,3]`. Nested spelling is a convenience for authoring a matrix by hand; it is flattened on the
way in.

**The entry count must match `shape` exactly.** A mismatch is an error that names where it
disagrees — `nested values[1] has 2 entries but shape [2, 3] needs 3 at dimension 1` — rather than
being padded with zeros, which would turn a typo into a plausible-looking half-empty grid.
`validate_content.py` catches this before the scene ever runs.

```json
{ "type": "tensor", "shape": [6, 6],
  "values": [[1,0,0,0,0,0],[1,1,0,0,0,0],[1,1,1,0,0,0],
             [1,1,1,1,0,0],[1,1,1,1,1,0],[1,1,1,1,1,1]],
  "colorMap": "magma" }
```

## Baked values — the idiom a real lesson uses

When the numbers come from a model rather than a formula, put them in a `data` table and read them
per cell. Nothing is invented at render time and every value stays reproducible offline.

```json
{ "data": { "attn": [ {"w0": 0.25, "w1": 0.04, "w2": 0.61, "w3": 0.10, "w4": 0, "w5": 0 } ] },
  "steps": [ { "add": [ {
    "type": "tensor", "shape": [6, 6],
    "valueExpr": "dataTable('attn', row, concat('w', col))",
    "colorMap": "viridis", "colorDomain": [0, 0.6]
  } ] } ] }
```

`dataTable(name, rowIndex, columnName)` takes a **column name**, not an index — hence
`concat('w', col)` to build `w0`, `w1`, … from the cell index. A table is a list of row objects.

`data` works at the lesson root or on a scene; both are merged, with scene-level winning.

## Channels — what a value drives

A cell's value drives its **colour** by default, through `colorMap` over `colorDomain`. Three more
expressions can read the same per-cell scope and drive other things. All of them see `row`, `col`,
`idx` and `value` — the cell's own number, whether it came from `valueExpr` or `values` — so "size
follows the value" needs no second data source.

| Expression | Drives | Result |
|---|---|---|
| `valueExpr` / `values` | colour | number, normalized over `colorDomain` |
| `widthExpr` | cell width | fraction of `cellSize`, 0–1; the cell stays centred on its slot |
| `heightExpr` | cell height | fraction of `cellSize`, 0–1; independent of width |
| `depthExpr` | cell depth (a bump or a well) | fraction of `cellSize`, −3..3, along the plane normal |
| `textExpr` | text inside the cell | a string; `''` draws nothing |

```json
{ "type": "tensor", "shape": [6, 6],
  "valueExpr": "dataTable('attn', row, concat('w', col))",
  "widthExpr": "sqrt(value)", "heightExpr": "sqrt(value)",
  "textExpr": "value >= 0.005 ? toFixed(value, 2) : ''",
  "colorMap": "viridis", "colorDomain": [0, 1] }
```

That makes each cell's **area** the attention weight and prints the number inside it.

**To see a distribution of values**, drive height alone and pin the bottom edge:

```json
{ "type": "tensor", "shape": [6],
  "valueExpr": "tfAttn(2, col)",
  "heightExpr": "value", "anchor": "bottom",
  "textExpr": "toFixed(value, 2)",
  "colorMap": "viridis", "colorDomain": [0, 1] }
```

Every bar stands on the same baseline, so heights compare by eye; without `anchor` the same
cells shrink about their centres and read as lozenges, not bars. `heightExpr` is a fraction of
`cellSize`, so for values outside `[0, 1]` normalize inside the expression — `value / 40`, or
`(value - lo) / (hi - lo)` — and say the scale in the axis title.

**Depth** is the third dimension. `"depthExpr": "value * 2"` raises each cell off the plane by twice
its value in cell pitches, drawn as a solid box — lid in the cell's colour, four walls a fixed step
darker so the height reads without lighting. A matrix becomes a relief map, and any text in the cell
rides on the lid. A **negative** depth sinks the cell below the plane instead, so signed data reads as
relief in both directions: `"(value - 1/6) * 4"` on a softmax row shows each weight above or below
uniform, and a diverging `colorMap` on pre-softmax scores pairs naturally with `"value / 10"`. It is
worth an angled camera: from straight on, a bump is just a tile.

Rules for the size channels:

- The result is clamped to `[0, 1]`; the default is `1 − gap`. A result that is not a number keeps
  the default for that cell, so a misfiring expression never collapses a cell or overruns its
  neighbours.
- A size expression makes the tensor **live** even with literal `values` — it may read a slider —
  so it registers the per-frame updater. Only the vertex buffer moves; nothing is re-compiled.

Rules for cell text:

- It is drawn **on the lattice plane** as geometry (one canvas texture on one quad, a hair in
  front of the cells), so it tilts, scales and occludes with the cells. It is not an HTML label and
  never piles up with the decal labels; do not use it for anything that must stay readable when the
  camera looks along the plane.
- Each string is fitted to its own cell's **current** width and height, so it always fits — a cell
  shrunk by `widthExpr` gets smaller text. Keep strings short: a 6-character number is the
  comfortable maximum at `cellSize: 1`.
- Plain text only, no KaTeX. Use `toFixed(value, 2)`, `concat(...)`, or a domain function that
  returns a string.
- Text colour is automatic per cell — dark on light cells, light on dark — unless `textColor` is
  set (a hex string or an `[r,g,b]` array; `"auto"` is the default spelled out).
- Cost: `textExpr` is evaluated once per cell per frame, like `valueExpr`, plus a string compare.
  The expensive part — redrawing the canvas and re-uploading the texture — happens only when some
  string, size or colour actually changed, so a matrix whose text is not moving pays the evaluations
  and nothing else. A text channel is never free the way literal `values` are.

## Axis labels and titles

Use `axes` rather than hand-placing `text` elements. `axes[k]` describes `shape[k]`, and the
renderer positions everything against the lattice: for a 2D tensor `axes[0]` labels the rows down
the left and `axes[1]` labels the columns across the top; for a 1D tensor `axes[0]` labels the
single row.

```json
{ "type": "tensor", "shape": [6, 6],
  "valueExpr": "dataTable('attn', row, concat('w', col))",
  "axes": [
    { "labels": ["the","cat","sat","on","the","mat"], "title": "query" },
    { "labels": ["the","cat","sat","on","the","mat"], "title": "key" }
  ] }
```

Each entry takes `labels` (one per position along that axis), `title` (the axis's own name, placed
beyond the labels), and `color`. All are optional — an axis with no entry is simply unlabelled.
A label count that disagrees with the axis length is a warning, not an error: the extras are
ignored and the remainder is left blank.

The labels hide and restore with the element and do **not** create legend entries.

### On the plane, or on the screen

By default (`"axisLabels": "plane"`) the labels are drawn on the lattice plane, in a band above the
cells (column labels, then the column title) and a band to the left (row labels, then the row title
turned a quarter turn), the same way `textExpr` cell text is drawn. They tilt, scale and occlude
with the lattice, and never pile up with the screen labels of other elements.

Two costs. Plain text only: LaTeX is reduced to its plain reading (`key $j$` → `key j`,
`$\alpha_{3j}$` → `α3j`), so keep labels simple. And a label driven by `labelExpr` is re-evaluated
per frame like cell text, with the canvas redrawn only when some label changed.

Set `"axisLabels": "screen"` for HTML labels that always face the camera, like every other label —
for a lattice that is only ever read face-on and whose labels need real KaTeX.

## Cell indexing

`row`, `col` and `idx` are **0-based**, and **row 0 renders at the top**, so the picture reads like
a written matrix. `idx` is the flat row-major index; on a 1D tensor `row` is 0 and `col` is the
position. They are bound per cell and exist only inside that tensor's `valueExpr` — a stray `row`
anywhere else is still reported as an undefined reference.

They are bound in a way that beats a same-named scene slider, so a scene with a slider called
`row` will not silently shadow the cell index.

## Rules that bite

- **Pick the ramp for the data.** `viridis` / `magma` are sequential — right for a non-negative
  quantity (a weight, a probability, a mask). `blueRed` is diverging and *implies a sign*, so use
  it only for genuinely signed data, such as pre-softmax scores.
- **Set `colorDomain` to the real range.** The default `[0,1]` will flatten a matrix whose values
  only span `[0, 0.3]` into the cold third of the ramp.
- **Rows, not columns.** A softmaxed attention matrix is row-stochastic; comparing intensities
  down a column is meaningless. Say so in the step text.
- **`shader: {"ignorePlaneOpacity": true}`** keeps cells at their own opacity when the viewer drags
  the global *Planes* opacity control down.
- An expression tripping the JS-only guard (`if(...)`, `w.toFixed(2)`) compiles **silently to 0** in
  an untrusted scene — a uniformly cold lattice with a clean console. Use the ternary
  `w > 0.5 ? 1 : 0` and the free function `toFixed(w, 2)`.
- A cell whose value is not a usable number keeps its previous colour rather than flashing cold.

## Cost

The whole tensor is one merged geometry, one material, one draw call; a frame update is a
typed-array write plus one buffer upload. Cell positions are arithmetic on `shape`, so **no
expression is evaluated for geometry** — the only per-frame work is `valueExpr`, once per cell.

An 8×8 written as 64 `animated_polygon`s costs ~830 evaluations/frame and ~450 compiled
expressions. The same lattice as a `tensor` costs 64 evaluations and **one** compiled expression.

## Layout

There is one layout today: the grid described above. The element deliberately separates *logical
data* (flat values + `shape`) from *where cells land in space*, so alternative layouts — a `[6,6]`
drawn as six row vectors, as six column vectors, or a rank-3 tensor drawn as stacked slices — can
be added later without changing how data is authored. Until then, position independent lattices as
separate `tensor` elements with their own `origin`.
