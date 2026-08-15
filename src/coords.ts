// ============================================================
// Coordinate conversion — data-space to world-space helpers.
// Pure functions that depend only on state.currentRange/Scale.
// Extracted to its own module to avoid circular imports between
// camera.js and labels.js (both need these functions).
// ============================================================

import { state } from '/state.js';

/** A point or vector in data or world space, as [x, y, z]. */
export type Vec3 = [number, number, number];

/** Axis ranges as [[xMin,xMax],[yMin,yMax],[zMin,zMax]]. */
export type Range3 = [[number, number], [number, number], [number, number]];

// `state` is still untyped JavaScript, so these two read back as number[][] /
// number[]. Narrow them here rather than at every call site; the shape is
// guaranteed by the lesson schema (range3D / vec3Number).
const range = (): Range3 | null => (state.currentRange as Range3 | null);
const scale = (): Vec3 => (state.currentScale as Vec3);

// MathBox cartesian maps data range to [-scale, +scale] in world space.
export function dataToWorld(pos: Vec3): Vec3 {
    const r = range();
    const s = scale();
    // Destructured so the emptiness guard narrows for the whole body —
    // indexing r again would re-widen each access back to possibly-undefined.
    const [rx, ry, rz] = r ?? [];
    if (!rx || !ry || !rz) return [0, 0, 0];
    return [
        ((pos[0] - rx[0]) / (rx[1] - rx[0]) * 2 - 1) * s[0],
        ((pos[1] - ry[0]) / (ry[1] - ry[0]) * 2 - 1) * s[1],
        ((pos[2] - rz[0]) / (rz[1] - rz[0]) * 2 - 1) * s[2],
    ];
}

// Convert a camera position/target from data-space to world-space using
// uniform normalization (largest half-span) so 2D scenes with a tiny z-range
// don't blow up the camera distance.
export function dataCameraToWorld(pos: Vec3): Vec3 {
    const r = range();
    const s = scale();
    const [rx, ry, rz] = r ?? [];
    if (!rx || !ry || !rz) return [0, 0, 0];
    const hx = (rx[1] - rx[0]) / 2;
    const hy = (ry[1] - ry[0]) / 2;
    const hz = (rz[1] - rz[0]) / 2;
    const maxH = Math.max(hx, hy, hz, 0.001);
    const cx = (rx[0] + rx[1]) / 2;
    const cy = (ry[0] + ry[1]) / 2;
    const cz = (rz[0] + rz[1]) / 2;
    return [
        (pos[0] - cx) / maxH * s[0],
        (pos[1] - cy) / maxH * s[1],
        (pos[2] - cz) / maxH * s[2],
    ];
}

// Inverse of dataCameraToWorld — convert world-space camera pos/target back
// to data-space values suitable for pasting into scene JSON.
export function worldCameraToData(pos: Vec3): Vec3 {
    const r = range();
    const s = scale();
    const [rx, ry, rz] = r ?? [];
    if (!rx || !ry || !rz) return [0, 0, 0];
    const hx = (rx[1] - rx[0]) / 2;
    const hy = (ry[1] - ry[0]) / 2;
    const hz = (rz[1] - rz[0]) / 2;
    const maxH = Math.max(hx, hy, hz, 0.001);
    const cx = (rx[0] + rx[1]) / 2;
    const cy = (ry[0] + ry[1]) / 2;
    const cz = (rz[0] + rz[1]) / 2;
    return [
        pos[0] * maxH / s[0] + cx,
        pos[1] * maxH / s[1] + cy,
        pos[2] * maxH / s[2] + cz,
    ];
}

// Convert a data-space length to world-space length (average across axes).
export function dataLenToWorld(len: number): number {
    const r = range();
    const s = scale();
    // No emptiness guard here, deliberately: the original threw on a missing
    // range and callers rely on that surfacing rather than silently yielding
    // a wrong length. `!` keeps the TypeError identical instead of inventing
    // a fallback the JavaScript never had.
    const sx = 2 * s[0] / (r![0][1] - r![0][0]);
    const sy = 2 * s[1] / (r![1][1] - r![1][0]);
    const sz = 2 * s[2] / (r![2][1] - r![2][0]);
    return len * (sx + sy + sz) / 3;
}
