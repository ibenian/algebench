/**
 * AI presenter: with the presenter switch on (chat toolbar), a question typed in the chat is answered as a
 * walk-through of the view, the way a person at the front of the room would answer it with a laser pointer. The
 * scene_present expert gets the view (the lesson, what is on screen, the run's execution states) and every target
 * the pointer can reach, and answers with beats: move the run to a state (the pointer drags the slider there), point
 * at or circle a target, and say a sentence or two. The beats play here: a red pointer glides over the view, follows
 * its target as the camera moves, and the words appear in the chat as they are spoken.
 *
 * Refs the expert may use, all resolved here to a place on screen:
 *   <id>          an element of the scene (its bounds, or its label);
 *   <id>[<i>]     cell i of an array, entry i of a dict, node i of a graph; <id>[i:j] a run of them, <id>[i,j,k]
 *                 a few; for a tensor, numpy style: <id>[r, c], <id>[r, :], <id>[:, c], <id>[r0:r1, c0:c1];
 *   row:<id>      an expression label's row in the variables panel;
 *   caption       the step caption;  slider  the execution slider.
 */
import { state } from '/state.js';
import { invokeExpert } from '/expert-client.js';
import { compileExpr, evalExpr } from '/expr.js';
import { setSliderValue } from '/sliders.js';
import { dataToWorld } from '/coords.js';
import { objectCellAnchor, objectChartMarks, objectTensorRegion, objectWorldCorners, objectWorldAnchor, objectLabelElement, objectLabelRow } from '/object-anchor.js';
import { keyDelay } from '/code-assist-play.js';
import { LINKS, SHAPES, edgePoint, hullAround, layoutDrawing, shapeStroke, smoothPath, type DrawSpec, type Drawing, type Laid, type Point, type Rect } from '/drawing-layout.js';
import type { Element as LessonElement, Scene } from '/types/lesson.js';

interface Beat { say: string; target: string; part?: string; mark: 'point' | 'circle' | 'underline' | 'check' | 'cross'; frame: number; write?: string; write_near?: string; erase?: boolean; arrow_to?: string; arrow_from?: string; arrow_kind?: 'arrow' | 'line' | 'both'; spotlight?: boolean;
    slider?: string; slider_to?: number | null; board?: string[]; erase_notes?: string[]; erase_draw?: string[]; together?: string[]; color?: string; draw?: Drawing | null }
interface Target { ref: string; about: string }

const PREF_KEY = 'algebench-presenter';
const MAX_CELLS = 60;

// ── What can be pointed at ──

const sceneNow = (): Scene | undefined => state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene | undefined;

/** The lesson JSON of a live element: the scene's own, else added by a step up to the one on screen. */
function elementSpec(id: string): LessonElement | undefined {
    const scene = sceneNow();
    const own = (scene?.elements ?? []) as LessonElement[];
    const added = (scene?.steps ?? []).slice(0, state.currentStepIndex + 1).flatMap(s => ((s as {add?: LessonElement[]}).add ?? []));
    return [...own, ...added].reverse().find(e => (e as {id?: string}).id === id);
}

const short = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return (t ?? '').slice(0, 60); };

/** Everything the pointer can reach now, each with what it is (an array's cells with their values). */
export function presentTargets(): Target[] {
    const out: Target[] = [];
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!reg || reg.hidden || state.legendToggledOff.has(id)) continue;
        const spec = elementSpec(id) as (LessonElement & {label?: string; title?: string; valueExpr?: string; keyExpr?: string}) | undefined;
        const name = reg.label ?? spec?.label ?? spec?.title ?? '';
        const type = reg.type ?? (spec as {type?: string} | undefined)?.type ?? 'object';
        if (objectCellAnchor(id, 0)) {
            // An array or dict: the whole, and each cell with its value (and key) as shown.
            const valueFn = spec?.valueExpr ? compileExpr(spec.valueExpr) : null, keyFn = spec?.keyExpr ? compileExpr(spec.keyExpr) : null;
            const cells: Target[] = [], graph = !!objectCellAnchor(id, 0)?.graph;
            for (let i = 0; i < MAX_CELLS && objectCellAnchor(id, i); i++) {
                let about = `${spec?.keyExpr ? 'entry' : graph ? 'node' : 'cell'} ${i} of ${name || id}`;
                try {
                    const value = valueFn ? evalExpr(valueFn, 0, {overrideScope: {idx: i}}) : undefined;
                    const key = keyFn ? evalExpr(keyFn, 0, {overrideScope: {idx: i}}) : undefined;
                    if (keyFn) about += `: key ${short(key)} -> ${short(value)}`;
                    else if (valueFn) about += `: ${short(value)}`;
                } catch { /* a value that doesn't evaluate: the cell is still there to point at */ }
                cells.push({ref: `${id}[${i}]`, about});
            }
            out.push({ref: id, about: `${type} ${name ? `"${name}"` : ''} with ${cells.length} ${spec?.keyExpr ? 'entries' : graph ? 'nodes' : 'cells'}`.replace(/\s+/g, ' ')}, ...cells);
            continue;
        }
        const marks = objectChartMarks(id);
        if (marks?.length) {
            // A chart: each bar and point it draws, by its place in that list.
            out.push({ref: id, about: `chart${name ? ` "${name}"` : ''} with ${marks.length} bars/points`},
                ...marks.slice(0, MAX_CELLS).map((m, i) => ({ref: `${id}[${i}]`, about: m.about})));
            continue;
        }
        const tensor = objectTensorRegion(id);
        if (tensor) {
            // Its cells are many: named by index, numpy style, rather than listed.
            out.push({ref: id, about: `tensor${name ? ` "${name}"` : ''}, ${tensor.rows} rows x ${tensor.cols} columns: point at a cell `
                + `${id}[r, c], a row ${id}[r, :], a column ${id}[:, c] or a block ${id}[r0:r1, c0:c1] (0-based, ends excluded)`});
            continue;
        }
        const row = objectLabelRow(id);
        if (row) { out.push({ref: `row:${id}`, about: `variables panel row: ${row.textContent?.trim().slice(0, 120) ?? ''}`});continue; }
        if (objectWorldAnchor(id) || objectLabelElement(id))
            out.push({ref: id, about: `${type}${name ? ` "${name}"` : ''}${objectLabelElement(id)?.textContent ? `: ${objectLabelElement(id)!.textContent!.trim().slice(0, 80)}` : ''}`});
    }
    const caption = document.getElementById('step-caption');
    if (caption && !caption.classList.contains('hidden') && caption.offsetParent) out.push({ref: 'caption', about: `the step caption: ${caption.textContent?.trim().slice(0, 160) ?? ''}`});
    if (sliderInput()) out.push({ref: 'slider', about: 'the execution slider, which steps through the run'});
    // The scene's parameters: each slider on screen, with its value and range (the run's own slider is `slider`).
    const run = playbackSlider()?.id;
    for (const [id, sl] of Object.entries(state.sceneSliders)) {
        const s = sl as unknown as {kind?: string; value: number; min: number; max: number; step?: number; label?: string};
        if (id === run || s.kind === 'tensor' || !paramInput(id)) continue;
        out.push({ref: `slider:${id}`, about: `slider "${(s.label ?? id).replace(/\$/g, '')}" = ${s.value} (from ${s.min} to ${s.max}${s.step ? `, step ${s.step}` : ''})`});
    }
    return out.slice(0, 400);
}

// ── Where on screen ──

/** The run's slider: the scene's step playback, else the step's own slider. */
function playbackSlider(): {id: string; min: number; max: number; value: number} | null {
    const scene = sceneNow() as (Scene & {stepPlayback?: {slider: string}}) | undefined;
    const id = scene?.stepPlayback?.slider;
    const s = id ? state.sceneSliders[id] : undefined;
    if (!id || !s) return null;
    const sl = s as unknown as {value: number; min?: number; max?: number};
    return {id, min: sl.min ?? 0, max: sl.max ?? 0, value: Number(sl.value)};
}
/** A parameter slider's control, when it is on screen. */
function paramInput(id: string): HTMLInputElement | null {
    const el = document.querySelector<HTMLInputElement>(`input[data-slider-id="${CSS.escape(id)}"]`);
    return el && el.offsetParent ? el : null;
}
function sliderInput(): HTMLInputElement | null {
    const el = document.querySelector<HTMLInputElement>('#state-player input[type=range]');
    return el && el.offsetParent ? el : null;
}
/** Where the slider's thumb sits for frame `f`. */
function sliderPoint(f: number): {x: number; y: number} | null {
    const input = sliderInput(), s = playbackSlider();
    if (!input || !s) return null;
    const r = input.getBoundingClientRect(), t = s.max > s.min ? (f - s.min) / (s.max - s.min) : 0;
    const thumb = 14;   // the thumb's width: its centre runs from half a thumb in at each end
    return {x: r.left + thumb / 2 + t * (r.width - thumb), y: r.top + r.height / 2};
}

function project(world: {x: number; y: number; z: number; clone(): {project(c: unknown): {x: number; y: number; z: number}}}): {x: number; y: number} | null {
    if (!state.camera || !state.renderer) return null;
    const p = world.clone().project(state.camera);
    if (p.z < -1 || p.z >= 1) return null;
    const v = state.renderer.domElement.getBoundingClientRect();
    return {x: v.left + (p.x * .5 + .5) * v.width, y: v.top + (-p.y * .5 + .5) * v.height};
}
function rectOf(points: ({x: number; y: number} | null)[]): DOMRect | null {
    const ok = points.filter((p): p is {x: number; y: number} => !!p);
    if (!ok.length) return null;
    const xs = ok.map(p => p.x), ys = ok.map(p => p.y);
    return new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
const V3 = (p: number[]) => new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

/** A ref's place on screen, re-read each frame (the camera, the panels and the values move). */
/** The cells an index names, for an array, dict or graph: one (`3`), a slice (`1:4`, end excluded) or a list
 *  (`1,3,4`). Null when it is none of these. */
export function cellIndices(index: string): number[] | null {
    const t = index.replace(/\s+/g, '');
    if (/^\d+$/.test(t)) return [Number(t)];
    const slice = /^(\d+):(\d+)$/.exec(t);
    if (slice) { const from = Number(slice[1]), to = Number(slice[2]);return to > from ? Array.from({length: Math.min(to - from, MAX_CELLS)}, (_, k) => from + k) : null; }
    return /^\d+(,\d+)+$/.test(t) ? t.split(',').map(Number) : null;
}

/** The rows and columns (first and last, inclusive) a tensor index names, numpy style: `r, c`, `r, :`, `:, c`,
 *  `r0:r1, c0:c1` (ends excluded, either end may be left out). A 1D index is a column of a single row. */
export function tensorBlock(index: string, rows: number, cols: number): [number, number, number, number] | null {
    const parts = index.replace(/\s+/g, '').split(',');
    if (parts.length > 2) return null;
    if (parts.length === 1) parts.unshift(':');
    const span = (p: string, n: number): [number, number] | null => {
        const m = /^(\d*)(:?)(\d*)$/.exec(p);
        if (!m) return null;
        const from = m[1] ? Number(m[1]) : 0;
        const to = m[2] ? (m[3] ? Number(m[3]) : n) - 1 : m[1] ? from : n - 1;
        return from <= to && to < n ? [from, to] : null;
    };
    const r = span(parts[0]!, rows), c = span(parts[1]!, cols);
    return r && c ? [r[0], r[1], c[0], c[1]] : null;
}

/** On screen: a tensor's cell, row, column or block; or an array's, dict's or graph's cells, boxed together. */
function indexedRect(id: string, index: string): DOMRect | null {
    const tensor = objectTensorRegion(id);
    if (tensor) {
        const block = tensorBlock(index, tensor.rows, tensor.cols);
        return block ? rectOf(tensor.corners(...block).map(c => project(V3(c)))) : null;
    }
    const cells = cellIndices(index);
    if (!cells) return null;
    const marks = objectChartMarks(id);
    if (marks) return cells.every(i => marks[i]) ? rectOf(cells.flatMap(i => marks[i]!.corners.map(c => project(V3(c))))) : null;
    const points = [];
    for (const i of cells) {
        const at = objectCellAnchor(id, i);
        if (!at) return null;
        points.push(...(at.corners.length ? at.corners.map(c => project(V3(dataToWorld(c as [number, number, number])))) : [project(V3(dataToWorld(at.position)))]));
    }
    return rectOf(points);
}

/**
 * The box of what an element reads, without its buttons: a label row ends in small Ask-AI, code and wire buttons
 * that show on hover, and a mark round the whole row would sit off to their side.
 */
function inkRect(el: HTMLElement): DOMRect {
    const rs: DOMRect[] = [];
    for (const n of el.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
            if (!n.textContent?.trim()) continue;
            const range = document.createRange();range.selectNodeContents(n);
            rs.push(range.getBoundingClientRect());
        } else if (n instanceof HTMLElement && !n.matches('button, .ai-ask-btn, .expression-wire-toggle') && n.offsetWidth) rs.push(n.getBoundingClientRect());
    }
    const shown = rs.filter(r => r.width && r.height);
    if (!shown.length) return el.getBoundingClientRect();
    const x0 = Math.min(...shown.map(r => r.left)), y0 = Math.min(...shown.map(r => r.top)), x1 = Math.max(...shown.map(r => r.right)), y1 = Math.max(...shown.map(r => r.bottom));
    return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}
