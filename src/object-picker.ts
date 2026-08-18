// ============================================================
// object-picker.ts — per-object "Ask AI" affordance for the 3D scene.
//
// Mirrors the semantic-graph per-node Ask-AI button (graph-view.ts): hovering a
// pickable 3D object reveals a floating sparkle button. An object is pickable if
// the author gave it a `prompt`, or if it's a labeled content object (axes/grid
// excluded) — in which case the ask is auto-generated from the label at click
// time and never written back to the scene JSON. Clicking sends that ask to the
// AI, with a deterministic, camera-relative description of the object *as it
// appears in the current viewport* (screen position, depth ordering, occlusion,
// apparent size, layout vs. the other visible objects) attached as context —
// the grounding an LLM can't reliably derive from raw data-space coordinates.
//
// Picking is a hybrid: three.js raycasting against the real meshes (vectors,
// polygons, spheres, cylinders, ellipsoids, parametric surfaces, animated-point
// spheres), plus a screen-space nearest-anchor fallback for the MathBox-node
// types a raycaster can't hit (points, lines, curves, axes). Objects are
// identified by walking state.elementRegistry trackers back to their element id
// — no renderer changes, no per-mesh id stamping at creation time.
// ============================================================

import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { makeAiAskButton } from '/labels.js';
import type { AppState } from '/state.js';
import type { Vec3 } from '/coords.js';
import type { Label3D } from '/labels.js';
import type { Object3D, Raycaster, Vector2, Vector3 } from 'three';

/** One element's registry entry, as src/state.ts types it. */
type PickerReg = NonNullable<AppState['elementRegistry'][string]>;

/**
 * A live label entry, plus the raw dynamic string the animated renderers stash
 * on it (`_lastDynamicText`) — not part of src/labels.ts's exported `Label3D`.
 */
type PickerLabel = Label3D & { _lastDynamicText?: string | null };

/** One arrow (vector head/shaft) entry on a tracker. */
interface PickerArrowEntry {
    mesh?: Object3D | null;
    tipWorld?: Vector3 | null;
}

/** One MathBox line/curve/axis entry on a tracker. */
interface PickerLineNode {
    anchorDataPos?: number[] | null;
}

/**
 * The slice of src/scene-loader.ts's private SubTracker this module reads.
 * src/state.ts types `ElementRegistryEntry.tracker` as `unknown` on purpose
 * ("only that module opens it"), so every read here casts down to this narrow
 * view rather than widening the shared state type.
 */
interface PickerTracker {
    arrowMeshes?: (PickerArrowEntry | null)[];
    planeMeshes?: (Object3D | null)[];
    labels?: PickerLabel[];
    lineNodes?: (PickerLineNode | null)[];
}

/** A world point projected into canvas-local pixels (see projectToScreen). */
interface ScreenPoint {
    x: number;
    y: number;
    ndc: Vector3;
    onScreen: boolean;
}

/** What pickAt resolved under the cursor. */
interface PickHit {
    id: string;
    point: Vector3 | null;
    labelEl: HTMLElement | null;
}

/** What (if anything) occludes an element — see occluderOf. */
interface Occluder {
    name?: string | null;
    generic?: boolean;
}

/** One visible element's viewport geometry (see collectVisible). */
interface VisibleEntry {
    id: string;
    reg: PickerReg;
    anchor: Vector3;
    name: string | null;
    type: string;
    screen: ScreenPoint | null;
    depth: number;
}

const PICK_PX = 20;          // screen-space radius for the nearest-anchor fallback
const HIDE_DELAY = 600;      // grace period so the cursor can travel onto the button
const MAX_NEIGHBORS = 12;    // cap the "other objects in view" list in the prompt

let _raycaster: Raycaster | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _btn: HTMLButtonElement | null = null;
let _hideTimer: ReturnType<typeof setTimeout> | null = null;
let _hoveredId: string | null = null;
let _rafPending = false;
let _lastEvt: PointerEvent | null = null;
let _trackRaf: number | null = null;
let _hoverPoint: Vector3 | null = null;   // world point the cursor last hit on the object (or null)
let _hoverLabelEl: HTMLElement | null = null;  // label DOM element the cursor is over (anchor the button on it)

