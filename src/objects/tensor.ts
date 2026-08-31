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
import { parseColor, addLabel3D } from '/labels.js';
import { buildColorMap, normalizeColorValue } from '/colormaps.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Element, Shader } from '/types/lesson.js';
import type { Object3D, Scene } from 'three';

/** parseColor returns `number[]`; three's Color constructor needs a tuple. */
type Rgb3 = [number, number, number];

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
}
const tensorState = state as unknown as TensorState;

/** Per-axis metadata, as an author supplies it. `axes[k]` describes `shape[k]`. */
interface AxisSpec {
    labels?: unknown;
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
function gridLayout(dims: number[], origin: Vec3, cellSize: number, plane: string) {
    const [hAxis, vAxis, nAxis] = PLANE_AXES[plane] || PLANE_AXES['xy']!;
    const cols = dims[dims.length - 1]!;
    const rows = dims.length >= 2 ? dims[dims.length - 2]! : 1;

    /** Position from in-plane (horizontal, vertical) offsets. */
    const at = (h: number, v: number): Vec3 => {
        const p: Vec3 = [0, 0, 0];
        p[hAxis!] = origin[0]! + h;
        p[vAxis!] = origin[1]! + v;
        p[nAxis!] = origin[2]!;
        return p;
    };

    return {
        rows,
        cols,
        /** How many logical cells this layout draws — the trailing 2D slice. */
        drawn: rows * cols,
        /** Centre-relative corner of the cell at (r, c), `d` in [0,1]^2. */
        corner: (r: number, c: number, dx: number, dy: number, fill: number): Vec3 =>
            at((c + 0.5) * cellSize + (dx - 0.5) * fill,
               (rows - 1 - r + 0.5) * cellSize + (dy - 0.5) * fill),
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

    const origin = (Array.isArray(el.origin) ? el.origin : [0, 0, 0]) as Vec3;
    const cellSize = (typeof el.cellSize === 'number' && el.cellSize > 0) ? el.cellSize : 1;
    // `gap` is a fraction of the cell pitch, so a lattice keeps its spacing when
    // an author scales `cellSize`.
    const gapRaw = (typeof el.gap === 'number') ? el.gap : 0.08;
    const fill = cellSize * (1 - Math.max(0, Math.min(0.9, gapRaw)));
    const plane = (typeof el.plane === 'string' && PLANE_AXES[el.plane]) ? el.plane : 'xy';

    const layout = gridLayout(dims, origin, cellSize, plane);
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

    const opacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity)) : 0.95;
    const sh = (el.shader || {}) as Shader;