export function resolveTarget(ref: string, part = ''): DOMRect | null {
    // Several marked as one (a beat's target with what it's `together` with, a line each): the box round all shown.
    if (ref.includes('\n')) {
        const rs = ref.split('\n').map(x => resolveTarget(x, '')).filter((x): x is DOMRect => !!x);
        if (!rs.length) return null;
        const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top)), x1 = Math.max(...rs.map(r => r.right)), y1 = Math.max(...rs.map(r => r.bottom));
        return new DOMRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (ref.startsWith('note:')) return noteRect(ref.slice(5), part);
    if (ref.startsWith('draw:')) return drawnRect(ref.slice(5), part);
    if (ref === 'caption') { const c = document.getElementById('step-caption');return c?.offsetParent ? c.getBoundingClientRect() : null; }
    if (ref === 'slider') { const i = sliderInput();return i ? i.getBoundingClientRect() : null; }
    if (ref.startsWith('slider:')) { const i = paramInput(ref.slice(7));return i ? (i.parentElement ?? i).getBoundingClientRect() : null; }
    if (ref.startsWith('row:')) { const row = objectLabelRow(ref.slice(4));return row ? inkRect(row) : null; }
    const indexed = /^(.+?)\[([\d\s:,]+)\]$/.exec(ref);
    if (indexed) return indexedRect(indexed[1]!, indexed[2]!);
    const corners = objectWorldCorners(ref);
    const box = corners.length ? rectOf(corners.map(c => project(c))) : null;
    if (box && box.width * box.height > 4) return box;
    const label = objectLabelElement(ref);
    if (label?.offsetParent) return label.getBoundingClientRect();
    const anchor = objectWorldAnchor(ref), p = anchor ? project(anchor) : null;
    return p ? new DOMRect(p.x - 6, p.y - 6, 12, 12) : box;
}

// ── The pointer ──

let pointer: HTMLElement | null = null, ring: SVGSVGElement | null = null;
const pos = {x: -100, y: -100};
function ensurePointer(): HTMLElement {
    if (pointer?.isConnected) return pointer;
    pointer = document.createElement('div');pointer.className = 'ai-pointer';pointer.setAttribute('aria-hidden', 'true');
    for (let k = 0; k < 6; k++) { const t = document.createElement('span');t.className = 'ai-pointer-trail';pointer.append(t); }
    const dot = document.createElement('span');dot.className = 'ai-pointer-dot';pointer.append(dot);
    ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');ring.classList.add('ai-pointer-ring');ring.setAttribute('aria-hidden', 'true');
    document.body.append(pointer, ring);
    return pointer;
}
// The pointer hovers like a mouse: the element under it gets the events a mouse would give it, so everything that
// reacts to hovering (a label row's wire to its cell, a formula tooltip, an array's links, the code's symbols)
// shows for what the presenter points at, as it would for the learner.
let hovered: Element[] = [];
// While the learner presses a real button (dragging the view to rotate it), the pointer's made-up moves would be
// read as part of their drag, between their own moves, and spoil it: the pointer stops hovering until they let go.
let learnerPressing = false;
for (const [type, down] of [['pointerdown', true], ['pointerup', false], ['pointercancel', false]] as const)
    window.addEventListener(type, e => { if (e.isTrusted) learnerPressing = down; }, true);
const chain = (el: Element | null) => { const out: Element[] = [];for (let e = el;e;e = e.parentElement) out.push(e);return out; };
function fire(el: Element, type: string, x: number, y: number, bubbles: boolean) {
    const init = {bubbles, cancelable: true, clientX: x, clientY: y, view: window};
    // Its own pointer id: not the learner's mouse (id 1), so nothing tracking that pointer mistakes it for theirs.
    el.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, {...init, pointerId: 9001, pointerType: 'mouse', isPrimary: false}) : new MouseEvent(type, init));
}
function hoverAt(x: number, y: number) {
    if (learnerPressing) return;
    const under = document.elementFromPoint(x, y);
    const now = chain(under), was = hovered;
    if (under !== was[0]) {
        if (was[0]) { fire(was[0], 'pointerout', x, y, true);fire(was[0], 'mouseout', x, y, true); }
        for (const el of was) if (!now.includes(el)) { fire(el, 'pointerleave', x, y, false);fire(el, 'mouseleave', x, y, false); }
        for (const el of [...now].reverse()) if (!was.includes(el)) { fire(el, 'pointerenter', x, y, false);fire(el, 'mouseenter', x, y, false); }
        if (under) { fire(under, 'pointerover', x, y, true);fire(under, 'mouseover', x, y, true); }
        hovered = now;
    }
    if (under) { fire(under, 'pointermove', x, y, true);fire(under, 'mousemove', x, y, true); }
}
/** The pointer has gone: whatever it hovered is left, as when a mouse moves away. */
function unhover() {
    const x = pos.x, y = pos.y;
    if (hovered[0]) { fire(hovered[0], 'pointerout', x, y, true);fire(hovered[0], 'mouseout', x, y, true); }
    for (const el of hovered) { fire(el, 'pointerleave', x, y, false);fire(el, 'mouseleave', x, y, false); }
    hovered = [];
}

const trail: {x: number; y: number}[] = [];
function paintPointer() {
    if (playing) hoverAt(pos.x, pos.y);
    const el = ensurePointer();
    el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    trail.unshift({...pos});trail.length = Math.min(trail.length, 7);
    [...el.querySelectorAll<HTMLElement>('.ai-pointer-trail')].forEach((t, k) => {
        const p = trail[k + 1] ?? pos;
        t.style.transform = `translate(${p.x - pos.x}px, ${p.y - pos.y}px)`;
    });
}
const sleep = (ms: number) => new Promise<void>(res => window.setTimeout(res, ms));
class Stopped extends Error {}
let run = 0;
const alive = (r: number) => { if (r !== run) throw new Stopped(); };

/** Glide to (x, y): eased, quicker for short hops, as a hand moves. */
async function glide(x: number, y: number, r: number, ms?: number) {
    showPointer();
    const from = {...pos}, d = Math.hypot(x - from.x, y - from.y), dur = ms ?? Math.min(900, 250 + d * .9);
    const t0 = performance.now();
    for (;;) {
        alive(r);
        const t = Math.min(1, (performance.now() - t0) / dur), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        pos.x = from.x + (x - from.x) * e;pos.y = from.y + (y - from.y) * e;paintPointer();
        if (t >= 1) return;
        await new Promise(res => requestAnimationFrame(res));
    }
}

type MarkShape = 'circle' | 'underline' | 'check' | 'cross';
/**
 * Where a mark goes and its strokes, in the mark's own box: a circle round `rect` (a hand's loop, a little past where
 * it began), a line under it, a tick or a cross over it (beside it, a tick on a row of cells reads as the next cell's).
 */
function markGeometry(rect: DOMRect, shape: MarkShape): {left: number; top: number; w: number; h: number; strokes: string[]} {
    if (shape === 'underline') {
        const w = rect.width + 8;
        return {left: rect.left - 4, top: rect.bottom, w: w + 4, h: 12, strokes: [`M2 5 Q ${w / 2 + 2} 8 ${w + 2} 4`]};
    }
    if (shape === 'check') {
        const s = Math.max(22, Math.min(44, rect.height * 1.3));
        return {left: rect.left + rect.width / 2 - s / 2, top: rect.top + rect.height / 2 - s / 2, w: s, h: s,
            strokes: [`M${s * .08} ${s * .55} L${s * .38} ${s * .88} L${s * .95} ${s * .1}`]};
    }
    if (shape === 'cross') {
        const pad = 4, w = Math.min(rect.width, 160) + pad * 2, h = Math.min(rect.height, 80) + pad * 2;
        const left = rect.left + rect.width / 2 - w / 2, top = rect.top + rect.height / 2 - h / 2;
        return {left, top, w, h, strokes: [`M2 2 L${w - 2} ${h - 2}`, `M${w - 2} 2 L2 ${h - 2}`]};
    }
    const {rx, ry} = ringRadii(rect), cx = rx + 2, cy = ry + 2;
    const at = (deg: number) => { const a = deg * Math.PI / 180;return `${cx + rx * Math.cos(a)} ${cy + ry * Math.sin(a)}`; };
    // From the top left, once round clockwise and a little on.
    return {left: rect.left + rect.width / 2 - rx - 2, top: rect.top + rect.height / 2 - ry - 2, w: rx * 2 + 4, h: ry * 2 + 4,
        // Both arcs on the one ellipse: the second runs 200° (60° round to -100°), so it is a large arc too; flagged small,
        // SVG fits it on another ellipse, shifted, and the ring cuts across what it rings.
        strokes: [`M${at(-120)} A${rx} ${ry} 0 1 1 ${at(60)} A${rx} ${ry} 0 1 1 ${at(-100)}`]};
}
/**
 * A ring's half-axes round `rect`: an ellipse just touching a box leaves its corners outside, so the line would cross
 * what it rings (most of all on a wide label). A little wider than the box, and as tall as it must be for the corners
 * to sit inside, with a margin.
 */
function ringRadii(rect: DOMRect): {rx: number; ry: number} {
    const hw = rect.width / 2, hh = rect.height / 2, rx = hw + Math.max(12, rect.width * .12);
    return {rx, ry: hh / Math.sqrt(1 - (hw / rx) ** 2) + 4};
}
let ringShape: MarkShape = 'circle';
/** Put a mark on `rect` in the beat's ink, not drawn yet (traceMark draws it); none for no rect. */
function drawRing(rect: DOMRect | null, color = '', shape: MarkShape = 'circle') {
    ensurePointer();
    if (!ring) return;
    for (const extra of [...moreRings, ...markLinks]) extra.remove();
    moreRings = [];markLinks = [];
    if (!rect) { ring.classList.remove('on', 'drawn');if (!spotlightBeat) hideSpotlight();return; }
    ringShape = shape;
    ring.setAttribute('class', `ai-pointer-ring ai-mark-${shape} ${inkClass(color)}`.trim());
    ring.innerHTML = markGeometry(rect, shape).strokes.map(() => '<path pathLength="1"/>').join('');
    fitRing(rect);
    ring.classList.add('on');
}
/** Fit the mark to `rect`: as the view zooms or pans, it keeps to its target (the stroke isn't redrawn). */
function fitRing(rect: DOMRect, el: SVGSVGElement | null = ring) {
    if (!el) return;
    const g = markGeometry(rect, ringShape);
    el.style.left = `${g.left}px`;el.style.top = `${g.top}px`;
    el.setAttribute('width', String(g.w));el.setAttribute('height', String(g.h));
    el.querySelectorAll('path').forEach((p, k) => p.setAttribute('d', g.strokes[k] ?? ''));
}
/** Marks on several things at once (a beat's `together`), one per cluster of them: the rings after the first. */
let moreRings: SVGSVGElement[] = [];
/** And for rings apart, the lines that join them, one from each ring to the next: what is marked belongs together. */
let markLinks: SVGSVGElement[] = [];
/** A slightly bowed line from ring `a`'s edge to ring `b`'s (each ring is its target's box, padded as markGeometry does). */
function linkGeometry(a: DOMRect, b: DOMRect): {left: number; top: number; w: number; h: number; d: string} {
    const ca = {x: a.left + a.width / 2, y: a.top + a.height / 2}, cb = {x: b.left + b.width / 2, y: b.top + b.height / 2};
    const ra = ringRadii(a), rb = ringRadii(b);
    const p = edgePoint('ellipse', ca.x, ca.y, ra.rx * 2, ra.ry * 2, cb, 3), q = edgePoint('ellipse', cb.x, cb.y, rb.rx * 2, rb.ry * 2, ca, 3);
    const dx = q.x - p.x, dy = q.y - p.y, m = {x: (p.x + q.x) / 2 - dy * .12, y: (p.y + q.y) / 2 + dx * .12};
    const left = Math.min(p.x, q.x, m.x) - 6, top = Math.min(p.y, q.y, m.y) - 6;
    const w = Math.max(p.x, q.x, m.x) - left + 6, h = Math.max(p.y, q.y, m.y) - top + 6;
    return {left, top, w, h, d: `M${p.x - left} ${p.y - top} Q${m.x - left} ${m.y - top} ${q.x - left} ${q.y - top}`};
}
function fitLink(el: SVGSVGElement, a: DOMRect, b: DOMRect) {
    const g = linkGeometry(a, b);
    el.style.left = `${g.left}px`;el.style.top = `${g.top}px`;
    el.setAttribute('width', String(g.w));el.setAttribute('height', String(g.h));
    el.querySelector('path')?.setAttribute('d', g.d);
}
/** Put marks on `rects`, one each, in the beat's ink: the first is the ring, the rest go alongside it. */
function drawRings(rects: DOMRect[], color: string, shape: MarkShape) {
    drawRing(rects[0] ?? null, color, shape);
    if (!ring) return;
    if (spotlightBeat && rects.length) showSpotlight(rects, shape);
    for (const r of rects.slice(1)) {
        const el = ring.cloneNode(false) as SVGSVGElement;
        el.innerHTML = markGeometry(r, shape).strokes.map(() => '<path pathLength="1"/>').join('');
        ring.parentElement?.append(el);moreRings.push(el);
        fitRing(r, el);
    }
    if (shape !== 'circle') return;
    for (let k = 1; k < rects.length; k++) {
        const el = ring.cloneNode(false) as SVGSVGElement;
        el.innerHTML = '<path pathLength="1"/>';
        ring.parentElement?.append(el);markLinks.push(el);
        fitLink(el, rects[k - 1]!, rects[k]!);
    }
}
function fitRings(rects: DOMRect[]) {
    if (rects[0]) fitRing(rects[0]);
    if (spot?.classList.contains('on')) fitSpotlight(rects);
    moreRings.forEach((el, k) => { if (rects[k + 1]) fitRing(rects[k + 1]!, el); });
    markLinks.forEach((el, k) => { if (rects[k] && rects[k + 1]) fitLink(el, rects[k]!, rects[k + 1]!); });
}
// ── Spotlight: on a busy view, the 3D view dims round what is marked, for the beat ──
/**
 * Whether this beat dims the view round its marks (the presenter's `spotlight`, for a crowded view). Set as the beat
 * starts, so the dimming of one beat carries on into the next that has it too: its hole moves on, not off and on.
 */
