/**
 * Array cell links (an array's connectTo): a curve from each cell to the cell of another object it names,
 * e.g. a deque of indices to the values in `nums`. An array may connect to several objects; each target is
 * one link group with its own colour. The owning array evaluates the pairs on state changes (setCellLinks);
 * this module only projects and paints them, each frame, beside label wires. Like a label's wire, each array
 * has one pin toggle (just outside its right edge) for all its groups: pinned links always show; unpinned
 * ones show only while the toggle is hovered.
 */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { objectCellAnchor, objectWorldCorners } from '/object-anchor.js';
import { cellEdgeAnchor } from '/cell-attachment.js';
import { cellLinkCurve, cellArcCurve, arrowHeadPath, graphEdgeCurve, graphArcCurve } from '/label-wire-path.js';

/** One link group: every pair is [source cell, target cell in `to`]. */
/** One link group: every pair is [source cell, target cell in `to`]; `arrow` marks the target end. */
export interface CellLinkGroup {
    to: string; pairs: [number, number][]; color: string; arrow?: boolean;
    /** The links point at the whole of `to` (its outline), not at its cells: each pair's target index is ignored. */
    whole?: boolean;
    /** Per pair, from colorExpr / highlightExpr: its own colour, and whether it is lit (thicker, glowing). */
    styles?: ({color?: string; lit?: boolean; bend?: number; arcCentre?: number[]; port?: number; width?: number; label?: string} | null)[];
    /** Graph edges: how much they bow, as a fraction of their length. */
    bend?: number;
}
interface LinkSet { groups: CellLinkGroup[]; svg: SVGSVGElement | null; drawn: string; pinned: boolean; hovered: boolean; toggle: HTMLButtonElement | null }
const sets = new Map<string, LinkSet>();

/** Replace the links drawn from array `from`. `pinned` sets the toggle's first state only; the reader owns it after. */
export function setCellLinks(from: string, groups: CellLinkGroup[], pinned: boolean): void {
    const set = sets.get(from);
    if (set) set.groups = groups;
    else sets.set(from, { groups, svg: null, drawn: '', pinned, hovered: false, toggle: null });
}

