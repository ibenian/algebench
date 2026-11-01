// The presenter's drawings (a beat's `draw`, an Excalidraw-like list of elements): where the shapes go and the
// strokes that draw them. Pure: presenter.ts measures, renders and has the pointer trace these strokes.
//
// Places are relative: a drawing is groups of shapes (rows, columns, trees, flows, free pictures), each group placed
// by the one it sits in and sized by what is in it, so nothing is measured by the model.

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
    /** For an arrow: "end" (the default), "start", "both" or "none". */
    heads?: string;
    near?: string;
    color?: string;
    points?: number[][];
    closed?: boolean;
    /** The group it sits in. */
    group?: string;
    /** For an "outline": the ids it is drawn around, a contour fitted to them, not laid out. */
    around?: string[];
    /** For a group: how it arranges what is in it, and how it lines them up across. */
    layout?: string;
    align?: string;
}
export interface Drawing { layout?: string; elements: DrawSpec[] }
export interface Point { x: number; y: number }

export const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);
export const LINKS = new Set(['arrow', 'line']);
export const LAYOUTS = new Set(['row', 'column', 'grid', 'cells', 'tree', 'flow', 'graph', 'free']);
const placed = (e: DrawSpec) => typeof e.x === 'number' && typeof e.y === 'number';

export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
/**
 * The board's size in px, and a shape's size within a box (its w and h are on that box's grid). Without, a box is
 * 600 by 400 and a shape 40 by 30.
 */
export interface Measure { box: Size; sizeOf: (e: DrawSpec, within: Size) => Size }
const GAP = 28;
const guess: Measure = {box: {w: 600, h: 400}, sizeOf: () => ({w: 40, h: 30})};

/**
 * What a layout places: shapes, groups, and text on its own. Text `near` something goes beside that instead, and a
 * an "outline" is drawn round what it picks out.
 */
const isNode = (e: DrawSpec) => SHAPES.has(e.type) || e.type === 'group' || (e.type === 'text' && !e.near);

export interface Laid {
    /** Each placed element's box, in px of the drawing's own space (top left at 0, 0). */
    boxes: Map<DrawSpec, Rect>;
    /** The whole drawing's box: scaled to fit the board by the caller when it's bigger. */
    w: number; h: number;
}

/**
 * Lay a drawing out. Every element sits in a group (`group`, a group's id) or in the drawing itself, the outermost
 * group, whose layout is `layout`. A group arranges what is in it: "row", "column", "grid", "tree" (top down, from
 * the links), "flow" (left to right, from the links), "graph" (any graph, cycles too: linked things pulled
 * together, all of them pushed apart) or "free" (each at its own x and y, 0 to 100 across and down
 * the group's box). Its size comes from what is in it (a free group's from its w and h), and its place from the
 * group it is in: so places are always relative, and nothing is measured by the model. With no layout, a group
 * whose things are linked is a flow, one with things given places is free, any other a row.
 */
