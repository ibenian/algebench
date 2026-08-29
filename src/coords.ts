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
const declaredScale = (): Vec3 => (state.declaredScale as Vec3);

// MathBox cartesian maps data range to [-scale, +scale] in world space.
/**
 * The `scale` a range implies when the scene does not choose one.
 *
 * `dataToWorld` normalises each axis by its OWN range onto [-1, 1] and then
 * multiplies by `scale[i]`, so `scale` IS the world half-extent of that axis.
 * A constant `[1, 1, 1]` therefore gives every axis the same world size however
 * many data units it spans — and a vector `(0,0,0) -> (5,1,0)` in a `[6, 2, 2]`
 * range is drawn at about 45° instead of 11°. Its direction is the one thing a
 * vector is for.
 *
 * Widths normalised by the LONGEST axis make one data unit the same distance
 * everywhere, so a circle is round, a right angle is square and a slope is the
 * slope it says — while keeping world coordinates in [-1, 1] as before. Raw
 * widths would not: a 2200-unit range would put the scene at ±2200 in world
 * space, which the camera transform and `getAbstractWidthScale` do not expect.
 *
 * This is the corpus's own isotropic convention where it chooses one — Cislunar
 * Scale has widths [1, 0.48, 0.16] and scale [1, 0.48, 0.16].
 *
 * A scene that WANTS anisotropy still says so: an explicit `scale` always wins.
 * That is a real editorial choice — a sine of amplitude 1 plotted over x ∈ [0,12]
 * is a nearly flat line rendered isotropically, so a graph legitimately stretches
 * its y axis to fill the frame.
 */
/**
 * Is this the legacy default rather than a decision?
 *
 * 37 of the 41 published scenes that "declare" a scale declare exactly
 * [1, 1, 1] — the pre-isotropy default written out — and 27 of those are
 * visibly distorted by it, including a unit circle drawn 2.8x taller than wide.
 * The 4 scenes that declare a genuinely different scale (artemis-ii, e.g.
 * [25, 12, 4] against widths [50, 24, 8]) are ALREADY isotropic at 1 world unit
 * per data unit. So nothing in the corpus wants the stretch, and a literal
 * [1, 1, 1] is far more likely to mean "never thought about it".
 *
 * Reading it as unspecified costs nothing elsewhere: the camera keeps its own
 * `declaredScale`, which is [1, 1, 1] for exactly these scenes either way.
 */
export function isDefaultScale(scale: unknown): boolean {
    return Array.isArray(scale) && scale.length === 3
        && scale.every((v) => Number(v) === 1);
}

export function isotropicScale(range: unknown): Vec3 {
    const fallback: Vec3 = [1, 1, 1];
    if (!Array.isArray(range) || range.length !== 3) return fallback;
    const widths = range.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) return NaN;
        return Number(pair[1]) - Number(pair[0]);
    });
    // A zero or negative width would scale that axis to nothing and collapse the
    // scene into a plane; a non-finite one poisons the whole ratio. `compose`
    // cannot produce either (MIN_EXTENT floors every width at 2) but a
    // hand-authored scene can, so this decides rather than propagates.
    if (!widths.every((w) => Number.isFinite(w) && w > 0)) return fallback;
    const longest = Math.max(...widths);
    return widths.map((w) => w / longest) as Vec3;
}

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
//
// The per-axis multiply uses the DECLARED scale, not the effective one. Under
// isotropy the two differ, and the effective scale would be wrong twice over:
// the uniform `maxH` above has already removed the aspect, so multiplying by
// w[i]/maxW puts it back — inverted. A 2D scene with range z ∈ [-1, 1] beside
// x ∈ [-10, 10] would pull a camera at z = 30 in by 10x, right through its own
// content. A scene that declared nothing gets [1, 1, 1] here, which makes this
// transform exact rather than approximate: isotropic `dataToWorld` maps every
// axis by the same 2/maxWidth, so the camera needs no per-axis correction.
export function dataCameraToWorld(pos: Vec3): Vec3 {
    const r = range();
    const s = declaredScale();
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
    const s = declaredScale();
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