/** Paint every link set; a set whose array left the scene is removed with its SVG. */
export function paintCellLinks(): void {
    const camera = state.camera, canvas = state.renderer?.domElement, container = document.getElementById('labels-container');
    for (const [from, set] of sets) {
        if (!state.elementRegistry?.[from]) { set.svg?.remove(); set.toggle?.remove(); sets.delete(from); continue; }
        if (!camera || !canvas || !container) continue;
        const rect = container.getBoundingClientRect(), viewport = canvas.getBoundingClientRect();
        const screen = (p: number[]) => {
            const v = new THREE.Vector3(...dataToWorld(p as [number, number, number])).project(camera);
            return { x: viewport.left - rect.left + (v.x * .5 + .5) * viewport.width, y: viewport.top - rect.top + (-v.y * .5 + .5) * viewport.height, z: v.z };
        };
        const paths: {d: string; color: string; head?: string; lit?: boolean; width?: number; label?: string}[] = [];
        let centre: {x: number; y: number} | null = null;   // a graph's centre, for which side its edges bow to
        let linked = false;
        // A whole object's outline, projected: its world bounds' corners.
        const outline = (name: string) => objectWorldCorners(name).map(v => {
            const q = v.clone().project(camera);
            return { x: viewport.left - rect.left + (q.x * .5 + .5) * viewport.width, y: viewport.top - rect.top + (-q.y * .5 + .5) * viewport.height, z: q.z };
        });
        for (const group of set.groups) group.pairs.forEach(([i, j], p) => {
            const a = objectCellAnchor(from, i);
            const wholeCorners = group.whole ? outline(group.to) : null;
            const b = group.whole ? (wholeCorners!.length ? {corners: [] as number[][], vertical: false, graph: false, round: false} : null) : objectCellAnchor(group.to, j);
            if (!a || !b) return;   // hidden array or out-of-range cell: no link
            const ac = a.corners.map(screen), bc = wholeCorners ?? b.corners.map(screen);
            if ([...ac, ...bc].some(q => q.z < -1 || q.z > 1)) return;
            linked = true;
            const mid = (c: {x: number; y: number}[]) => ({ x: c.reduce((s, p) => s + p.x, 0) / c.length, y: c.reduce((s, p) => s + p.y, 0) / c.length });
            const am = mid(ac), bm = mid(bc);
            // A cell's front face: where its tags sit. Under perspective the back face projects off to one side, so a
            // link that ends beside a stacked cell (a dict column, keys on the left) meets the front edge, where the key
            // tag touches the cell, not a point behind the tag.
            const front = (cell: {corners: number[][]}, c: typeof ac) => {
                const z = Math.max(...cell.corners.map(q => q[2] ?? 0));
                const f = c.filter((_, k) => (cell.corners[k]![2] ?? 0) >= z - 1e-9);
                return f.length ? f : c;
            };
            let curve: {d: string; arrive: {x: number; y: number}}, end: {x: number; y: number};
            if (group.whole) {
                // To a whole object: leave the cell along its array's axis, arrive at the outline's facing side.
                const start = a.vertical ? cellEdgeAnchor(front(a, ac), bm.x < am.x ? 'left' : 'right', 2) : cellEdgeAnchor(ac, bm.y < am.y ? 'top' : 'bottom', 2);
                const xs = bc.map(q => q.x), ys = bc.map(q => q.y);
                const across = Math.max(Math.min(...xs) - start.x, start.x - Math.max(...xs), 0) > Math.max(Math.min(...ys) - start.y, start.y - Math.max(...ys), 0);
                end = across ? cellEdgeAnchor(bc, start.x < bm.x ? 'left' : 'right', 4) : cellEdgeAnchor(bc, start.y < bm.y ? 'top' : 'bottom', 4);
                curve = cellLinkCurve(start, end, a.vertical ? 'h' : 'v', across ? 'h' : 'v');
            } else if (a.graph || b.graph) {
                // Graph nodes stand free: an edge runs from node edge to node edge, bowing away from the graph's centre.
                // A node's four corners come in order round its face, so they are its outline as drawn (poly).
                const box = (c: {x: number; y: number}[], m: {x: number; y: number}, round?: boolean) => ({ centre: m, round,
                    hw: (Math.max(...c.map(q => q.x)) - Math.min(...c.map(q => q.x))) / 2, hh: (Math.max(...c.map(q => q.y)) - Math.min(...c.map(q => q.y))) / 2,
                    ...(c.length === 4 ? {poly: c} : {}) });
                centre ??= graphCentre(from, screen) ?? am;
                // Per edge (from bendExpr / arcCenterExpr): an arc round a given centre, or a bow of its own.
                const route = group.styles?.[p];
                const port = route?.port !== undefined ? a.ports?.[route.port] : undefined;
                const edge = port
                    // From a port (a gap in a cell row) straight down to the top of the child, as a B-tree draws it.
                    ? (() => { const s = screen(port), e = {x: bm.x, y: Math.min(...bc.map(q => q.y)) - 2}; const c = cellLinkCurve(s, e, 'v', 'v'); return {...c, end: e}; })()
                    : route?.arcCentre
                    ? graphArcCurve(box(ac, am, a.round), box(bc, bm, b.round), screen(route.arcCentre))
                    : graphEdgeCurve(box(ac, am, a.round), box(bc, bm, b.round), route?.bend ?? group.bend ?? .12, centre);
                curve = edge; end = edge.end;
            } else if (group.to === from) {
                // Within one array: arch over the row for a forward link, under it for a backward one (a stack:
                // right or left), so the curve never crosses the cells between. Below a row it clears the index tags.
                const forward = j >= i;
                type Edge = 'top' | 'bottom' | 'left' | 'right';
                const [startEdge, endEdge, side]: [Edge, Edge, 'up' | 'down' | 'left' | 'right'] = a.vertical
                    ? (forward ? ['right', 'right', 'right'] : ['left', 'left', 'left'])
                    : (forward ? ['top', 'top', 'up'] : ['bottom', 'bottom', 'down']);
                const gap = !a.vertical && !forward ? 14 : 2;
                let start = cellEdgeAnchor(ac, startEdge, gap);
                end = cellEdgeAnchor(bc, endEdge, gap);
                if (i === j) {   // a cell naming itself: a small loop over its own edge
                    const w = (Math.max(...ac.map(p => p.x)) - Math.min(...ac.map(p => p.x))) * .25;
                    start = {x: start.x - (a.vertical ? 0 : w), y: start.y - (a.vertical ? w : 0)};
                    end = {x: end.x + (a.vertical ? 0 : w), y: end.y + (a.vertical ? w : 0)};
                }
                curve = cellArcCurve(start, end, side);
            } else {
                // Each end leaves along its own array's axis: a row's top or bottom edge, a stacked cell's side,
                // so a stack's link never runs up through the cells above it. A row's end clears its index tag.
                const start = a.vertical ? cellEdgeAnchor(front(a, ac), bm.x < am.x ? 'left' : 'right', 2) : cellEdgeAnchor(ac, bm.y < am.y ? 'top' : 'bottom', 2);
                end = b.vertical ? cellEdgeAnchor(front(b, bc), am.x < bm.x ? 'left' : 'right', 0) : cellEdgeAnchor(bc, am.y < bm.y ? 'top' : 'bottom', am.y > bm.y ? 14 : 2);
                curve = cellLinkCurve(start, end, a.vertical ? 'h' : 'v', b.vertical ? 'h' : 'v');
            }
            const style = group.styles?.[p];
            const width = style?.width;
            paths.push({ d: curve.d, color: style?.color || group.color, lit: !!style?.lit, ...(width ? {width} : {}), ...(style?.label ? {label: style.label} : {}),
                ...(group.arrow ? {head: arrowHeadPath(end, curve.arrive, Math.max(style?.lit ? 8 : 6, (width ?? 0) * 2.4))} : {}) });
        });
        paintToggle(set, container, linked ? outsideRight(from, screen) : null);
        const shown = set.pinned || set.hovered;
        const drawn = JSON.stringify(shown ? paths : []);
        if (!set.svg?.isConnected) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('cell-link-layer'); svg.setAttribute('aria-hidden', 'true');
            Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: '5' });
            container.append(svg); set.svg = svg; set.drawn = '';
        }
        if (drawn === set.drawn) continue;
        set.drawn = drawn;
        const labelled: {path: SVGPathElement; text: string; color: string}[] = [];
        set.svg!.replaceChildren(...(shown ? paths : []).flatMap(({d, color, head, lit, width, label}) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
            path.setAttribute('stroke-opacity', lit ? '1' : '.6'); path.setAttribute('stroke-width', String(width ?? (lit ? 3 : 1.4))); path.setAttribute('stroke-linecap', 'round');
            if (label) labelled.push({path, text: label, color});
            if (lit) path.style.filter = `drop-shadow(0 0 3px ${color})`;
            if (!head) return [path];
            const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            tip.setAttribute('d', head); tip.setAttribute('fill', color); tip.setAttribute('fill-opacity', lit ? '1' : '.8');
            return [path, tip];
        }));
        // Labels at each link's midpoint, once the paths are in the document to be measured: a small pill over the
        // line (dark, edged in the link's colour) so the text never sits on the stroke itself.
        for (const {path, text, color} of labelled) {
            const at = path.getPointAtLength(path.getTotalLength() / 2);
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', String(at.x)); t.setAttribute('y', String(at.y));
            t.setAttribute('class', 'cell-link-label');
            t.textContent = text;
            const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            pill.setAttribute('class', 'cell-link-label-pill'); pill.setAttribute('stroke', color);
            set.svg!.append(pill, t);
            const box = t.getBBox(), padX = 4, padY = 1.5;
            pill.setAttribute('x', String(box.x - padX)); pill.setAttribute('y', String(box.y - padY));
            pill.setAttribute('width', String(box.width + 2 * padX)); pill.setAttribute('height', String(box.height + 2 * padY));
            pill.setAttribute('rx', String((box.height + 2 * padY) / 2));
        }
    }
}

