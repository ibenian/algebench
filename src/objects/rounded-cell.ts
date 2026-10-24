/**
 * A rounded-rectangle cell, as unit geometry for the array's per-cell scaling: a prism over the rounded outline
 * of a w × h cell (corner radius r), with x and y divided by w and h and z running −½…½, so scaling it back by
 * the cell's size gives true round corners. Non-indexed triangles: the front and back caps fanned from the
 * centre, and a wall quad per outline edge, each with its face normal (the array shades by normal).
 */
/** Outline of one node in data units, centred on (x, y): a circle, or a rectangle with rounded corners. */
export function nodeOutline(shape: 'point' | 'rect', w: number, h: number, radius: number, segments = 24): [number, number][] {
    if (shape === 'point') return Array.from({length: segments}, (_, k) => {
        const a = 2 * Math.PI * k / segments; return [Math.cos(a) * w / 2, Math.sin(a) * w / 2];
    });
    const r = Math.min(radius, w / 2, h / 2), pts: [number, number][] = [];
    const corners: [number, number, number][] = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, 1.5 * Math.PI]];
    for (const [cx, cy, a0] of corners) {
        const steps = r > 0 ? 6 : 0;
        for (let s = 0; s <= steps; s++) { const a = a0 + (Math.PI / 2) * s / Math.max(steps, 1); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    }
    return pts;
}


export function roundedCellUnit(w: number, h: number, r: number): {positions: number[]; normals: number[]} {
    const outline = nodeOutline('rect', w, h, r).map(([x, y]) => [x / w, y / h] as const);
    const positions: number[] = [], normals: number[] = [];
    const tri = (a: number[], b: number[], c: number[], n: number[]) => { positions.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) normals.push(...n); };
    outline.forEach(([x0, y0], k) => {
        const [x1, y1] = outline[(k + 1) % outline.length]!;
        tri([0, 0, .5], [x0, y0, .5], [x1, y1, .5], [0, 0, 1]);        // front, counter-clockwise
        tri([0, 0, -.5], [x1, y1, -.5], [x0, y0, -.5], [0, 0, -1]);    // back
        // The wall faces outward: the outline runs counter-clockwise, so its outward normal is (dy, −dx).
        const dx = (x1 - x0) * w, dy = (y1 - y0) * h, len = Math.hypot(dx, dy) || 1, n = [dy / len, -dx / len, 0];
        tri([x0, y0, .5], [x0, y0, -.5], [x1, y1, -.5], n);
        tri([x0, y0, .5], [x1, y1, -.5], [x1, y1, .5], n);
    });
    return {positions, normals};
}
