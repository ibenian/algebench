// ============================================================
// Coordinate conversion — data-space to world-space helpers.
// Pure functions that depend only on state.currentRange/Scale.
// Extracted to its own module to avoid circular imports between
// camera.js and labels.js (both need these functions).
// ============================================================

import { state } from '/state.js';

// MathBox cartesian maps data range to [-scale, +scale] in world space.
export function dataToWorld(pos) {
    const r = state.currentRange;
    const s = state.currentScale;
    if (!r || !r[0] || !r[1] || !r[2]) return [0, 0, 0];
    return [
        ((pos[0] - r[0][0]) / (r[0][1] - r[0][0]) * 2 - 1) * s[0],
        ((pos[1] - r[1][0]) / (r[1][1] - r[1][0]) * 2 - 1) * s[1],
        ((pos[2] - r[2][0]) / (r[2][1] - r[2][0]) * 2 - 1) * s[2],
    ];
}

// Convert a camera position/target from data-space to world-space using
// uniform normalization (largest half-span) so 2D scenes with a tiny z-range
// don't blow up the camera distance.
export function dataCameraToWorld(pos) {
    const r = state.currentRange;
    const s = state.currentScale;
    if (!r || !r[0] || !r[1] || !r[2]) return [0, 0, 0];
    const hx = (r[0][1] - r[0][0]) / 2;
    const hy = (r[1][1] - r[1][0]) / 2;
    const hz = (r[2][1] - r[2][0]) / 2;
    const maxH = Math.max(hx, hy, hz, 0.001);
    const cx = (r[0][0] + r[0][1]) / 2;
    const cy = (r[1][0] + r[1][1]) / 2;
    const cz = (r[2][0] + r[2][1]) / 2;
    return [
        (pos[0] - cx) / maxH * s[0],
        (pos[1] - cy) / maxH * s[1],
        (pos[2] - cz) / maxH * s[2],
    ];
}

// Inverse of dataCameraToWorld — convert world-space camera pos/target back
// to data-space values suitable for pasting into scene JSON.
export function worldCameraToData(pos) {
    const r = state.currentRange;
    const s = state.currentScale;
    if (!r || !r[0] || !r[1] || !r[2]) return [0, 0, 0];
    const hx = (r[0][1] - r[0][0]) / 2;
    const hy = (r[1][1] - r[1][0]) / 2;
    const hz = (r[2][1] - r[2][0]) / 2;
    const maxH = Math.max(hx, hy, hz, 0.001);
    const cx = (r[0][0] + r[0][1]) / 2;
    const cy = (r[1][0] + r[1][1]) / 2;
    const cz = (r[2][0] + r[2][1]) / 2;
    return [
        pos[0] * maxH / s[0] + cx,
        pos[1] * maxH / s[1] + cy,
        pos[2] * maxH / s[2] + cz,
    ];
}

// Convert a data-space length to world-space length (average across axes).
export function dataLenToWorld(len) {
    const r = state.currentRange;
    const s = state.currentScale;
    const sx = 2 * s[0] / (r[0][1] - r[0][0]);
    const sy = 2 * s[1] / (r[1][1] - r[1][0]);
    const sz = 2 * s[2] / (r[2][1] - r[2][0]);
    return len * (sx + sy + sz) / 3;
}