/** A graph's centre on screen: the mean of its node centres, read through its cell target. */
function graphCentre(name: string, screen: (p: number[]) => {x: number; y: number}): {x: number; y: number} | null {
    const pts: {x: number; y: number}[] = [];
    for (let i = 0; i < 256; i++) { const a = objectCellAnchor(name, i); if (!a) break; pts.push(screen(a.position)); }
    return pts.length ? {x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length} : null;
}

/** Just outside the object's right edge, clear of every cell and link: level with an array's rightmost cell,
 *  or at a graph's bottom-right corner (markers and labels sit above its nodes). */
function outsideRight(name: string, screen: (p: number[]) => {x: number; y: number}): {x: number; y: number} | null {
    let best: {x: number; y: number} | null = null, bottom = -Infinity, graph = false;
    for (let i = 0; i < 256; i++) {
        const a = objectCellAnchor(name, i); if (!a) break;
        const c = a.corners.map(screen), x = Math.max(...c.map(q => q.x));
        graph ||= !!a.graph; bottom = Math.max(bottom, ...c.map(q => q.y));
        if (!best || x > best.x + .5) best = {x, y: c.reduce((s, q) => s + q.y, 0) / c.length};
    }
    return best && {x: best.x + 6, y: graph ? bottom : best.y};
}

/** The set's pin toggle, built on first paint and kept just outside the source object's right edge. */
function paintToggle(set: LinkSet, container: HTMLElement, at: {x: number; y: number} | null): void {
    if (!set.toggle?.isConnected) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'expression-wire-toggle cell-link-toggle';
        const label = () => {
            button.setAttribute('aria-pressed', String(set.pinned));
            button.setAttribute('aria-label', set.pinned ? 'Unpin cell links' : 'Pin cell links');
            button.title = set.pinned ? 'Links pinned · click to show them only on hover' : 'Hover to show links · click to pin';
        };
        button.addEventListener('pointerdown', event => event.stopPropagation());
        button.addEventListener('click', event => { event.stopPropagation(); set.pinned = !set.pinned; label(); });
        button.addEventListener('pointerenter', () => { set.hovered = true; });
        button.addEventListener('pointerleave', () => { set.hovered = false; });
        label(); container.append(button); set.toggle = button;
    }
    const button = set.toggle!;
    if (!at) { if (button.style.display !== 'none') button.style.display = 'none'; return; }
    const style = `${Math.round(at.x)}px,${Math.round(at.y - 8)}px`;
    if (button.dataset.at !== style) { button.dataset.at = style; button.style.transform = `translate(${style})`; }
    if (button.style.display === 'none') button.style.display = '';
}