export function layoutDrawing(elements: DrawSpec[], layout = '', m: Measure = guess): Laid {
    const nodes = elements.filter(isNode);
    const groups = new Map(nodes.filter(e => e.type === 'group' && e.id).map(e => [e.id!, e]));
    const byId = new Map(nodes.filter(e => e.id).map(e => [e.id!, e]));
    // Each node's group (null: the drawing), never one inside itself.
    const parent = new Map<DrawSpec, DrawSpec | null>();
    for (const e of nodes) {
        let g = e.group ? groups.get(e.group) ?? null : null;
        for (let up = g, i = 0; up && i < 50; up = up.group ? groups.get(up.group) ?? null : null, i++) if (up === e) { g = null;break; }
        parent.set(e, g);
    }
    const kids = (g: DrawSpec | null) => nodes.filter(e => parent.get(e) === g);
    // A link's end, as the one of `among` it is in (itself or a group holding it).
    const holder = (id: string | undefined, among: Set<DrawSpec>): DrawSpec | null => {
        for (let e = id ? byId.get(id) ?? null : null, i = 0; e && i < 50; e = parent.get(e) ?? null, i++) if (among.has(e)) return e;
        return null;
    };
    const linksAmong = (among: DrawSpec[]): [DrawSpec, DrawSpec][] => {
        const set = new Set(among), seen = new Set<string>(), out: [DrawSpec, DrawSpec][] = [];
        for (const l of elements) {
            if (!LINKS.has(l.type)) continue;
            const a = holder(l.start, set), z = holder(l.end, set);
            if (!a || !z || a === z) continue;
            const k = `${among.indexOf(a)}>${among.indexOf(z)}`;
            if (!seen.has(k)) { seen.add(k);out.push([a, z]); }
        }
        return out;
    };

    const local = new Map<DrawSpec, Rect>();      // each node's box within its group
    const sizes = new Map<DrawSpec, Size>();
    const freeBox = (g: DrawSpec | null): Size => g ? {w: (g.w ?? 50) / 100 * m.box.w, h: (g.h ?? 50) / 100 * m.box.h} : m.box;
    const kindOf = (g: DrawSpec | null, inside: DrawSpec[]): string => {
        const asked = g ? g.layout ?? '' : layout;
        // Linked things are a diagram, never placed by hand: "free" is for pictures only.
        if (asked === 'free' && linksAmong(inside).length) return 'flow';
        if (LAYOUTS.has(asked)) return asked;
        if (linksAmong(inside).length) return 'flow';
        return inside.some(placed) ? 'free' : 'row';
    };
    const measure = (g: DrawSpec | null): Size => {
        const inside = kids(g), kind = kindOf(g, inside);
        const within = kind === 'free' ? freeBox(g) : m.box;
        for (const e of inside) sizes.set(e, e.type === 'group' ? measure(e) : m.sizeOf(e, within));
        const size = (e: DrawSpec) => sizes.get(e)!;
        let at: Map<DrawSpec, Point>, span: Size, resized: Map<DrawSpec, Size> | undefined;
        if (kind === 'free') {
            at = new Map(inside.map(e => [e, {x: (e.x ?? 50) / 100 * within.w, y: (e.y ?? 50) / 100 * within.h}]));
            span = within;
        } else if (kind === 'tree') ({at, span} = treePx(inside, linksAmong(inside), size));
        else if (kind === 'flow') ({at, span} = flowPx(inside, linksAmong(inside), size));
        else if (kind === 'graph') ({at, span} = graphPx(inside, linksAmong(inside), size));
        else if (kind === 'cells') ({at, span, resized} = cellsPx(inside, size));
        else ({at, span} = linePx(inside, kind, size, g?.align ?? 'center'));
        for (const e of inside) { const c = at.get(e)!, s = resized?.get(e) ?? size(e);local.set(e, {x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h}); }
        return span;
    };
    const whole = measure(null);
    // Down from the drawing: a box's place is its group's place plus its place in the group.
    const boxes = new Map<DrawSpec, Rect>();
    const place = (g: DrawSpec | null, ox: number, oy: number) => {
        for (const e of kids(g)) {
            const l = local.get(e)!, r = {x: ox + l.x, y: oy + l.y, w: l.w, h: l.h};
            boxes.set(e, r);
            if (e.type === 'group') place(e, r.x, r.y);
        }
    };
    place(null, 0, 0);
    return {boxes, w: whole.w, h: whole.h};
}

/**
 * An array's cells: side by side with no gap, all as wide and tall as the widest and tallest, so they read as one
 * row of boxes; words (its name) stand before them with a gap.
 */
