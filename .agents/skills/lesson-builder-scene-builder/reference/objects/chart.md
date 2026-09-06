# chart

A 2-D plot that lives in the 3-D scene as a planar object — **the line-chart / distribution element**.
Reach for it when a step needs a sampled quantity, a running statistic, a spread, or anything you
would otherwise build from a dozen hand-placed `parametric_curve`, `line` and `text` elements.

The data is geometry: every series is a real line in the viewport, crisp at any angle and zoom,
occluded like everything else. The paper — axes, ticks, tick labels, titles, grid — is drawn on the
lattice plane the same way `tensor` draws its labels, so it tilts with the plot and never piles up
with screen labels. Nothing is rasterised that you would notice.

```json
{
  "id": "spread",
  "type": "chart",
  "origin": [6, 4, 0],
  "size": [7, 3],
  "series": [
    { "yExpr": "tfDotSample(i, s3_gen_d)", "n": 64, "color": "#f06292", "label": "q·k, i.i.d. draws" }
  ],
  "hlines": [
    { "yExpr": "sqrt(tfSampleVar(s3_gen_d, 4000))", "color": "#f06292", "opacity": 0.6 },
    { "yExpr": "-sqrt(tfSampleVar(s3_gen_d, 4000))", "color": "#f06292", "opacity": 0.6 }
  ],
  "axes": [ { "title": "draw" }, { "title": "$q \\cdot k$" } ]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `origin` | `[0,0,0]` | Lower-left corner of the **plot area**, `[horizontal, vertical, normal]` in the chosen `plane` |
| `size` | `[6, 3]` | Plot area width and height in data units. The paper extends ~1.1–1.6 left and ~0.7–1.1 below for labels |
| `plane` | `"xy"` | `"xy"`, `"xz"` or `"yz"` |
| `series` | — | The data; see *Series* |
| `hlines` | — | Horizontal reference lines, each a literal `y` or a `yExpr` |
| `bands` | — | Filled bands between `lo`/`hi` (or `loExpr`/`hiExpr`), drawn behind the series |
| `xDomain`, `yDomain` | `"auto"` | `[lo, hi]`, or auto-fit to the data and widened to round ticks |
| `axes` | — | `axes[0]` is x, `axes[1]` is y: `title`, `ticks` (target count, default 5), `labelExpr` (formats one tick with `value` bound), `color` |
| `grid` | `true` | Faint grid lines at the ticks |
| `textColor` | — | Ink for grid and zero lines; axes use their own `color` |
| `opacity` | `0.9` | The paper's opacity; honours the global *Planes* control unless `shader.ignorePlaneOpacity` |
| `label` | — | One legend entry. Defaults to the only series' `label` |

## Series

Each series is a line (or `"kind": "points"`) whose samples come from **either** literal arrays
**or** expressions:

- `y: [...]` (and optionally `x: [...]`) — static; built once, no per-frame cost.
- `yExpr` — evaluated once per sample with `i` (0-based index), `n` (sample count) and `x` (that
  sample's x) bound; `x` is `i` unless `xExpr` (same scope, minus `x`) or `x` is given. `n` sets the
  sample count (default 64).

Scope names are bound the way `tensor` binds `row`/`col`: they win over a same-named slider, and
`validate_content.py` knows them, so a stray `i` elsewhere is still reported.

A slider or a domain function in any expression makes the chart live: it re-samples every frame and
pushes the points into the existing lines. The paper is redrawn only when a tick label or domain
actually changes.

## Domains

`"auto"` fits the extent of everything drawn — series, lines, bands — pads it a little, then widens
to the nearest tick multiples so the axis ends on round numbers. That is the right default for a
sampled quantity whose scale is the point (the ±1 s.d. band growing like √n). **Fix the domain** when
a slider should be seen to move the data, not the axis: with `"auto"` a curve that doubles looks the
same after the axis rescales.

## Rules that bite

- Same expression gate as `tensor`: a `yExpr` the untrusted sandbox would compile to `0` is left out
  with a warning rather than drawn as a flat line at zero. Use the ternary, `toFixed(v, 2)`, and
  `sum(...)` spelled out — no `->` lambdas.
- Titles and tick labels are plain text drawn on the plane; LaTeX is reduced to its reading
  (`$q \cdot k$` → `q · k`).
- The chart draws the plot **area** at `origin`; leave room to the left and below for the paper, or
  it will overlap a neighbour.
- It is one element, one legend entry. Several series that each need a legend row are several
  charts, or one chart with `label` naming the group.

## Why not a charting library on a texture

Considered and rejected. A rasterised series blurs the moment the plane tilts or the camera zooms; a
library brings its own colours, fonts and legends that fight the lesson's colour language; and none
of its interaction survives in 3-D. Everything here is drawn from the scene's own primitives, and the
only raster is the paper, which is thin lines and short text.