    // ── Geometry: built once. Cell corners are arithmetic on the layout. ──
    const vertsPerCell = QUAD_CORNERS.length;
    const positions = new Float32Array(drawn * vertsPerCell * 3);
    const colors = new Float32Array(drawn * vertsPerCell * 3);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = r * cols + c;
            for (let k = 0; k < vertsPerCell; k++) {
                // Non-null: k indexes QUAD_CORNERS, whose length is vertsPerCell.
                const [dx, dy] = QUAD_CORNERS[k]!;
                const w = dataToWorld(layout.corner(r, c, dx, dy, fill));
                const base = (cell * vertsPerCell + k) * 3;
                positions[base] = w[0];
                positions[base + 1] = w[1];
                positions[base + 2] = w[2];
            }
        }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    geom.setAttribute('color', colorAttr);

    /** Paint one cell's six vertices from a raw value. */
    function paintCell(cell: number, raw: unknown) {
        const u = normalizeColorValue(raw, colorDomain);
        // null means the value was not a usable number — leave the cell as it
        // was rather than flashing it to the cold end of the ramp.
        if (u === null) return;
        const rgb = colorMapFn(u);
        const r0 = rgb[0]!, g0 = rgb[1]!, b0 = rgb[2]!;
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
        for (let k = 0; k < vertsPerCell; k++) {
            const base = (cell * vertsPerCell + k) * 3;
            colors[base] = baseColor[0];
            colors[base + 1] = baseColor[1];
            colors[base + 2] = baseColor[2];
        }
    }

    /** Evaluate every drawn cell at `tSec`, binding indices for that cell only. */
    function paintAll(tSec: number) {
        if (literalValues) {
            for (let cell = 0; cell < drawn; cell++) paintCell(cell, literalValues[cell]);
            return;
        }
        if (!valueFn) return;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = r * cols + c;
                // overrideScope, not extraScope: extraScope *loses* to a scene
                // slider of the same name, so a scene with a slider called
                // `row` would silently shadow the cell index.
                const raw = evalExpr(valueFn, tSec, { overrideScope: { row: r, col: c, idx: cell } });
                paintCell(cell, raw);
            }
        }
    }

    try { paintAll(0); } catch (err) {
        console.warn('tensor value evaluation error:', err);
    }
    colorAttr.needsUpdate = true;

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

    // ── Axis labels. `axes[k]` describes `shape[k]`; the last dimension runs
    // horizontally and the one before it vertically, matching the layout. These
    // go through addLabel3D, so the loader's snapshot tracker picks them up and
    // they are hidden and restored with the element. ──
    const axes = Array.isArray(el.axes) ? (el.axes as AxisSpec[]) : [];
    if (axes.length) {
        const pad = cellSize * 0.35;
        const hAxisIdx = dims.length - 1;
        const vAxisIdx = dims.length - 2;
        const defaultLabelColor = '#aabbcc';

        const hAxis = axes[hAxisIdx];
        const hColor = parseColor((hAxis && hAxis.color) || defaultLabelColor) as Rgb3;
        const hLabels = readAxisLabels(hAxis, cols);
        if (hLabels) {
            for (let c = 0; c < hLabels.length; c++) {
                addLabel3D(hLabels[c]!, layout.colLabelAt(c, pad), hColor);
            }
        }
        if (hAxis && hAxis.title) {
            addLabel3D(String(hAxis.title), layout.colTitleAt(pad * 3), hColor);
        }

        // A 1D tensor has no vertical axis, so axes[1] simply does not apply.
        if (vAxisIdx >= 0) {
            const vAxis = axes[vAxisIdx];
            const vColor = parseColor((vAxis && vAxis.color) || defaultLabelColor) as Rgb3;
            const vLabels = readAxisLabels(vAxis, rows);
            if (vLabels) {
                for (let r = 0; r < vLabels.length; r++) {
                    addLabel3D(vLabels[r]!, layout.rowLabelAt(r, pad), vColor);
                }
            }
            if (vAxis && vAxis.title) {
                addLabel3D(String(vAxis.title), layout.rowTitleAt(pad * 4), vColor);
            }
        }
    }

    const animState = { stopped: false };

    // Literal values never change, so there is nothing to run per frame. This
    // is the static path, and it costs exactly nothing.
    if (!valueFn) {
        return { type: 'tensor', color: baseColor, label: el.label };
    }

    const entry: TensorAnimExprEntry = {
        // Non-null: this branch is gated on valueExprString having compiled.
        exprStrings: [valueExprString!],
        animState,
        compiledFns: [valueFn],
        _rebuildFn() {
            try {
                valueFn = compileExpr(valueExprString!);
                entry.compiledFns = [valueFn];
            } catch (err) {
                console.warn('Slider tensor valueExpr recompile error:', err);
            }
        },
    };
    tensorState.activeAnimExprs.push(entry);

    const startTime = tensorState.sceneStartTime;
    tensorState.activeAnimUpdaters.push({
        animState,
        updateFrame(nowMs) {
            if (!mesh.visible) return;
            try {
                paintAll((nowMs - startTime) / 1000);
                colorAttr.needsUpdate = true;
            } catch (_err) { /* keep the last frame's colours */ }
        },
    });

    return { type: 'tensor', color: baseColor, label: el.label, _animState: animState, _animExprEntry: entry };
}
