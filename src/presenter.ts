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
import type { Element as LessonElement, Scene } from '/types/lesson.js';

interface Beat { say: string; target: string; mark: 'point' | 'circle'; frame: number; write?: string; write_near?: string; erase?: boolean; arrow_to?: string; arrow_from?: string;
    slider?: string; slider_to?: number | null; board?: string[]; erase_notes?: string[]; color?: string }
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

export function resolveTarget(ref: string): DOMRect | null {
    if (ref === 'caption') { const c = document.getElementById('step-caption');return c?.offsetParent ? c.getBoundingClientRect() : null; }
    if (ref === 'slider') { const i = sliderInput();return i ? i.getBoundingClientRect() : null; }
    if (ref.startsWith('slider:')) { const i = paramInput(ref.slice(7));return i ? (i.parentElement ?? i).getBoundingClientRect() : null; }
    if (ref.startsWith('row:')) return objectLabelRow(ref.slice(4))?.getBoundingClientRect() ?? null;
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
function drawRing(rect: DOMRect | null, color = '') {
    ensurePointer();
    if (!ring) return;
    if (!rect) { ring.classList.remove('on');return; }
    ring.setAttribute('class', `ai-pointer-ring ${inkClass(color)}`.trim());
    ring.innerHTML = '<ellipse pathLength="1"/>';
    fitRing(rect);
    ring.classList.remove('on');void ring.getBoundingClientRect();ring.classList.add('on');
}
/** Fit the circle round `rect`: as the view zooms or pans, it keeps hugging its target (the stroke isn't redrawn). */
function fitRing(rect: DOMRect) {
    const ellipse = ring?.querySelector('ellipse');
    if (!ring || !ellipse) return;
    const pad = 8, w = rect.width + pad * 2, h = rect.height + pad * 2;
    ring.style.left = `${rect.left - pad}px`;ring.style.top = `${rect.top - pad}px`;
    ring.setAttribute('width', String(w + 4));ring.setAttribute('height', String(h + 4));
    ellipse.setAttribute('cx', String(w / 2 + 2));ellipse.setAttribute('cy', String(h / 2 + 2));
    ellipse.setAttribute('rx', String(w / 2));ellipse.setAttribute('ry', String(h / 2));
}

/** Hold the pointer on a target while `until` runs, following it as the view moves; circle it if asked, in the beat's ink. */
async function holdOn(ref: string, mark: Beat['mark'], r: number, until: Promise<void>, color = '') {
    let done = false;void until.then(() => { done = true; });
    const at = resolveTarget(ref);
    if (at) await glide(at.left + at.width / 2, at.top + at.height / 2, r);
    if (mark === 'circle') drawRing(resolveTarget(ref), color);
    let t = 0;
    while (!done) {
        alive(r);
        const now = resolveTarget(ref);
        if (now) {
            // A gentle drift around the centre: a hand holding a pointer is never quite still.
            t += .05;
            const cx = now.left + now.width / 2 + Math.sin(t * 1.3) * Math.min(6, now.width / 6), cy = now.top + now.height / 2 + Math.cos(t) * Math.min(3, now.height / 6);
            pos.x += (cx - pos.x) * .2;pos.y += (cy - pos.y) * .2;paintPointer();
            if (mark === 'circle' && ring?.classList.contains('on')) fitRing(now);
        }
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

let notes: Element[] = [], notesFade = 0;
// The board: notes sent to the top left, stacked like lines on a blackboard; erasing leaves them, the end clears them.
let board: HTMLElement[] = [];
// Each note by what was written, so a later beat can name it to wipe or to keep on the board.
const noteByText = new Map<string, HTMLElement>();
const noteKey = (t: string) => t.replace(/\s+/g, ' ').trim();
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
    const gap = 16, taken = [...notes.filter(n => n.classList.contains('ai-note')).map(n => n.getBoundingClientRect()),
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
        out += esc(plain);i += plain.length;
    }
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
    clearTimeout(notesFade);
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
async function drawArrow(from: () => DOMRect | null, to: () => DOMRect | null, r: number, fromNote: Element | null = null, color = '') {
    clearTimeout(notesFade);
    // Its hand: which side it bows to, and its wobble, kept so a redraw is the same stroke, moved.
    const side = Math.random() < .5 ? -1 : 1, jitter = [Math.random() - .5, Math.random() - .5, Math.random() - .5, Math.random() - .5];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');svg.classList.add('ai-arrow');
    if (inkClass(color)) svg.classList.add(inkClass(color));
    const shape = (): number => {
        const f = from(), t = to();
        if (!f || !t) return 0;
        const fc = {x: f.left + f.width / 2, y: f.top + f.height / 2}, tc = {x: t.left + t.width / 2, y: t.top + t.height / 2};
        const a = edgeToward(f, tc.x, tc.y, 4), b = edgeToward(t, fc.x, fc.y, 7);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < 12) { svg.innerHTML = '';return 0; }
        // A bow to one side, and a hand's wobble: two control points off the straight line.
        const nx = -dy / len, ny = dx / len, bow = side * Math.min(60, len * .18), wob = (k: number) => jitter[k]! * Math.min(10, len * .04);
        const c1 = {x: a.x + dx * .3 + nx * bow + wob(0), y: a.y + dy * .3 + ny * bow + wob(1)};
        const c2 = {x: a.x + dx * .7 + nx * bow * .8 + wob(2), y: a.y + dy * .7 + ny * bow * .8 + wob(3)};
        // The head follows the curve's last direction.
        const ex = b.x - c2.x, ey = b.y - c2.y, el = Math.hypot(ex, ey) || 1, ux = ex / el, uy = ey / el, head = 13;
        const wing = (k: number) => { const c = Math.cos(k), s = Math.sin(k);return {x: b.x - head * (ux * c - uy * s), y: b.y - head * (uy * c + ux * s)}; };
        const w1 = wing(.48), w2 = wing(-.42);
        svg.innerHTML = `<path class="ai-arrow-shaft" pathLength="1" d="M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}"/>`
            + `<path class="ai-arrow-head" pathLength="1" d="M${w1.x},${w1.y} L${b.x},${b.y} L${w2.x},${w2.y}"/>`;
        return len;
    };
    const len = shape();
    if (!len) return;
    notesLayer().append(svg);notes.push(svg);
    if (fromNote) arrowsFrom.set(fromNote, [...(arrowsFrom.get(fromNote) ?? []), shape]);
    svg.classList.add('drawing');
    await sleep(Math.min(900, 350 + len * .6));alive(r);
    svg.classList.add('headed');
    await sleep(220);
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
        if (speakNow) { speakNow(text, () => { into.textContent = text;end(); });window.setTimeout(end, 6000 + text.split(/\s+/).length * 600); }
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
    return {question, lesson, view, frames, frame: s && frames.length ? s.value : -1, targets: presentTargets()};
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

let playing = false;
export const presenting = () => playing;
// The chat message whose walk-through is playing: its speaker shows it, and stops it.
let playingMsg: HTMLElement | null = null;
const markPlaying = (msg: HTMLElement | null) => { playingMsg?.classList.remove('presenting-now');playingMsg = msg;msg?.classList.add('presenting-now'); };

/**
 * Answer `question` as a walk-through. Resolves to what was said, as far as it got when stopped: '' when there was
 * nothing to present, null when it was stopped before its first word. `joinHistory`: add the question and answer to the chat's history (the chat records them itself
 * when it asked for the walk-through).
 */
export async function presentQuestion(question: string, {joinHistory = true}: {joinHistory?: boolean} = {}): Promise<string | null> {
    const r = begin(), start = {scene: state.currentSceneIndex, step: state.currentStepIndex, frame: playbackSlider()?.value ?? -1};
    const add = window.addChatMessage;
    const msg = add('assistant', '');
    markPlaying(msg);
    const body = (msg.querySelector('.msg-body') ?? msg) as HTMLElement;
    body.classList.add('ai-present-msg');
    body.innerHTML = '<div class="chat-loading"><span></span><span></span><span></span></div>';
    let steps: Beat[] | null = null;
    try {
        const out = await invokeExpert('scene_present', describeView(question)) as {result?: {steps: Beat[]}; reason?: string};
        alive(r);
        if (!out.result) { body.textContent = out.reason ?? 'No walk-through came back.';return ''; }
        body.replaceChildren();
        steps = out.result.steps;
        const said = await playBeats(steps, body, r);
        addReplay(body, steps, start);
        if (joinHistory) window.algebenchRecordChatTurn?.(question, said.join(' '));
        return said.join(' ');
    } catch (e) {
        if (!(e instanceof Stopped)) { body.textContent = (e as Error).message || 'The walk-through failed.';return ''; }
        // Stopped (the learner typed on, Esc, a scene change): what was said so far stands; a walk-through stopped
        // before its first word leaves no bubble behind, never its loading dots.
        body.querySelector('.chat-loading')?.remove();
        const spoken = [...body.querySelectorAll('.ai-present-line')].map(l => l.textContent ?? '').join(' ').trim();
        if (!spoken) msg.remove();
        else if (joinHistory) window.algebenchRecordChatTurn?.(question, spoken);
        if (spoken && steps) addReplay(body, steps, start);
        return spoken || null;
    } finally {
        end(r);
    }
}

/** A walk-through's start: a new run, the pointer's mode on, the lesson's own playback paused. */
function begin(): number {
    const r = ++run;
    playing = true;document.body.classList.add('ai-presenting');
    window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
    return r;
}
function end(r: number) {
    if (r !== run) return;
    markPlaying(null);
    playing = false;unhover();document.body.classList.remove('ai-presenting');drawRing(null);pointer?.classList.remove('on', 'pressed');
    // What was written stays a moment after the last word, then fades.
    notesFade = window.setTimeout(() => eraseNotes(true), 4000);
}

/** Play the beats, each line said into `body`; resolves to what was said. */
async function playBeats(steps: Beat[], body: HTMLElement, r: number): Promise<string[]> {
    const viewport = state.renderer?.domElement.getBoundingClientRect();
    if (viewport && pos.x < 0) { pos.x = viewport.left + viewport.width / 2;pos.y = viewport.top + viewport.height * .4;paintPointer(); }
    ensurePointer().classList.add('on');
    const said: string[] = [];
    for (const beat of steps) {
        alive(r);
        if (beat.frame >= 0) await dragSliderTo(beat.frame, r);
        if (beat.slider?.startsWith('slider:') && typeof beat.slider_to === 'number') await dragParamTo(beat.slider.slice(7), beat.slider_to, r);
        drawRing(null);
        if (beat.erase) eraseNotes();
        // Tidying the board before going on: notes named by their text are wiped, or slide to the top-left stack.
        for (const t of beat.erase_notes ?? []) {
            const n = noteByText.get(noteKey(t));
            if (!n?.isConnected) continue;
            notes = notes.filter(x => x !== n);board = board.filter(x => x !== n);
            n.classList.add('fading');window.setTimeout(() => n.remove(), 700);
        }
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
        const writing = (beat.write ? typeNote(beat.write, beat.write_near || beat.target, r, false, beat.color) : Promise.resolve(null)).then(async note => {
            if (beat.arrow_to) await arrowFor(note);
        });
        const arrowFor = async (note: HTMLElement | null) => {
            if (!beat.arrow_to) return;
            const to = resolveTarget(beat.arrow_to);
            const from = beat.arrow_from ? resolveTarget(beat.arrow_from) : note ? note.getBoundingClientRect() : beat.target ? resolveTarget(beat.target) : null;
            // Read again on each redraw: a note the learner moves takes its arrow with it.
            const fromNow = () => beat.arrow_from ? resolveTarget(beat.arrow_from) : note ? note.getBoundingClientRect() : beat.target ? resolveTarget(beat.target) : null;
            if (from && to) await drawArrow(fromNow, () => resolveTarget(beat.arrow_to!), r, beat.arrow_from ? null : note, beat.color);
        };
        const both = Promise.all([words, writing]).then(() => undefined);
        if (beat.target) await holdOn(beat.target, beat.mark, r, both, beat.color);
        else await both;
        alive(r);
        said.push(beat.say);
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
        clearTimeout(notesFade);eraseNotes(true);
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

/** Stop a walk-through now: the pointer goes, and so does the voice. */
export function stopPresenting() {
    if (!playing) return;
    run++;markPlaying(null);playing = false;unhover();document.body.classList.remove('ai-presenting');drawRing(null);pointer?.classList.remove('on', 'pressed');eraseNotes(true);
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
        if (!on) stopPresenting();
    });
    // Esc, or a scene change, ends a walk-through.
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && playing) { e.preventDefault();stopPresenting(); } });
    window.addEventListener('algebench:navchange', () => { if (playing) stopPresenting(); });
}
