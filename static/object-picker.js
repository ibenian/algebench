// ============================================================
// object-picker.js — per-object "Ask AI" affordance for the 3D scene.
//
// Mirrors the semantic-graph per-node Ask-AI button (graph-view.js): hovering a
// 3D object that the scene author opted in — by giving it a `prompt` string —
// reveals a floating sparkle button. Clicking it sends that authored prompt to
// the AI, with a deterministic, camera-relative description of the object *as it
// appears in the current viewport* (screen position, depth ordering, occlusion,
// apparent size, layout vs. the other visible objects) attached as context —
// the grounding an LLM can't reliably derive from raw data-space coordinates.
// Objects without a `prompt` are never pickable.
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

const PICK_PX = 20;          // screen-space radius for the nearest-anchor fallback
const HIDE_DELAY = 600;      // grace period so the cursor can travel onto the button
const MAX_NEIGHBORS = 12;    // cap the "other objects in view" list in the prompt

let _raycaster = null;
let _canvas = null;
let _btn = null;
let _hideTimer = null;
let _hoveredId = null;
let _rafPending = false;
let _lastEvt = null;

// ----- reverse mesh → element-id map -----

/** Build a `Map<THREE.Mesh, elementId>` by walking the per-element trackers.
 *  Cheap enough to rebuild on demand (a scene holds few registered elements),
 *  and always current with the live registry — no invalidation bookkeeping. */
function buildMeshIdMap() {
    const map = new Map();
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!reg || reg.hidden || !reg.tracker) continue;
        const t = reg.tracker;
        for (const e of (t.arrowMeshes || [])) if (e && e.mesh) map.set(e.mesh, id);
        for (const m of (t.planeMeshes || [])) if (m) map.set(m, id);
    }
    return map;
}

/** All currently-visible, raycastable meshes across every registered element. */
function pickableMeshes() {
    const meshes = [];
    for (const e of state.arrowMeshes) if (e && e.mesh && e.mesh.visible) meshes.push(e.mesh);
    for (const m of state.planeMeshes) if (m && m.visible) meshes.push(m);
    return meshes;
}

function isHidden(id) {
    const reg = state.elementRegistry[id];
    return !reg || reg.hidden || state.legendToggledOff.has(id);
}

/** Only objects the author opted in — those carrying a `prompt` — are pickable. */
function isPickable(id) {
    const reg = state.elementRegistry[id];
    return !!reg && !isHidden(id) && !!reg.prompt;
}

// ----- anchors & projection -----

/** A representative world-space anchor for an element, tried in order:
 *  live animated position → its label → a mesh centroid/tip → a line anchor. */
function worldAnchor(id, reg) {
    const t = (reg && reg.tracker) || {};
    const ap = state.animatedElementPos[id];
    if (ap && ap.pos) return new THREE.Vector3(...dataToWorld(ap.pos));
    if (t.labels && t.labels.length && t.labels[0].dataPos) {
        return new THREE.Vector3(...dataToWorld(t.labels[0].dataPos));
    }
    for (const e of (t.arrowMeshes || [])) if (e && e.tipWorld) return e.tipWorld.clone();
    for (const m of (t.planeMeshes || [])) {
        if (!m) continue;
        const c = new THREE.Vector3();
        const box = new THREE.Box3().setFromObject(m);
        if (!box.isEmpty()) { box.getCenter(c); return c; }
    }
    for (const e of (t.lineNodes || [])) if (e && e.anchorDataPos) {
        return new THREE.Vector3(...dataToWorld(e.anchorDataPos));
    }
    return null;
}

/** Project a world point to canvas-local pixels. Returns null if behind camera. */
function projectToScreen(world, rect) {
    const v = world.clone().project(state.camera);
    if (v.z >= 1) return null;   // behind the camera / clipped
    return {
        x: (v.x * 0.5 + 0.5) * rect.width,
        y: (-v.y * 0.5 + 0.5) * rect.height,
        ndc: v,
        onScreen: v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1,
    };
}

// ----- picking -----

/** Resolve the element under a client-space point: raycast first, then fall
 *  back to the nearest projected anchor within PICK_PX. Returns an id or null. */
function pickAt(clientX, clientY) {
    if (!state.camera || !_canvas) return null;
    const rect = _canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    // 1) Raycast the real meshes (true geometry + occlusion ordering).
    const ndc = { x: (localX / rect.width) * 2 - 1, y: -((localY / rect.height) * 2 - 1) };
    _raycaster.setFromCamera(ndc, state.camera);
    const hits = _raycaster.intersectObjects(pickableMeshes(), false);
    if (hits.length) {
        const map = buildMeshIdMap();
        for (const h of hits) {
            const id = map.get(h.object);
            if (id && isPickable(id)) return id;
        }
    }

    // 2) Fallback: nearest projected anchor (covers points, lines, curves, axes).
    let best = null, bestD = PICK_PX;
    for (const [id, reg] of Object.entries(state.elementRegistry)) {
        if (!isPickable(id)) continue;
        const anchor = worldAnchor(id, reg);
        if (!anchor) continue;
        const p = projectToScreen(anchor, rect);
        if (!p) continue;
        const d = Math.hypot(p.x - localX, p.y - localY);
        if (d < bestD) { bestD = d; best = id; }
    }
    return best;
}

// ----- the floating button -----

