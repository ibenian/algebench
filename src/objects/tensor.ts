/**
 * `tensor` — a lattice of cells whose colour carries a value.
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
 * static contract); a `valueExpr` registers one updater. The batch element
 * types this follows — `vectors`, `vector_field`, `point` with `positions[]` —
 * have no `animated_` twins either, and here the geometry never animates at
 * all, so a second type would differ by one `if`.
 *
 * "Tensor" is used in the machine-learning sense: an n-dimensional array, whose
 * *components* this renders. It carries no transformation law, so it is not a
 * tensor in the differential-geometry sense that `special-relativity.json`
 * means by the word.
 */

import { state } from '/state.js';
import { parseColor } from '/labels.js';
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
 * Read `shape`, tolerating the leading dimensions a future slice selector will
 * add: the last two entries are always [rows, cols], so `[2,6,6]` already reads
 * as a 6x6 lattice rather than failing.
 */
export function readShape(raw: unknown): { rows: number; cols: number } | null {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const rows = Number(raw[raw.length - 2]);
    const cols = Number(raw[raw.length - 1]);
    if (!Number.isInteger(rows) || !Number.isInteger(cols)) return null;
    if (rows < 1 || cols < 1) return null;
    return { rows, cols };
}

/** Flatten `values` to a row-major lookup, accepting nested rows or a flat list. */
export function readValues(raw: unknown, rows: number, cols: number): number[] | null {
    if (!Array.isArray(raw)) return null;
    const flat: number[] = [];
    if (Array.isArray(raw[0])) {
        for (let r = 0; r < rows; r++) {
            const row = raw[r] as unknown;
            for (let c = 0; c < cols; c++) {
                const v = Array.isArray(row) ? Number(row[c]) : NaN;
                flat.push(Number.isFinite(v) ? v : 0);
            }
        }
    } else {
        for (let i = 0; i < rows * cols; i++) {
            const v = Number(raw[i]);
            flat.push(Number.isFinite(v) ? v : 0);
        }
    }
    return flat;
}

export function renderTensor(el: Element, _view: MathBoxNode) {
    const shape = readShape(el.shape);
    if (!shape) {
        console.warn('tensor: `shape` must be [rows, cols] of positive integers; got', el.shape);
        return null;
    }
    const { rows, cols } = shape;
    const cellCount = rows * cols;

    const origin = (Array.isArray(el.origin) ? el.origin : [0, 0, 0]) as Vec3;
    const cellSize = (typeof el.cellSize === 'number' && el.cellSize > 0) ? el.cellSize : 1;
    // `gap` is a fraction of the cell pitch, so a lattice keeps its spacing when
    // an author scales `cellSize`.
    const gapRaw = (typeof el.gap === 'number') ? el.gap : 0.08;
    const gap = Math.max(0, Math.min(0.9, gapRaw));
    const fill = cellSize * (1 - gap);
    const plane = (typeof el.plane === 'string' && PLANE_AXES[el.plane]) ? el.plane : 'xy';
    // Non-null: `plane` was just narrowed to a key of PLANE_AXES.
    const [hAxis, vAxis, nAxis] = PLANE_AXES[plane]!;

    const baseColor = parseColor(el.color || '#3b528b') as Rgb3;
    const colorMapFn = buildColorMap(el.colorMap);
    const colorDomain = el.colorDomain;

    const valueExprString = (typeof el.valueExpr === 'string' && el.valueExpr.trim())
        ? el.valueExpr.trim() : null;
    const literalValues = readValues(el.values, rows, cols);

    let valueFn: CompiledExpr | null = null;
    if (valueExprString) {
        try { valueFn = compileExpr(valueExprString); } catch (err) {
            console.warn('tensor valueExpr compile error:', err);
        }
    }

    const opacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity)) : 0.95;
    const sh = (el.shader || {}) as Shader;

    // ── Geometry: built once. Cell corners are arithmetic on (row, col). ──
    const vertsPerCell = QUAD_CORNERS.length;
    const positions = new Float32Array(cellCount * vertsPerCell * 3);
    const colors = new Float32Array(cellCount * vertsPerCell * 3);

    /** Data-space centre of cell (r, c). Row 0 sits at the top, as a matrix reads. */
    function cellCorner(r: number, c: number, dx: number, dy: number): Vec3 {
        const pos: Vec3 = [0, 0, 0];
        pos[hAxis] = origin[0]! + (c + 0.5) * cellSize + (dx - 0.5) * fill;
        pos[vAxis] = origin[1]! + (rows - 1 - r + 0.5) * cellSize + (dy - 0.5) * fill;
        pos[nAxis] = origin[2]!;
        return pos;
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = r * cols + c;
            for (let k = 0; k < vertsPerCell; k++) {
                // Non-null: k indexes QUAD_CORNERS, whose length is vertsPerCell.
                const [dx, dy] = QUAD_CORNERS[k]!;
                const w = dataToWorld(cellCorner(r, c, dx, dy));
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

    /** Seed every cell with the element's static colour, so a failed or absent
     *  value source still renders something deliberate. */
    for (let cell = 0; cell < cellCount; cell++) {
        for (let k = 0; k < vertsPerCell; k++) {
            const base = (cell * vertsPerCell + k) * 3;
            colors[base] = baseColor[0];
            colors[base + 1] = baseColor[1];
            colors[base + 2] = baseColor[2];
        }
    }

    /** Evaluate every cell at `tSec`, binding row/col for this cell only. */
    function paintAll(tSec: number) {
        if (literalValues) {
            for (let cell = 0; cell < cellCount; cell++) paintCell(cell, literalValues[cell]);
            return;
        }
        if (!valueFn) return;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // overrideScope, not extraScope: extraScope *loses* to a scene
                // slider of the same name, so a scene with a slider called
                // `row` would silently shadow the cell index.
                const raw = evalExpr(valueFn, tSec, { overrideScope: { row: r, col: c } });
                paintCell(r * cols + c, raw);
            }
        }
    }

    try { paintAll(0); } catch (err) {
        console.warn('tensor value evaluation error:', err);
    }
    colorAttr.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: tensorState.displayParams.planeOpacity * (opacity / 0.5),
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Read back by the global Planes opacity control; without these it dims the
    // tensor with no way back and no way to opt out.
    mesh.userData.targetOpacity = opacity;
    mesh.userData.ignorePlaneOpacity = !!sh.ignorePlaneOpacity;
    const serial = el.renderOrder !== undefined ? el.renderOrder : tensorState._planeMeshSerial++;
    mesh.renderOrder = serial;
    tensorState.three.scene.add(mesh);
    tensorState.planeMeshes.push(mesh);

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
