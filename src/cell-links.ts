/**
 * Array cell links: a curve from each cell of one array to the cell of another object it names,
 * e.g. a deque of indices to the values in `nums`. The owning array evaluates the pairs on state
 * changes (setCellLinks); this module only projects and paints them, each frame, beside label wires.
 */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { objectCellAnchor } from '/object-anchor.js';
import { cellEdgeAnchor } from '/cell-attachment.js';
import { cellLinkPath } from '/label-wire-path.js';

interface LinkSet { to: string; pairs: [number, number][]; color: string; svg: SVGSVGElement | null; drawn: string }
const sets = new Map<string, LinkSet>();

/** Replace the links drawn from array `from`: each pair is [source cell, target cell in `to`]. */
export function setCellLinks(from: string, to: string, pairs: [number, number][], color: string): void {
    const set = sets.get(from);
    if (set) { set.to = to; set.pairs = pairs; set.color = color; }
    else sets.set(from, { to, pairs, color, svg: null, drawn: '' });
}

/** Paint every link set; a set whose array left the scene is removed with its SVG. */
export function paintCellLinks(): void {
    const camera = state.camera, canvas = state.renderer?.domElement, container = document.getElementById('labels-container');
    for (const [from, set] of sets) {
        if (!state.elementRegistry?.[from]) { set.svg?.remove(); sets.delete(from); continue; }
        if (!camera || !canvas || !container) continue;
        const rect = container.getBoundingClientRect(), viewport = canvas.getBoundingClientRect();
        const screen = (p: number[]) => {
            const v = new THREE.Vector3(...dataToWorld(p as [number, number, number])).project(camera);
            return { x: viewport.left - rect.left + (v.x * .5 + .5) * viewport.width, y: viewport.top - rect.top + (-v.y * .5 + .5) * viewport.height, z: v.z };
        };
        const paths: string[] = [];
        for (const [i, j] of set.pairs) {
            const a = objectCellAnchor(from, i), b = objectCellAnchor(set.to, j);
            if (!a || !b) continue;   // hidden array or out-of-range cell: no link
            const ac = a.corners.map(screen), bc = b.corners.map(screen);
            if ([...ac, ...bc].some(p => p.z < -1 || p.z > 1)) continue;
            const targetAbove = Math.min(...bc.map(p => p.y)) < Math.min(...ac.map(p => p.y));
            // Leave the near edge of the source cell; land on the target's near edge, clear of its index tag.
            const start = cellEdgeAnchor(ac, targetAbove ? 'top' : 'bottom', 2);
            const end = cellEdgeAnchor(bc, targetAbove ? 'bottom' : 'top', targetAbove ? 14 : 2);
            paths.push(cellLinkPath(start, end));
        }
        const drawn = JSON.stringify([paths, set.color]);
        if (!set.svg?.isConnected) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('cell-link-layer'); svg.setAttribute('aria-hidden', 'true');
            Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: '5' });
            container.append(svg); set.svg = svg; set.drawn = '';
        }
        if (drawn === set.drawn) continue;
        set.drawn = drawn;
        set.svg!.replaceChildren(...paths.map(d => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', set.color);
            path.setAttribute('stroke-opacity', '.6'); path.setAttribute('stroke-width', '1.4'); path.setAttribute('stroke-linecap', 'round');
            return path;
        }));
    }
}
