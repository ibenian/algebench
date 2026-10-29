/**
 * Draws an execution tree (exec-tree.ts) as a top-down node-link diagram: calls as boxes written as the code
 * writes them, loops as pills with their iteration count, the node executing now lit, the ones that finished
 * paler. Each leaf takes a column and a parent sits over its children, so the width is the work fanning out.
 */
import type { ExecTree, ExecNode } from '/exec-tree.js';

const ROW = 46, H = 22, PAD = 10, CHAR = 6.4;
const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

/** Each node's column centre: leaves in order, a parent over the middle of its children. */
function columns(tree: ExecTree): Map<number, number> {
    const x = new Map<number, number>();
    let next = 0;
    const place = (id: number): number => {
        const n = tree.nodes[id]!;
        const at = n.children.length ? n.children.map(place).reduce((a, b) => a + b, 0) / n.children.length : next++;
        x.set(id, at);
        return at;
    };
    for (const n of tree.nodes) if (n.parent == null) place(n.id);
    return x;
}

const short = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
/**
 * A loop by what it walks: `for i, num` (its variables), `while k` (a short condition, else just `while`); the
 * whole header is in its tooltip.
 */
export function loopName(header: string): string {
    const each = /^for\s+(.+?)\s+in\b/.exec(header);
    if (each) return `for ${short(each[1]!, 10)}`;
    const cond = /^while\s+(.+)$/.exec(header)?.[1] ?? '';
    return cond && cond.length <= 10 ? `while ${cond}` : 'while';
}
function text(n: ExecNode): string {
    return n.kind === 'call' ? short(n.label, 22) : `↻ ${loopName(n.label)} ×${n.iterations}`;
}

/** Draw the tree into host; the node executing now is scrolled into view. `fresh` is the frame being shown. */
/**
 * The scrolling view under the summary, kept across redraws (so a pan stays where the reader left it) and
 * dragged with the mouse to pan.
 */
function scrollerOf(host: HTMLElement): HTMLDivElement {
    let scroller = host.querySelector<HTMLDivElement>(':scope > .exec-tree-scroll');
    if (scroller) return scroller;
    scroller = document.createElement('div');scroller.className = 'exec-tree-scroll';
    scroller.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const s = scroller!, x0 = e.clientX, y0 = e.clientY, left = s.scrollLeft, top = s.scrollTop;
        s.setPointerCapture(e.pointerId);s.classList.add('panning');
        const move = (ev: PointerEvent) => { s.scrollLeft = left - (ev.clientX - x0);s.scrollTop = top - (ev.clientY - y0); };
        const up = () => { s.removeEventListener('pointermove', move);s.classList.remove('panning'); };
        s.addEventListener('pointermove', move);
        s.addEventListener('pointerup', up, {once: true});s.addEventListener('pointercancel', up, {once: true});
    });
    return scroller;
}

export function drawExecTree(host: HTMLElement, tree: ExecTree, frame: number): void {
    const scroller = scrollerOf(host);
    host.replaceChildren();
    const summary = document.createElement('div');summary.className = 'exec-tree-summary';
    summary.textContent = tree.nodes.length
        ? `${tree.calls} call${tree.calls === 1 ? '' : 's'} · ${tree.iterations} loop iteration${tree.iterations === 1 ? '' : 's'} · depth ${tree.maxDepth}`
        : 'No recorded run at this step.';
    host.append(summary);
    if (!tree.nodes.length) { scroller.replaceChildren();return; }
    const x = columns(tree);
    // One column width for all, wide enough for the longest label.
    const COL = Math.max(64, Math.max(...tree.nodes.map(n => text(n).length)) * CHAR + 18);
    const width = (Math.max(...x.values()) + 1) * COL + PAD * 2, height = (Math.max(...tree.nodes.map(n => n.depth)) + 1) * ROW + PAD;
    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'exec-tree-svg', role: 'img', 'aria-label': summary.textContent });
    const cx = (id: number) => PAD + x.get(id)! * COL + COL / 2, cy = (n: ExecNode) => PAD + n.depth * ROW + H / 2;
    for (const n of tree.nodes) if (n.parent != null) {
        const p = tree.nodes[n.parent]!;
        root.append(svg('path', { class: 'exec-tree-edge', d: `M${cx(p.id)},${cy(p) + H / 2} C${cx(p.id)},${cy(p) + ROW / 2} ${cx(n.id)},${cy(n) - ROW / 2} ${cx(n.id)},${cy(n) - H / 2}` }));
    }
    let current: SVGGElement | null = null;
    for (const n of tree.nodes) {
        const g = svg('g', { class: `exec-tree-node exec-tree-${n.kind}${n.done ? ' done' : ''}${n.id === tree.current ? ' current' : ''}${n.frame === frame ? ' fresh' : ''}`,
            transform: `translate(${cx(n.id)},${cy(n)})` });
        const w = COL - 8;
        g.append(svg('rect', { x: -w / 2, y: -H / 2, width: w, height: H, rx: n.kind === 'loop' ? H / 2 : 5 }));
        const label = svg('text', { 'text-anchor': 'middle', dy: '0.35em' });label.textContent = text(n);
        const tip = svg('title', {});
        tip.textContent = n.kind === 'call'
            ? `${n.label}${n.site ? `, called from line ${n.site}` : ''}${n.iteration ? ` in iteration ${n.iteration}` : ''}${n.done ? ', returned' : ''}`
            : `${n.label}: ${n.iterations} iteration${n.iterations === 1 ? '' : 's'} so far${n.iteration ? ` (inside iteration ${n.iteration})` : ''}${n.done ? ', ended' : ''}`;
        g.append(label, tip);
        root.append(g);
        if (n.id === tree.current) current = g;
    }
    scroller.replaceChildren(root);host.append(scroller);
    // Follow the run only when it leaves the view, so a reader's pan is kept while the node stays in sight.
    if (current) {
        const n = tree.nodes[tree.current]!, nx = cx(n.id), ny = cy(n), w = COL / 2;
        const seen = nx - w >= scroller.scrollLeft && nx + w <= scroller.scrollLeft + scroller.clientWidth
            && ny - H >= scroller.scrollTop && ny + H <= scroller.scrollTop + scroller.clientHeight;
        if (!seen) scroller.scrollTo({ left: Math.max(0, nx - scroller.clientWidth / 2), top: Math.max(0, ny - scroller.clientHeight / 2) });
    }
}