function cellsPx(items: DrawSpec[], size: (e: DrawSpec) => Size) {
    const at = new Map<DrawSpec, Point>(), resized = new Map<DrawSpec, Size>();
    const cells = items.filter(e => SHAPES.has(e.type));
    const cw = Math.max(34, ...cells.map(e => size(e).w)), ch = Math.max(30, ...cells.map(e => size(e).h));
    let x = 0;
    for (const e of items) {
        if (SHAPES.has(e.type)) { at.set(e, {x: x + cw / 2, y: ch / 2});resized.set(e, {w: cw, h: ch});x += cw;continue; }
        const s = size(e);
        at.set(e, {x: x + s.w / 2, y: ch / 2});x += s.w + GAP * .5;
    }
    return {at, span: {w: x, h: ch}, resized};
}
/** Side by side ("row"), one under another ("column"), or in a square-ish grid; lined up by `align` across. */
function linePx(items: DrawSpec[], kind: string, size: (e: DrawSpec) => Size, align: string) {
    const at = new Map<DrawSpec, Point>();
    if (!items.length) return {at, span: {w: 0, h: 0}};
    if (kind === 'grid') {
        const cols = Math.ceil(Math.sqrt(items.length)), cw = Math.max(...items.map(e => size(e).w)), ch = Math.max(...items.map(e => size(e).h));
        items.forEach((e, i) => at.set(e, {x: (i % cols) * (cw + GAP) + cw / 2, y: Math.floor(i / cols) * (ch + GAP) + ch / 2}));
        const rows = Math.ceil(items.length / cols);
        return {at, span: {w: cols * cw + (cols - 1) * GAP, h: rows * ch + (rows - 1) * GAP}};
    }
    const across = kind === 'column';
    const along = (s: Size) => across ? s.h : s.w, cross = (s: Size) => across ? s.w : s.h;
    const thick = Math.max(...items.map(e => cross(size(e))));
    let run = 0;
    for (const e of items) {
        const s = size(e), c = align === 'start' ? cross(s) / 2 : align === 'end' ? thick - cross(s) / 2 : thick / 2;
        const p = run + along(s) / 2;
        at.set(e, across ? {x: c, y: p} : {x: p, y: c});
        run += along(s) + GAP;
    }
    run -= GAP;
    return {at, span: across ? {w: thick, h: run} : {w: run, h: thick}};
}

/**
 * A tidy tree from the links (parent -> child); the roots are what no link ends at, in drawing order. Leaves go
 * across side by side, each as wide as it is; a parent sits over the middle of its children; a level per row.
 */
function treePx(items: DrawSpec[], links: [DrawSpec, DrawSpec][], size: (e: DrawSpec) => Size) {
    const children = new Map<DrawSpec, DrawSpec[]>(), parent = new Map<DrawSpec, DrawSpec>();
    for (const [a, z] of links) {
        if (parent.has(z)) continue;
        parent.set(z, a);
        children.set(a, [...(children.get(a) ?? []), z]);
    }
    const cx = new Map<DrawSpec, number>(), depth = new Map<DrawSpec, number>(), rowH: number[] = [];
    let cursor = 0;
    const visit = (e: DrawSpec, d: number, seen: Set<DrawSpec>): number => {
        if (seen.has(e)) return cx.get(e) ?? 0;
        seen.add(e);depth.set(e, d);rowH[d] = Math.max(rowH[d] ?? 0, size(e).h);
        const ks = (children.get(e) ?? []).filter(k => !seen.has(k));
        let at: number;
        if (ks.length) {
            const xs = ks.map(k => visit(k, d + 1, seen));
            at = (Math.min(...xs) + Math.max(...xs)) / 2;
            cursor = Math.max(cursor, at + size(e).w / 2 + GAP);
        } else {
            at = cursor + size(e).w / 2;cursor += size(e).w + GAP;
        }
        cx.set(e, at);
        return at;
    };
    const seen = new Set<DrawSpec>();
    for (const e of items) if (!parent.has(e)) visit(e, 0, seen);
    for (const e of items) if (!seen.has(e)) visit(e, 0, seen);   // a cycle: start it where it was drawn
    const rowY: number[] = [], vgap = GAP * 1.6;
    let y = 0;
    for (const h of rowH) { rowY.push(y + h / 2);y += h + vgap; }
    const at = new Map<DrawSpec, Point>();
    for (const e of items) at.set(e, {x: cx.get(e)!, y: rowY[depth.get(e)!]!});
    return {at, span: {w: Math.max(0, cursor - GAP), h: Math.max(0, y - vgap)}};
}

