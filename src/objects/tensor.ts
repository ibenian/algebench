/**
 * `tensor` — N-dimensional logical data, and a spatial view of it.
 *
 * The separation is deliberate and is the point of the module: a tensor's
 * *data* is a flat row-major array plus a `shape`, and where its cells land in
 * 3D is a *layout* decision made separately. Today there is one layout (a grid:
 * 1D renders as a row of cells, 2D as a matrix). Row vectors, column vectors
 * and stacked slices are all additions to `gridLayout`'s neighbourhood rather
 * than rewrites, because nothing outside `cellCentre`/`axisAnchor` knows where
 * a cell goes.
 *
 * Nested `values` are a convenience spelling, normalized to flat + shape on the
 * way in, so the logical representation never depends on how the author chose
 * to write it down.
 *
 * The authoring win is that one element replaces N*M near-identical
 * `animated_polygon`s. The rendering win is bigger and less obvious: because
 * the lattice is *derived* from `shape` rather than written out, cell geometry
 * is arithmetic instead of expressions. A hand-written 8x8 spends ~768
 * expression evaluations per frame on vertex positions that never move; this
 * spends none, and evaluates one compiled `valueExpr` per cell instead.
 *
 * The whole tensor is a single merged, non-indexed BufferGeometry with a
 * vertex-colour attribute — one mesh, one material, one draw call. A frame
 * update is a typed-array write plus one buffer upload, not N*M material
 * mutations.
 *
 * Static and animated in one type, decided by which input is given: literal
 * `values` build once and register no updater (zero per-frame cost, exactly the
 * static contract); a `valueExpr` registers one. The batch element types this
 * follows — `vectors`, `vector_field`, `point` with `positions[]` — have no
 * `animated_` twins either, and here the geometry never animates at all.
 *
 * "Tensor" is used in the machine-learning sense: an n-dimensional array, whose
 * *components* this renders. It carries no transformation law, so it is not a
 * tensor in the differential-geometry sense that `special-relativity.json`
 * means by the word.
 */

import { state } from '/state.js';
import { parseColor, addLabel3D, renderKaTeX } from '/labels.js';
import type { Label3D } from '/labels.js';
import { buildColorMap, normalizeColorValue } from '/colormaps.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Element, Shader } from '/types/lesson.js';
import type { CanvasTexture, Mesh, Object3D, Scene } from 'three';

/** parseColor returns `number[]`; three's Color constructor needs a tuple. */
type Rgb3 = [number, number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Per-cell channels — pure helpers, exported so they can be pinned by tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `widthExpr` / `heightExpr` result as a fraction of the cell pitch.
 * Anything that is not a finite number keeps the fallback (the `gap`-derived
 * fill), so a cell whose extent expression misfires stays the size it was
 * rather than collapsing to a sliver or exploding over its neighbours.
 */
export function resolveExtent(raw: unknown, fallback: number): number {
    // Number(null) is 0 and Number('') is 0: an absent result is not "zero
    // width", it is "no opinion", so those keep the fallback explicitly.
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

/**
 * Font size, in canvas pixels, that fits a string into a `wPx` x `hPx` box.
 * `widthAt100` is the string's measured width at a 100px font, so the fit is
 * a pure ratio and needs no canvas of its own. The 0.86 / 0.62 margins keep
 * glyph ascenders and a little side padding inside the cell edge.
 */
export function fitFontPx(widthAt100: number, wPx: number, hPx: number): number {
    const byHeight = hPx * 0.62;
    const byWidth = widthAt100 > 0 ? (wPx * 0.86) * 100 / widthAt100 : byHeight;
    return Math.max(1, Math.floor(Math.min(byHeight, byWidth)));
}

/**
 * Which edge of its slot a shrunken cell keeps. `-1` keeps the low edge
 * (left / bottom), `0` centres, `+1` keeps the high edge (right / top). A
 * height-only lattice anchored at the bottom is a bar chart on its lattice;
 * centred, it is a strip of lozenges — same numbers, a different reading.
 */
export function parseAnchor(raw: unknown): { h: -1 | 0 | 1; v: -1 | 0 | 1 } {
    const out = { h: 0 as -1 | 0 | 1, v: 0 as -1 | 0 | 1 };
    if (typeof raw !== 'string') return out;
    for (const word of raw.toLowerCase().split(/[\s,-]+/)) {
        if (word === 'left') out.h = -1;
        else if (word === 'right') out.h = 1;
        else if (word === 'bottom') out.v = -1;
        else if (word === 'top') out.v = 1;
    }
    return out;
}

/**
 * An authored `textColor` as a canvas fill style, or null for "decide per
 * cell". Accepts everything `$defs/color` does -- a hex string or an [r,g,b]
 * tuple in 0..1 -- plus the explicit `"auto"`, which means the same as
 * leaving it out. Goes through parseColor so the two spellings cannot drift.
 */
export function resolveTextColor(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
        raw = raw.trim();
        if (!raw || (raw as string).toLowerCase() === 'auto') return null;
    } else if (!Array.isArray(raw)) {
        return null;
    }
    const rgb = parseColor(raw);
    const ch = (v: number) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255);
    // parseColor reads only the first six hex digits; the colour type also
    // permits '#rrggbbaa', and a canvas fill can honour that alpha where the
    // vertex-colour path cannot. Read it here so the promise is kept for text.
    let alpha = 1;
    if (typeof raw === 'string') {
        const m = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(raw);
        if (m) alpha = parseInt(m[1]!, 16) / 255;
    }
    return alpha < 1
        ? `rgba(${ch(rgb[0]!)}, ${ch(rgb[1]!)}, ${ch(rgb[2]!)}, ${Math.round(alpha * 1000) / 1000})`
        : `rgb(${ch(rgb[0]!)}, ${ch(rgb[1]!)}, ${ch(rgb[2]!)})`;
}