function ensureBtn() {
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

function showBtnFor(id) {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    const reg = state.elementRegistry[id];
    const anchor = reg && worldAnchor(id, reg);
    if (!anchor) { hideBtn(); return; }
    const p = projectToScreen(anchor, rect);
    if (!p) { hideBtn(); return; }
    const btn = ensureBtn();
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    _hoveredId = id;
    // Anchor the button to the object's projected point, nudged up-and-right so it
    // sits beside the object rather than under the cursor.
    btn.style.left = (rect.left + p.x + 10) + 'px';
    btn.style.top = (rect.top + p.y - 26) + 'px';
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
}

function hideBtn() {
    if (!_btn) return;
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    const btn = _btn;
    _hideTimer = setTimeout(() => {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        _hoveredId = null;
    }, HIDE_DELAY);
}

// ----- camera-relative view description (Option B) -----

function viewportLabel(ndc) {
    const col = ndc.x < -0.33 ? 'left' : ndc.x > 0.33 ? 'right' : 'center';
    const row = ndc.y > 0.33 ? 'upper' : ndc.y < -0.33 ? 'lower' : 'middle';
    if (row === 'middle' && col === 'center') return 'the center of the frame';
    if (col === 'center') return `the ${row} middle`;
    if (row === 'middle') return `the ${col} side`;
    return `the ${row}-${col}`;
}

function elementName(id, reg) {
    // Prefer the author's raw label (may be KaTeX TeX, which the AI reads fine) —
    // the rendered label's DOM textContent triples the math and reads as garbage.
    if (reg && reg.label) return reg.label;
    if (id && !id.startsWith('__auto_')) return id;
    return (reg && reg.type) || id;
}

/** Approximate on-screen extent (px) of an element's meshes, or null. */
function screenExtentPx(reg, rect) {
    const t = (reg && reg.tracker) || {};
    const meshes = [];
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

function sizeWord(extent, rect) {
    if (!extent) return null;
    const frac = Math.max(extent.w, extent.h) / Math.min(rect.width, rect.height);
    if (frac > 0.6) return 'large — it fills much of the view';
    if (frac > 0.25) return 'medium-sized in the view';
    return 'small in the view';
}

/** Which other element (if any) occludes `anchor` along the camera ray. */
function occluderOf(id, anchor) {
    const origin = state.camera.position;
    const dir = anchor.clone().sub(origin).normalize();
    _raycaster.set(origin, dir);
    const hits = _raycaster.intersectObjects(pickableMeshes(), false);
    if (!hits.length) return null;
    const map = buildMeshIdMap();
    const distToAnchor = origin.distanceTo(anchor);
    for (const h of hits) {
        const hid = map.get(h.object);
        if (!hid || isHidden(hid)) continue;
        if (hid === id) return null;                       // self reached first → not occluded
        if (h.distance < distToAnchor - 0.05) return hid;  // a different object is in front
    }
    return null;
}

/** Snapshot every visible element's viewport geometry (for the target + layout). */
function collectVisible(rect) {
    const out = [];
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
            depth: state.camera.position.distanceTo(anchor),
        });
    }
    out.sort((a, b) => a.depth - b.depth);                  // nearest first
    return out;
}

function depthPhrase(rank, total) {
    if (total <= 1) return null;
    if (rank === 0) return 'nearest the camera';
    if (rank === total - 1) return 'the farthest object from the camera';
    return `at mid-depth (${rank + 1} of ${total} front-to-back)`;
}

/** The deterministic, camera-relative context block for the clicked object —
 *  attached to the author's prompt so the model knows what is actually on screen. */
function buildViewContext(id, reg) {
    if (!_canvas) return '';
    const rect = _canvas.getBoundingClientRect();
    const visible = collectVisible(rect);
    const idx = visible.findIndex(v => v.id === id);
    const me = idx >= 0 ? visible[idx] : null;
    const name = elementName(id, reg);
    const type = reg.type || 'object';

    const lines = [];
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
        if (occ) facts.push(`partially behind "${elementName(occ, state.elementRegistry[occ])}"`);
    }
    lines.push('- ' + facts.join(', ') + '.');

    const others = visible.filter(v => v.id !== id).slice(0, MAX_NEIGHBORS);
    if (others.length) {
        lines.push('Other objects currently in view (nearest first):');
        for (const o of others) {
            const where = o.screen ? viewportLabel(o.screen.ndc) : 'behind the camera';
            lines.push(`- "${o.name}" (${o.type}) — ${where}`);
        }
    }
    lines.push('Ground your answer in what I am actually looking at from this viewpoint.');
    return lines.join('\n');
}

/** The message sent on click: the author's per-object `prompt` (the actual ask),
 *  with the camera-relative view context appended. */
function buildObjectAskMessage(id) {
    const reg = id && state.elementRegistry[id];
    if (!reg) return 'Explain this object in the 3D scene.';
    const authorPrompt = (reg.prompt || '').trim();
    const ctx = buildViewContext(id, reg);
    if (authorPrompt && ctx) return `${authorPrompt}\n\n${ctx}`;
    return authorPrompt || ctx || 'Explain this object in the 3D scene.';
}

// ----- setup -----

function onPointerMove(e) {
    // Ignore moves while the user is orbiting/panning (a button is held).
    if (e.buttons !== 0) { hideBtn(); return; }
    _lastEvt = e;
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
        _rafPending = false;
        const ev = _lastEvt;
        if (!ev) return;
        const id = pickAt(ev.clientX, ev.clientY);
        if (id) showBtnFor(id);
        else hideBtn();
    });
}

export function setupObjectPicker() {
    if (!state.renderer || !state.renderer.domElement) return;
    _canvas = state.renderer.domElement;
    _raycaster = new THREE.Raycaster();
    _canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    _canvas.addEventListener('pointerleave', () => hideBtn(), { passive: true });
    // Hide the button while dragging (orbit) so it doesn't linger over the scene.
    _canvas.addEventListener('pointerdown', () => hideBtn(), { passive: true });
}