let spotlightBeat = false;
let spot: SVGSVGElement | null = null, spotShape: MarkShape = 'circle';
/** A hole in the dimming, in the view's space: a rounded box, an ellipse being one whose corners are round all the way. */
interface Hole { x: number; y: number; w: number; h: number; rx: number; ry: number }
/** What the holes show now, and where they are going: a move from `from` that began at `t0` (none when still). */
let spotHoles: Hole[] = [], spotRects: DOMRect[] = [], spotMove: {from: Hole[]; t0: number} | null = null;
const SPOT_MOVE_MS = 650;
function showSpotlight(rects: DOMRect[], shape: MarkShape) {
    if (!spot?.isConnected) {
        spot = document.createElementNS(SVG_NS, 'svg');spot.classList.add('ai-spotlight');spot.setAttribute('aria-hidden', 'true');
        spot.innerHTML = '<defs><mask id="ai-spotlight-mask" maskUnits="userSpaceOnUse"><rect class="ai-spotlight-all" fill="white"/><g class="ai-spotlight-holes"/></mask></defs>'
            + '<rect class="ai-spotlight-dim" mask="url(#ai-spotlight-mask)"/>';
        document.body.append(spot);
    }
    // Already dimmed (the beat before had it): the hole glides from what it showed to what this beat marks.
    const lit = spot.classList.contains('on') && spotHoles.length > 0;
    spotMove = lit ? {from: spotHoles, t0: performance.now()} : null;
    spotShape = shape;spotRects = rects;
    fitSpotlight(rects);
    if (spotMove) requestAnimationFrame(moveSpotlight);
    // Laid out unlit first, so it fades in rather than appearing.
    void spot.getBoundingClientRect();
    spot.classList.add('on');
}
/** Step the hole's glide each frame until it arrives (the marks' own refits keep it on target after). */
function moveSpotlight() {
    if (!spotMove || !spot?.classList.contains('on')) return;
    fitSpotlight(spotRects);
    if (spotMove) requestAnimationFrame(moveSpotlight);
}
function hideSpotlight() { spot?.classList.remove('on');spotMove = null; }
/** The hole for a mark on `rect`: the ring's own ellipse for a circle, else the box it is drawn on (an underline's takes in its line). */
function holeFor(rect: DOMRect, view: DOMRect): Hole {
    const x = rect.left - view.left, y = rect.top - view.top;
    if (spotShape === 'circle') {
        const {rx, ry} = ringRadii(rect);
        return {x: x + rect.width / 2 - rx, y: y + rect.height / 2 - ry, w: rx * 2, h: ry * 2, rx, ry};
    }
    const pad = 6, below = spotShape === 'underline' ? 12 : 0;
    return {x: x - pad, y: y - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 + below, rx: 6, ry: 6};
}
/** Lay the dimming over the 3D view, and nowhere else, with a hole for each mark, partway there while it glides. */
function fitSpotlight(rects: DOMRect[]) {
    const view = state.renderer?.domElement.getBoundingClientRect();
    if (!spot || !view) return;
    spotRects = rects;
    spot.style.left = `${view.left}px`;spot.style.top = `${view.top}px`;
    spot.setAttribute('width', String(view.width));spot.setAttribute('height', String(view.height));
    for (const r of spot.querySelectorAll('.ai-spotlight-all, .ai-spotlight-dim')) { r.setAttribute('width', String(view.width));r.setAttribute('height', String(view.height)); }
    let holes = rects.map(rect => holeFor(rect, view));
    if (spotMove) {
        const t = Math.min(1, (performance.now() - spotMove.t0) / SPOT_MOVE_MS), k = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        // Each new hole comes from an old one (the last, when there are more now); old ones beyond them close.
        const from = spotMove.from, lerp = (a: number, b: number) => a + (b - a) * k;
        holes = holes.map((h, i) => { const f = from[Math.min(i, from.length - 1)]!;return {x: lerp(f.x, h.x), y: lerp(f.y, h.y), w: lerp(f.w, h.w), h: lerp(f.h, h.h), rx: lerp(f.rx, h.rx), ry: lerp(f.ry, h.ry)}; });
        if (t >= 1) spotMove = null;
    }
    spotHoles = holes;
    spot.querySelector('.ai-spotlight-holes')!.innerHTML = holes.map(h =>
        `<rect fill="black" x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="${Math.min(h.rx, h.w / 2)}" ry="${Math.min(h.ry, h.h / 2)}"/>`).join('');
}
/**
 * What a mark goes round: the target, or with things `together` with it (a line each) the clusters they make:
 * things side by side share one ring, things apart get one each (a ring round both would take in all between).
 */
function markRects(ref: string, part: string): DOMRect[] {
    if (!ref.includes('\n')) { const r = resolveTarget(ref, part);return r ? [r] : []; }
    const clusters = ref.split('\n').map(x => resolveTarget(x, '')).filter((x): x is DOMRect => !!x);
    const near = (a: DOMRect, b: DOMRect) => {
        const gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right), Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        return gap <= Math.max(24, Math.min(a.height, b.height) * .8);
    };
    for (let merged = true; merged;) {
        merged = false;
        for (let i = 0; i < clusters.length && !merged; i++) for (let j = i + 1; j < clusters.length && !merged; j++) {
            const a = clusters[i]!, b = clusters[j]!;
            if (!near(a, b)) continue;
            const x0 = Math.min(a.left, b.left), y0 = Math.min(a.top, b.top);
            clusters[i] = new DOMRect(x0, y0, Math.max(a.right, b.right) - x0, Math.max(a.bottom, b.bottom) - y0);
            clusters.splice(j, 1);merged = true;
        }
    }
    return clusters;
}
/** Draw the mark as a hand would, the pointer making each stroke: a loop, a line, a tick, the two lines of a cross. */
async function traceMark(r: number) {
    if (!ring) return;
    for (const el of [ring, ...moreRings, ...markLinks]) for (const path of [...el.querySelectorAll('path')]) {
        const box = el.getBoundingClientRect(), total = path.getTotalLength(), start = path.getPointAtLength(0);
        await glide(box.left + start.x, box.top + start.y, r, 200);
        path.classList.add('tracing');
        const dur = Math.min(800, 220 + total * 1.6), t0 = performance.now();
        for (;;) {
            alive(r);
            const t = Math.min(1, (performance.now() - t0) / dur), k = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            path.style.setProperty('stroke-dashoffset', String(1 - k));
            const b = el.getBoundingClientRect(), p = path.getPointAtLength(total * k);
            pos.x = b.left + p.x;pos.y = b.top + p.y;paintPointer();
            if (t >= 1) break;
            await new Promise(res => requestAnimationFrame(res));
        }
    }
    for (const el of [ring, ...moreRings, ...markLinks]) el.classList.add('drawn');
}
/** The pointer shows while it moves and shows something; resting on what it showed, it goes after a moment. */
function showPointer() { ensurePointer().classList.add('on'); }
function restPointer() {
    if (!pointer?.classList.contains('on')) return;
    pointer.classList.remove('on');
    unhover();
}
/** How long the pointer stays on what it showed before it goes (the mark stays). */
const REST_MS = 1000;
// Who has the pointer: a beat holding it on its target, and an arrow drawing (which takes it from the hold).
let holding = false, drawingArrow = false;

/**
 * Show a target (or the `part` of a note) while `until` runs: the pointer goes to it and, if asked, draws a mark on
 * it (a circle round it, a line under it, a tick by it, a cross over it), rests there a second and goes; the mark
 * stays, following the target as the view moves, until the next beat.
 */
async function holdOn(ref: string, mark: Beat['mark'], r: number, until: Promise<void>, color = '', part = '') {
    let done = false;void until.then(() => { done = true; });
    holding = true;
    try { await holdPointer(ref, mark, r, () => done, color, part); } finally { holding = false; }
}
async function holdPointer(ref: string, mark: Beat['mark'], r: number, done: () => boolean, color: string, part: string) {
    showPointer();
    const at = resolveTarget(ref, part);
    if (at) await glide(at.left + at.width / 2, at.top + at.height / 2, r);
    let drawn = mark === 'point', since = 0;
    const t0 = performance.now();
    while (!done()) {
        alive(r);
        // An arrow being drawn has the pointer (it runs along it); it comes back here after, for its moment.
        if (drawingArrow) { since = 0;await new Promise(res => requestAnimationFrame(res));continue; }
        const now = resolveTarget(ref, part);
        if (now) {
            // A note written this beat appears while the pointer waits for it: its mark is drawn once it's there.
            if (!drawn) { drawRings(markRects(ref, part), color, mark as MarkShape);await traceMark(r);drawn = true;since = 0;continue; }
            if (mark !== 'point' && ring?.classList.contains('on')) fitRings(markRects(ref, part));
            since ||= performance.now();
            if (pointer?.classList.contains('on')) {
                // Held where it finished: the centre, or the end of the mark it drew.
                if (mark === 'point') {
                    const cx = now.left + now.width / 2, cy = now.top + now.height / 2;
                    pos.x += (cx - pos.x) * .35;pos.y += (cy - pos.y) * .35;paintPointer();
                }
                if (performance.now() - since > REST_MS) restPointer();
            }
        } else if (performance.now() - t0 > 4000) restPointer();   // nothing to show after all
        await new Promise(res => requestAnimationFrame(res));
    }
}

/** Move the run to frame `f` as a person would: onto the slider's thumb, press, drag along the track, release. */
async function dragSliderTo(f: number, r: number) {
    const s = playbackSlider(), from = s ? sliderPoint(s.value) : null, to = sliderPoint(f);
    if (!s || !from || !to) { if (s) setSliderValue(s.id, f);return; }
    window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
    await glide(from.x, from.y, r);
    ensurePointer().classList.add('pressed');await sleep(180);
    const steps = Math.abs(f - s.value), dir = Math.sign(f - s.value);
    for (let k = 1; k <= steps; k++) {
        alive(r);
        const v = s.value + dir * k, p = sliderPoint(v)!;
        await glide(p.x, p.y, r, Math.max(40, Math.min(160, 900 / steps)));
        setSliderValue(s.id, v);
    }
    await sleep(160);ensurePointer().classList.remove('pressed');
    await sleep(350);   // the view settles on the new state before the words about it
}

// ── The scratchpad: lines typed over the view, as a presenter writes on the board ──

let notes: Element[] = [];
// The board: notes sent to the top left, stacked like lines on a blackboard; erasing leaves them, the end clears them.
let board: HTMLElement[] = [];
// Each note by what was written, so a later beat can name it to wipe or to keep on the board.
const noteByText = new Map<string, HTMLElement>();
const noteKey = (t: string) => t.replace(/\s+/g, ' ').trim();
/** A note on the view, by what was written, or the `part` of it named (the box round those words); null when gone. */
function noteRect(text: string, part = ''): DOMRect | null {
    const note = noteByText.get(noteKey(text));
    if (!note?.isConnected || note.classList.contains('fading')) return null;
    const ink = note.querySelector('.ai-note-ink') ?? note;
    return (part && textRect(ink, part)) || ink.getBoundingClientRect();
}
/**
 * Where `part` is in `text`: the first place it stands as a whole word (the `p` of `build_lps(p)` is the parameter,
 * not the last letter of `lps`), else the first place at all; -1 if absent.
 */
export function partAt(text: string, part: string): number {
    const word = /\w/;
    for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
        const before = text[at - 1] ?? '', after = text[at + part.length] ?? '';
        if (!(word.test(part[0]!) && word.test(before)) && !(word.test(part.at(-1)!) && word.test(after))) return at;
    }
    return text.indexOf(part);
}
/** The box round `part` (see partAt) in the text shown under `root` (KaTeX's hidden MathML left out); null if absent. */
function textRect(root: Element, part: string): DOMRect | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentElement?.closest('.katex-mathml') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    const nodes: Text[] = [];let all = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n as Text);all += n.nodeValue ?? ''; }
    const at = partAt(all, part);
    if (at < 0) return null;
    const range = document.createRange();let seen = 0;
    for (const n of nodes) {
        const len = n.nodeValue?.length ?? 0;
        if (seen <= at && at < seen + len) range.setStart(n, at - seen);
        if (at + part.length <= seen + len) { range.setEnd(n, at + part.length - seen);break; }
        seen += len;
    }
    const box = range.getBoundingClientRect();
    return box.width ? box : null;
}
function notesLayer(): HTMLElement {
    let layer = document.getElementById('ai-scratchpad');
    if (!layer) { layer = document.createElement('div');layer.id = 'ai-scratchpad';layer.setAttribute('aria-live', 'polite');document.body.append(layer); }
    return layer;
}
const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
/**
 * Where a note of size w×h goes: beside `near` (right, else left, above, below), within the view and clear of the
 * notes already written; with nothing to sit beside, down the view's top-left corner.
 */
function placeNote(w: number, h: number, near: DOMRect | null): {x: number; y: number} {
    const view = state.renderer?.domElement.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    // Kept clear: the notes already written, what the note is about, and the panels drawn over the view (the
    // variables box, the step caption, the player): a note on top of them would hide what it explains.
    const panels = [...document.querySelectorAll<HTMLElement>('.annotation-badge, #step-caption, #state-player, .code-step-targets')]
        .filter(el => el.offsetParent).map(el => el.getBoundingClientRect());
    const gap = 16, taken = [...notes.filter(n => n.classList.contains('ai-note') || n.classList.contains('ai-drawing')).map(n => n.getBoundingClientRect()),
        ...board.map(n => n.getBoundingClientRect()), ...panels, ...(near ? [near] : [])]
        .filter(r => r.width);
    const fits = (x: number, y: number) => {
        const r = new DOMRect(x, y, w, h);
        return x >= view.left + 6 && y >= view.top + 6 && x + w <= view.right - 6 && y + h <= view.bottom - 6 && !taken.some(t => overlaps(r, t));
    };
    // Something inside a panel (a variables row) is written beside the panel, level with the row.
    const host = near ? panels.find(p => near.left >= p.left - 1 && near.right <= p.right + 1 && near.top >= p.top - 1 && near.bottom <= p.bottom + 1) : undefined;
    if (near && host) {
        const cy = near.top + near.height / 2 - h / 2;
        for (const [x, y] of [[host.right + gap, cy], [host.left - gap - w, cy], [host.left, host.top - gap - h], [host.left, host.bottom + gap]] as [number, number][])
            if (fits(x, y)) return {x, y};
    }
    if (near) {
        const cy = near.top + near.height / 2 - h / 2, cx = near.left + near.width / 2 - w / 2;
        for (const [x, y] of [[near.right + gap, cy], [near.left - gap - w, cy], [cx, near.top - gap - h], [cx, near.bottom + gap],
            [near.right + gap, cy + h + 8], [near.right + gap, cy - h - 8]] as [number, number][]) if (fits(x, y)) return {x, y};
    }
    // A free spot down the left of the view, then down its right.
    for (const x of [view.left + 24, view.right - w - 24]) for (let y = view.top + 56;y + h < view.bottom - 6;y += h + 10) if (fits(x, y)) return {x, y};
    return {x: view.left + 24, y: view.top + 56};
}
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
type Katex = {renderToString(t: string, o: object): string};
/**
 * A note's text as shown: plain text in the typing face, `code` in code colours, and $math$, when a note needs real
 * notation, set by KaTeX as the info overlays are (an unclosed one too, as it is being typed).
 */