/** Near-black or near-white, whichever reads against the cell's colour. */
export function contrastTextColor(rgb: readonly number[]): string {
    const lum = 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    return lum > 0.45 ? '#101418' : '#f4f6f8';
}

/**
 * One axis label driven by `labelExpr`, memoising the last string it rendered
 * so an unchanged label costs no DOM write and no KaTeX pass. `scope` binds
 * that entry's index — `row` down the rows, `col` across the columns, and
 * `idx` either way — exactly as `valueExpr` binds them per cell.
 */
interface DynamicAxisLabel {
    label: Label3D & { _lastDynamicText?: string };
    src: string;
    fn: CompiledExpr;
    scope: Record<string, number>;
}

/** A per-frame updater, as the scene loader's animation loop expects it. */
interface AnimUpdater {
    animState: { stopped: boolean };
    updateFrame(nowMs: number): void;
}

/**
 * The tensor's entry in the shared recompile list. `_rebuildFn` is the hook
 * `recompileActiveExprs` calls in place of its generic path, which is what lets
 * this register one compiled expression rather than the array of vertex
 * expressions that path expects.
 */
interface TensorAnimExprEntry {
    exprStrings: string[];
    animState: { stopped: boolean };
    compiledFns: CompiledExpr[];
    _rebuildFn?: () => void;
}

/** The slice of the shared state object this module touches. */
interface TensorState {
    displayParams: { planeOpacity: number };
    _planeMeshSerial: number;
    three: { scene: Scene };
    planeMeshes: Object3D[];
    activeAnimExprs: TensorAnimExprEntry[];
    activeAnimUpdaters: AnimUpdater[];
    sceneStartTime: number;
    /** Read only to decide whether a recompile could change anything — see
     *  `_rebuildFn`. Same field overlay.ts and json-browser.ts consult. */
    _sceneJsTrustState: string | null;
}
const tensorState = state as unknown as TensorState;

