/** Pure framing maths for camera focus mode: what box to show, and whether the camera must move. */
export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3; }
/** The camera's orthonormal viewing basis (world): right, up, and forward (towards the target). */
export interface Basis { right: Vec3; up: Vec3; forward: Vec3; }
export interface Frame { center: Vec3; distance: number; }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The smallest box containing every given box; null when there are none. */
export function unionBoxes(boxes: Array<Box | null | undefined>): Box | null {
    let out: Box | null = null;
    for (const b of boxes) {
        if (!b) continue;
        out = out ? { min: [0, 1, 2].map(i => Math.min(out!.min[i]!, b.min[i]!)) as Vec3, max: [0, 1, 2].map(i => Math.max(out!.max[i]!, b.max[i]!)) as Vec3 }
                  : { min: [...b.min] as Vec3, max: [...b.max] as Vec3 };
    }
    return out;
}

/** The box around a set of points, padded by `pad` on every side; null for no points. */
export function boxOfPoints(points: Vec3[], pad = 0): Box | null {
    if (!points.length) return null;
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]! - pad); max[i] = Math.max(max[i]!, p[i]! + pad); }
    return { min, max };
}

function corners(box: Box): Vec3[] {
    const out: Vec3[] = [];
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
    return out;
}

export interface FitOptions {
    /** Extra room around the box, as a fraction of its size (0.3 = 30%). */
    margin: number;
    /** Never frame less than this half-height (world units): keeps context, avoids zooming onto one cell. */
    minHalfHeight: number;
    /** Never move further away than this. */
    maxDistance: number;
}

/**
 * Where to look and how far away, keeping the current viewing direction: the box centre, at the distance
 * that fits the box (plus margin) in a perspective view with vertical field of view `fovY` (radians).
 */
export function fitBox(box: Box, basis: Basis, fovY: number, aspect: number, opts: FitOptions): Frame {
    const center: Vec3 = [0, 1, 2].map(i => (box.min[i]! + box.max[i]!) / 2) as Vec3;
    let hw = 0, hh = 0, hd = 0;
    for (const c of corners(box)) {
        const r = sub(c, center);
        hw = Math.max(hw, Math.abs(dot(r, basis.right)));
        hh = Math.max(hh, Math.abs(dot(r, basis.up)));
        hd = Math.max(hd, Math.abs(dot(r, basis.forward)));
    }
    const half = Math.max(hh, hw / Math.max(aspect, 1e-6), opts.minHalfHeight) * (1 + opts.margin);
    const distance = Math.min(opts.maxDistance, half / Math.tan(fovY / 2) + hd);
    return { center, distance };
}

/**
 * Hysteresis, so the camera stays put unless it has a reason to move: it refocuses when part of the box
 * falls outside the central `inner` share of the current view, or when the fitted distance differs from
 * the current one by more than the factor `zoom` either way (the changes became small on screen, or too big).
 */
export function needsRefocus(target: Vec3, distance: number, next: Frame, box: Box, basis: Basis, fovY: number, aspect: number,
                             inner = 0.85, zoom = 1.25): boolean {
    const t = Math.tan(fovY / 2);
    for (const c of corners(box)) {
        const r = sub(c, target);
        const depth = Math.max(1e-6, distance + dot(r, basis.forward));
        const vh = depth * t * inner;
        if (Math.abs(dot(r, basis.up)) > vh || Math.abs(dot(r, basis.right)) > vh * aspect) return true;
    }
    return next.distance < distance / zoom || next.distance > distance * zoom;
}