// ----- reverse mesh → element-id map -----

/** Build a `Map<THREE.Mesh, elementId>` by walking the per-element trackers.
 *  Cheap enough to rebuild on demand (a scene holds few registered elements),
 *  and always current with the live registry — no invalidation bookkeeping. */
function buildMeshIdMap(): Map<Object3D, string> {
    const map = new Map<Object3D, string>();
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!reg || reg.hidden || !reg.tracker) continue;
        const t = reg.tracker as PickerTracker;
        for (const e of (t.arrowMeshes || [])) if (e && e.mesh) map.set(e.mesh, id);
        for (const m of (t.planeMeshes || [])) if (m) map.set(m, id);
    }
    return map;
}

/** All currently-visible, raycastable meshes across every registered element. */
function pickableMeshes(): Object3D[] {
    const meshes: Object3D[] = [];
    for (const e of state.arrowMeshes) if (e && e.mesh && e.mesh.visible) meshes.push(e.mesh);
    for (const m of state.planeMeshes) if (m && m.visible) meshes.push(m);
    return meshes;
}

function isHidden(id: string): boolean {
    const reg = state.elementRegistry[id];
    return !reg || reg.hidden || state.legendToggledOff.has(id);
}

// Scaffolding types never get an Ask-AI button on the strength of a label alone
// (an author can still opt one in explicitly with a `prompt`).
const STRUCTURAL_TYPES = new Set(['axis', 'grid', 'skybox']);

/** Pickable if the author opted in with a `prompt`, or it's a content object that
 *  renders a label — static (`reg.label`) or dynamic (a live label entry on its
 *  tracker, e.g. an animated point's `labelExpr` "6.3 km/s"). */
function isPickable(id: string): boolean {
    const reg = state.elementRegistry[id];
    if (!reg || isHidden(id)) return false;
    if (reg.prompt) return true;
    // `as string` — Set<string>.has takes a string; `reg.type` may be undefined,
    // which the JavaScript passed through here unchanged (always a miss).
    if (STRUCTURAL_TYPES.has(reg.type as string)) return false;
    if (reg.label) return true;
    const t = reg.tracker as PickerTracker;
    return !!(t && t.labels && t.labels.length);
}

// ----- anchors & projection -----

/** A representative world-space anchor for an element, tried in order:
 *  live animated position → its label → a mesh centroid/tip → a line anchor. */
function worldAnchor(id: string, reg: PickerReg | undefined): Vector3 | null {
    const t = ((reg && reg.tracker) || {}) as PickerTracker;
    const ap = state.animatedElementPos[id];
    if (ap && ap.pos) return new THREE.Vector3(...dataToWorld(ap.pos as Vec3));
    if (t.labels && t.labels.length && t.labels[0]!.dataPos) {
        // `!` ×2 — guarded by the `t.labels.length` test on the line above.
        return new THREE.Vector3(...dataToWorld(t.labels[0]!.dataPos as Vec3));
    }
    for (const e of (t.arrowMeshes || [])) if (e && e.tipWorld) return e.tipWorld.clone();
    for (const m of (t.planeMeshes || [])) {
        if (!m) continue;
        const c = new THREE.Vector3();
        const box = new THREE.Box3().setFromObject(m);
        if (!box.isEmpty()) { box.getCenter(c); return c; }
    }
    for (const e of (t.lineNodes || [])) if (e && e.anchorDataPos) {
        return new THREE.Vector3(...dataToWorld(e.anchorDataPos as Vec3));
    }
    return null;
}

/** Project a world point to canvas-local pixels. Returns null if behind camera. */
function projectToScreen(world: Vector3, rect: DOMRect): ScreenPoint | null {
    // `!` — every caller runs only once a scene is live (state.camera set); a
    // null camera threw inside .project() before this conversion too.
    const v = world.clone().project(state.camera!);
    if (v.z >= 1) return null;   // behind the camera / clipped
    return {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
        ndc: v,
        onScreen: v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1,
    };
}

// ----- picking -----

/** Is the cursor over a pickable object's label element? Labels are
 *  `pointer-events:none`, so the canvas still gets the move and we test their
 *  bounding boxes directly — this catches hovering the text/name tag itself
 *  (e.g. anywhere along "Orion"), which a point-anchor proximity test misses. */