/** Per-axis metadata, as an author supplies it. `axes[k]` describes `shape[k]`. */
interface AxisSpec {
    labels?: unknown;
    labelExpr?: unknown;
    title?: unknown;
    color?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logical layer — shape and values, independent of how they are drawn
// ─────────────────────────────────────────────────────────────────────────────

/** Element count implied by a shape. */
export function shapeSize(dims: number[]): number {
    return dims.reduce((a, b) => a * b, 1);
}

/**
 * Read `shape` into a list of positive integer dimensions.
 *
 * Any rank is accepted, including 1D — the *layout* decides what it can draw,
 * which is what keeps higher-rank shapes from being a parse-time error.
 */
export function parseShape(raw: unknown): number[] | null {
    if (!Array.isArray(raw) || raw.length < 1) return null;
    const dims: number[] = [];
    for (const d of raw) {
        const n = Number(d);
        if (!Number.isInteger(n) || n < 1) return null;
        dims.push(n);
    }
    return dims;
}

/** Describe a shape the way an author wrote it, for error messages. */
function fmtShape(dims: number[]): string {
    return `[${dims.join(', ')}]`;
}

/**
 * Normalize `values` — nested or flat — into a flat row-major array checked
 * against `dims`.
 *
 * Returns `{ error }` rather than throwing or silently padding: a shape that
 * disagrees with its data is an authoring mistake, and the useful response is
 * to say exactly where it disagrees. (The previous revision padded short input
 * with zeros, which turned a typo into a plausible-looking half-empty grid.)
 */
export function normalizeValues(
    raw: unknown,
    dims: number[],
): { values: number[] } | { error: string } {
    if (!Array.isArray(raw)) return { error: '`values` must be an array' };

    const expected = shapeSize(dims);
    const nested = raw.some(v => Array.isArray(v));

    if (!nested) {
        if (raw.length !== expected) {
            return {
                error: `flat \`values\` has ${raw.length} entries but shape ${fmtShape(dims)} needs ${expected}`,
            };
        }
        return { values: raw.map(v => (Number.isFinite(Number(v)) ? Number(v) : 0)) };
    }

    // Nested: the structure must match `dims` level for level. Walking it with
    // the path in hand is what makes the error message locate the mismatch
    // rather than just reporting a total.
    const out: number[] = [];
    let failure: string | null = null;

    const walk = (node: unknown, depth: number, path: number[]) => {
        if (failure) return;
        const where = path.length ? ` at values[${path.join('][')}]` : '';
        if (depth === dims.length) {
            // Past the last dimension: this must be a scalar.
            if (Array.isArray(node)) {
                failure = `nested \`values\`${where} is deeper than shape ${fmtShape(dims)}`;
                return;
            }
            const n = Number(node);
            out.push(Number.isFinite(n) ? n : 0);
            return;
        }
        if (!Array.isArray(node)) {
            failure = `nested \`values\`${where} is shallower than shape ${fmtShape(dims)}: expected an array of ${dims[depth]}`;
            return;
        }
        if (node.length !== dims[depth]) {
            failure = `nested \`values\`${where} has ${node.length} entries but shape ${fmtShape(dims)} needs ${dims[depth]} at dimension ${depth}`;
            return;
        }
        for (let i = 0; i < node.length; i++) walk(node[i], depth + 1, [...path, i]);
    };

    walk(raw, 0, []);
    if (failure) return { error: failure };
    return { values: out };
}

/** Read one axis's labels, trimmed to the axis length. */
function readAxisLabels(axis: AxisSpec | undefined, length: number): string[] | null {
    if (!axis || !Array.isArray(axis.labels)) return null;
    const labels = axis.labels.slice(0, length).map(l => String(l));
    if (labels.length < length) {
        console.warn(`tensor: axis has ${labels.length} labels for ${length} entries; the rest are unlabelled`);
    }
    return labels;
}

/**
 * Compile one axis's `labelExpr`. It wins over `labels` for the same reason
 * `valueExpr` wins over `values`: it is the "labels are a view over data held
 * elsewhere" contract, so an axis carrying both is asking for the live one.
 * The expression may evaluate to a string — `concat`, `toFixed` and
 * `dataTable` all return one — which is the point of the key.
 */
export function compileAxisLabelExpr(axis: AxisSpec | undefined): CompiledExpr | null {
    const src = (axis && typeof axis.labelExpr === 'string' && axis.labelExpr.trim())
        ? (axis.labelExpr as string).trim() : null;
    if (!src) return null;
    try {
        return compileExpr(src);
    } catch (err) {
        console.warn('tensor axis labelExpr compile error:', err);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout layer — where a logical cell lands in space
// ─────────────────────────────────────────────────────────────────────────────

/** Axis indices for the two in-plane directions, per plane. */
const PLANE_AXES: Record<string, [number, number, number]> = {
    // [horizontal axis, vertical axis, normal axis]
    xy: [0, 1, 2],
    xz: [0, 2, 1],
    yz: [1, 2, 0],
};

/** Six vertices — two triangles — per quad, in the order the buffer expects. */
const QUAD_CORNERS: [number, number][] = [
    [0, 0], [1, 0], [1, 1],
    [0, 0], [1, 1], [0, 1],
];

/**
 * The grid layout: the last shape dimension runs horizontally, the one before
 * it vertically (index 0 at the top, so the picture reads like a written
 * matrix). A 1D shape is a single row.
 *
 * This is the only place that knows where a cell goes. Alternative layouts —
 * a tensor drawn as separate row vectors, as column vectors, or as stacked
 * slices for rank 3 — are new functions of this shape, and nothing downstream
 * changes.
 */
function gridLayout(dims: number[], origin: Vec3, cellSize: number, plane: string,
                    fill: number, anchor: { h: -1 | 0 | 1; v: -1 | 0 | 1 }) {
    const [hAxis, vAxis, nAxis] = PLANE_AXES[plane] || PLANE_AXES['xy']!;
    const cols = dims[dims.length - 1]!;
    const rows = dims.length >= 2 ? dims[dims.length - 2]! : 1;

    /** Position from in-plane (horizontal, vertical) offsets, and an optional lift off the plane. */
    const at = (h: number, v: number, nOff = 0): Vec3 => {
        const p: Vec3 = [0, 0, 0];
        p[hAxis!] = origin[0]! + h;
        p[vAxis!] = origin[1]! + v;
        p[nAxis!] = origin[2]! + nOff;
        return p;
    };

    return {
        rows,
        cols,
        /** How many logical cells this layout draws — the trailing 2D slice. */
        drawn: rows * cols,
        /**
         * Corner of the cell at (r, c), `d` in [0,1]^2, for a `w` x `h` cell.
         * A full-size cell (`w = h = fill`) lands in the same place whatever
         * the anchor; the anchor only decides where a smaller one sits.
         */
        corner: (r: number, c: number, dx: number, dy: number, w: number, h: number): Vec3 =>
            at((c + 0.5) * cellSize + anchor.h * (fill - w) / 2 + (dx - 0.5) * w,
               (rows - 1 - r + 0.5) * cellSize + anchor.v * (fill - h) / 2 + (dy - 0.5) * h),
        /** Absolute in-plane point, lifted `nOff` off the lattice plane. */
        point: at,
        /** Whole-lattice extent in the plane. */
        width: cols * cellSize,
        height: rows * cellSize,
        /** Where an axis label sits. `k` is the index along that axis. */
        rowLabelAt: (r: number, pad: number): Vec3 =>
            at(-pad, (rows - 1 - r + 0.5) * cellSize),
        colLabelAt: (c: number, pad: number): Vec3 =>
            at((c + 0.5) * cellSize, rows * cellSize + pad),
        rowTitleAt: (pad: number): Vec3 => at(-pad, (rows * cellSize) / 2),
        colTitleAt: (pad: number): Vec3 => at((cols * cellSize) / 2, rows * cellSize + pad),
    };
}

// ─────────────────────────────────────────────────────────────────────────────

export function renderTensor(el: Element, _view: MathBoxNode) {
    const dims = parseShape(el.shape);
    if (!dims) {
        console.warn('tensor: `shape` must be an array of positive integers; got', el.shape);
        return null;
    }

    // Coerced, then checked per component. `$defs/vec3` permits a component to
    // be a string, so a bare `Number.isFinite` would silently turn `"2"` into 0
    // and pin the lattice to the origin.
    //
    // The strings vec3 permits are math.js *expressions*, and this element does
    // not evaluate them: the lattice is built once and its whole point is that
    // cell positions are arithmetic rather than per-frame expressions. So a
    // component that will not coerce to a number is a limitation worth naming
    // out loud rather than absorbing as a 0.
    const originRaw = Array.isArray(el.origin) ? el.origin : [];
    const origin = [0, 1, 2].map(i => {
        const raw = originRaw[i];
        if (raw === undefined || raw === null) return 0;
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
        console.warn(
            `tensor${el.id ? ` "${el.id}"` : ''}: origin[${i}] is ${JSON.stringify(raw)}, which is not a `
            + `number. tensor builds its lattice once and does not evaluate expression origins, so this `
            + `component is treated as 0.`);
        return 0;
    }) as Vec3;
    const cellSize = (typeof el.cellSize === 'number' && el.cellSize > 0) ? el.cellSize : 1;
    // `gap` is a fraction of the cell pitch, so a lattice keeps its spacing when
    // an author scales `cellSize`.
    // Finite, not merely a number: Math.min/Math.max propagate NaN, so a
    // `gap: NaN` would reach every vertex and the whole lattice would come out
    // as NaN coordinates -- an invisible element and no error anywhere.
    const gapRaw = Number.isFinite(el.gap as number) ? (el.gap as number) : 0.08;
    const fill = cellSize * (1 - Math.max(0, Math.min(0.9, gapRaw)));
    const plane = (typeof el.plane === 'string' && PLANE_AXES[el.plane]) ? el.plane : 'xy';

    const anchor = parseAnchor(el.anchor);
    const layout = gridLayout(dims, origin, cellSize, plane, fill, anchor);
    const { rows, cols, drawn } = layout;

    // Rank > 2 parses and validates, but the grid layout draws the trailing 2D
    // slice only. Saying so is the difference between a documented limitation
    // and silent data loss: without it an author sees a plausible 6x6 and no
    // sign that the other slices exist.
    if (dims.length > 2) {
        const total = shapeSize(dims);
        console.warn(
            `tensor${el.id ? ` "${el.id}"` : ''}: shape [${dims.join(', ')}] has rank ${dims.length}; `
            + `the grid layout draws the trailing ${rows}x${cols} slice, so ${total - drawn} of `
            + `${total} values are not shown. Split it into separate tensors with their own origin `
            + `until slice layouts exist.`);
    }

    const baseColor = parseColor(el.color || '#3b528b') as Rgb3;
    const colorMapFn = buildColorMap(el.colorMap);
    const colorDomain = el.colorDomain;

    const valueExprString = (typeof el.valueExpr === 'string' && el.valueExpr.trim())
        ? el.valueExpr.trim() : null;

    // `valueExpr` wins over `values`: it is the "view over data held elsewhere"
    // mode, and reading both would make which one is live ambiguous.
    let literalValues: number[] | null = null;
    if (!valueExprString && el.values !== undefined) {
        const parsed = normalizeValues(el.values, dims);
        if ('error' in parsed) {
            console.warn(`tensor${el.id ? ` "${el.id}"` : ''}: ${parsed.error}`);
            return null;
        }
        literalValues = parsed.values;
    }

    let valueFn: CompiledExpr | null = null;
    if (valueExprString) {
        try { valueFn = compileExpr(valueExprString); } catch (err) {
            console.warn('tensor valueExpr compile error:', err);
        }
    }

    // The other per-cell channels. Each is evaluated with the same index scope
    // as `valueExpr` plus `value`, the cell's own number, so "size follows the
    // value" is `widthExpr: "value"` and needs no second data source. Colour
    // stays value-driven through `colorMap`; these add to it, never replace it.
    const readExpr = (key: 'widthExpr' | 'heightExpr' | 'textExpr'): string | null => {
        const raw = el[key];
        return (typeof raw === 'string' && raw.trim()) ? raw.trim() : null;
    };
    const widthExprString = readExpr('widthExpr');
    const heightExprString = readExpr('heightExpr');
    const textExprString = readExpr('textExpr');
    const compileOpt = (src: string | null, what: string): CompiledExpr | null => {
        if (!src) return null;
        try { return compileExpr(src); } catch (err) {
            console.warn(`tensor ${what} compile error:`, err);
            return null;
        }
    };
    let widthFn = compileOpt(widthExprString, 'widthExpr');
    let heightFn = compileOpt(heightExprString, 'heightExpr');
    let textFn = compileOpt(textExprString, 'textExpr');
    const hasSizeExpr = !!(widthFn || heightFn);
    const textColorFixed = resolveTextColor(el.textColor);

    const opacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity)) : 0.95;
    const sh = (el.shader || {}) as Shader;

    // ── Geometry: built once. Cell corners are arithmetic on the layout. ──
    const vertsPerCell = QUAD_CORNERS.length;
    const positions = new Float32Array(drawn * vertsPerCell * 3);
    const colors = new Float32Array(drawn * vertsPerCell * 3);

    /** Write one cell's six vertices for a cell `w` x `h` in data units, centred on its lattice slot. */
    function placeCell(cell: number, r: number, c: number, w: number, h: number) {
        for (let k = 0; k < vertsPerCell; k++) {
            // Non-null: k indexes QUAD_CORNERS, whose length is vertsPerCell.
            const [dx, dy] = QUAD_CORNERS[k]!;
            const p = dataToWorld(layout.corner(r, c, dx, dy, w, h));
            const base = (cell * vertsPerCell + k) * 3;
            positions[base] = p[0];
            positions[base + 1] = p[1];
            positions[base + 2] = p[2];
        }
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) placeCell(r * cols + c, r, c, fill, fill);
    }

    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    // Only a size channel moves vertices after the build; without one the
    // positions really are write-once, which is the static contract.
    if (hasSizeExpr) posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', posAttr);
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    // Positions never move, but a `valueExpr` tensor rewrites this whole buffer
    // every frame. Saying so lets the driver keep it somewhere it can be
    // respecified cheaply, rather than treating it as write-once like the
    // default STATIC usage claims.
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('color', colorAttr);

