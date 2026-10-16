/**
 * Array cell links (an array's connectTo): a curve from each cell to the cell of another object it names,
 * e.g. a deque of indices to the values in `nums`. An array may connect to several objects; each target is
 * one link group with its own colour. The owning array evaluates the pairs on state changes (setCellLinks);
 * this module only projects and paints them, each frame, beside label wires. Like a label's wire, each array
 * has one pin toggle (beside its last linked cell) for all its groups: pinned links always show; unpinned
 * ones show only while the toggle is hovered.
 */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { objectCellAnchor } from '/object-anchor.js';
import { cellEdgeAnchor } from '/cell-attachment.js';
import { cellLinkPath } from '/label-wire-path.js';

/** One link group: every pair is [source cell, target cell in `to`]. */
export interface CellLinkGroup { to: string; pairs: [number, number][]; color: string }
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
        const paths: {d: string; color: string}[] = [];
        let toggleAt: {x: number; y: number} | null = null, last = -1;
        for (const group of set.groups) for (const [i, j] of group.pairs) {
            const a = objectCellAnchor(from, i), b = objectCellAnchor(group.to, j);
            if (!a || !b) continue;   // hidden array or out-of-range cell: no link
            const ac = a.corners.map(screen), bc = b.corners.map(screen);
            if ([...ac, ...bc].some(p => p.z < -1 || p.z > 1)) continue;
            if (i > last) { last = i; toggleAt = { x: Math.max(...ac.map(p => p.x)) + 6, y: ac.reduce((sum, p) => sum + p.y, 0) / ac.length }; }
            const mid = (c: {x: number; y: number}[]) => ({ x: c.reduce((s, p) => s + p.x, 0) / c.length, y: c.reduce((s, p) => s + p.y, 0) / c.length });
            const am = mid(ac), bm = mid(bc);
            // Each end leaves along its own array's axis: a row's top or bottom edge, a stacked cell's side,
            // so a stack's link never runs up through the cells above it. A row's end clears its index tag.
            const start = a.vertical ? cellEdgeAnchor(ac, bm.x < am.x ? 'left' : 'right', 2) : cellEdgeAnchor(ac, bm.y < am.y ? 'top' : 'bottom', 2);
            const end = b.vertical ? cellEdgeAnchor(bc, am.x < bm.x ? 'left' : 'right', 2) : cellEdgeAnchor(bc, am.y < bm.y ? 'top' : 'bottom', am.y > bm.y ? 14 : 2);
            paths.push({ d: cellLinkPath(start, end, a.vertical ? 'h' : 'v', b.vertical ? 'h' : 'v'), color: group.color });
        }
        paintToggle(set, container, toggleAt);
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
        set.svg!.replaceChildren(...(shown ? paths : []).map(({d, color}) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
            path.setAttribute('stroke-opacity', '.6'); path.setAttribute('stroke-width', '1.4'); path.setAttribute('stroke-linecap', 'round');
            return path;
        }));
    }
}

/** The set's pin toggle, built on first paint and kept beside the source array's last linked cell. */
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