function labelHitTest(clientX: number, clientY: number): { id: string; el: HTMLElement } | null {
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!isPickable(id)) continue;
        const t = reg.tracker as PickerTracker;
        if (!t || !t.labels) continue;
        for (const lbl of t.labels) {
            if (!lbl.el || lbl.visible === false || lbl.forceHidden) continue;
            const br = lbl.el.getBoundingClientRect();
            if (!br.width && !br.height) continue;
            if (clientX >= br.left && clientX <= br.right && clientY >= br.top && clientY <= br.bottom) {
                return { id, el: lbl.el };
            }
        }
    }
    return null;
}

/** Resolve the element under a client-space point: raycast first, then fall back
 *  to the nearest projected anchor within PICK_PX. Returns `{ id, point }` (point
 *  = the world hit location for a raycast hit, so the button can appear right
 *  where the user hovered rather than at a possibly-distant label; null for a
 *  screen-anchor fallback) or null if nothing is under the cursor. */
function pickAt(clientX: number, clientY: number): PickHit | null {
    if (!state.camera || !_canvas) return null;
    const rect = _canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    // 1) Hovering the label/text itself (labels sit visually on top) → anchor the
    //    button on that label.
    const lh = labelHitTest(clientX, clientY);
    if (lh) return { id: lh.id, point: null, labelEl: lh.el };

    // 2) Raycast the real meshes (true geometry + occlusion ordering).
    const ndc = { x: (localX / rect.width) * 2 - 1, y: -((localY / rect.height) * 2 - 1) };
    // `as unknown as Vector2` — three only reads `.x`/`.y` off `coords`;
    // the plain object literal is exactly what the JavaScript passed.
    // `_raycaster!` — setupObjectPicker creates it before wiring this listener.
    _raycaster!.setFromCamera(ndc as unknown as Vector2, state.camera);
    const hits = _raycaster!.intersectObjects(pickableMeshes(), false);
    if (hits.length) {
        const map = buildMeshIdMap();
        for (const h of hits) {
            const id = map.get(h.object);
            if (id && isPickable(id)) return { id, point: h.point.clone(), labelEl: null };
        }
    }

    // 3) Fallback: nearest projected anchor (covers points, lines, curves, axes).
    let best: string | null = null, bestD = PICK_PX;
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!isPickable(id)) continue;
        const anchor = worldAnchor(id, reg);
        if (!anchor) continue;
        const p = projectToScreen(anchor, rect);
        if (!p) continue;
        const d = Math.hypot(p.x - localX, p.y - localY);
        if (d < bestD) { bestD = d; best = id; }
    }
    return best ? { id: best, point: null, labelEl: null } : null;
}

// ----- the floating button -----

function ensureBtn(): HTMLButtonElement {
    if (_btn) return _btn;
    const btn = makeAiAskButton(
        'ai-ask-btn object-ai-btn',
        'Ask AI about this object',
        () => buildObjectAskMessage(_hoveredId),
    );
    btn.style.position = 'fixed';
    btn.style.margin = '0';         // .ai-ask-btn carries a 5px inline margin — kill it
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
    btn.style.zIndex = '950';
    btn.addEventListener('mouseenter', () => {
        if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    });
    btn.addEventListener('mouseleave', () => hideBtn());
    document.body.appendChild(btn);
    _btn = btn;
    return btn;
}

/** Place the button next to where the user actually hovered on the object — the
 *  raycast hit point (`_hoverPoint`) — so it stays snug to the geometry even when
 *  the object's label is offset far away (e.g. a vector whose "Orion" tag sits
 *  across the view). Falls back to the object's own anchor (label/point) for
 *  screen-anchor picks that have no hit point. Returns false if not visible. */
