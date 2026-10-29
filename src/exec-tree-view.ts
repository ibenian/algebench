/**
 * Draws an execution tree (exec-tree.ts) as a top-down node-link diagram: calls as boxes written as the code
 * writes them, loops as pills with their iteration count, the node executing now lit, the ones that finished
 * paler. Each leaf takes a column and a parent sits over its children, so the width is the work fanning out.
 */
import { repeatedCalls } from '/exec-tree.js';
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

/**
 * The scrolling view under the summary, kept across redraws (so a pan stays where the reader left it) and
 * dragged with the mouse to pan.
 */
function scrollerOf(host: HTMLElement): HTMLDivElement {
    let scroller = host.querySelector<HTMLDivElement>(':scope > .exec-tree-scroll');
    if (scroller) return scroller;
    scroller = document.createElement('div');scroller.className = 'exec-tree-scroll';
    // A drag pans; a press that does not move is a click, left to the node under it. On a loop, a drag (or a
    // press held still) scrubs its iterations instead: sliding sideways moves the run to the start of each one.
    // Panning starts anywhere else.
    scroller.addEventListener('pointerdown', e => {
        // The ✦ is a button: its press is its own click, never a pan or a scrub.
        if (e.button !== 0 || (e.target as Element).closest?.('.exec-tree-ask')) return;
        const s = scroller!, x0 = e.clientX, y0 = e.clientY, left = s.scrollLeft, top = s.scrollTop;
        let panning = false;
        const loopEl = (e.target as Element).closest?.('.exec-tree-loop');
        const loop = loopEl ? loopOf.get(loopEl) : undefined;
        let scrub: { at: number; badge: HTMLDivElement } | null = null;
        const show = (at: number, ev: { clientX: number; clientY: number }) => {
            scrub!.badge.textContent = `${loop!.name} · iteration ${at + 1} of ${loop!.starts.length}`;
            scrub!.badge.style.left = `${ev.clientX + 12}px`;scrub!.badge.style.top = `${ev.clientY - 28}px`;
        };
        const startScrub = () => {
            if (scrub || !loop) return;
            const badge = document.createElement('div');badge.className = 'exec-tree-scrub-badge';document.body.append(badge);
            scrub = { at: loop.at, badge };s.classList.add('scrubbing');show(loop.at, e);
        };
        const hold = loop ? setTimeout(startScrub, HOLD_MS) : 0;
        const move = (ev: PointerEvent) => {
            if (scrub) {
                const at = Math.max(0, Math.min(loop!.starts.length - 1, loop!.at + Math.round((ev.clientX - x0) / SCRUB_PX)));
                if (at !== scrub.at) { scrub.at = at;loop!.pick?.(loop!.starts[at]!); }
                show(at, ev);
                return;
            }
            if (!panning && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
            clearTimeout(hold);
            if (loop) { startScrub();move(ev);return; }
            if (!panning) { panning = true;s.classList.add('panning'); }
            s.scrollLeft = left - (ev.clientX - x0);s.scrollTop = top - (ev.clientY - y0);
        };
        // Followed on the window, so a release anywhere (outside the panel too) ends the drag.
        const up = () => {
            window.removeEventListener('pointermove', move);window.removeEventListener('pointerup', up);window.removeEventListener('pointercancel', up);
            clearTimeout(hold);
            s.classList.remove('panning', 'scrubbing');
            const scrubbed = !!scrub;
            scrub?.badge.remove();scrub = null;
            // The click that ends a pan or a scrub (fired right after the release, if it ended over the panel) is not a pick.
            if (panning || scrubbed) {
                const swallow = (ev: Event) => ev.stopPropagation();
                s.addEventListener('click', swallow, {capture: true, once: true});
                setTimeout(() => s.removeEventListener('click', swallow, {capture: true}), 0);
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);window.addEventListener('pointercancel', up);
    });
    // Pointing at a node lights every node like it: the same call with the same values, or the same loop.
    const light = (label: string | null) => scroller!.querySelectorAll<SVGGElement>('.exec-tree-node')
        .forEach(g => g.classList.toggle('match', label != null && g.dataset.label === label));
    scroller.addEventListener('pointerover', e => {
        const g = (e.target as Element).closest?.<SVGGElement>('.exec-tree-node');
        light(g ? g.dataset.label ?? null : null);
    });
    scroller.addEventListener('pointerleave', () => light(null));
    return scroller;
}

/**
 * Two ways to watch a run: "grow" builds the tree as the run goes, only what has run so far; "whole" shows the
 * whole run's tree from the start, the nodes not run yet grayed, so the run is seen walking it.
 */
export type ExecTreeMode = 'grow' | 'whole';
/** A call made more than once with the same arguments: its label, how many times, and its function's line. */
export interface RepeatGroup { label: string; count: number; line: number }
const MODE_KEY = 'algebench-exec-tree-mode';
let mode: ExecTreeMode = 'grow';
try { if (localStorage.getItem(MODE_KEY) === 'whole') mode = 'whole'; } catch { /* storage off: grow */ }
// Whether the repeated calls are marked: on from a click on the alert until the next.
let markRepeats = false;
// What each host last drew, so switching the mode redraws it.
const drawn = new WeakMap<HTMLElement, () => void>();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Holding a loop this long (or dragging it) starts scrubbing its iterations; each this many pixels sideways is one.
const HOLD_MS = 250, SCRUB_PX = 14, ASK_W = 18;
// The colors repeated calls are marked in, a group each (no gold: that is the running node).
const REPEAT_COLORS = ['#6ea8e0', '#d36ba6', '#4fb39a', '#b69bea', '#e0875a', '#8fbf5a'];
// Each drawn loop: its name, the frame each iteration started at, the iteration the run is in, and where to go.
const loopOf = new WeakMap<Element, { name: string; starts: number[]; at: number; pick?: (frame: number) => void }>();

/**
 * Draw the run's tree into host at the frame shown: `build(upto)` gives the tree for frames 0..upto, `last` is the
 * run's last frame. The node executing now is scrolled into view; clicking a node calls `pick` with the frame it
 * started at.
 */
export function drawExecTree(host: HTMLElement, build: (upto: number) => ExecTree, last: number, frame: number, pick?: (frame: number) => void,
    ask?: (id: number) => HTMLElement, askRepeats?: (groups: RepeatGroup[], extra: number) => HTMLElement): void {
    drawn.set(host, () => drawExecTree(host, build, last, frame, pick, ask, askRepeats));
    const now = build(frame), full = last >= 0 ? build(last) : now, whole = mode === 'whole' ? full : null;
    const tree = whole ?? now;
    // Nodes are made in run order, so the first ones of the whole tree are those run so far.
    const ran = (n: ExecNode) => n.id < now.nodes.length;
    const state = (n: ExecNode) => ran(n) ? now.nodes[n.id]! : n;
    const scroller = scrollerOf(host);
    host.replaceChildren();
    const head = document.createElement('div');head.className = 'exec-tree-summary';
    const summary = document.createElement('span');
    const of = (a: number, b: number) => whole ? `${a}/${b}` : String(a);
    summary.textContent = tree.nodes.length
        ? `${of(now.calls, tree.calls)} call${tree.calls === 1 ? '' : 's'} · ${of(now.iterations, tree.iterations)} loop iteration${tree.iterations === 1 ? '' : 's'} · depth ${now.maxDepth}${whole ? `/${whole.maxDepth}` : ''}`
        : 'No recorded run at this step.';
    const modes = document.createElement('span');modes.className = 'exec-tree-modes';modes.setAttribute('role', 'group');
    for (const [m, name, title] of [['grow', 'Grow', 'Build the tree as the run goes'], ['whole', 'Whole', 'Show the whole run\'s tree, the part not run yet grayed']] as const) {
        const b = document.createElement('button');b.type = 'button';b.textContent = name;b.title = title;b.setAttribute('aria-pressed', String(mode === m));
        b.addEventListener('click', () => {
            mode = m;try { localStorage.setItem(MODE_KEY, m); } catch { /* not kept */ }
            drawn.get(host)?.();
        });
        modes.append(b);
    }
    head.append(summary, modes);
    host.append(head);
    if (!tree.nodes.length) { scroller.replaceChildren();return; }
    const label = (n: ExecNode) => {
        if (n.kind === 'call' || !whole) return text(state(n));
        return `↻ ${loopName(n.label)} ×${ran(n) ? `${state(n).iterations}/` : ''}${n.iterations}`;
    };
    const x = columns(tree);
    // One column width for all, wide enough for the longest label.
    const COL = Math.max(64, Math.max(...tree.nodes.map(n => label(n).length)) * CHAR + 18 + (ask ? ASK_W : 0));
    const width = (Math.max(...x.values()) + 1) * COL + PAD * 2, height = (Math.max(...tree.nodes.map(n => n.depth)) + 1) * ROW + PAD;
    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'exec-tree-svg', role: 'img', 'aria-label': summary.textContent });
    const cx = (id: number) => PAD + x.get(id)! * COL + COL / 2, cy = (n: ExecNode) => PAD + n.depth * ROW + H / 2;
    for (const n of tree.nodes) if (n.parent != null) {
        const p = tree.nodes[n.parent]!;
        root.append(svg('path', { class: `exec-tree-edge${ran(n) ? '' : ' future'}`, d: `M${cx(p.id)},${cy(p) + H / 2} C${cx(p.id)},${cy(p) + ROW / 2} ${cx(n.id)},${cy(n) - ROW / 2} ${cx(n.id)},${cy(n) - H / 2}` }));
    }
    // The same call with the same values more than once: repeated work, marked on request.
    const repeats = repeatedCalls(tree);
    // Each repeated call gets a color of its own, so its copies read as one group.
    const groupColor = new Map<number, string>();
    [...repeats.values()].forEach((ids, k) => ids.forEach(id => groupColor.set(id, REPEAT_COLORS[k % REPEAT_COLORS.length]!)));
    let current: SVGGElement | null = null;
    for (const n of tree.nodes) {
        const st = state(n), future = !ran(n);
        const g = svg('g', { class: `exec-tree-node exec-tree-${n.kind}${future ? ' future' : st.done ? ' done' : ''}${n.id === now.current ? ' current' : ''}${!whole && n.frame === frame ? ' fresh' : ''}${markRepeats && groupColor.has(n.id) ? ' repeated' : ''}`,
            transform: `translate(${cx(n.id)},${cy(n)})` });
        if (markRepeats && groupColor.has(n.id)) g.style.setProperty('--repeat', groupColor.get(n.id)!);
        g.dataset.label = n.label;
        const w = COL - 8;
        g.append(svg('rect', { x: -w / 2, y: -H / 2, width: w, height: H, rx: n.kind === 'loop' ? H / 2 : 5 }));
        // A loop fills from the left as its iterations are reached, as its label counts them: 4/4 is full.
        const total = full.nodes[n.id]?.iterations ?? 0;
        if (n.kind === 'loop' && !future && total > 0) {
            const share = Math.min(1, st.iterations / total);
            const clip = svg('clipPath', { id: `exec-tree-clip-${n.id}` });
            clip.append(svg('rect', { x: -w / 2, y: -H / 2, width: w, height: H, rx: H / 2 }));
            g.append(clip, svg('rect', { class: 'exec-tree-progress', x: -w / 2, y: -H / 2, width: w * share, height: H, 'clip-path': `url(#exec-tree-clip-${n.id})` }));
        }
        // The label sits left of the ✦ when there is one.
        const t = svg('text', { 'text-anchor': 'middle', dy: '0.35em', x: ask ? -ASK_W / 2 : 0 });t.textContent = label(n);
        const tip = svg('title', {});
        tip.textContent = n.kind === 'call'
            ? `${n.label}${n.site ? `, called from line ${n.site}` : ''}${n.iteration ? ` in iteration ${n.iteration}` : ''}${future ? ', not run yet' : st.done ? ', returned' : ''}`
            : `${n.label}: ${future ? plural(n.iterations, 'iteration') + ', not run yet' : `${plural(st.iterations, 'iteration')} so far${whole ? ` of ${n.iterations}` : ''}`}${n.iteration ? ` (inside iteration ${n.iteration})` : ''}${!future && st.done ? ', ended' : ''}`;
        tip.textContent += pick ? ` · click to go to frame ${n.frame}` : '';
        g.append(t, tip);
        if (ask) {
            // The app's Ask AI button (✦ in its circle): the tutor on this step of the run, its structure and cost.
            const a = svg('foreignObject', { class: 'exec-tree-ask', x: w / 2 - ASK_W - 2, y: -ASK_W / 2, width: ASK_W, height: ASK_W });
            a.append(ask(n.id));
            // Its click is its own: the node behind it does not jump.
            a.addEventListener('click', ev => ev.stopPropagation());
            g.append(a);
        }
        if (pick) g.addEventListener('click', () => pick(n.frame));
        if (n.kind === 'loop') {
            // The iteration the run is in now: the last one started by this frame (the first while not reached).
            const at = Math.max(0, n.starts.filter(f => f <= frame).length - 1);
            loopOf.set(g, { name: `↻ ${loopName(n.label)}`, starts: n.starts, at, pick });
            tip.textContent += ` · drag sideways to pick an iteration`;
        }
        root.append(g);
        if (n.id === now.current) current = g;
    }
    scroller.replaceChildren(root);host.append(scroller);
    if (repeats.size) {
        const calls = [...repeats.values()].reduce((sum, ids) => sum + ids.length - 1, 0);
        // A div acting as a button, so the Ask AI button can sit inside it.
        const alert = document.createElement('div');alert.className = 'exec-tree-alert';alert.setAttribute('role', 'button');alert.tabIndex = 0;
        alert.setAttribute('aria-pressed', String(markRepeats));
        alert.append(`⚠ ${plural(calls, 'repeated call')}: `);
        // Each group in its color (once marked), as its nodes are.
        [...repeats].forEach(([label, ids], k) => {
            const chip = document.createElement('span');chip.className = 'exec-tree-alert-chip';chip.textContent = `${label} ×${ids.length}`;
            if (markRepeats) chip.style.setProperty('--repeat', REPEAT_COLORS[k % REPEAT_COLORS.length]!);
            alert.append(chip);
        });
        const hint = document.createElement('span');hint.className = 'exec-tree-alert-hint';hint.textContent = markRepeats ? 'click to clear' : 'click to mark';
        alert.append(hint);
        if (askRepeats) {
            // ✦: the tutor recommends how to stop doing this work twice. Its click is its own, not a mark.
            const b = askRepeats([...repeats].map(([label, ids]) => ({ label, count: ids.length, line: tree.nodes[ids[0]!]!.line })), calls);
            b.addEventListener('click', ev => ev.stopPropagation());
            alert.append(b);
        }
        alert.title = 'The same call with the same arguments, made again: work done more than once. Remembering each answer (memoization) would make each of these once.';
        const toggle = () => { markRepeats = !markRepeats;drawn.get(host)?.(); };
        alert.addEventListener('click', toggle);
        alert.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault();toggle(); } });
        host.append(alert);
    }
    // Follow the run only when it leaves the view, so a reader's pan is kept while the node stays in sight.
    if (current) {
        const n = tree.nodes[now.current]!, nx = cx(n.id), ny = cy(n), w = COL / 2;
        const seen = nx - w >= scroller.scrollLeft && nx + w <= scroller.scrollLeft + scroller.clientWidth
            && ny - H >= scroller.scrollTop && ny + H <= scroller.scrollTop + scroller.clientHeight;
        if (!seen) scroller.scrollTo({ left: Math.max(0, nx - scroller.clientWidth / 2), top: Math.max(0, ny - scroller.clientHeight / 2) });
    }
}