/**
 * Any graph, cycles and all: a force layout. Things start round a circle (in drawing order, so the same graph is
 * always drawn the same way); every pair pushes apart, every link pulls its two ends to a rest length; then the
 * boxes still touching are pushed clear of each other, measured as they are.
 */
function graphPx(items: DrawSpec[], links: [DrawSpec, DrawSpec][], size: (e: DrawSpec) => Size) {
    const n = items.length, at = new Map<DrawSpec, Point>();
    if (!n) return {at, span: {w: 0, h: 0}};
    const sz = items.map(size), idx = new Map(items.map((e, i) => [e, i]));
    const avg = sz.reduce((a, s) => a + Math.max(s.w, s.h), 0) / n, rest = avg + GAP * 2.2;
    const r0 = Math.max(rest, rest * n / (2 * Math.PI));
    const p = items.map((_, i) => ({x: r0 * Math.cos(2 * Math.PI * i / n - Math.PI / 2), y: r0 * Math.sin(2 * Math.PI * i / n - Math.PI / 2)}));
    const edges = links.map(([a, z]) => [idx.get(a)!, idx.get(z)!] as const);
    for (let it = 0, heat = rest; it < 300; it++, heat *= .985) {
        const f = p.map(() => ({x: 0, y: 0}));
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            let dx = p[i]!.x - p[j]!.x, dy = p[i]!.y - p[j]!.y;
            if (!dx && !dy) { dx = .1 * (i - j);dy = .1; }
            const d = Math.hypot(dx, dy), push = rest * rest / d;
            f[i]!.x += dx / d * push;f[i]!.y += dy / d * push;f[j]!.x -= dx / d * push;f[j]!.y -= dy / d * push;
        }
        for (const [i, j] of edges) {
            const dx = p[j]!.x - p[i]!.x, dy = p[j]!.y - p[i]!.y, d = Math.hypot(dx, dy) || 1, pull = d * d / rest;
            f[i]!.x += dx / d * pull;f[i]!.y += dy / d * pull;f[j]!.x -= dx / d * pull;f[j]!.y -= dy / d * pull;
        }
        for (let i = 0; i < n; i++) {
            const m = Math.hypot(f[i]!.x, f[i]!.y) || 1, step = Math.min(m, heat);
            p[i]!.x += f[i]!.x / m * step;p[i]!.y += f[i]!.y / m * step;
        }
    }
    // Boxes, not points: push apart any two that still overlap (with a gap), along the shorter way out.
    for (let pass = 0; pass < 60; pass++) {
        let moved = false;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const ox = (sz[i]!.w + sz[j]!.w) / 2 + GAP * .8 - Math.abs(p[i]!.x - p[j]!.x);
            const oy = (sz[i]!.h + sz[j]!.h) / 2 + GAP * .8 - Math.abs(p[i]!.y - p[j]!.y);
            if (ox <= 0 || oy <= 0) continue;
            moved = true;
            if (ox < oy) { const s = (p[i]!.x < p[j]!.x ? -1 : 1) * ox / 2;p[i]!.x += s;p[j]!.x -= s; }
            else { const s = (p[i]!.y < p[j]!.y ? -1 : 1) * oy / 2;p[i]!.y += s;p[j]!.y -= s; }
        }
        if (!moved) break;
    }
    const x0 = Math.min(...p.map((q, i) => q.x - sz[i]!.w / 2)), y0 = Math.min(...p.map((q, i) => q.y - sz[i]!.h / 2));
    const x1 = Math.max(...p.map((q, i) => q.x + sz[i]!.w / 2)), y1 = Math.max(...p.map((q, i) => q.y + sz[i]!.h / 2));
    items.forEach((e, i) => at.set(e, {x: p[i]!.x - x0, y: p[i]!.y - y0}));
    return {at, span: {w: x1 - x0, h: y1 - y0}};
}