function inkHtml(src: string): string {
    const katex = (window as unknown as {katex?: Katex}).katex;
    let out = '', i = 0;
    while (i < src.length) {
        const mark = src[i];
        if (mark === '$' || mark === '`') {
            const end = src.indexOf(mark, i + 1), body = src.slice(i + 1, end < 0 ? src.length : end);
            if (mark === '`') out += `<code>${esc(body)}</code>`;
            else if (body) out += mathHtml(body, end < 0, katex);
            i = end < 0 ? src.length : end + 1;
            continue;
        }
        const next = src.slice(i).search(/[$`]/), plain = next < 0 ? src.slice(i) : src.slice(i, i + next);
        out += /\\[A-Za-z]/.test(plain) ? strayMath(plain, katex) : esc(plain);i += plain.length;
    }
    return out;
}
/**
 * Plain text holding LaTeX commands the model wrote without $...$ ("temps[2]=75 \\ge temps[3]=71"): its formula runs
 * (words with a command, a digit, a bracket or an operator, and single letters) set as math, the words between as text.
 */
function strayMath(plain: string, katex?: Katex): string {
    const mathy = (w: string) => /\\[A-Za-z]|[\d=<>^_[\](){}+*|]/.test(w) || /^[A-Za-z]$/.test(w);
    let out = '', run: string[] = [];
    const flush = () => { if (run.length) out += mathHtml(run.join(' '), true, katex);run = []; };
    for (const part of plain.split(/(\s+)/)) {
        if (!part) continue;
        if (!part.trim()) { if (!run.length) out += esc(part);continue; }
        if (mathy(part)) { run.push(part);continue; }
        const after = run.length > 0;
        flush();out += (after ? ' ' : '') + esc(part);
    }
    flush();
    return out;
}
/**
 * Math set by KaTeX. Being typed (`open`), it is set as far as it goes: a command still being spelled is left out
 * and the braces still open are closed, so `\frac{1}{2` already reads as a fraction.
 */
function mathHtml(body: string, open: boolean, katex?: Katex): string {
    if (!katex) return esc(body);
    const tries = [body];
    if (open) {
        let cut = body;
        for (let k = 0; k < 3; k++) cut = cut.replace(/\\(begin|end)\{[A-Za-z*]*$/, '').replace(/\\[A-Za-z]*$/, '').replace(/[\\^_]$/, '');
        // Nothing settable yet (a command still being spelled): nothing shows, rather than its letters.
        if (!cut.trim()) return '';
        const depth = [...cut].reduce((d, c, i) => c === '{' && cut[i - 1] !== '\\' ? d + 1 : c === '}' && cut[i - 1] !== '\\' ? Math.max(0, d - 1) : d, 0);
        // Environments still open (a matrix being typed, row by row) are ended too.
        const open = [...cut.matchAll(/\\(begin|end)\{([A-Za-z*]+)\}/g)].reduce<string[]>((stack, m) => {
            if (m[1] === 'begin') stack.push(m[2]!);else stack.pop();
            return stack;
        }, []);
        tries.push(cut + '}'.repeat(depth) + open.reverse().map(env => `\\end{${env}}`).join(''));
    }
    for (const t of tries) if (t) try { return katex.renderToString(t, {throwOnError: true, displayMode: false}); } catch { /* next */ }
    return `<span class="ai-note-raw">${esc(body)}</span>`;
}
/** Type `text` as a note over the view at a person's pace: plain text in the typing face, $math$ set key by key. */
/** The presenter's colours (style.css `.ai-ink-*`); green when none is named. */
const INKS = new Set(['yellow', 'red', 'blue', 'purple', 'orange', 'pink']);
const inkClass = (color?: string) => color && INKS.has(color) ? `ai-ink-${color}` : '';

async function typeNote(text: string, near: string, r: number, onBoard = false, color = ''): Promise<HTMLElement> {
    const note = document.createElement('div');note.className = `ai-note ${inkClass(color)}`.trim();note.title = 'Drag to move';
    makeMovable(note);
    const ink = document.createElement('span');ink.className = 'ai-note-ink';
    const caret = document.createElement('span');caret.className = 'ai-note-caret';
    note.append(ink, caret);notesLayer().append(note);
    // Its place, from its full size: measured fully set, then emptied to be typed.
    ink.innerHTML = inkHtml(text);
    const size = note.getBoundingClientRect(), at = onBoard ? boardSlot() : placeNote(size.width + 12, size.height, near ? resolveTarget(near) : null);
    note.style.left = `${at.x}px`;note.style.top = `${at.y}px`;ink.textContent = '';
    if (onBoard) { board.push(note);note.classList.add('boarded'); } else notes.push(note);
    noteByText.set(noteKey(text), note);
    note.classList.add('on');
    // Each key shows what is typed so far; the $ and backtick marks aren't keys anyone sees pressed.
    let prev = '\n';
    for (let k = 1; k <= text.length; k++) {
        const ch = text[k - 1]!;
        if (ch === '$' || ch === '`') continue;
        alive(r);
        await sleep(keyDelay(prev, ch));
        ink.innerHTML = inkHtml(text.slice(0, k));prev = ch;
    }
    // Typed: it stays as it was typed (the typing face reads best on the view); only the caret goes.
    await sleep(250);
    note.classList.add('set');
    return note;
}
/** The point where the line from a rect's centre towards (x, y) leaves the rect, `pad` outside it. */
function edgeToward(r: DOMRect, x: number, y: number, pad: number): {x: number; y: number} {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, dx = x - cx, dy = y - cy;
    const hw = r.width / 2 + pad, hh = r.height / 2 + pad;
    const t = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity, 1);
    return {x: cx + dx * t, y: cy + dy * t};
}
/**
 * A hand-drawn arrow from one rect to another: a gently bowed, slightly wobbly stroke drawn out from its tail,
 * then its head, two quick strokes. It stays with the notes and goes when they are wiped.
 */
// Arrows starting at a note: redrawn when the learner moves the note.
const arrowsFrom = new WeakMap<Element, (() => void)[]>();
async function drawArrow(from: () => DOMRect | null, to: () => DOMRect | null, r: number, fromNote: Element | null = null, color = '', kind: 'arrow' | 'line' | 'both' = 'arrow') {
    // Its hand: which side it bows to, and its wobble, kept so a redraw is the same stroke, moved.
    const side = Math.random() < .5 ? -1 : 1, jitter = [Math.random() - .5, Math.random() - .5, Math.random() - .5, Math.random() - .5];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');svg.classList.add('ai-arrow');
    if (inkClass(color)) svg.classList.add(inkClass(color));
    // How much of the shaft is drawn so far (0..1), kept for a redraw while it is being drawn.
    let drawnSoFar = 0;
    const shaft = () => svg.querySelector<SVGPathElement>('.ai-arrow-shaft');
    const shape = (): number => {
        const f = from(), t = to();
        if (!f || !t) return 0;
        const fc = {x: f.left + f.width / 2, y: f.top + f.height / 2}, tc = {x: t.left + t.width / 2, y: t.top + t.height / 2};
        const a = edgeToward(f, tc.x, tc.y, kind === 'both' ? 7 : 4), b = edgeToward(t, fc.x, fc.y, kind === 'line' ? 4 : 7);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 12) { svg.innerHTML = '';return 0; }
        // A bow to one side, and a hand's wobble: two control points off the straight line.
        const nx = -dy / len, ny = dx / len, bow = side * Math.min(60, len * .18), wob = (k: number) => jitter[k]! * Math.min(10, len * .04);
        const c1 = {x: a.x + dx * .3 + nx * bow + wob(0), y: a.y + dy * .3 + ny * bow + wob(1)};
        const c2 = {x: a.x + dx * .7 + nx * bow * .8 + wob(2), y: a.y + dy * .7 + ny * bow * .8 + wob(3)};
        // A head follows the curve's direction into its tip: at the end, and for "both" at the start too.
        const headAt = (tip: Point, from: Point) => {
            const ex = tip.x - from.x, ey = tip.y - from.y, el = Math.hypot(ex, ey) || 1, ux = ex / el, uy = ey / el, head = 13;
            const wing = (k: number) => { const c = Math.cos(k), s = Math.sin(k);return {x: tip.x - head * (ux * c - uy * s), y: tip.y - head * (uy * c + ux * s)}; };
            const w1 = wing(.48), w2 = wing(-.42);
            return `M${w1.x},${w1.y} L${tip.x},${tip.y} L${w2.x},${w2.y}`;
        };
        const heads = [...(kind !== 'line' ? [headAt(b, c2)] : []), ...(kind === 'both' ? [headAt(a, c1)] : [])];
        const d = `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, drawnHeads = svg.querySelectorAll('.ai-arrow-head');
        // Moved, it keeps its strokes and only reshapes them: new ones would draw their heads again.
        if (shaft() && drawnHeads.length === heads.length) {
            shaft()!.setAttribute('d', d);
            drawnHeads.forEach((h, k) => h.setAttribute('d', heads[k]!));
        } else svg.innerHTML = `<path class="ai-arrow-shaft" pathLength="1" d="${d}"/>` + heads.map(h => `<path class="ai-arrow-head" pathLength="1" d="${h}"/>`).join('');
        if (!svg.classList.contains('drawn')) shaft()?.style.setProperty('stroke-dashoffset', String(1 - drawnSoFar));
        return len;
    };
    const len = shape();
    if (!len) return;
    notesLayer().append(svg);notes.push(svg);
    if (fromNote) arrowsFrom.set(fromNote, [...(arrowsFrom.get(fromNote) ?? []), shape]);
    // What it joins on the view moves as the scene plays, turns or is resized: put it in place again every frame
    // while it's up (only when an end moved).
    let was = '';
    const follow = () => {
        if (!svg.isConnected) return;
        const f = from(), t = to(), now = f && t ? [f.left, f.top, f.width, f.height, t.left, t.top, t.width, t.height].map(Math.round).join() : '';
        if (now && now !== was) { was = now;shape(); }
        requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
    // The pointer draws it: onto its start, then along the stroke as it appears; then the beat has it back.
    drawingArrow = true;
    try {
        const start = shaft()?.getPointAtLength(0);
        if (start) await glide(start.x, start.y, r, 260);
        svg.classList.add('tracing');
        const dur = Math.min(900, 350 + len * .6), t0 = performance.now();
        for (;;) {
            alive(r);
            const t = Math.min(1, (performance.now() - t0) / dur);
            drawnSoFar = 1 - Math.pow(1 - t, 2);
            const path = shaft();
            if (path) {
                path.style.setProperty('stroke-dashoffset', String(1 - drawnSoFar));
                const p = path.getPointAtLength(path.getTotalLength() * drawnSoFar);
                pos.x = p.x;pos.y = p.y;paintPointer();
            }
            if (t >= 1) break;
            await new Promise(res => requestAnimationFrame(res));
        }
        svg.classList.add('drawn');
        if (kind !== 'line') { svg.classList.add('headed');await sleep(220); }
    } finally {
        drawingArrow = false;
    }
    // With no target to go back to, the pointer rests at the arrow's end a moment and goes.
    if (!holding) window.setTimeout(() => { if (!holding && !drawingArrow) restPointer(); }, REST_MS);
}
// ── Drawing: a small diagram the pointer sketches over the view (a beat's `draw`) ──

interface Drawn { spec: DrawSpec; paths: SVGPathElement[]; label: HTMLElement | null; place: () => void; local: () => DOMRect | null }
/**
 * The walk-through's drawing board: one box over the view that every beat's drawing adds to. The drawing is laid
 * out in its own space (`canvas`), fitted into the board by `view` (scaled down when it's bigger, centred); a group
 * the learner dragged keeps its offset (`moved`).
 */
interface Sketch {
    el: HTMLDivElement; canvas: HTMLDivElement; svg: SVGSVGElement; w: number; h: number; layout: string;
    specs: DrawSpec[]; laid: Laid; view: {ox: number; oy: number; s: number}; moved: Map<DrawSpec, Point>;
    items: Map<string, Drawn>; all: Drawn[]; groups: Map<DrawSpec, HTMLDivElement>; hits: Map<DrawSpec, HTMLDivElement>;
    /** The drawing itself, a group around all of it: its title drags the whole board. */
    root: DrawSpec;
    /** Sized by the learner (its corner dragged): the drawing then fills the board, larger than drawn if need be. */
    sized?: boolean;
    /** Groups the learner resized by their corner: how much what is in each is scaled, about the group's top left. */
    zoom: Map<DrawSpec, number>;
    /** Laid out again: where things were and how the board was fitted, as they glide to their new places. */
    glide: {from: Map<DrawSpec, Rect>; view: {ox: number; oy: number; s: number}; to: {ox: number; oy: number; s: number}; t0: number} | null;
}
let sketch: Sketch | null = null;
const SVG_NS = 'http://www.w3.org/2000/svg';
const LABEL_FONT = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
let measurer: CanvasRenderingContext2D | null = null;
const textWidth = (t: string) => { measurer ??= document.createElement('canvas').getContext('2d');if (!measurer) return t.length * 9;measurer.font = LABEL_FONT;return measurer.measureText(t).width; };

/**
 * A shape's size in px within a box `within` (its group's, or the board): w and h on that box's grid, never
 * smaller than its label; a circle with only a w is round. Text is as big as its words.
 */
function shapeSize(spec: DrawSpec, within: {w: number; h: number}): {w: number; h: number} {
    // $math$ measured about as it shows: a command (\omega) as one symbol, no braces or scripts' marks.
    const shown = (spec.label ?? '').replace(/\$([^$]*)\$?/g, (_, m: string) => m.replace(/\\[a-zA-Z]+\s*/g, 'x').replace(/[{}_^\\]/g, ''));
    const tw = textWidth(shown);
    if (spec.type === 'text') return {w: tw * 14 / 15 + 6, h: 20};
    // An ellipse holds less than its box: wide enough that a line of text inside clears its curve.
    const fit = spec.type === 'diamond' ? tw * 1.6 + 30 : spec.type === 'ellipse' ? Math.max(36, tw * 1.22 + 26) : Math.max(34, tw + 22);
    const w = Math.max(fit, spec.w ? spec.w / 100 * within.w : 0);
    const h = spec.h ? Math.max(spec.h / 100 * within.h, 30) : spec.type === 'diamond' ? 46 : spec.type === 'ellipse' ? (spec.w || tw < 20 ? w : 42) : 32;
    return {w, h};
}
/** The group a spec sits in, if it names one on the board. */
const groupOf = (b: Sketch, e: DrawSpec) => e.group ? b.specs.find(g => g.type === 'group' && g.id === e.group) ?? null : null;
/** How far the learner dragged it: its own drag and its groups'. */
function offsetOf(b: Sketch, e: DrawSpec): Point {
    const o = {x: 0, y: 0};
    for (let g: DrawSpec | null = e, i = 0; g && i < 50; g = groupOf(b, g), i++) { const m = b.moved.get(g);if (m) { o.x += m.x;o.y += m.y; } }
    return o;
}
/** A laid-out element's box in the drawing's space, where the learner left it. */
function boxOf(b: Sketch, e: DrawSpec): DOMRect | null {
    const r = laidBox(b, e);
    if (!r) return null;
    const o = offsetOf(b, e);
    let x = r.x + o.x, y = r.y + o.y, w = r.w, h = r.h;
    // Each group around it that the learner resized scales it about that group's top left, innermost first.
    for (let g = groupOf(b, e), i = 0; g && i < 50; g = groupOf(b, g), i++) {
        const z = b.zoom.get(g), gr = z && z !== 1 ? laidBox(b, g) : null;
        if (!z || !gr) continue;
        const go = offsetOf(b, g), gx = gr.x + go.x, gy = gr.y + go.y;
        x = gx + (x - gx) * z;y = gy + (y - gy) * z;w *= z;h *= z;
    }
    return new DOMRect(x, y, w, h);
}
/** How long things take to glide to where a new layout puts them, and how far along they are. */
const GLIDE_MS = 480;
const glideK = (b: Sketch) => { if (!b.glide) return 1;const t = Math.min(1, (performance.now() - b.glide.t0) / GLIDE_MS);return 1 - Math.pow(1 - t, 3); };
const mix = (a: number, z: number, k: number) => a + (z - a) * k;
/** Where the layout has it now: on its way from its old place to its new one while a new layout glides in. */
function laidBox(b: Sketch, e: DrawSpec): Rect | null {
    const r = b.laid.boxes.get(e), f = b.glide?.from.get(e);
    if (!r || !f) return r ?? null;
    const k = glideK(b);
    return {x: mix(f.x, r.x, k), y: mix(f.y, r.y, k), w: mix(f.w, r.w, k), h: mix(f.h, r.h, k)};
}
/**
 * A group's box as it is now: where it was laid out, grown to hold what is in it wherever the learner dragged it.
 * Its background and the links to it use this.
 */
function extentOf(b: Sketch, g: DrawSpec, depth = 0): DOMRect | null {
    const root = g === b.root;
    let r = root ? new DOMRect(0, 0, b.laid.w, b.laid.h) : boxOf(b, g);
    if (!r || depth > 20) return r;
    for (const e of b.specs) {
        if ((root ? groupOf(b, e) !== null : groupOf(b, e) !== g) || e.type === 'path' || LINKS.has(e.type)) continue;
        const c = e.type === 'group' ? extentOf(b, e, depth + 1) : b.all.find(d => d.spec === e)?.local() ?? null;
        if (!c) continue;
        const x0 = Math.min(r.left, c.left), y0 = Math.min(r.top, c.top), x1 = Math.max(r.right, c.right), y1 = Math.max(r.bottom, c.bottom);
        r = new DOMRect(x0, y0, x1 - x0, y1 - y0);
    }
    return r;
}
/** The box a picture's points are on: its group's, or the whole drawing's. */
function frameOf(b: Sketch, e: DrawSpec): DOMRect {
    const g = groupOf(b, e);
    return (g && boxOf(b, g)) || new DOMRect(0, 0, b.laid.w, b.laid.h);
}
const toScreen = (b: Sketch, x: number, y: number) => {
    const o = b.el.getBoundingClientRect();
    return {x: o.left + b.view.ox + x * b.view.s, y: o.top + b.view.oy + y * b.view.s};
};
const fromScreen = (b: Sketch, r: DOMRect) => {
    const o = b.el.getBoundingClientRect(), s = b.view.s;
    return new DOMRect((r.left - o.left - b.view.ox) / s, (r.top - o.top - b.view.oy) / s, r.width / s, r.height / s);
};

/** Lay the drawing out again, fit it to the board, and put everything where it now goes. */
function layoutBoard(b: Sketch, grow = true) {
    // What is drawn glides from where it is now; what is new starts in its place.
    const from = new Map<DrawSpec, Rect>();
    for (const e of b.laid.boxes.keys()) { const r = laidBox(b, e);if (r) from.set(e, r); }
    const first = !from.size;
    b.laid = layoutDrawing(b.specs, b.layout, {box: {w: b.w, h: b.h}, sizeOf: shapeSize});
    const pad = 12, fit = () => Math.min(b.sized ? 4 : 1, (b.w - 2 * pad) / Math.max(1, b.laid.w), (b.h - 2 * pad) / Math.max(1, b.laid.h));
    // Grown too big to read at this size: the board grows (as far as the view allows) rather than shrink it further.
    // Not while the learner sizes it: a board they make small stays small.
    if (grow && fit() < MIN_SCALE) {
        const view = state.renderer?.domElement.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
        const w = Math.min(view.width * .92, Math.max(b.w, b.laid.w * MIN_SCALE + 2 * pad)), h = Math.min(view.height * .88, Math.max(b.h, b.laid.h * MIN_SCALE + 2 * pad));
        if (w > b.w + 1 || h > b.h + 1) { sizeBoard(b, w, h);b.laid = layoutDrawing(b.specs, b.layout, {box: {w: b.w, h: b.h}, sizeOf: shapeSize}); }
    }
    const s = fit();
    // Held at the board's top left: the board grows (by itself, or by its corner) to the right and down, and what is
    // drawn stays where it is.
    const to = {ox: pad, oy: pad, s};
    if (first) {
        b.glide = null;b.view = to;fitCanvas(b);placeAll(b);
        return;
    }
    const running = !!b.glide;
    b.glide = {from, view: {...b.view}, to, t0: performance.now()};
    if (running) return;
    const tick = () => {
        if (!b.glide || !b.el.isConnected) return;
        const k = glideK(b), {view: v, to: z} = b.glide;
        b.view = {ox: mix(v.ox, z.ox, k), oy: mix(v.oy, z.oy, k), s: mix(v.s, z.s, k)};
        fitCanvas(b);placeAll(b);
        if (k < 1) requestAnimationFrame(tick);
        else b.glide = null;
    };
    tick();
}
/** Below this the drawing would be too small to read: the board grows instead. */
const MIN_SCALE = .75;
/** The board's size in px: its top left stays put, and it grows no further than the window's edge. */
function sizeBoard(b: Sketch, w: number, h: number) {
    const left = parseFloat(b.el.style.left), top = parseFloat(b.el.style.top);
    b.w = Math.round(Math.max(80, Math.min(w, innerWidth - 8 - left)));b.h = Math.round(Math.max(60, Math.min(h, innerHeight - 8 - top)));
    b.el.style.width = `${b.w}px`;b.el.style.height = `${b.h}px`;
}
const fitCanvas = (b: Sketch) => { b.canvas.style.transform = `translate(${b.view.ox}px, ${b.view.oy}px) scale(${b.view.s})`; };
function placeAll(b: Sketch) {
    for (const item of b.all) item.place();
    for (const [g, el] of b.groups) {
        const r = extentOf(b, g);
        if (!r) continue;
        // Room above for its title; a group holding groups has more room round them, so its edge and corner stay
        // outside theirs, where they can be reached.
        // In screen px whatever the scale: scaled with the drawing, its top left would move as the board is resized.
        const n = nesting(b, g), side = (12 + 10 * n) / b.view.s, head = (34 + 30 * n) / b.view.s;
        el.style.left = `${r.left - side}px`;el.style.top = `${r.top - head}px`;el.style.width = `${r.width + 2 * side}px`;el.style.height = `${r.height + head + side}px`;
    }
    for (const [e, el] of b.hits) {
        const r = b.all.find(d => d.spec === e)?.local();
        if (!r) continue;
        el.style.left = `${r.left - 4}px`;el.style.top = `${r.top - 4}px`;el.style.width = `${r.width + 8}px`;el.style.height = `${r.height + 8}px`;
    }
}

/** Drag `el` to move what it holds: `drag` gets each step of the move in screen px. */
function draggable(el: HTMLElement, drag: (dx: number, dy: number) => void, lit: HTMLElement = el) {
    el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();e.stopPropagation();el.setPointerCapture(e.pointerId);lit.classList.add('dragging');
        let x = e.clientX, y = e.clientY;
        const move = (ev: PointerEvent) => { drag(ev.clientX - x, ev.clientY - y);x = ev.clientX;y = ev.clientY; };
        const up = () => { el.removeEventListener('pointermove', move);lit.classList.remove('dragging'); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up, {once: true});el.addEventListener('pointercancel', up, {once: true});
    });
}
/** Move a drawn element (and what is in it) by a drag of (dx, dy) screen px; the links to it follow. */
function nudge(b: Sketch, e: DrawSpec, dx: number, dy: number) {
    const m = b.moved.get(e) ?? {x: 0, y: 0};
    b.moved.set(e, {x: m.x + dx / b.view.s, y: m.y + dy / b.view.s});
    placeAll(b);
}
/** How deep the groups inside `g` go: 0 when it holds none. */
function nesting(b: Sketch, g: DrawSpec, depth = 0): number {
    if (depth > 20) return 0;
    const inner = b.specs.filter(e => e.type === 'group' && (g === b.root ? !groupOf(b, e) : groupOf(b, e) === g));
    return inner.length ? 1 + Math.max(...inner.map(e => nesting(b, e, depth + 1))) : 0;
}
/** How much the groups around `e` that the learner resized scale it: its words grow and shrink with its box. */
function zoomOf(b: Sketch, e: DrawSpec): number {
    let z = 1;
    for (let g = groupOf(b, e), i = 0; g && i < 50; g = groupOf(b, g), i++) z *= b.zoom.get(g) ?? 1;
    return z;
}
/** The groups `e` sits in, innermost first. */
function groupsAround(b: Sketch, e: DrawSpec): DrawSpec[] {
    const out: DrawSpec[] = [];
    for (let g = groupOf(b, e), i = 0; g && i < 50; g = groupOf(b, g), i++) out.push(g);
    return out;
}
/**
 * A group's handle, under its shapes: pointed at (or anything in it), it lights up behind them, the scene dimmed,
 * so they read over a busy view, and shows its title; the title drags the whole group.
 */
function groupHandle(b: Sketch, g: DrawSpec): HTMLDivElement {
    const el = document.createElement('div');el.className = 'ai-draw-group';
    const title = document.createElement('div');title.className = 'ai-draw-group-title';
    title.textContent = g.label || g.id || '';title.title = 'Drag to move';
    el.append(title);
    // The drawing's own title moves the board; a group's moves the group.
    draggable(title, (dx, dy) => {
        if (g !== b.root) { nudge(b, g, dx, dy);return; }
        b.el.style.left = `${parseFloat(b.el.style.left) + dx}px`;b.el.style.top = `${parseFloat(b.el.style.top) + dy}px`;
        placeAll(b);   // links to the view stay on what they join there
    }, el);
    // Pointed at, the groups around it light too (and the drawing), so their titles and corners can be reached.
    const light = (on: boolean) => { for (const o of g === b.root ? [] : [...groupsAround(b, g), b.root]) b.groups.get(o)?.classList.toggle('lit', on); };
    el.addEventListener('pointerenter', e => { if (e.isTrusted) light(true); });
    el.addEventListener('pointerleave', e => { if (e.isTrusted) light(false); });
    const grip = document.createElement('div');grip.className = 'ai-draw-resize';grip.title = 'Drag to resize';
    el.append(grip);
    // A group's corner scales what is in it, about its top left; the container grows with it.
    if (g !== b.root) draggable(grip, (dx, dy) => {
        const r = extentOf(b, g);
        if (!r || r.width < 1 || r.height < 1) return;
        const f = Math.max((r.width + dx / b.view.s) / r.width, (r.height + dy / b.view.s) / r.height);
        b.zoom.set(g, Math.min(4, Math.max(.3, (b.zoom.get(g) ?? 1) * f)));
        placeAll(b);
    }, el);
    // The drawing's corner resizes the board: what is drawn is laid out and fitted to it again.
    if (g === b.root) {
        draggable(grip, (dx, dy) => {
            if (!b.sized) {
                // First, the board shrinks to the drawing as it is now, so the drag scales what is seen, with no jump.
                const pad = 12;
                b.w = b.laid.w * b.view.s + 2 * pad;b.h = b.laid.h * b.view.s + 2 * pad;b.sized = true;
            }
            sizeBoard(b, b.w + dx, b.h + dy);b.glide = null;b.laid = {boxes: new Map(), w: b.w, h: b.h};layoutBoard(b, false); }, el);
    }
    // Parents first, so a group inside another is on top of it.
    b.canvas.insertBefore(el, b.svg);
    b.groups.set(g, el);
    return el;
}
/** A shape's or a word's own handle, over it: drag it anywhere, and it lights its groups while pointed at. */
function nodeHandle(b: Sketch, e: DrawSpec): HTMLDivElement {
    const el = document.createElement('div');el.className = 'ai-draw-hit';el.title = 'Drag to move';
    draggable(el, (dx, dy) => nudge(b, e, dx, dy));
    const light = (on: boolean) => { for (const g of [...groupsAround(b, e), b.root]) b.groups.get(g)?.classList.toggle('lit', on); };
    // The learner's own mouse only: the presenter's pointer hovers the view with made-up events, and must not light
    // the drawing it draws.
    el.addEventListener('pointerenter', e => { if (e.isTrusted) light(true); });
    el.addEventListener('pointerleave', e => { if (e.isTrusted) light(false); });
    b.canvas.append(el);
    b.hits.set(e, el);
    return el;
}

/** The board, made on the first drawing: a wide box (3 by 2) in a free part of the view, clear of notes and panels. */
function sketchBoard(): Sketch {
    if (sketch?.el.isConnected && !sketch.el.classList.contains('fading')) return sketch;
    const view = state.renderer?.domElement.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const w = Math.round(Math.max(300, Math.min(560, view.width * .62, (view.height - 120) * 1.5))), h = Math.round(w * 2 / 3);
    const el = document.createElement('div');el.className = 'ai-drawing';
    const at = placeNote(w, h, null);
    el.style.left = `${at.x}px`;el.style.top = `${at.y}px`;el.style.width = `${w}px`;el.style.height = `${h}px`;
    const canvas = document.createElement('div');canvas.className = 'ai-drawing-canvas';
    const svg = document.createElementNS(SVG_NS, 'svg');
    canvas.append(svg);el.append(canvas);notesLayer().append(el);notes.push(el);
    sketch = {el, canvas, svg, w, h, layout: '', specs: [], laid: {boxes: new Map(), w, h}, view: {ox: 0, oy: 0, s: 1}, moved: new Map(),
        items: new Map(), all: [], groups: new Map(), hits: new Map(), root: {type: 'group', label: 'Drawing'}, glide: null, zoom: new Map()};
    groupHandle(sketch, sketch.root).classList.add('ai-draw-root');
    return sketch;
}
/**
 * Links with an end on the view (a cell, a chart bar, a note), not on the board: what they join there moves as the
 * scene plays, turns or is resized, so they are put in place again every frame while there are any.
 */
const linksToView = (b: Sketch) => b.all.filter(d => LINKS.has(d.spec.type) && [d.spec.start, d.spec.end].some(e => e && !b.items.has(e)));
let followingView = false;
function followView(b: Sketch) {
    if (followingView) return;
    followingView = true;
    const tick = () => {
        const live = sketch === b && b.el.isConnected && !b.el.classList.contains('fading') ? linksToView(b) : [];
        if (!live.length) { followingView = false;return; }
        if (!b.glide) for (const d of live) d.place();
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
/** A drawn shape's box on screen, or the `part` of its label; null when it's gone. */
function drawnRect(id: string, part = ''): DOMRect | null {
    const b = sketch, item = b?.el.isConnected ? b.items.get(id) : undefined;
    if (!item || !b) return null;
    if (part && item.label) { const t = textRect(item.label, part);if (t) return t; }
    const l = item.local();
    if (!l) return null;
    const p = toScreen(b, l.left, l.top);
    return new DOMRect(p.x, p.y, l.width * b.view.s, l.height * b.view.s);
}
/**
 * Where a link's end is now, in the drawing's space: anything drawn (a shape, a group, text, another link) by its
 * id, or a ref on the view. Read on every redraw, so a link follows what it joins as it's laid out or dragged.
 */
function linkEnd(name: string): {type: string; cx: number; cy: number; w: number; h: number} | null {
    const b = sketch;
    if (!b) return null;
    const item = b.items.get(name);
    const r = item ? item.local() : (() => { const v = resolveTarget(name);return v ? fromScreen(b, v) : null; })();
    if (!r) return null;
    return {type: item && SHAPES.has(item.spec.type) ? item.spec.type : 'rectangle', cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height};
}
/** The pointer draws `path` (in the drawing's space) as a hand would: onto its start, then along it as it appears. */
async function traceStroke(path: SVGPathElement, r: number, speed = 1) {
    const b = sketch;
    if (!b) return;
    const total = path.getTotalLength(), s0 = path.getPointAtLength(0), p0 = toScreen(b, s0.x, s0.y);
    await glide(p0.x, p0.y, r, 220);
    path.classList.add('tracing');
    const dur = Math.min(900, 200 + total * b.view.s * 1.3) / speed, t0 = performance.now();
    for (;;) {
        alive(r);
        const t = Math.min(1, (performance.now() - t0) / dur), k = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        path.style.setProperty('stroke-dashoffset', String(1 - k));
        const p = path.getPointAtLength(total * k), at = toScreen(b, p.x, p.y);
        pos.x = at.x;pos.y = at.y;paintPointer();
        if (t >= 1) break;
        await new Promise(res => requestAnimationFrame(res));
    }
    path.classList.add('drawn');
}
/** Write a label key by key, quicker than a note, the pointer moving along with the words. */
async function typeLabel(el: HTMLElement, text: string, r: number) {
    el.textContent = '';
    let prev = '\n', shown = '';
    for (const ch of text) {
        alive(r);
        await sleep(keyDelay(prev, ch) * .45);
        // As a note is: $math$ set by KaTeX (an unclosed one too, as it is being typed), `code` in code colours.
        shown += ch;el.innerHTML = inkHtml(shown);prev = ch;
        const b = el.getBoundingClientRect();
        pos.x += (b.right - pos.x) * .5;pos.y += (b.bottom - 2 - pos.y) * .5;paintPointer();
    }
}
const newPath = (cls: string, color: string) => {
    const p = document.createElementNS(SVG_NS, 'path');p.setAttribute('pathLength', '1');
    p.setAttribute('class', `${cls} ${inkClass(color)}`.trim());
    return p;
};
const newLabel = (b: Sketch, cls: string, ink: string) => {
    const lab = Object.assign(document.createElement('div'), {className: `ai-draw-label ${cls} ${inkClass(ink)}`.replace(/\s+/g, ' ').trim()});
    b.canvas.append(lab);
    return lab;
};

/** Draw a beat's drawing on the board: each element in turn, the pointer making its strokes and writing its words. */
async function drawSketch(d: Drawing, color: string, r: number) {
    const b = sketchBoard();
    // What is on the board already (a beat repeating the drawing so far) stays as it is: only the new is drawn.
    const fresh = d.elements.filter(e => !e.id || !b.items.has(e.id));
    b.specs.push(...fresh);
    if (d.layout) b.layout = d.layout;
    // Laid out with everything this beat adds, before any of it is drawn: what is already drawn moves once, to
    // where it goes, and each new thing is drawn in its place.
    for (const g of fresh) if (g.type === 'group' && g.id) {
        groupHandle(b, g);
        const item: Drawn = {spec: g, paths: [], label: null, place: () => undefined, local: () => extentOf(b, g)};
        b.items.set(g.id, item);b.all.push(item);
    }
    layoutBoard(b);
    drawingArrow = true;
    try {
        for (const spec of fresh) {
            alive(r);
            const ink = spec.color || color;
            if (SHAPES.has(spec.type)) {
                const label = spec.label ?? '';
                const jitter = [Math.random() - .5, Math.random() - .5, Math.random() - .5, Math.random() - .5];
                const path = newPath('ai-draw-stroke', ink);b.svg.append(path);
                const lab = label ? newLabel(b, '', ink) : null;
                const local = () => boxOf(b, spec);
                const place = () => {
                    const l = local();
                    if (!l) return;
                    path.setAttribute('d', shapeStroke(spec.type, l.left + l.width / 2, l.top + l.height / 2, l.width, l.height, jitter));
                    if (lab) { lab.style.left = `${l.left + l.width / 2}px`;lab.style.top = `${l.top + l.height / 2}px`;lab.style.scale = String(zoomOf(b, spec)); }
                };
                const item: Drawn = {spec, paths: [path], label: lab, place, local};
                if (spec.id) b.items.set(spec.id, item);
                b.all.push(item);
                place();
                await traceStroke(path, r);
                if (lab) await typeLabel(lab, label, r);
                nodeHandle(b, spec);placeAll(b);
            } else if (spec.type === 'outline' && spec.around?.length) {
                // A contour round what it picks out, wherever they are now; its label just above it.
                const path = newPath('ai-draw-stroke', ink);b.svg.append(path);
                const lab = spec.label ? newLabel(b, '', ink) : null;
                const hull = () => hullAround(spec.around!.map(id => b.items.get(id)?.local()).filter((x): x is DOMRect => !!x).map(x => ({x: x.left, y: x.top, w: x.width, h: x.height})));
                const place = () => {
                    const h = hull();
                    if (h.length < 3) return;
                    path.setAttribute('d', smoothPath(h, true));
                    if (lab) { const top = Math.min(...h.map(p => p.y)), mid = h.reduce((a, p) => a + p.x, 0) / h.length;lab.style.left = `${mid}px`;lab.style.top = `${top - 12}px`; }
                };
                const local = () => { const bb = path.getBBox();return bb.width ? new DOMRect(bb.x, bb.y, bb.width, bb.height) : null; };
                const item: Drawn = {spec, paths: [path], label: lab, place, local};
                if (spec.id) b.items.set(spec.id, item);
                b.all.push(item);
                place();
                await traceStroke(path, r);
                if (lab) await typeLabel(lab, spec.label!, r);
            } else if (LINKS.has(spec.type) && ((spec.start && spec.end) || (spec.points?.length ?? 0) >= 2)) {
                // Its heads: at the end (an arrow's default), the start, both, or none (a line).
                const heads = spec.type === 'line' ? 'none' : spec.heads || 'end';
                const atEnd = heads === 'end' || heads === 'both', atStart = heads === 'start' || heads === 'both';
                const shaft = newPath('ai-draw-stroke', ink);
                const head = atEnd ? newPath('ai-draw-stroke', ink) : null, tail = atStart ? newPath('ai-draw-stroke', ink) : null;
                b.svg.append(shaft);if (head) b.svg.append(head);if (tail) b.svg.append(tail);
                // A name beside it (a vector's "a"), written once it's drawn, off the middle of the shaft.
                const lab = spec.label ? newLabel(b, '', ink) : null;
                const bow = (Math.random() - .5) * .25;
                const free = !(spec.start && spec.end);
                const pts = () => { const f = frameOf(b, spec);return spec.points!.map(([x = 0, y = 0]) => ({x: f.left + x / 100 * f.width, y: f.top + y / 100 * f.height})); };
                const place = () => {
                    // The shaft from a to z; (mx, my) is where it comes into z from, (nx, ny) where it leaves a towards.
                    let a: Point, z: Point, mx: number, my: number, nx: number, ny: number;
                    if (free) {
                        const ps = pts();
                        a = ps[0]!;z = ps[ps.length - 1]!;
                        if (ps.length > 2) {
                            shaft.setAttribute('d', smoothPath(ps));
                            ({x: mx, y: my} = ps[ps.length - 2]!);({x: nx, y: ny} = ps[1]!);
                        } else {
                            mx = nx = (a.x + z.x) / 2;my = ny = (a.y + z.y) / 2;
                            shaft.setAttribute('d', `M${a.x} ${a.y} L${z.x} ${z.y}`);
                        }
                    } else {
                        const s = linkEnd(spec.start!), e = linkEnd(spec.end!);
                        if (!s || !e) return;
                        a = edgePoint(s.type, s.cx, s.cy, s.w, s.h, {x: e.cx, y: e.cy}, tail ? 5 : 3);z = edgePoint(e.type, e.cx, e.cy, e.w, e.h, {x: s.cx, y: s.cy}, head ? 5 : 3);
                        const dx = z.x - a.x, dy = z.y - a.y;
                        mx = nx = (a.x + z.x) / 2 - dy * bow;my = ny = (a.y + z.y) / 2 + dx * bow;
                        shaft.setAttribute('d', `M${a.x} ${a.y} Q${mx} ${my} ${z.x} ${z.y}`);
                    }
                    const headAt = (path: SVGPathElement, tip: Point, fx: number, fy: number) => {
                        const ex = tip.x - fx, ey = tip.y - fy, el = Math.hypot(ex, ey) || 1, ux = ex / el, uy = ey / el, len = 11;
                        const wing = (k: number) => { const c = Math.cos(k), si = Math.sin(k);return `${tip.x - len * (ux * c - uy * si)} ${tip.y - len * (uy * c + ux * si)}`; };
                        path.setAttribute('d', `M${wing(.5)} L${tip.x} ${tip.y} L${wing(-.45)}`);
                    };
                    if (head) headAt(head, z, mx, my);
                    if (tail) headAt(tail, a, nx, ny);
                    if (lab) {
                        const m = shaft.getPointAtLength(shaft.getTotalLength() / 2), dx = z.x - a.x, dy = z.y - a.y, l = Math.hypot(dx, dy) || 1;
                        // To the left of the way it goes (above a rightward arrow), clear of the stroke.
                        lab.style.left = `${m.x + dy / l * 14}px`;lab.style.top = `${m.y - dx / l * 14}px`;
                    }
                };
                const local = () => { const bb = shaft.getBBox();return new DOMRect(bb.x, bb.y, bb.width, bb.height); };
                const item: Drawn = {spec, paths: [shaft, ...(head ? [head] : []), ...(tail ? [tail] : [])], label: lab, place, local};
                if (spec.id) b.items.set(spec.id, item);
                b.all.push(item);
                place();
                await traceStroke(shaft, r);
                if (head) await traceStroke(head, r, 2.5);
                if (tail) await traceStroke(tail, r, 2.5);
                followView(b);
                if (lab) await typeLabel(lab, spec.label!, r);
            } else if (spec.type === 'path' && (spec.points?.length ?? 0) >= 2) {
                // A free stroke (a smile, a wave, a curve): through its points on its group's grid, smoothed.
                const path = newPath('ai-draw-stroke', ink);b.svg.append(path);
                const place = () => { const f = frameOf(b, spec);path.setAttribute('d', smoothPath(spec.points!.map(([x = 0, y = 0]) => ({x: f.left + x / 100 * f.width, y: f.top + y / 100 * f.height})), spec.closed)); };
                const local = () => { const bb = path.getBBox();return new DOMRect(bb.x, bb.y, bb.width, bb.height); };
                const item: Drawn = {spec, paths: [path], label: null, place, local};
                if (spec.id) b.items.set(spec.id, item);
                b.all.push(item);
                place();
                await traceStroke(path, r);
            } else if (spec.type === 'text' && spec.label) {
                const lab = newLabel(b, `ai-draw-text${spec.near ? ' beside' : ''}`, ink);
                // Laid out like a shape; or `near` something: just right of it, level with it.
                const local = () => {
                    if (!spec.near) return boxOf(b, spec);
                    const w = lab.offsetWidth, h = lab.offsetHeight;
                    return w ? new DOMRect(lab.offsetLeft, lab.offsetTop - h / 2, w, h) : null;
                };
                const place = () => {
                    if (!spec.near) {
                        const l = boxOf(b, spec);
                        if (l) { lab.style.left = `${l.left + l.width / 2}px`;lab.style.top = `${l.top + l.height / 2}px`;lab.style.scale = String(zoomOf(b, spec)); }
                        return;
                    }
                    const n = linkEnd(spec.near);
                    lab.style.left = `${n ? n.cx + n.w / 2 + 8 : b.laid.w / 2}px`;lab.style.top = `${n ? n.cy : b.laid.h - 14}px`;
                };
                const item: Drawn = {spec, paths: [], label: lab, place, local};
                if (spec.id) b.items.set(spec.id, item);
                b.all.push(item);
                place();
                const p0 = lab.getBoundingClientRect();
                await glide(p0.left, p0.top + p0.height / 2, r, 260);
                await typeLabel(lab, spec.label, r);
                if (!spec.near) { nodeHandle(b, spec);placeAll(b); }
            }
        }
    } finally {
        drawingArrow = false;
    }
    if (!holding) window.setTimeout(() => { if (!holding && !drawingArrow) restPointer(); }, REST_MS);
}

/**
 * Rub out drawn things as with an eraser: the pointer scrubs back and forth over each while it fades. The links
 * and text joined to one go with it, and what is in a group goes with the group; what stays is laid out again.
 */
async function eraseSketch(ids: string[], r: number) {
    const b = sketch;
    if (!b?.el.isConnected || !ids.length) return;
    const gone = new Set(ids.filter(id => b.items.has(id)));
    if (!gone.size) return;
    // What is in a group that goes, goes too (and what is in that, and so on).
    for (let grew = true; grew;) {
        grew = false;
        for (const e of b.specs) if (e.id && e.group && gone.has(e.group) && !gone.has(e.id)) { gone.add(e.id);grew = true; }
    }
    const inGone = (e: DrawSpec) => !!e.group && gone.has(e.group);
    const joined = (item: Drawn) => [item.spec.start, item.spec.end, item.spec.near].some(e => e && gone.has(e));
    const going = b.all.filter(item => (item.spec.id && gone.has(item.spec.id)) || joined(item) || inGone(item.spec));
    drawingArrow = true;
    try {
        for (const item of going) {
            alive(r);
            const l = item.local();
            const parts: Element[] = [...item.paths, ...(item.label ? [item.label] : [])];
            if (l && l.width + l.height > 0 && parts.length) {
                const tl = toScreen(b, l.left, l.top), br = toScreen(b, l.right, l.bottom), pad = 6;
                const x0 = tl.x - pad, x1 = br.x + pad, y0 = tl.y - pad, h = br.y - tl.y + 2 * pad;
                await glide(x0, y0, r, 220);
                // Back and forth, a little lower each pass, as an eraser goes over a mark.
                const passes = 5, dur = 650, t0 = performance.now();
                for (;;) {
                    alive(r);
                    const t = Math.min(1, (performance.now() - t0) / dur), u = t * passes, leg = Math.floor(u), f = u - leg;
                    pos.x = leg % 2 ? x1 - (x1 - x0) * f : x0 + (x1 - x0) * f;
                    pos.y = y0 + h * Math.min(1, (leg + f) / passes);paintPointer();
                    for (const el of parts) (el as HTMLElement).style.opacity = String(1 - t);
                    if (t >= 1) break;
                    await new Promise(res => requestAnimationFrame(res));
                }
            }
            for (const el of parts) el.remove();
            b.groups.get(item.spec)?.remove();b.groups.delete(item.spec);
            b.hits.get(item.spec)?.remove();b.hits.delete(item.spec);
        }
    } finally {
        drawingArrow = false;
    }
    b.all = b.all.filter(item => !going.includes(item));
    b.specs = b.specs.filter(spec => !going.some(item => item.spec === spec));
    for (const item of going) if (item.spec.id && b.items.get(item.spec.id) === item) b.items.delete(item.spec.id);
    layoutBoard(b);
    if (!holding) window.setTimeout(() => { if (!holding && !drawingArrow) restPointer(); }, REST_MS);
}

/**
 * The learner may move a note, as they move the variables box: drag it anywhere; arrows from it follow. A moved
 * note is theirs to keep in place: the presenter's later notes are placed around it.
 */
function makeMovable(note: HTMLElement) {
    note.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();e.stopPropagation();note.setPointerCapture(e.pointerId);note.classList.add('dragging');
        const r = note.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = (ev: PointerEvent) => {
            note.style.left = `${Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx))}px`;
            note.style.top = `${Math.max(0, Math.min(innerHeight - r.height, ev.clientY - dy))}px`;
            for (const redraw of arrowsFrom.get(note) ?? []) redraw();
        };
        const up = () => { note.removeEventListener('pointermove', move);note.classList.remove('dragging'); };
        note.addEventListener('pointermove', move);
        note.addEventListener('pointerup', up, {once: true});note.addEventListener('pointercancel', up, {once: true});
    });
}
/** Wipe the notes: they fade away (the board stays; `all` wipes it too). */
function eraseNotes(all = false) {
    const going = all ? [...notes, ...board] : notes;
    if (sketch && going.includes(sketch.el)) sketch = null;
    notes = [];if (all) { board = [];noteByText.clear(); }
    for (const n of going) { n.classList.add('fading');window.setTimeout(() => n.remove(), 700); }
}
/**
 * Send a note to the board: it slides to the top left of the view, under the notes already there, and stays.
 * Arrows from it follow it there.
 */
/** The board's next line: the top left of the view, below its own corner buttons, under the lines already there. */
function boardSlot(): {x: number; y: number} {
    const view = state.renderer?.domElement.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    return {x: view.left + 16, y: board.reduce((top, n) => Math.max(top, n.getBoundingClientRect().bottom + 8), view.top + 52)};
}
async function sendToBoard(note: HTMLElement, r: number) {
    if (board.includes(note)) return;
    notes = notes.filter(n => n !== note);
    const slot = boardSlot();
    board.push(note);note.classList.add('boarded');
    note.style.transition = 'left .65s cubic-bezier(.4, 0, .2, 1), top .65s cubic-bezier(.4, 0, .2, 1), opacity .3s, transform .3s';
    note.style.left = `${slot.x}px`;note.style.top = `${slot.y}px`;
    const t0 = performance.now();
    while (performance.now() - t0 < 700) {
        alive(r);
        for (const redraw of arrowsFrom.get(note) ?? []) redraw();
        await new Promise(res => requestAnimationFrame(res));
    }
    note.style.transition = '';
}

/**
 * Move a parameter slider to `value` as a person would: onto its thumb, press, drag smoothly along the track while
 * the view follows, release. Off screen (its panel folded), it just takes the value.
 */
async function dragParamTo(id: string, value: number, r: number) {
    const s = state.sceneSliders[id] as unknown as {value: number; min: number; max: number; step?: number} | undefined;
    if (!s) return;
    const to = Math.max(s.min, Math.min(s.max, value)), from = Number(s.value), input = paramInput(id);
    if (!input || s.max <= s.min) { setSliderValue(id, to);return; }
    const thumb = 14, at = (v: number) => { const rr = input.getBoundingClientRect(), t = (v - s.min) / (s.max - s.min);return {x: rr.left + thumb / 2 + t * (rr.width - thumb), y: rr.top + rr.height / 2}; };
    const start = at(from);
    await glide(start.x, start.y, r);
    ensurePointer().classList.add('pressed');await sleep(180);
    const dur = Math.min(1800, 500 + Math.abs(to - from) / (s.max - s.min) * 1600), t0 = performance.now();
    for (;;) {
        alive(r);
        const t = Math.min(1, (performance.now() - t0) / dur), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        let v = from + (to - from) * e;
        if (s.step) v = Math.round(v / s.step) * s.step;
        setSliderValue(id, v);
        const p = at(v);pos.x = p.x;pos.y = p.y;paintPointer();
        if (t >= 1) break;
        await new Promise(res => requestAnimationFrame(res));
    }
    setSliderValue(id, to);
    await sleep(160);ensurePointer().classList.remove('pressed');
    await sleep(300);   // the view settles before the words about it
}

// ── Speaking ──

function speak(text: string, into: HTMLElement, r: number): Promise<void> {
    return new Promise<void>(res => {
        let finished = false;
        const end = () => { if (!finished) { finished = true;res(); } };
        const words = text.split(/(\s+)/);
        let shown = '', k = 0;
        // The chat follows the words as they come, as it does a reply.
        const follow = () => into.scrollIntoView({block: 'nearest'});
        const reveal = () => { if (r !== run || k >= words.length) return;shown += words[k++];into.textContent = shown;follow();window.setTimeout(reveal, words[k - 1]!.trim() ? 130 : 0); };
        reveal();
        const speakNow = window.algebenchSpeakText;
        // The next beat waits for the speech's own end (a failed or cut-off stream reports one too), however long
        // its voice takes to prepare and say: no guess at its length.
        if (speakNow) speakNow(text, () => { into.textContent = text;end(); });
        else window.setTimeout(() => { into.textContent = text;end(); }, Math.max(1500, text.split(/\s+/).length * 260));
    });
}

// ── Playing a walk-through ──

/** What the expert is told about the view: the lesson around it, what is on screen, and the run's states. */
function describeView(question: string) {
    const ctx = window.algebenchBuildChatContext?.();
    const scene = sceneNow() as (Scene & {markdown?: string; title?: string}) | undefined;
    const step = scene?.steps?.[state.currentStepIndex] as {title?: string; description?: string; descriptionExpr?: string} | undefined;
    const lesson = [`Lesson: ${ctx?.lessonTitle ?? ''}`, `Scene: ${scene?.title ?? ''}`, step ? `Step: ${step.title ?? ''}${step.description ? ` (${step.description})` : ''}` : '',
        (scene?.markdown ?? '').slice(0, 3500)].filter(Boolean).join('\n');
    const rt = ctx?.runtime as {currentCaption?: string; screenValues?: string[]; simulationState?: string} | undefined;
    const view = [rt?.currentCaption ? `Caption: ${rt.currentCaption}` : '', rt?.screenValues?.length ? `Values on screen:\n${rt.screenValues.join('\n')}` : '',
        rt?.simulationState ? `State:\n${rt.simulationState.slice(0, 2500)}` : ''].filter(Boolean).join('\n');
    // The run's states, read off the table the step caption comes from (dataTable('t', frame, 'col')).
    const frames: {n: number; text: string; state: string}[] = [];
    const s = playbackSlider(), m = /dataTable\(\s*'([^']+)'\s*,\s*frame\s*,\s*'([^']+)'\s*\)/.exec(step?.descriptionExpr ?? '');
    const rows = m ? ((scene as {data?: Record<string, unknown>} | undefined)?.data?.[m[1]!] as Record<string, unknown>[] | undefined) : undefined;
    if (s && Array.isArray(rows)) for (let n = s.min; n <= s.max && n < rows.length; n++)
        frames.push({n, text: String(rows[n]?.[m![2]!] ?? '').slice(0, 400), state: frameState(rows[n], m![2]!)});
    return {question, lesson, view, frames, frame: s && frames.length ? s.value : -1, targets: presentTargets(), on_view: onView()};
}

/** What earlier walk-throughs left on the view (it stays until the presenter wipes it): notes, board lines, shapes. */
function onView() {
    const here = (n: Element) => n.isConnected && !n.classList.contains('fading');
    const texts = (list: Element[]) => [...noteByText].filter(([, n]) => list.includes(n) && here(n)).map(([t]) => t.slice(0, 200)).slice(0, 40);
    const drawn = sketch && here(sketch.el) ? sketch.all.filter(d => d.spec.id).slice(0, 80).map(({spec}) => ({
        id: spec.id!.slice(0, 40), type: spec.type, label: (spec.label ?? '').slice(0, 120),
        joins: (spec.start && spec.end ? [spec.start, spec.end] : spec.near ? [spec.near] : spec.group ? [spec.group] : []).map(j => j.slice(0, 120)),
    })) : [];
    return {notes: texts(notes), board: texts(board), drawn};
}

/**
 * A state's values, from its row of the run's table: what the presenter needs to talk about a state it moves to,
 * as it has the values on screen for the one shown. The caption column and the view's own bookkeeping (tooltips,
 * line links, status) are left out.
 */
function frameState(row: Record<string, unknown> | undefined, caption: string): string {
    if (!row) return '';
    const skip = new Set([caption, 'line', 'status', 'running', 'message']);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(row)) {
        if (skip.has(k) || /^(tip_|ln_)/.test(k) || v === '' || v === null || typeof v === 'object' && !Array.isArray(v)) continue;
        parts.push(`${k}=${Array.isArray(v) ? `[${v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')}]` : String(v)}`);
    }
    return parts.join(', ').slice(0, 700);
}

let playing = false, narratingRun = 0;
export const presenting = () => playing;
/** A walk-through narrating playback is about the state it began at: the learner moving the run ends it. */
export function stopNarrating() { if (playing && narratingRun === run) stopPresenting(); }
// The chat message whose walk-through is playing: its speaker shows it, and stops it.
let playingMsg: HTMLElement | null = null;
const markPlaying = (msg: HTMLElement | null) => { playingMsg?.classList.remove('presenting-now');playingMsg = msg;msg?.classList.add('presenting-now'); };

/**
 * Answer `question` as a walk-through. Resolves to what was said, as far as it got when stopped: '' when there was
 * nothing to present, null when it was stopped before its first word. `joinHistory`: add the question and answer to the chat's history (the chat records them itself
 * when it asked for the walk-through).
 */
/**
 * What a walk-through has said so far, as the chat's history keeps it: each beat's words, with what it wrote on the
 * scratchpad or the board, so a follow-up question can refer to it.
 */
function transcript(body: HTMLElement, beats: string[]): string {
    // Beats done carry their notes; a beat cut off mid-sentence counts as far as it was spoken.
    const lines = [...body.querySelectorAll('.ai-present-line')].map(l => l.textContent ?? '');
    return lines.map((l, i) => beats[i] ?? l).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Present `question` as a walk-through in a new chat bubble. ``onProgress`` hears the transcript after each beat, so
 * the chat's history holds what was said even while it plays (a follow-up asked mid-walk-through sees it).
 */
export async function presentQuestion(question: string, {joinHistory = true, narrating = false, onProgress}: {joinHistory?: boolean; narrating?: boolean; onProgress?: (said: string) => void} = {}): Promise<string | null> {
    // Narrating playback: the run moves on by itself, so the walk-through stays at the state on screen (no slider
    // moves, no pause) and starts on a clean board; the run moving on ends it.
    if (narrating) { eraseNotes(true); }
    const r = begin(!narrating);narratingRun = narrating ? r : 0;
    const start = {scene: state.currentSceneIndex, step: state.currentStepIndex, frame: playbackSlider()?.value ?? -1};
    const add = window.addChatMessage;
    const msg = add('assistant', '');
    markPlaying(msg);
    const body = (msg.querySelector('.msg-body') ?? msg) as HTMLElement;
    body.classList.add('ai-present-msg');
    body.innerHTML = '<div class="chat-loading"><span></span><span></span><span></span></div>';
    let steps: Beat[] | null = null;
    let heard: string[] = [];
    try {
        const out = await invokeExpert('scene_present', describeView(question)) as {result?: {steps: Beat[]}; reason?: string};
        alive(r);
        if (!out.result) { body.textContent = out.reason ?? 'No walk-through came back.';return ''; }
        body.replaceChildren();
        steps = narrating ? out.result.steps.map(b => ({...b, frame: -1, slider: ''})) : out.result.steps;
        const said = transcript(body, await playBeats(steps, body, r, beats => { heard = beats;onProgress?.(transcript(body, beats)); }));
        addReplay(body, steps, start);
        if (joinHistory) window.algebenchRecordChatTurn?.(question, said);
        return said;
    } catch (e) {
        if (!(e instanceof Stopped)) { body.textContent = (e as Error).message || 'The walk-through failed.';return ''; }
        // Stopped (the learner typed on, Esc, a scene change): what was said so far stands; a walk-through stopped
        // before its first word leaves no bubble behind, never its loading dots.
        body.querySelector('.chat-loading')?.remove();
        const spoken = transcript(body, heard);
        if (!spoken) msg.remove();
        else if (joinHistory) window.algebenchRecordChatTurn?.(question, spoken);
        if (spoken && steps) addReplay(body, steps, start);
        return spoken || null;
    } finally {
        end(r);
    }
}

/** A walk-through's start: a new run, the pointer's mode on, the lesson's own playback paused (unless it narrates it). */
function begin(pause = true): number {
    const r = ++run;
    playing = true;document.body.classList.add('ai-presenting');
    if (pause) window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
    return r;
}
function end(r: number) {
    if (r !== run) return;
    markPlaying(null);
    playing = false;unhover();document.body.classList.remove('ai-presenting');spotlightBeat = false;drawRing(null);pointer?.classList.remove('on', 'pressed');
    // What was written and drawn stays: the presenter wipes it on a later walk-through when it's done with it.
}

/** Play the beats, each line said into `body`; resolves to what was said. */
/** Play the beats; returns each beat's words with what it wrote, and tells ``onBeat`` the same after each beat. */
async function playBeats(steps: Beat[], body: HTMLElement, r: number, onBeat?: (said: string[]) => void): Promise<string[]> {
    const viewport = state.renderer?.domElement.getBoundingClientRect();
    if (viewport && pos.x < 0) { pos.x = viewport.left + viewport.width / 2;pos.y = viewport.top + viewport.height * .4;paintPointer(); }
    ensurePointer().classList.add('on');
    const said: string[] = [];
    for (const beat of steps) {
        alive(r);
        if (beat.frame >= 0) await dragSliderTo(beat.frame, r);
        if (beat.slider?.startsWith('slider:') && typeof beat.slider_to === 'number') await dragParamTo(beat.slider.slice(7), beat.slider_to, r);
        spotlightBeat = !!beat.spotlight && !!beat.target && beat.mark !== 'point';
        drawRing(null);
        if (beat.erase) eraseNotes();
        // Tidying the board before going on: notes named by their text are wiped, or slide to the top-left stack.
        for (const t of beat.erase_notes ?? []) {
            const n = noteByText.get(noteKey(t));
            if (!n?.isConnected) continue;
            notes = notes.filter(x => x !== n);board = board.filter(x => x !== n);
            n.classList.add('fading');window.setTimeout(() => n.remove(), 700);
        }
        if (beat.erase_draw?.length) await eraseSketch(beat.erase_draw, r);
        // Kept on the board: a note written earlier slides up there; a line not written yet is written there.
        for (const t of beat.board ?? []) {
            const n = noteByText.get(noteKey(t));
            if (n?.isConnected && !n.classList.contains('fading')) await sendToBoard(n, r);
            else await typeNote(t, '', r, true, beat.color);
        }
        const line = document.createElement('p');line.className = 'ai-present-line';body.append(line);
        // Talking while writing, as at a board: the beat ends when both are done.
        const words = speak(beat.say, line, r);
        // What it writes, then an arrow from it (or from what it names) to what it points out.
        const noted = beat.write ? typeNote(beat.write, beat.write_near || beat.target, r, false, beat.color) : Promise.resolve(null);
        const sketched = noted.then(async note => { if (beat.draw?.elements?.length) await drawSketch(beat.draw, beat.color ?? '', r);return note; });
        const writing = sketched.then(async note => { if (beat.arrow_to) await arrowFor(note); });
        const arrowFor = async (note: HTMLElement | null) => {
            if (!beat.arrow_to) return;
            // Joining something drawn: a link on the board, whose ends are found again as the drawing is laid out
            // or dragged.
            const fromRef = beat.arrow_from || (note ? '' : beat.target);
            if (sketch?.el.isConnected && fromRef && [beat.arrow_to, fromRef].some(x => x.startsWith('draw:'))) {
                const end = (x: string) => x.startsWith('draw:') ? x.slice(5) : x;
                await drawSketch({elements: [{type: beat.arrow_kind === 'line' ? 'line' : 'arrow', heads: beat.arrow_kind === 'both' ? 'both' : '', start: end(fromRef), end: end(beat.arrow_to)}]}, beat.color ?? '', r);
                return;
            }
            const to = resolveTarget(beat.arrow_to);
            const from = beat.arrow_from ? resolveTarget(beat.arrow_from) : note ? note.getBoundingClientRect() : beat.target ? resolveTarget(beat.target) : null;
            // Read again on each redraw: a note the learner moves takes its arrow with it.
            const fromNow = () => beat.arrow_from ? resolveTarget(beat.arrow_from) : note ? note.getBoundingClientRect() : beat.target ? resolveTarget(beat.target) : null;
            if (from && to) await drawArrow(fromNow, () => resolveTarget(beat.arrow_to!), r, beat.arrow_from ? null : note, beat.color, beat.arrow_kind);
        };
        const both = Promise.all([words, writing]).then(() => undefined);
        // A target this beat draws is marked once it is drawn, where it ends up (not where it was still being made).
        if ([beat.target, ...(beat.together ?? [])].some(t => t?.startsWith('draw:') && beat.draw?.elements?.some(e => e.id === t.slice(5)))) {
            await sketched;
            for (let t0 = performance.now(); sketch?.glide && performance.now() - t0 < GLIDE_MS + 100;) await new Promise(res => requestAnimationFrame(res));
        }
        const marked = beat.together?.length ? [beat.target, ...beat.together].join('\n') : beat.target;
        if (beat.target) await holdOn(marked, beat.mark, r, both, beat.color, beat.together?.length ? '' : beat.part);
        else await both;
        alive(r);
        const wrote = [beat.write, ...(beat.board ?? [])].filter(Boolean);
        // What it drew, as words: the shapes by their labels, the links by their ends.
        const drew = (beat.draw?.elements ?? []).map(e => LINKS.has(e.type) && e.start ? `${e.start} ${e.type === 'line' || e.heads === 'none' ? '-' : e.heads === 'both' ? '<->' : e.heads === 'start' ? '<-' : '->'} ${e.end}` : `${e.type} "${e.label || e.id || ''}"`);
        const rubbed = beat.erase_draw?.length ? ` [erased: ${beat.erase_draw.join(', ')}]` : '';
        said.push(beat.say + rubbed + (wrote.length ? ` [wrote: ${wrote.join(' | ')}]` : '') + (drew.length ? ` [drew: ${drew.join(', ')}]` : ''));
        onBeat?.([...said]);
        await sleep(250);
    }
    return said;
}

type Start = {scene: number; step: number; frame: number};
/**
 * A replay button under a walk-through, for a learner who missed it: the same beats again, from the state they
 * started at, without asking again. Only while the view is still on the step it was about. The message's speaker
 * button replays it too (chat.ts reads `_replay`).
 */
function addReplay(body: HTMLElement, steps: Beat[], start: Start) {
    if (body.querySelector('.ai-present-replay')) return;
    const btn = document.createElement('button');btn.type = 'button';btn.className = 'ai-present-replay';
    btn.title = 'Play this walk-through again';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Replay</span>';
    const msg = body.closest('.chat-msg') as (HTMLElement & {_replay?: () => void}) | null;
    const replay = async () => {
        if (state.currentSceneIndex !== start.scene || state.currentStepIndex !== start.step) {
            btn.disabled = true;btn.title = 'The view has moved on from the step this was about';return;
        }
        stopPresenting();
        eraseNotes(true);
        const r = begin(), kept = [...body.childNodes];
        markPlaying(msg);
        body.replaceChildren();
        let whole = false;
        try {
            if (start.frame >= 0 && playbackSlider()?.value !== start.frame) await dragSliderTo(start.frame, r);
            await playBeats(steps, body, r);
            whole = true;
        } catch (e) {
            if (!(e instanceof Stopped)) throw e;
        } finally {
            // Played through, the whole walk-through stays to read (even if the first time was cut short); stopped
            // partway, what was there before comes back.
            if (whole) body.append(btn);
            else body.replaceChildren(...kept);
            end(r);
        }
    };
    btn.addEventListener('click', () => void replay());
    if (msg) msg._replay = () => void replay();
    body.append(btn);
}

/** Stop a walk-through now: the pointer goes, and so does the voice; what it wrote and drew stays. */
export function stopPresenting() {
    if (!playing) return;
    run++;markPlaying(null);playing = false;unhover();document.body.classList.remove('ai-presenting');spotlightBeat = false;drawRing(null);pointer?.classList.remove('on', 'pressed');
    if (window.algebenchTTSActive?.()) window.algebenchStopTTS?.();
}

// ── The switch ──

export const presenterOn = () => document.getElementById('presenter-toggle-btn')?.getAttribute('aria-pressed') === 'true';

export function setupPresenter(): void {
    const btn = document.getElementById('presenter-toggle-btn');
    if (!btn) return;
    let on = false;
    try { on = localStorage.getItem(PREF_KEY) === '1'; } catch { /* storage off: off */ }
    const paint = () => {
        btn.setAttribute('aria-pressed', String(on));btn.classList.toggle('active', on);
        btn.title = on ? 'AI presenter is on: questions about the view are answered as a walk-through with a pointer (click to turn off)'
            : 'AI presenter: answer questions about the view as a spoken walk-through with a laser pointer';
    };
    paint();
    btn.addEventListener('click', () => {
        on = !on;paint();
        try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* storage off: this session only */ }
        if (!on) { stopPresenting();eraseNotes(true); }
    });
    // Esc ends a walk-through; what it wrote and drew stays for the next one to build on or wipe. Esc with none
    // playing wipes it. A scene or step change ends it and wipes it: it was about the view that's gone.
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (playing) { e.preventDefault();stopPresenting(); } else if (notes.length || board.length) eraseNotes(true);
    });
    window.addEventListener('algebench:navchange', () => { stopPresenting();eraseNotes(true); });
}