function positionBtn(id: string, rect: DOMRect): boolean {
    const reg = state.elementRegistry[id];
    if (!reg || isHidden(id)) return false;
    // Hovering the label → pin to its top-right corner.
    if (_hoverLabelEl) {
        const br = _hoverLabelEl.getBoundingClientRect();
        if (br.width || br.height) {
            const btn = ensureBtn();
            btn.style.left = (br.right - 6) + 'px';
            btn.style.top = (br.top - 16) + 'px';
            return true;
        }
    }
    const world = _hoverPoint || worldAnchor(id, reg);
    const p = world && projectToScreen(world, rect);
    if (!p) return false;
    const btn = ensureBtn();
    btn.style.left = (rect.left + p.x + 10) + 'px';   // just up-and-right of the hover point
    btn.style.top = (rect.top + p.y - 26) + 'px';
    return true;
}

function showBtnFor(hit: PickHit) {
    if (!_canvas) return;
    const id = hit.id;
    // Anchor the button ONCE, when the hovered object first changes — then hold it
    // still while the cursor keeps moving within the same object, so the user can
    // travel to the button and click it instead of chasing a moving target.
    // (retrack still re-projects this fixed anchor for camera/animation motion.)
    if (id !== _hoveredId) {
        _hoverPoint = hit.point || null;
        _hoverLabelEl = hit.labelEl || null;
    }
    const rect = _canvas.getBoundingClientRect();
    if (!positionBtn(id, rect)) { hideBtn(); return; }
    const btn = ensureBtn();
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    _hoveredId = id;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    startTrack();
}

// Keep the shown button glued to its object as the camera or objects move under a
// STATIONARY cursor (follow-cam, expr-driven camera, autoplay, animations) — a
// pointermove-only update would leave it at a stale screen position pointing at
// the wrong place. Cheap: one projection per frame, no re-pick; self-stops when
// the button hides or the object leaves the view.
function retrack() {
    _trackRaf = null;
    if (!_btn || _btn.style.opacity === '0' || !_hoveredId) return;
    // `!` — _btn only exists once setupObjectPicker has assigned _canvas.
    const rect = _canvas!.getBoundingClientRect();
    if (!positionBtn(_hoveredId, rect)) { hideBtn(); return; }  // object gone → let it fade out
    _trackRaf = requestAnimationFrame(retrack);
}

function startTrack() {
    if (_trackRaf == null) _trackRaf = requestAnimationFrame(retrack);
}

function hideBtn() {
    if (!_btn) return;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    const btn = _btn;
    _hideTimer = setTimeout(() => {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        _hoveredId = null;
        _hoverPoint = null;
        _hoverLabelEl = null;
    }, HIDE_DELAY);
}

/** Hide the button right away (no grace delay) — used while dragging/orbiting so
 *  it never lingers over the scene mid-gesture. */
function hideBtnNow() {
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    if (!_btn) return;
    _btn.style.opacity = '0';
    _btn.style.pointerEvents = 'none';
    _hoveredId = null;
    _hoverPoint = null;
    _hoverLabelEl = null;
}

// ----- camera-relative view description (Option B) -----

function viewportLabel(ndc: { x: number; y: number }): string {
    const col = ndc.x < -0.33 ? 'left' : ndc.x > 0.33 ? 'right' : 'center';
    const row = ndc.y > 0.33 ? 'upper' : ndc.y < -0.33 ? 'lower' : 'middle';
    if (row === 'middle' && col === 'center') return 'the center of the frame';
    if (col === 'center') return `the ${row} middle`;
    if (row === 'middle') return `the ${col} side`;
    return `the ${row}-${col}`;
}

/** Clean text for a live label entry: the raw dynamic string if the renderer kept
 *  one (`_lastDynamicText`), else the DOM text with each KaTeX span collapsed back
 *  to its `$…$` source (plain textContent triples the math and reads as garbage). */
function liveLabelText(lbl: PickerLabel | null | undefined): string | null {
    if (!lbl) return null;
    if (lbl._lastDynamicText) return String(lbl._lastDynamicText).trim() || null;
    if (!lbl.el) return null;
    const clone = lbl.el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.katex').forEach(k => {
        const ann = k.querySelector('annotation[encoding="application/x-tex"]');
        // `!` — a KaTeX <annotation> always carries its TeX source as text.
        k.replaceWith(ann ? `$${ann.textContent!.trim()}$` : (k.textContent || ''));
    });
    return (clone.textContent || '').trim().replace(/\s+/g, ' ') || null;
}