    // Per-cell state the text layer reads back: the last value, the extents
    // (as fractions of the pitch) and the painted colour.
    const fillFrac = fill / cellSize;
    const cellValue = new Float64Array(drawn).fill(NaN);
    const cellW = new Float64Array(drawn).fill(fillFrac);
    const cellH = new Float64Array(drawn).fill(fillFrac);
    const cellRgb = new Float32Array(drawn * 3);

    /** Paint one cell's six vertices from a raw value. */
    function paintCell(cell: number, raw: unknown) {
        const u = normalizeColorValue(raw, colorDomain);
        // null means the value was not a usable number — leave the cell as it
        // was rather than flashing it to the cold end of the ramp.
        if (u === null) return;
        const rgb = colorMapFn(u);
        const r0 = rgb[0]!, g0 = rgb[1]!, b0 = rgb[2]!;
        cellRgb[cell * 3] = r0; cellRgb[cell * 3 + 1] = g0; cellRgb[cell * 3 + 2] = b0;
        for (let k = 0; k < vertsPerCell; k++) {
            const base = (cell * vertsPerCell + k) * 3;
            colors[base] = r0;
            colors[base + 1] = g0;
            colors[base + 2] = b0;
        }
    }

    // Seed every cell with the element's static colour, so a failed or absent
    // value source still renders something deliberate.
    for (let cell = 0; cell < drawn; cell++) {
        cellRgb[cell * 3] = baseColor[0]; cellRgb[cell * 3 + 1] = baseColor[1]; cellRgb[cell * 3 + 2] = baseColor[2];
        for (let k = 0; k < vertsPerCell; k++) {
            const base = (cell * vertsPerCell + k) * 3;
            colors[base] = baseColor[0];
            colors[base + 1] = baseColor[1];
            colors[base + 2] = baseColor[2];
        }
    }

