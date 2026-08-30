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
| `shape` | required | `[rows, cols]`. Leading dimensions are allowed and currently ignored, so `[2,6,6]` reads as a 6×6 lattice |
| `values` | — | Literal cell values: nested rows `[[…],[…]]` or a flat row-major list. **Static path — costs nothing per frame** |
| `valueExpr` | — | One math.js expression, evaluated per cell with `row` and `col` bound. Live path |
| `origin` | `[0,0,0]` | Near corner of the lattice: `[horizontal, vertical, normal]` in the chosen `plane` |
| `cellSize` | `1` | Data-space pitch between cell centres |
| `gap` | `0.08` | Gap as a *fraction* of `cellSize`, so spacing survives a `cellSize` change |
| `plane` | `"xy"` | `"xy"`, `"xz"` or `"yz"` |
| `colorMap` | `"viridis"` | `"viridis"`, `"magma"`, `"blueRed"`, or `{"stops":[{"t":0,"color":"#…"}, …]}` |
| `colorDomain` | `[0,1]` | Range values are normalized over. Outside values clamp |
| `color` | `"#3b528b"` | Fallback colour for cells with no usable value; also the legend swatch |
| `opacity` | `0.95` | 0–1 |
| `label` | — | **One** legend entry for the whole tensor |
| `prompt` | — | **One** Ask-AI button for the whole tensor |

## Static or live — pick by which input you give

There is no `animated_tensor`. The renderer decides:

- **`values`** → built once, no per-frame updater, **zero** ongoing cost. Use this for any matrix
  that does not change (a fixed weight matrix, a causal mask).
- **`valueExpr`** → one updater, `rows × cols` evaluations per frame. Use this only when the matrix
  should respond to a slider or to `t`.

`values` is ignored when `valueExpr` is present.

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

## Cell indexing

`row` and `col` are **0-based**, and **row 0 renders at the top**, so the picture reads like a
written matrix. They are bound per cell and exist only inside that tensor's `valueExpr` — a stray
`row` anywhere else is still reported as an undefined reference.

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