function elementName(id: string | null, reg: PickerReg | undefined): string | null {
    // Prefer the author's raw static label (may be KaTeX TeX, which the AI reads
    // fine). Otherwise resolve the live rendered label (covers labelExpr/textExpr).
    if (reg && reg.label) return reg.label;
    const t = reg && (reg.tracker as PickerTracker);
    if (t && t.labels && t.labels.length) {
        const name = liveLabelText(t.labels[0]);
        if (name) return name;
    }
    if (id && !id.startsWith('__auto_')) return id;
    return (reg && reg.type) || id;
}

/** Approximate on-screen extent (px) of an element's meshes, or null. */
function screenExtentPx(reg: PickerReg | undefined, rect: DOMRect): { w: number; h: number } | null {
    const t = ((reg && reg.tracker) || {}) as PickerTracker;
    const meshes: Object3D[] = [];
    for (const e of (t.arrowMeshes || [])) if (e && e.mesh) meshes.push(e.mesh);
    for (const m of (t.planeMeshes || [])) if (m) meshes.push(m);
    if (!meshes.length) return null;
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    if (box.isEmpty()) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, anyFront = false;
    const c = box.min, d = box.max;
    for (let i = 0; i < 8; i++) {
        const corner = new THREE.Vector3(
            (i & 1) ? d.x : c.x, (i & 2) ? d.y : c.y, (i & 4) ? d.z : c.z);
        const p = projectToScreen(corner, rect);
        if (!p) continue;
        anyFront = true;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (!anyFront) return null;
    return { w: maxX - minX, h: maxY - minY };
}

function sizeWord(extent: { w: number; h: number } | null, rect: DOMRect): string | null {
    if (!extent) return null;
    const frac = Math.max(extent.w, extent.h) / Math.min(rect.width, rect.height);
    if (frac > 0.6) return 'large — it fills much of the view';
    if (frac > 0.25) return 'medium-sized in the view';
    return 'small in the view';
}

/** What (if anything) occludes `anchor` along the camera ray. Returns null (not
 *  occluded), `{ name }` for a resolved element, or `{ generic: true }` when a
 *  closer mesh can't be mapped back to an element id (still a real occluder). */
function occluderOf(id: string, anchor: Vector3): Occluder | null {
    // `!` — only reached from buildViewContext, i.e. with a live scene camera.
    const origin = state.camera!.position;
    const dir = anchor.clone().sub(origin).normalize();
    // `!` — setupObjectPicker created the raycaster before any pick can happen.
    _raycaster!.set(origin, dir);
    const hits = _raycaster!.intersectObjects(pickableMeshes(), false);  // sorted nearest-first
    if (!hits.length) return null;
    const map = buildMeshIdMap();
    const distToAnchor = origin.distanceTo(anchor);
    for (const h of hits) {
        if (h.distance >= distToAnchor - 0.05) break;      // reached the object's depth, nothing closer
        const hid = map.get(h.object);
        if (hid === id) return null;                       // our own geometry is hit first → visible
        if (hid && isHidden(hid)) continue;                // ignore hidden elements
        return hid ? { name: elementName(hid, state.elementRegistry[hid]) } : { generic: true };
    }
    return null;
}

/** Snapshot every visible element's viewport geometry (for the target + layout). */
function collectVisible(rect: DOMRect): VisibleEntry[] {
    const out: VisibleEntry[] = [];
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (isHidden(id)) continue;
        const anchor = worldAnchor(id, reg);
        if (!anchor) continue;
        const p = projectToScreen(anchor, rect);
        out.push({
            id, reg, anchor,
            name: elementName(id, reg),
            type: reg.type || 'object',
            screen: p,                                     // null if behind camera
            // `!` — same live-camera invariant as projectToScreen above.
            depth: state.camera!.position.distanceTo(anchor),
        });
    }
    out.sort((a, b) => a.depth - b.depth);                  // nearest first
    return out;
}

function depthPhrase(rank: number, total: number): string | null {
    if (total <= 1) return null;
    if (rank === 0) return 'nearest the camera';
    if (rank === total - 1) return 'the farthest object from the camera';
    return `at mid-depth (${rank + 1} of ${total} front-to-back)`;
}