/** A flow left to right: each a column after what leads to it (the longest way in), a column stacked in the order of what leads to it. */
function flowPx(items: DrawSpec[], links: [DrawSpec, DrawSpec][], size: (e: DrawSpec) => Size) {
    const ins = new Map<DrawSpec, DrawSpec[]>(items.map(e => [e, []]));
    for (const [a, z] of links) ins.get(z)!.push(a);
    const rank = new Map<DrawSpec, number>();
    const rankOf = (e: DrawSpec, path: Set<DrawSpec>): number => {
        if (rank.has(e)) return rank.get(e)!;
        if (path.has(e)) return 0;                                   // a cycle: cut it here
        path.add(e);
        const r = Math.max(-1, ...ins.get(e)!.map(p => rankOf(p, path))) + 1;
        path.delete(e);rank.set(e, r);
        return r;
    };
    for (const e of items) rankOf(e, new Set());
    const cols: DrawSpec[][] = [];
    for (const e of items) (cols[rank.get(e)!] ??= []).push(e);
    const order = new Map<DrawSpec, number>();
    for (const col of cols) {
        if (!col) continue;
        const key = (e: DrawSpec) => { const ps = ins.get(e)!.filter(p => order.has(p));return ps.length ? ps.reduce((a, p) => a + order.get(p)!, 0) / ps.length : Infinity; };
        col.sort((a, b) => key(a) - key(b) || items.indexOf(a) - items.indexOf(b));
        col.forEach((e, i) => order.set(e, i));
    }
    const full = cols.filter(Boolean);
    const heights = full.map(col => col.reduce((a, e) => a + size(e).h, 0) + GAP * (col.length - 1));
    const tall = Math.max(0, ...heights), hgap = GAP * 1.4;
    const at = new Map<DrawSpec, Point>();
    let x = 0;
    full.forEach((col, c) => {
        const w = Math.max(...col.map(e => size(e).w));
        let y = (tall - heights[c]!) / 2;
        for (const e of col) { const s = size(e);at.set(e, {x: x + w / 2, y: y + s.h / 2});y += s.h + GAP; }
        x += w + hgap;
    });
    return {at, span: {w: Math.max(0, x - hgap), h: tall}};
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

/**
 * A free stroke through `pts` as one smooth curve (Catmull-Rom, as cubic Béziers): it passes through every point,
 * bending between them as a hand does. `closed` carries on from the last point round to the first.
 */
export function smoothPath(pts: Point[], closed = false): string {
    if (pts.length < 2) return '';
    const n = pts.length, at = (i: number): Point => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])!;
    const f = (v: number) => +v.toFixed(2);
    let d = `M${f(at(0).x)} ${f(at(0).y)}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        d += ` C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
    }
    return d;
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

/**
 * A contour round `boxes`: the convex hull of their corners, each rounded off `pad` out, as the points of a closed
 * stroke (smoothPath draws it). It holds just them, never what lies beside them.
 */
export function hullAround(boxes: Rect[], pad = 12): Point[] {
    const pts: Point[] = [];
    for (const b of boxes) for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as const)
        for (let k = 0; k < 8; k++) pts.push({x: cx + pad * Math.cos(k * Math.PI / 4), y: cy + pad * Math.sin(k * Math.PI / 4)});
    if (pts.length < 3) return pts;
    // Monotone chain.
    pts.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (list: Point[]) => {
        const h: Point[] = [];
        for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop();h.push(p); }
        h.pop();
        return h;
    };
    const hull = [...half(pts), ...half([...pts].reverse())];
    // Fewer, evener points for a hand's stroke: drop those closer than a few px to the last kept.
    const out: Point[] = [];
    for (const p of hull) if (!out.length || Math.hypot(p.x - out[out.length - 1]!.x, p.y - out[out.length - 1]!.y) > 6) out.push(p);
    return out;
}