    /**
     * Evaluate every drawn cell at `tSec`, binding indices for that cell only:
     * the value first (colour), then the size channels with that value in
     * scope. Literal values still run the size channels, so a static matrix
     * can have slider-driven cell sizes without paying for a valueExpr.
     */
    function paintAll(tSec: number) {
        const liveValue = literalValues || valueFn;
        if (!liveValue && !hasSizeExpr) return;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = r * cols + c;
                // overrideScope, not extraScope: extraScope *loses* to a scene
                // slider of the same name, so a scene with a slider called
                // `row` would silently shadow the cell index.
                // `value` enters the scope only AFTER the value is known: it
                // is what the size and text channels read, and binding it for
                // valueExpr itself would shadow a scene slider or function of
                // that name for no reason.
                const idxScope = { row: r, col: c, idx: cell };
                let raw: unknown;
                if (literalValues) raw = literalValues[cell];
                else if (valueFn) raw = evalExpr(valueFn, tSec, { overrideScope: idxScope });
                if (raw !== undefined) paintCell(cell, raw);
                const v = Number(raw);
                const scope = { ...idxScope, value: Number.isFinite(v) ? v : NaN };
                cellValue[cell] = scope.value;
                if (hasSizeExpr) {
                    const w = widthFn ? resolveExtent(evalExpr(widthFn, tSec, { overrideScope: scope }), fillFrac) : fillFrac;
                    const h = heightFn ? resolveExtent(evalExpr(heightFn, tSec, { overrideScope: scope }), fillFrac) : fillFrac;
                    cellW[cell] = w;
                    cellH[cell] = h;
                    placeCell(cell, r, c, w * cellSize, h * cellSize);
                }
            }
        }
    }

    try { paintAll(0); } catch (err) {
        console.warn('tensor value evaluation error:', err);
    }
    colorAttr.needsUpdate = true;
    if (hasSizeExpr) posAttr.needsUpdate = true;

    // One formula for the first paint and for the global Planes control, which
    // recomputes `targetOpacity * planeOpacity` (or `targetOpacity` alone when
    // ignoring it — see overlay.ts). Painting one thing here and storing
    // another made the first drag of that control jump: at the default
    // planeOpacity of 0.2 an `opacity: 0.95` tensor started at 0.38 and
    // snapped to 0.95.
    //
    // Unlike animated_polygon this carries no `/ 0.5` boost. That fudge exists
    // there to keep planes visible at the 0.2 default and cannot be removed
    // without restyling every shipped scene, but it also means `opacity` above
    // 0.5 does not mean what it says. A new element should not inherit that;
    // an author asking for 0.95 gets 0.95, and reaches for
    // `shader.ignorePlaneOpacity` when they want it independent of the control.
    const ignoresPlaneOpacity = !!sh.ignorePlaneOpacity;
    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: ignoresPlaneOpacity ? opacity : tensorState.displayParams.planeOpacity * opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Read back by the global Planes opacity control; without these it dims the
    // tensor with no way back and no way to opt out.
    mesh.userData.targetOpacity = opacity;
    mesh.userData.ignorePlaneOpacity = ignoresPlaneOpacity;
    const serial = el.renderOrder !== undefined ? el.renderOrder : tensorState._planeMeshSerial++;
    mesh.renderOrder = serial;
    tensorState.three.scene.add(mesh);
    tensorState.planeMeshes.push(mesh);

    // ── Cell text: one canvas for the whole lattice, mapped onto one quad that
    // lies ON the lattice plane, a hair in front of the cells. It is geometry,
    // not an HTML label: it tilts with the plane, is occluded like the cells,
    // and never piles up with the decal labels. Each string is fitted to its
    // own cell's current extent, so it always fits, and the canvas is redrawn
    // only when some string, size or colour actually changed. ──
    interface TextLayer {
        canvas: HTMLCanvasElement;
        ctx: CanvasRenderingContext2D;
        tex: CanvasTexture;
        mesh: Mesh;
        px: number;
        lastKey: string;
    }
    let textLayer: TextLayer | null = null;
    // A canvas is at least one pixel per cell, so past 2048 cells a side no
    // pixel budget keeps it inside the texture limit; and at that density no
    // string could be read anyway. Say so and skip the layer rather than
    // allocate something the GPU may refuse.
    if (textFn && Math.max(rows, cols) > 2048) {
        console.warn(
            `tensor${el.id ? ` "${el.id}"` : ''}: textExpr is ignored on a ${rows}x${cols} lattice; `
            + `cell text needs at least one canvas pixel per cell and the canvas is capped at 2048 a side.`);
        textFn = null;
    }
    if (textFn) {
        // Pixels per cell pitch: enough for a short number to be crisp, and
        // capped so the whole canvas never exceeds 2048 on a side. The cap
        // wins over crispness: past ~85 cells a side the text is too small to
        // read anyway, and an oversized texture is a real memory cost.
        const px = Math.max(1, Math.min(128, Math.floor(2048 / Math.max(rows, cols))));
        const canvas = document.createElement('canvas');
        canvas.width = cols * px;
        canvas.height = rows * px;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            // Lift off the plane by a fraction of the pitch so the quad wins the
            // depth tie against the cells without visibly floating.
            const lift = cellSize * 0.02;
            const q = [
                dataToWorld(layout.point(0, 0, lift)),
                dataToWorld(layout.point(layout.width, 0, lift)),
                dataToWorld(layout.point(layout.width, layout.height, lift)),
                dataToWorld(layout.point(0, layout.height, lift)),
            ];
            const qPos = new Float32Array([...q[0]!, ...q[1]!, ...q[2]!, ...q[3]!]);
            // Row 0 is drawn at the top of the canvas and sits at the top of the
            // lattice; CanvasTexture flips Y, so v = 1 is the canvas top.
            const qUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
            const qGeom = new THREE.BufferGeometry();
            qGeom.setAttribute('position', new THREE.BufferAttribute(qPos, 3));
            qGeom.setAttribute('uv', new THREE.BufferAttribute(qUv, 2));
            qGeom.setIndex([0, 1, 2, 0, 2, 3]);
            const qMat = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                opacity: mat.opacity,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            // Disposing a material does not dispose its map. The loader tears a
            // mesh down by disposing geometry and material, so ride that event
            // to free the texture too; otherwise every step that adds and
            // removes a text-bearing tensor leaks one GPU texture.
            qMat.addEventListener('dispose', () => tex.dispose());
            const qMesh = new THREE.Mesh(qGeom, qMat);
            qMesh.userData.targetOpacity = opacity;
            qMesh.userData.ignorePlaneOpacity = ignoresPlaneOpacity;
            qMesh.renderOrder = serial + 1;
            tensorState.three.scene.add(qMesh);
            tensorState.planeMeshes.push(qMesh);
            textLayer = { canvas, ctx, tex, mesh: qMesh, px, lastKey: '' };
        }
    }

    /** Evaluate every cell's text and redraw the canvas if anything on it changed. */
    function paintText(tSec: number) {
        if (!textLayer || !textFn) return;
        const { ctx, tex, px } = textLayer;
        const texts: string[] = new Array(drawn);
        const keyParts: string[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = r * cols + c;
                let txt = '';
                try {
                    const out = evalExpr(textFn, tSec, { overrideScope: { row: r, col: c, idx: cell, value: cellValue[cell]! } });
                    txt = (out === null || out === undefined) ? '' : String(out);
                } catch (_err) { txt = ''; }
                texts[cell] = txt;
                keyParts.push(txt, cellW[cell]!.toFixed(3), cellH[cell]!.toFixed(3),
                    String(Math.round(cellRgb[cell * 3]! * 255)), String(Math.round(cellRgb[cell * 3 + 1]! * 255)),
                    String(Math.round(cellRgb[cell * 3 + 2]! * 255)));
            }
        }
        const key = keyParts.join('\u0001');
        if (key === textLayer.lastKey) return;
        textLayer.lastKey = key;

        ctx.clearRect(0, 0, cols * px, rows * px);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = r * cols + c;
                const txt = texts[cell]!;
                if (!txt) continue;
                const wPx = cellW[cell]! * px;
                const hPx = cellH[cell]! * px;
                if (wPx < 2 || hPx < 2) continue;
                ctx.font = '100px system-ui, sans-serif';
                const measured = ctx.measureText(txt).width;
                const fontPx = fitFontPx(measured, wPx, hPx);
                ctx.font = `${fontPx}px system-ui, sans-serif`;
                ctx.fillStyle = textColorFixed || contrastTextColor([cellRgb[cell * 3]!, cellRgb[cell * 3 + 1]!, cellRgb[cell * 3 + 2]!]);
                // Canvas y runs down while the lattice's vertical axis runs
                // up, so the vertical anchor flips sign here.
                const cx = (c + 0.5) * px + anchor.h * (fillFrac - cellW[cell]!) * px / 2;
                const cy = (r + 0.5) * px - anchor.v * (fillFrac - cellH[cell]!) * px / 2;
                ctx.fillText(txt, cx, cy);
            }
        }
        tex.needsUpdate = true;
    }

    if (textLayer) {
        try { paintText(0); } catch (err) {
            console.warn('tensor textExpr evaluation error:', err);
        }
    }

    // ── Axis labels. `axes[k]` describes `shape[k]`; the last dimension runs
    // horizontally and the one before it vertically, matching the layout. These
    // go through addLabel3D, so the loader's snapshot tracker picks them up and
    // they are hidden and restored with the element. ──
    const axes = Array.isArray(el.axes) ? (el.axes as AxisSpec[]) : [];
    const dynamicLabels: DynamicAxisLabel[] = [];
    const labelExprStrings: string[] = [];
    if (axes.length) {
        const pad = cellSize * 0.35;
        const hAxisIdx = dims.length - 1;
        const vAxisIdx = dims.length - 2;
        const defaultLabelColor = '#aabbcc';

        const hAxis = axes[hAxisIdx];
        const hColor = parseColor((hAxis && hAxis.color) || defaultLabelColor) as Rgb3;
        const hLabelFn = compileAxisLabelExpr(hAxis);
        if (hLabelFn) {
            const src = String(hAxis!.labelExpr).trim();
            labelExprStrings.push(src);
            for (let c = 0; c < cols; c++) {
                const label = addLabel3D('', layout.colLabelAt(c, pad), hColor);
                dynamicLabels.push({ label, src, fn: hLabelFn, scope: { col: c, idx: c } });
            }
        } else {
            const hLabels = readAxisLabels(hAxis, cols);
            if (hLabels) {
                for (let c = 0; c < hLabels.length; c++) {
                    addLabel3D(hLabels[c]!, layout.colLabelAt(c, pad), hColor);
                }
            }
        }
        if (hAxis && hAxis.title) {
            addLabel3D(String(hAxis.title), layout.colTitleAt(pad * 3), hColor);
        }

        // A 1D tensor has no vertical axis, so axes[1] simply does not apply.
        if (vAxisIdx >= 0) {
            const vAxis = axes[vAxisIdx];
            const vColor = parseColor((vAxis && vAxis.color) || defaultLabelColor) as Rgb3;
            const vLabelFn = compileAxisLabelExpr(vAxis);
            if (vLabelFn) {
                const src = String(vAxis!.labelExpr).trim();
                labelExprStrings.push(src);
                for (let r = 0; r < rows; r++) {
                    const label = addLabel3D('', layout.rowLabelAt(r, pad), vColor);
                    dynamicLabels.push({ label, src, fn: vLabelFn, scope: { row: r, idx: r } });
                }
            } else {
                const vLabels = readAxisLabels(vAxis, rows);
                if (vLabels) {
                    for (let r = 0; r < vLabels.length; r++) {
                        addLabel3D(vLabels[r]!, layout.rowLabelAt(r, pad), vColor);
                    }
                }
            }
            if (vAxis && vAxis.title) {
                addLabel3D(String(vAxis.title), layout.rowTitleAt(pad * 4), vColor);
            }
        }
    }

    /**
     * Re-evaluate every expression-driven axis label. The memo is what makes
     * this affordable per frame: a label whose text has not changed is left
     * alone, so the common case costs one eval and a string compare rather
     * than a KaTeX render.
     */
    function paintLabels(tSec: number) {
        for (const dl of dynamicLabels) {
            let txt: string;
            // Same reasoning as the cell scope: overrideScope, so a scene
            // slider named `row` cannot shadow the axis index.
            try { txt = String(evalExpr(dl.fn, tSec, { overrideScope: dl.scope })); }
            catch (_err) { continue; }   // keep the last text this label had
            if (txt === dl.label._lastDynamicText) continue;
            dl.label.el.innerHTML = renderKaTeX(txt, false);
            // The label system measures a box ONCE and caches it, re-measuring
            // only when boxW is null or the scale changed (labels.ts). Text that
            // changes LENGTH therefore keeps a stale width -- and that width is
            // what declutter and overlap avoidance read. Drop the cache so the
            // next frame measures the text actually on screen.
            dl.label.boxW = null;
            dl.label._lastDynamicText = txt;
        }
    }

    if (dynamicLabels.length) {
        try { paintLabels(0); } catch (err) {
            console.warn('tensor axis label evaluation error:', err);
        }
    }

    const animState = { stopped: false };

    // Literal values and literal labels never change, so there is nothing to
    // run per frame. This is the static path, and it costs exactly nothing.
    // A size or text channel is live by definition — it may read a slider —
    // so any of them registers the updater.
    if (!valueFn && !dynamicLabels.length && !hasSizeExpr && !textFn) {
        return { type: 'tensor', color: baseColor, label: el.label };
    }

    let compiledUnderTrust = tensorState._sceneJsTrustState;

    const channelStrings = [widthExprString, heightExprString, textExprString].filter((x): x is string => !!x);
    const channelFns = () => [widthFn, heightFn, textFn].filter((x): x is CompiledExpr => !!x);
    const entry: TensorAnimExprEntry = {
        exprStrings: [...(valueExprString ? [valueExprString] : []), ...channelStrings, ...labelExprStrings],
        animState,
        compiledFns: [...(valueFn ? [valueFn] : []), ...channelFns(), ...dynamicLabels.map(dl => dl.fn)],
        // Called on EVERY slider value change, not just on a recompile
        // (sliders.ts drives both through the same hook). Compiling the same
        // string twice gives the same node -- a slider VALUE is read at eval
        // time, never at compile time -- so the work was pure waste on the hot
        // path, and worse once labelExpr added more strings to redo.
        //
        // The one input that changes what compileExpr RETURNS for a fixed
        // string is the scene's JS trust state: untrusted it is compile('0'),
        // trusted it is the JS fallback. Scene functions and domain imports do
        // not count -- those resolve from the scope at eval time. So remember
        // the trust the current nodes were compiled under and skip until it
        // moves.
        _rebuildFn() {
            if (tensorState._sceneJsTrustState === compiledUnderTrust) return;
            compiledUnderTrust = tensorState._sceneJsTrustState;
            if (valueExprString) {
                try {
                    valueFn = compileExpr(valueExprString);
                } catch (err) {
                    console.warn('Slider tensor valueExpr recompile error:', err);
                }
            }
            widthFn = compileOpt(widthExprString, 'widthExpr') ?? widthFn;
            heightFn = compileOpt(heightExprString, 'heightExpr') ?? heightFn;
            textFn = compileOpt(textExprString, 'textExpr') ?? textFn;
            // One compile per distinct expression, not one per label: the six
            // labels down an axis all share a single `labelExpr`.
            const recompiled = new Map<string, CompiledExpr>();
            for (const dl of dynamicLabels) {
                let fn = recompiled.get(dl.src);
                if (!fn) {
                    try { fn = compileExpr(dl.src); } catch (err) {
                        console.warn('Slider tensor labelExpr recompile error:', err);
                        continue;
                    }
                    recompiled.set(dl.src, fn);
                }
                dl.fn = fn;
            }
            entry.compiledFns = [...(valueFn ? [valueFn] : []), ...channelFns(), ...dynamicLabels.map(dl => dl.fn)];
        },
    };
    tensorState.activeAnimExprs.push(entry);

    const startTime = tensorState.sceneStartTime;
    tensorState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            // The text quad follows the cell mesh's visibility whatever set it,
            // so it can never be left showing over a hidden lattice.
            if (textLayer) textLayer.mesh.visible = mesh.visible;
            if (!mesh.visible) return;
            const tSec = (nowMs - startTime) / 1000;
            if (valueFn || hasSizeExpr) {
                try {
                    paintAll(tSec);
                    colorAttr.needsUpdate = true;
                    if (hasSizeExpr) posAttr.needsUpdate = true;
                } catch (_err) { /* keep the last frame's colours */ }
            }
            if (textLayer) {
                try { paintText(tSec); } catch (_err) { /* keep the last frame's text */ }
            }
            if (dynamicLabels.length) paintLabels(tSec);
        },
    });

    return { type: 'tensor', color: baseColor, label: el.label, _animState: animState, _animExprEntry: entry };
}