/** The deterministic, camera-relative context block for the clicked object —
 *  attached to the author's prompt so the model knows what is actually on screen. */
function buildViewContext(id: string, reg: PickerReg): string {
    if (!_canvas) return '';
    const rect = _canvas.getBoundingClientRect();
    const visible = collectVisible(rect);
    const idx = visible.findIndex(v => v.id === id);
    const me = idx >= 0 ? visible[idx] : null;
    const name = elementName(id, reg);
    const type = reg.type || 'object';

    const lines: string[] = [];
    lines.push('[Context — I clicked this object in the 3D view. From my current camera view:]');

    const facts = [`the object "${name}" (type \`${type}\`)`];
    if (me && me.screen) {
        facts.push(`appears at ${viewportLabel(me.screen.ndc)}`);
        const xPct = Math.round((me.screen.ndc.x * 0.5 + 0.5) * 100);
        const yPct = Math.round((1 - (me.screen.ndc.y * 0.5 + 0.5)) * 100);
        facts.push(`~${xPct}% from the left and ~${yPct}% from the top`);
        if (!me.screen.onScreen) facts.push('currently off the visible frame');
    } else {
        facts.push('is currently behind the camera / not visible in this view');
    }
    const dp = me ? depthPhrase(idx, visible.length) : null;
    if (dp) facts.push(dp);
    const sw = sizeWord(screenExtentPx(reg, rect), rect);
    if (sw) facts.push(sw);
    if (me) {
        const occ = occluderOf(id, me.anchor);
        if (occ) facts.push(occ.generic ? 'partially behind another object' : `partially behind "${occ.name}"`);
    }
    lines.push('- ' + facts.join(', ') + '.');

    // Only objects actually within the current viewport — not behind the camera or
    // off-frame — so the list reflects what the user can really see right now.
    const others = visible
        .filter(v => v.id !== id && v.screen && v.screen.onScreen)
        .slice(0, MAX_NEIGHBORS);
    if (others.length) {
        lines.push('Other objects currently in view (nearest first):');
        for (const o of others) {
            // `!` — the filter above kept only entries with a non-null `screen`.
            lines.push(`- "${o.name}" (${o.type}) — ${viewportLabel(o.screen!.ndc)}`);
        }
    }
    lines.push('Ground your answer in what I am actually looking at from this viewpoint.');
    return lines.join('\n');
}

/** Default ask for a labeled object with no author `prompt` — generated at click
 *  time from the label, never written back to the scene JSON. */
function autoPromptFor(id: string | null, reg: PickerReg): string {
    const name = elementName(id, reg);
    return `Explain what ${name} represents here and how it relates to the other objects in this scene.`;
}

/** The message sent on click: the author's per-object `prompt` if set, otherwise
 *  an auto-generated ask from the label — with the camera-relative view context
 *  appended. */
function buildObjectAskMessage(id: string | null): string {
    const reg = id && state.elementRegistry[id];
    if (!reg) return 'Explain this object in the 3D scene.';
    const ask = (reg.prompt || '').trim() || autoPromptFor(id, reg);
    // `!` — `reg` is only truthy when `id` was, per the `&&` above.
    const ctx = buildViewContext(id!, reg);
    return ctx ? `${ask}\n\n${ctx}` : ask;
}

// ----- setup -----

function onPointerMove(e: PointerEvent) {
    // Ignore moves while the user is orbiting/panning (a button is held) — hide
    // immediately so the button never lingers over the scene mid-drag.
    if (e.buttons !== 0) { hideBtnNow(); return; }
    _lastEvt = e;
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
        _rafPending = false;
        const ev = _lastEvt;
        if (!ev) return;
        const hit = pickAt(ev.clientX, ev.clientY);
        if (hit) showBtnFor(hit);
        else hideBtn();
    });
}

export function setupObjectPicker() {
    if (!state.renderer || !state.renderer.domElement) return;
    _canvas = state.renderer.domElement;
    _raycaster = new THREE.Raycaster();
    _canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    _canvas.addEventListener('pointerleave', () => hideBtn(), { passive: true });
    // Hide the button immediately while dragging (orbit) so it doesn't linger.
    _canvas.addEventListener('pointerdown', () => hideBtnNow(), { passive: true });
}
