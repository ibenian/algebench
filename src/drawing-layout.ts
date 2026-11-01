// The presenter's drawings (a beat's `draw`, an Excalidraw-like list of elements): where the shapes go and the
// strokes that draw them. Pure: presenter.ts measures, renders and has the pointer trace these strokes.
//
// Places are on a 0-100 grid across and down the drawing's box. A shape the model placed keeps its x and y; the
// others are placed by the layout: "tree" (parents above children, from the links), "row" (left to right), or,
// with none, in a row under the placed ones.

export interface DrawSpec {
    type: string;
    id?: string;
    label?: string;
    x?: number | null;
    y?: number | null;
    w?: number | null;
    h?: number | null;
    start?: string;
    end?: string;
    near?: string;
    color?: string;
}
export interface Drawing { layout?: string; elements: DrawSpec[] }
export interface Point { x: number; y: number }

export const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);
export const LINKS = new Set(['arrow', 'line']);
const placed = (e: DrawSpec) => typeof e.x === 'number' && typeof e.y === 'number';

/** The centre of every shape with an id, on the 0-100 grid. */
export function layoutShapes(elements: DrawSpec[], layout = ''): Map<string, Point> {
    const shapes = elements.filter(e => SHAPES.has(e.type) && e.id);
    const out = new Map<string, Point>();
    for (const e of shapes) if (placed(e)) out.set(e.id!, {x: e.x!, y: e.y!});
    const free = shapes.filter(e => !out.has(e.id!));
    if (!free.length) return out;
    if (layout === 'tree') {
        for (const [id, p] of treeLayout(free.map(e => e.id!), elements)) out.set(id, p);
        return out;
    }
    // A row: across the middle, or under the placed shapes when there are some.
    const y = out.size ? Math.min(90, Math.max(...[...out.values()].map(p => p.y)) + 25) : 50;
    free.forEach((e, i) => out.set(e.id!, {x: (i + .5) / free.length * 100, y}));
    return out;
}

/**
 * A tidy tree: the links (start -> end) among `ids` make parent -> child; the roots are the ids no link ends at, in
 * the order they were drawn. Leaves take the next slot across; a parent sits over the middle of its children; each
 * level is a row down.
 */
export function treeLayout(ids: string[], elements: DrawSpec[]): Map<string, Point> {
    const known = new Set(ids), children = new Map<string, string[]>(), parent = new Map<string, string>();
    for (const e of elements) {
        if (!LINKS.has(e.type) || !e.start || !e.end || !known.has(e.start) || !known.has(e.end)) continue;
        if (parent.has(e.end) || e.start === e.end) continue;
        parent.set(e.end, e.start);
        children.set(e.start, [...(children.get(e.start) ?? []), e.end]);
    }
    const slot = new Map<string, number>(), depth = new Map<string, number>();
    let leaves = 0, deepest = 0;
    const visit = (id: string, d: number, seen: Set<string>): number => {
        if (seen.has(id)) return slot.get(id) ?? 0;
        seen.add(id);depth.set(id, d);deepest = Math.max(deepest, d);
        const kids = (children.get(id) ?? []).filter(k => !seen.has(k));
        const at = kids.length ? kids.map(k => visit(k, d + 1, seen)).reduce((a, b) => a + b, 0) / kids.length : leaves++;
        slot.set(id, at);
        return at;
    };
    const seen = new Set<string>();
    for (const id of ids) if (!parent.has(id)) visit(id, 0, seen);
    for (const id of ids) if (!seen.has(id)) visit(id, 0, seen);   // a cycle: start it where it was drawn
    const out = new Map<string, Point>();
    for (const id of ids) out.set(id, {x: (slot.get(id)! + .5) / Math.max(1, leaves) * 100, y: (depth.get(id)! + .5) / (deepest + 1) * 100});
    return out;
}

/**
 * The stroke of a shape centred at (cx, cy), w by h, as a hand draws it: a box from its top left round and a little
 * past the corner, a circle from the top left once round and on, a diamond from its top point. `j` (-.5..5 each)
 * is the hand's wobble, kept so a redraw is the same stroke.
 */
export function shapeStroke(type: string, cx: number, cy: number, w: number, h: number, j: number[] = [0, 0, 0, 0]): string {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, k = (i: number) => (j[i] ?? 0) * 3;
    if (type === 'ellipse') {
        const rx = w / 2, ry = h / 2, at = (deg: number) => { const a = deg * Math.PI / 180;return `${cx + rx * Math.cos(a)} ${cy + ry * Math.sin(a)}`; };
        return `M${at(-120)} A${rx} ${ry} 0 1 1 ${at(60)} A${rx} ${ry} 0 0 1 ${at(-100)}`;
    }
    if (type === 'diamond') return `M${cx + k(0)} ${y0} L${x1} ${cy + k(1)} L${cx + k(2)} ${y1} L${x0} ${cy + k(3)} L${cx + 4} ${y0 + 2}`;
    return `M${x0 + k(0)} ${y0} L${x1} ${y0 + k(1)} L${x1 + k(2)} ${y1} L${x0} ${y1 + k(3)} L${x0} ${y0 - 3}`;
}

/** The point where the line from a box's centre towards `p` leaves the box (an ellipse's or diamond's own edge). */
export function edgePoint(type: string, cx: number, cy: number, w: number, h: number, p: Point, pad = 3): Point {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const rx = w / 2 + pad, ry = h / 2 + pad;
    let t: number;
    if (type === 'ellipse') t = 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2);
    else if (type === 'diamond') t = 1 / (Math.abs(ux) / rx + Math.abs(uy) / ry);
    else t = Math.min(Math.abs(ux) > 1e-9 ? rx / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? ry / Math.abs(uy) : Infinity);
    return {x: cx + ux * t, y: cy + uy * t};
}
