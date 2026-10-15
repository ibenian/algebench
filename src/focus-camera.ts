/**
 * Camera focus mode: while on, the camera follows the change highlights — after each playback step it
 * eases (pan + zoom, same viewing angle) to the area that holds everything that just changed.
 *
 * Renderers report their own highlights through registerFocusSource (world-space boxes of what they
 * light up now: changed array cells, active pipes). The controller is deliberately calm: it waits for
 * the step to render, holds still when nothing changed or the changes are already well in view, never
 * zooms in past a minimum or out past the step's starting view, and lets a new step retarget a move in
 * flight. Dragging or scrolling the view yourself turns it off, so it never fights you.
 */
import { state } from '/state.js';
import { animateCameraPose } from '/camera.js';
import { unionBoxes, fitBox, needsRefocus, type Box, type Vec3 } from '/focus-frame.js';
import type { Vector3 } from 'three';

type FocusSource = () => Box | null;
const sources = new Set<FocusSource>();
const STORAGE_KEY = 'algebench.focusCamera';
const MOVE_MS = 650, REDUCED_MS = 200;

interface CameraLike { position: Vector3; up: Vector3; fov?: number; aspect?: number; isOrthographicCamera?: boolean; getWorldDirection(v: Vector3): Vector3; }
const camera = () => (state as unknown as { camera?: CameraLike }).camera;
const controls = () => (state as unknown as { controls?: { target: Vector3 } }).controls;

let enabled = false;
/** Distance from the camera to its target when the step started (or focus was turned on): the furthest focus backs off. */
let baseline = 0;

/** Report the world-space box of what a renderer highlights right now (null for nothing). Returns an unregister function. */
export function registerFocusSource(source: FocusSource): () => void {
    sources.add(source);
    return () => { sources.delete(source); };
}

export function focusCameraEnabled(): boolean { return enabled; }

/** Identity of the current slider state. A renderer records it when its highlights change, and reports them
 *  to focus only while it still matches, so a glow left over from an earlier step is not treated as news. */
export function sliderStateKey(): string {
    const sliders = (state as unknown as { sceneSliders?: Record<string, { value?: unknown; values?: unknown }> }).sceneSliders ?? {};
    return JSON.stringify(Object.entries(sliders).map(([id, s]) => [id, s.value, s.values]));
}

export function setFocusCamera(on: boolean): void {
    if (enabled === on) return;
    enabled = on;
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode: not remembered */ }
    window.dispatchEvent(new CustomEvent('algebench:focuscamera', { detail: { enabled: on } }));
    if (on) { captureBaseline(); schedule(); }
}

function captureBaseline(): void {
    const cam = camera(), ctl = controls();
    if (cam && ctl) baseline = cam.position.distanceTo(ctl.target);
}

let pending: ReturnType<typeof setTimeout> | null = null;
/** After a step: wait for scrubbing to settle and for renderers to update, then look. */
function schedule(): void {
    if (!enabled) return;
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; requestAnimationFrame(() => requestAnimationFrame(refocus)); }, 120);
}

function refocus(): void {
    const cam = camera(), ctl = controls();
    if (!enabled || !cam || !ctl || cam.isOrthographicCamera) return;
    const changed = unionBoxes([...sources].map(source => { try { return source(); } catch { return null; } }));
    if (!changed) return;   // nothing changed this step: hold still
    const forward = cam.getWorldDirection(ctl.target.clone()).normalize();
    const up = cam.up.clone().sub(forward.clone().multiplyScalar(cam.up.dot(forward))).normalize();
    const right = forward.clone().cross(up).normalize();
    const basis = { forward: forward.toArray() as Vec3, up: up.toArray() as Vec3, right: right.toArray() as Vec3 };
    const fovY = ((cam.fov ?? 45) * Math.PI) / 180, aspect = cam.aspect ?? 1.6;
    if (!baseline) captureBaseline();
    const box = changed;
    const frame = fitBox(box, basis, fovY, aspect, {
        margin: 0.35,
        // Keep at least a tenth of the step's starting view height around the changes.
        minHalfHeight: baseline * Math.tan(fovY / 2) * 0.1,
        maxDistance: baseline * 1.1,
    });
    const target = ctl.target.toArray() as Vec3, distance = cam.position.distanceTo(ctl.target);
    if (!needsRefocus(target, distance, frame, box, basis, fovY, aspect)) return;
    const center = ctl.target.clone().fromArray(frame.center);
    const position = center.clone().sub(forward.clone().multiplyScalar(frame.distance));
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll<HTMLElement>('.cam-btn.active').forEach(b => b.classList.remove('active'));
    animateCameraPose(position, center, reduced ? REDUCED_MS : MOVE_MS);
}

/** A drag or scroll on the 3D view is the user taking the camera: focus mode steps aside. */
function watchUserCamera(): void {
    const isView = (e: Event) => e.target instanceof HTMLCanvasElement;
    let down: { x: number; y: number } | null = null;
    document.addEventListener('wheel', e => { if (enabled && isView(e)) setFocusCamera(false); }, { passive: true, capture: true });
    document.addEventListener('pointerdown', e => { down = isView(e) ? { x: e.clientX, y: e.clientY } : null; }, { capture: true });
    document.addEventListener('pointermove', e => {
        if (!enabled || !down || !e.buttons) return;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; setFocusCamera(false); }
    }, { capture: true });
    document.addEventListener('pointerup', () => { down = null; }, { capture: true });
}

export function setupFocusCamera(): void {
    try { enabled = localStorage.getItem(STORAGE_KEY) === '1'; } catch { enabled = false; }
    window.addEventListener('algebench:sliderchange', schedule);
    // A new step sets its own camera: that view is the new limit for zooming out.
    window.addEventListener('algebench:navchange', () => { setTimeout(() => { captureBaseline(); }, 900); });
    watchUserCamera();
}
