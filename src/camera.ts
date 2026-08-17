// ============================================================
// Camera system — MathBox init, arcball rotation, projection
// switching, trackpad pan, camera animation, and camera buttons.
// Also owns line/arrow sizing helpers used by object renderers.
// ============================================================

import { state } from '/state.js';
import { dataToWorld, dataCameraToWorld } from '/coords.js';
import { activateFollowCam, deactivateFollowCam, updateFollowCam, updateFollowAngleLockButtonState } from '/follow-cam.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { renderKaTeX, updateLabels } from '/labels.js';
// sliders.js and overlay.js are created later in the refactor;
// these imports will resolve once all modules are in place.
import { runAnimUpdaters } from '/sliders.js';
import { updateStatusBar } from '/overlay.js';
import type { Camera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import type { Vec3 } from '/coords.js';
import type { Element, View } from '/types/lesson.js';

/**
 * The active camera — perspective or orthographic, swapped by
 * switchProjection(). Declared structurally rather than as
 * `PerspectiveCamera | OrthographicCamera` because the code reads
 * projection-specific fields behind `isOrthographicCamera` truthiness checks
 * rather than through a discriminated narrowing, and intersecting the two
 * three.js classes collapses their conflicting members to `never`.
 */
type SceneCamera = Camera & {
    isOrthographicCamera?: boolean;
    isPerspectiveCamera?: boolean;
    fov?: number;
    aspect?: number;
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    zoom?: number;
    near?: number;
    far?: number;
    updateProjectionMatrix(): void;
};

/** three's renderer, plus the original render fn initMathBox stashes when it
 *  wraps render() to drive the per-frame label/animation updates. */
type WrappedRenderer = WebGLRenderer & { _origRender?: WebGLRenderer['render'] };

/** A line/axis registry entry, as src/objects/ publishes it. */
interface LineEntry {
    node: MathBoxNode | null;
    baseWidth: number;
    widthParam?: string;
}

/** An arrow-registry entry. `mesh.userData` carries the per-mesh sizing the
 *  shaft/head helpers below read back. */
interface ArrowEntry {
    mesh: (import('three').Mesh & { userData: Record<string, unknown> }) | null;
    isShaft?: boolean;
}

/**
 * An AUTHORED camera view, exactly as schemas/lesson.schema.json defines it:
 * `name` is required (it is the button label) and `position` is optional,
 * because a view may instead be a follow-cam (`follow`) or expression-driven
 * (`positionExpr`/`targetExpr`). Re-exported from the generated lesson types
 * rather than restated, so the two cannot drift.
 */
export type CameraView = View;

/**
 * A RESOLVED view, as buildCameraButtons() writes it into state.CAMERA_VIEWS.
 * Distinct from CameraView on purpose: these are computed, never authored, and
 * always carry all three vectors in WORLD space — which is why animateCamera()
 * can read them without assertions. Follow and expression views never land
 * here; they are handled by their own activate* paths.
 */
export interface ResolvedCameraView {
    /** Vec3 tuples, not number[]: both come straight from dataCameraToWorld(),
     *  so animateCamera() can spread them into a Vector3 without a cast. */
    position: Vec3;
    target: Vec3;
    /** Still a plain array — it is `.slice(0, 3)`d from author data or sceneUp. */
    up: number[];
}

/** The scene shape this module reads. Looser than the schema on purpose —
 *  scenes also arrive from the AI — so every field is guarded at its use site. */
export interface CameraScene {
    camera?: StepCamera;
    views?: CameraView[];
    // Only `camera` is read off a step here; scene-loader's richer SceneStep
    // is structurally assignable because it declares the same field.
    steps?: { camera?: StepCamera }[];
}

/** A camera override on a scene or one of its steps. */
export interface StepCamera {
    position?: number[];
    target?: number[];
    up?: number[];
}

/** The in-flight arcball drag, while the pointer is down. */
/** The in-flight alt-drag camera roll: the last pointer x, plus a latch that
 *  suspends rolling when alt is released mid-drag until the mouse comes up. */
interface RollDragState {
    x: number;
    awaitingMouseUp: boolean;
}

/** The in-flight arcball orbit: the previous point on the virtual sphere. */
interface OrbitDragState {
    pt: Vector3;
}

/** An expression-driven camera view, compiled and ticked each frame. */
interface CameraExprState {
    posFns: CompiledExpr[];
    tgtFns: CompiledExpr[];
    up?: unknown;
    /** Which named view is driving, so switching away can deactivate it. */
    viewKey?: string | null;
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface CameraState {
    mathbox: MathBoxRoot;
    three: { scene: Scene; camera: SceneCamera; renderer: WrappedRenderer; controls: ThreeControls } | null;
    camera: SceneCamera | null;
    perspCamera: SceneCamera | null;
    renderer: WrappedRenderer | null;
    controls: ThreeControls | null;
    currentProjection: string;
    currentSpec: CameraScene | null | undefined;
    lessonSpec: { scenes?: CameraScene[] } | null | undefined;
    currentSceneIndex: number;
    currentStepIndex: number;
    CAMERA_VIEWS: Record<string, ResolvedCameraView | undefined>;
    displayParams: Record<string, number>;
    sceneUp: number[];
    mainDirLight: import('three').DirectionalLight | null;
    animationFrameId: number | null;
    cameraAnimating: boolean;
    rollDrag: RollDragState | null;
    arcballMomentum: number;
    arcballInertiaId: number | null;
    arcballInertiaQ: Quaternion | null;
    arcballLastMoveTime: number;
    followCamState: { viewKey?: string } | null;
    cameraExprState: CameraExprState | null;
    cameraExprStartTime: number;
}
const cameraState = state as unknown as CameraState;

// ----- Constants -----

export const ABSTRACT_LINE_THICKNESS_FACTOR = 1 / 20;
export const VECTOR_SHAFT_THICKNESS_MULTIPLIER = 1;
export const ARROW_HEAD_SIZE_MULTIPLIER = 2;
export const ARROW_HEAD_MIN_FACTOR = 0.004;
export const ARROW_HEAD_MAX_FACTOR = 0.012;
export const ARROW_HEAD_RADIUS_RATIO = 0.35;
export const SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO = 0.35;
export const SHAFT_CONE_OVERLAP_HEAD_RATIO = 0.0;
export const SMALL_VECTOR_HEAD_RATIO_LIMIT = 3;
export const SMALL_VECTOR_AUTOSCALE_MIN = 0.05;

export const DEFAULT_CAMERA = { position: [2.5, 1.8, 2.5], target: [0, 0, 0] };
const VIEW_EPSILON = 0.05;

export const DEFAULT_VIEWS: CameraView[] = [
    { name: 'Iso',   position: [2.5, 1.8, 2.5], target: [0, 0, 0], description: 'Isometric perspective — balanced 3D view showing all axes' },
    { name: 'Front', position: [0, 0, 4.5],      target: [0, 0, 0], description: 'Front view along Z axis — see the XY plane directly' },
    { name: 'Top',   position: [0, 4.5, 0.01],   target: [0, 0, 0], description: 'Top view along Y axis — look straight down at the XZ plane' },
    { name: 'Right', position: [4.5, 0, 0],       target: [0, 0, 0], description: 'Right view along X axis — see the YZ plane from the right' },
];

const CONTROL_CLASS = (typeof THREE !== 'undefined' && THREE.OrbitControls)
    ? THREE.OrbitControls
    : (typeof THREE !== 'undefined' ? THREE.TrackballControls : null);

// ----- Line / Arrow Sizing Helpers -----

export function worldPerPixelAt(anchorDataPos?: number[] | null): number {
    if (!cameraState.camera || !cameraState.renderer) return 1;
    const h = Math.max(cameraState.renderer.domElement?.clientHeight || 1, 1);
    if (cameraState.camera.isOrthographicCamera) {
        // Non-null: top/bottom exist precisely when isOrthographicCamera does.
        return Math.abs((cameraState.camera.top! - cameraState.camera.bottom!) / h);
    }
    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor as Vec3));
    const dist = Math.max(cameraState.camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((cameraState.camera.fov || 75) * Math.PI) / 180;
    return (2 * dist * Math.tan(fov / 2)) / h;
}

/** `abstract` is not in schemas/lesson.schema.json — it is a renderer-level
 *  opt-in some elements carry — so the parameter admits a lesson Element too. */
export function getAbstractWidthScale(el: Element | { abstract?: boolean } | null | undefined): number {
    return (el && (el as { abstract?: boolean }).abstract === true) ? ABSTRACT_LINE_THICKNESS_FACTOR : 1.0;
}

export function worldLenToPixels(worldLen: number, anchorDataPos?: number[] | null): number {
    if (!cameraState.camera || !cameraState.renderer) return worldLen;
    const h = Math.max(cameraState.renderer.domElement?.clientHeight || 1, 1);
    if (cameraState.camera.isOrthographicCamera) {
        const worldPerPixel = Math.abs((cameraState.camera.top! - cameraState.camera.bottom!) / h);
        return worldLen / Math.max(worldPerPixel, 1e-6);
    }
    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor as Vec3));
    const dist = Math.max(cameraState.camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((cameraState.camera.fov || 75) * Math.PI) / 180;
    const worldPerPixel = (2 * dist * Math.tan(fov / 2)) / h;
    return worldLen / Math.max(worldPerPixel, 1e-6);
}

export function resolveLineWidth(entry: LineEntry): number {
    const scale = cameraState.displayParams[entry.widthParam || 'lineWidth'] ?? 1;
    return Math.max(entry.baseWidth * scale, 0.1);
}

export function applyLineWidth(entry: LineEntry | null | undefined): void {
    if (!entry || !entry.node) return;
    entry.node.set('width', resolveLineWidth(entry));
}

export function resolveShaftThicknessScale(mesh: ArrowEntry['mesh']): number {
    const base = mesh?.userData?.baseThicknessScale ?? 1;
    const auto = mesh?.userData?.autoThicknessScale ?? 1;
    return Math.max(base * auto * (cameraState.displayParams.vectorWidth || 1) * VECTOR_SHAFT_THICKNESS_MULTIPLIER, 0.05);
}

export function applyShaftThickness(mesh: ArrowEntry['mesh']): void {
    if (!mesh) return;
    const thickness = resolveShaftThicknessScale(mesh);
    const baseShaftRadius = (mesh.userData && typeof mesh.userData.baseShaftRadius === 'number')
        ? Math.max(mesh.userData.baseShaftRadius, 1e-6)
        : 1;
    const maxRadiusFromHead = (mesh.userData && typeof mesh.userData.maxRadiusFromHead === 'number')
        ? mesh.userData.maxRadiusFromHead
        : Infinity;
    const maxThicknessScale = Number.isFinite(maxRadiusFromHead)
        ? (maxRadiusFromHead / baseShaftRadius)
        : Infinity;
    const cappedThickness = Math.min(thickness, maxThicknessScale);
    const lengthScale = (mesh.userData && typeof mesh.userData.lengthScale === 'number')
        ? mesh.userData.lengthScale
        : 1;
    mesh.scale.set(cappedThickness, lengthScale, cappedThickness);
}

export function isShaftEntry(entry: ArrowEntry | null | undefined): boolean {
    if (!entry || !entry.mesh) return false;
    if (entry.isShaft) return true;
    return entry.mesh.geometry && entry.mesh.geometry.type === 'CylinderGeometry';
}

export function resolveArrowSizeScale(localScale: number | null | undefined): number {
    return (localScale || 1) * ARROW_HEAD_SIZE_MULTIPLIER;
}

export function resolveSmallVectorAutoScale(vectorLen: number, coneLen: number): number {
    if (vectorLen <= 0 || coneLen <= 0) return 1;
    const limit = SMALL_VECTOR_HEAD_RATIO_LIMIT * coneLen;
    if (vectorLen > limit) return 1;
    return Math.max(vectorLen / Math.max(limit, 1e-6), SMALL_VECTOR_AUTOSCALE_MIN);
}

// No-op stub — kept for call-site compatibility.
export function updateAdaptiveLineWidths(): void { return; }

// ----- Controls Helpers -----

export function updateControlsHint(): void {
    const hint = document.getElementById('controls-hint');
    if (hint) hint.innerHTML = 'Drag: rotate &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel: zoom &middot; &#8997;+drag: roll';
}

export function configureControlsInstance(ctrl: ThreeControls, target?: Vector3 | null): void {
    if (!ctrl) return;
    if (target) ctrl.target.copy(target);
    // Cast, NOT a `THREE.TrackballControls &&` guard: `x instanceof undefined`
    // throws a TypeError, and adding the guard would silently swallow that.
    if (ctrl instanceof (THREE.TrackballControls as unknown as Function)) {
        ctrl.rotateSpeed = 3.5;
        ctrl.zoomSpeed = 1.2;
        ctrl.panSpeed = 0.9;
        ctrl.staticMoving = false;
        ctrl.dynamicDampingFactor = 0.1;
        ctrl.noRotate = true;  // arcball handler owns rotation
        ctrl.noZoom = false;
        ctrl.noPan = false;
    } else if (THREE.MOUSE && THREE.TOUCH) {
        ctrl.enableDamping = true;
        ctrl.dampingFactor = 0.06;
        ctrl.enableZoom = true;
        ctrl.screenSpacePanning = true;
        ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        ctrl.touches  = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    ctrl.update();
}

// ----- Arcball Rotation -----

function screenToArcball(clientX: number, clientY: number): Vector3 {
    if (!cameraState.renderer) return new THREE.Vector3(0, 0, 1);
    const el   = cameraState.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const nx   =  (clientX - rect.left   - rect.width  * 0.5) / (rect.width  * 0.5);
    const ny   = -(clientY - rect.top    - rect.height * 0.5) / (rect.height * 0.5);
    const r2   = nx * nx + ny * ny;
    if (r2 <= 1.0) return new THREE.Vector3(nx, ny, Math.sqrt(1.0 - r2));
    const r = Math.sqrt(r2);
    return new THREE.Vector3(nx / r, ny / r, 0);
}

function applyArcballOrbit(prevPt: Vector3, currPt: Vector3): void {
    if (!cameraState.camera || !cameraState.controls) return;
    if (prevPt.distanceToSquared(currPt) < 1e-10) return;

    const q = new THREE.Quaternion().setFromUnitVectors(
        currPt.clone().normalize(),
        prevPt.clone().normalize()
    );

    const camQ   = cameraState.camera.quaternion.clone();
    const worldQ = camQ.clone().multiply(q).multiply(camQ.clone().conjugate());

    const target = cameraState.controls.target.clone();
    const offset = cameraState.camera.position.clone().sub(target);
    offset.applyQuaternion(worldQ);
    cameraState.camera.up.applyQuaternion(worldQ).normalize();
    cameraState.camera.position.copy(target).add(offset);
    cameraState.camera.lookAt(target);
    cameraState.controls.update();

    cameraState.arcballLastMoveTime = performance.now();
    cameraState.arcballInertiaQ = cameraState.arcballInertiaQ
        ? cameraState.arcballInertiaQ.slerp(worldQ, 0.5)
        : worldQ.clone();
}

function startArcballInertia(): void {
    if (cameraState.arcballInertiaId) {
        cancelAnimationFrame(cameraState.arcballInertiaId);
        cameraState.arcballInertiaId = null;
    }
    const identity = new THREE.Quaternion();
    if (!cameraState.arcballInertiaQ || cameraState.arcballMomentum < 0.01 ||
        performance.now() - cameraState.arcballLastMoveTime > 80 ||
        cameraState.arcballInertiaQ.angleTo(identity) < 0.0002) {
        cameraState.arcballInertiaQ = null; return;
    }
    const slerpT = Math.pow(0.01, cameraState.arcballMomentum);
    function step() {
        if (!cameraState.arcballInertiaQ || !cameraState.camera || !cameraState.controls) {
            cameraState.arcballInertiaId = null; return;
        }
        if (cameraState.arcballInertiaQ.angleTo(identity) < 0.00005) {
            cameraState.arcballInertiaQ = null; cameraState.arcballInertiaId = null; return;
        }
        const tgt    = cameraState.controls.target.clone();
        const offset = cameraState.camera.position.clone().sub(tgt);
        offset.applyQuaternion(cameraState.arcballInertiaQ);
        cameraState.camera.up.applyQuaternion(cameraState.arcballInertiaQ).normalize();
        cameraState.camera.position.copy(tgt).add(offset);
        cameraState.camera.lookAt(tgt);
        cameraState.controls.update();
        cameraState.arcballInertiaQ.slerp(identity, slerpT);
        cameraState.arcballInertiaId = requestAnimationFrame(step);
    }
    cameraState.arcballInertiaId = requestAnimationFrame(step);
}

function applyCameraRoll(deltaAngle: number): void {
    if (!cameraState.camera || !cameraState.controls) return;
    const viewDir = new THREE.Vector3().subVectors(cameraState.controls.target, cameraState.camera.position);
    if (viewDir.lengthSq() < 1e-12) return;
    viewDir.normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(viewDir, deltaAngle);
    cameraState.camera.up.applyQuaternion(q).normalize();
    cameraState.camera.lookAt(cameraState.controls.target);
    cameraState.controls.update();
}

export function setupRollDrag(container: HTMLElement | null): void {
    if (!container) return;
    const inputSurface = container;
    let orbitDrag: OrbitDragState | null = null;

    inputSurface.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        if (e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            cameraState.rollDrag = { x: e.clientX, awaitingMouseUp: false };
            document.body.classList.add('rotating');
            if (cameraState.controls) cameraState.controls.enabled = false;
            return;
        }

        if (e.shiftKey) return;
        if (e.ctrlKey || e.metaKey) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        if (cameraState.arcballInertiaId) {
            cancelAnimationFrame(cameraState.arcballInertiaId);
            cameraState.arcballInertiaId = null;
        }
        cameraState.arcballInertiaQ = null;
        orbitDrag = { pt: screenToArcball(e.clientX, e.clientY) };
        document.body.classList.add('rotating');
        if (cameraState.controls) cameraState.controls.enabled = false;
    }, { capture: true });

    window.addEventListener('mousemove', (e) => {
        if (orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if ((e.buttons & 1) === 0) return endOrbitDrag();
            const currPt = screenToArcball(e.clientX, e.clientY);
            applyArcballOrbit(orbitDrag.pt, currPt);
            orbitDrag.pt = currPt;
            return;
        }

        if (!cameraState.rollDrag) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.altKey) {
            cameraState.rollDrag.awaitingMouseUp = true;
            return;
        }
        if ((e.buttons & 1) === 0) return endRollDrag();
        if (cameraState.rollDrag.awaitingMouseUp) return;
        const dx = e.clientX - cameraState.rollDrag.x;
        cameraState.rollDrag.x = e.clientX;
        applyCameraRoll(-dx * 0.0045);
    });

    function endOrbitDrag() {
        if (!orbitDrag) return;
        orbitDrag = null;
        document.body.classList.remove('rotating');
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
        startArcballInertia();
    }

    function endRollDrag() {
        document.body.classList.remove('rotating');
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
        if (!cameraState.rollDrag) return;
        cameraState.rollDrag = null;
    }

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt' && cameraState.rollDrag) {
            cameraState.rollDrag.awaitingMouseUp = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (cameraState.rollDrag || orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        endOrbitDrag();
        endRollDrag();
    }, { capture: true });

    window.addEventListener('pointerup', () => { endOrbitDrag(); endRollDrag(); }, { capture: true });
    document.addEventListener('mouseup', () => { endOrbitDrag(); endRollDrag(); }, true);
    window.addEventListener('mouseleave', () => { endOrbitDrag(); endRollDrag(); });
    window.addEventListener('blur', () => { endOrbitDrag(); endRollDrag(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { endOrbitDrag(); endRollDrag(); }
    });
    window.addEventListener('mousedown', () => {
        if (!cameraState.rollDrag && !orbitDrag && cameraState.controls && !cameraState.controls.enabled) {
            cameraState.controls.enabled = true;
        }
    }, { capture: true });
}

function activateExprCamera(viewSpec: CameraView, key: string): void {
    const posExpr = Array.isArray(viewSpec.positionExpr) && viewSpec.positionExpr.length === 3 ? viewSpec.positionExpr : null;
    const tgtExpr = Array.isArray(viewSpec.targetExpr) && viewSpec.targetExpr.length === 3 ? viewSpec.targetExpr : null;
    if (!posExpr || !tgtExpr || !cameraState.camera || !cameraState.controls) return;
    let posFns, tgtFns;
    try {
        posFns = posExpr.map(e => compileExpr(typeof e === 'number' ? String(e) : e));
        tgtFns = tgtExpr.map(e => compileExpr(typeof e === 'number' ? String(e) : e));
    } catch (err) {
        console.warn('expr-camera compile error:', err);
        return;
    }
    cameraState.cameraExprState = {
        posFns,
        tgtFns,
        up: Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : cameraState.sceneUp.slice(0, 3),
        viewKey: key || null,
    };
    cameraState.cameraExprStartTime = performance.now();
    updateExprCamera();
}

function deactivateExprCamera(): void {
    cameraState.cameraExprState = null;
}

function updateExprCamera(): void {
    if (!cameraState.cameraExprState || !cameraState.camera || !cameraState.controls) return;
    const tSec = (performance.now() - cameraState.cameraExprStartTime) / 1000;
    let posData: number[], tgtData: number[];
    try {
        posData = cameraState.cameraExprState.posFns.map(fn => evalExpr(fn, tSec) as number);
        tgtData = cameraState.cameraExprState.tgtFns.map(fn => evalExpr(fn, tSec) as number);
    } catch (err) {
        return;
    }
    const posWorld = dataCameraToWorld(posData as Vec3);
    const tgtWorld = dataCameraToWorld(tgtData as Vec3);
    cameraState.camera.position.set(posWorld[0], posWorld[1], posWorld[2]);
    cameraState.controls.target.set(tgtWorld[0], tgtWorld[1], tgtWorld[2]);
    cameraState.camera.up.copy(normalizeUpVector(cameraState.cameraExprState.up));
    cameraState.camera.lookAt(cameraState.controls.target);
}

// ----- MathBox Initialization -----

/** Paint the WebGL clear color from the --canvas-bg token (a slate board in
 *  both themes — see tokens.css). Called at init and on every theme toggle. */
export function applyCanvasClearColor(): void {
    if (!cameraState.renderer) return;
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--canvas-bg').trim();
    cameraState.renderer.setClearColor(new THREE.Color(v || '#0a0a0f'), 1);
}

export function initMathBox(): void {
    const container = document.getElementById('mathbox-container')!;
    const w = container.clientWidth;
    const h = container.clientHeight;

    cameraState.mathbox = MathBox.mathBox({
        element: container,
        plugins: ['core', 'controls', 'cursor'],
        controls: { klass: CONTROL_CLASS },
        camera: { fov: 75 },
        renderer: { antialias: true },
    });

    cameraState.three    = cameraState.mathbox.three as CameraState['three'];
    cameraState.camera   = cameraState.three!.camera;
    cameraState.perspCamera = cameraState.camera;
    cameraState.renderer = cameraState.three!.renderer;
    cameraState.controls = cameraState.three!.controls;

    applyCanvasClearColor();
    cameraState.renderer.setPixelRatio(window.devicePixelRatio);
    cameraState.renderer.setSize(w, h);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    cameraState.three!.scene.add(ambientLight);
    cameraState.mainDirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    cameraState.mainDirLight.position.set(5, 10, 7);
    cameraState.three!.scene.add(cameraState.mainDirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-3, -5, -4);
    cameraState.three!.scene.add(dirLight2);

    const initPos = dataToWorld(DEFAULT_CAMERA.position as Vec3);
    const initTgt = dataToWorld(DEFAULT_CAMERA.target as Vec3);
    cameraState.camera.position.set(initPos[0], initPos[1], initPos[2]);
    cameraState.camera.lookAt(initTgt[0], initTgt[1], initTgt[2]);
    if (cameraState.controls) {
        const target = new THREE.Vector3(initTgt[0], initTgt[1], initTgt[2]);
        configureControlsInstance(cameraState.controls, target);
    }
    updateControlsHint();

    window.addEventListener('resize', () => {
        const w2 = container.clientWidth;
        const h2 = container.clientHeight;
        cameraState.renderer!.setSize(w2, h2);
        if (cameraState.camera!.isOrthographicCamera) {
            const aspect2 = w2 / h2;
            const halfH = (cameraState.camera!.top! - cameraState.camera!.bottom!) / 2;
            cameraState.camera!.left  = -halfH * aspect2;
            cameraState.camera!.right =  halfH * aspect2;
        } else {
            cameraState.camera!.aspect = w2 / h2;
        }
        cameraState.camera!.updateProjectionMatrix();
    });

    let _statusFrameTick = 0;
    function updateLoop() {
        cameraState.animationFrameId = requestAnimationFrame(updateLoop);
        const nowMs = performance.now();
        runAnimUpdaters(nowMs);
        if (cameraState.cameraExprState) {
            updateExprCamera();
        } else if (cameraState.followCamState) {
            updateFollowCam();
        } else if (cameraState.controls && typeof cameraState.controls.update === 'function') {
            cameraState.controls.update();
        }
        updateAdaptiveLineWidths();
        updateLabels();
        if (++_statusFrameTick % 6 === 0) updateStatusBar();
    }
    updateLoop();
}

// ----- Projection Switching -----

export function switchProjection(mode: string): void {
    if (mode === cameraState.currentProjection) return;
    cameraState.currentProjection = mode;

    const container = document.getElementById('mathbox-container')!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;

    const pos    = cameraState.camera!.position.clone();
    const target = cameraState.controls ? cameraState.controls.target.clone() : new THREE.Vector3();

    let newCamera: SceneCamera | null;
    if (mode === 'orthographic') {
        const dist = Math.max(pos.distanceTo(target), 0.001);
        const frustumHeight = dist * Math.tan((cameraState.perspCamera!.fov! / 2) * Math.PI / 180) * 2;
        const frustumWidth  = frustumHeight * aspect;
        newCamera = new THREE.OrthographicCamera(
            -frustumWidth / 2, frustumWidth / 2,
            frustumHeight / 2, -frustumHeight / 2,
            -1000, 1000
        );
        newCamera.updateProjectionMatrix();
    } else {
        newCamera = cameraState.perspCamera;
    }

    newCamera!.up.copy(cameraState.camera!.up);
    newCamera!.position.copy(pos);
    newCamera!.lookAt(target);

    // Non-null: the orthographic branch constructs one, and the perspective
    // branch reuses perspCamera, which initMathBox() set.
    cameraState.three!.camera = newCamera!;
    cameraState.camera = newCamera!;

    if (!cameraState.renderer!._origRender) {
        cameraState.renderer!._origRender = cameraState.renderer!.render.bind(cameraState.renderer);
    }
    // The wrapper ignores the caller's camera and always renders the current
    // one, which is how a projection switch takes effect without MathBox
    // knowing. Signature widened to match WebGLRenderer.render.
    cameraState.renderer!.render = function(scene: Scene, cam: Camera) {
        cameraState.renderer!._origRender!(scene, cameraState.camera!);
    } as WebGLRenderer['render'];

    if (cameraState.controls) cameraState.controls.dispose();
    // Non-null: initMathBox() already built controls from the same class, so a
    // missing CONTROL_CLASS threw long before this line in the JS too.
    cameraState.controls = new CONTROL_CLASS!(cameraState.camera!, cameraState.renderer!.domElement);
    configureControlsInstance(cameraState.controls, target);
    cameraState.three!.controls = cameraState.controls;

    document.querySelectorAll<HTMLElement>('.proj-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.proj === mode);
    });
}

export function setupProjectionToggle(): void {
    document.querySelectorAll<HTMLElement>('.proj-btn').forEach(btn => {
        // Non-null: every .proj-btn carries data-proj in index.html.
        btn.addEventListener('click', () => switchProjection(btn.dataset.proj!));
    });
}

// ----- Trackpad Two-Finger Pan -----

export function setupTrackpadPan(): void {
    const canvas = cameraState.renderer && cameraState.renderer.domElement;
    if (!canvas) return;
    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.deltaMode !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!cameraState.camera || !cameraState.controls) return;

        const distance  = cameraState.camera.position.distanceTo(cameraState.controls.target);
        const panFactor = distance / canvas.clientHeight * 0.8;

        const right = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 0);
        const up    = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 1);
        const panOffset = new THREE.Vector3()
            .addScaledVector(right,  e.deltaX * panFactor)
            .addScaledVector(up,    -e.deltaY * panFactor);

        cameraState.camera.position.add(panOffset);
        cameraState.controls.target.add(panOffset);
        cameraState.controls.update();
    }, { capture: true, passive: false });
}

// Legacy custom gesture layer disabled in favor of native control behavior.
export function setupTouchGestures(container: unknown): void { void container; }

// ----- Camera Animation -----

export function normalizeUpVector(up: unknown): Vector3 {
    const raw = Array.isArray(up) && up.length === 3 ? up : [0, 1, 0];
    const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
    if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
}

export function resolveEffectiveStepCamera(scene: CameraScene | null | undefined, stepIdx: number) {
    if (!scene) return null;

    const baseUp = (scene.camera && Array.isArray(scene.camera.up) && scene.camera.up.length === 3)
        ? scene.camera.up.slice(0, 3)
        : [0, 1, 0];

    const effective = {
        position: (scene.camera && Array.isArray(scene.camera.position) && scene.camera.position.length === 3)
            ? scene.camera.position.slice(0, 3)
            : DEFAULT_CAMERA.position.slice(0, 3),
        target: (scene.camera && Array.isArray(scene.camera.target) && scene.camera.target.length === 3)
            ? scene.camera.target.slice(0, 3)
            : DEFAULT_CAMERA.target.slice(0, 3),
        up: baseUp,
    };

    if (stepIdx >= 0 && Array.isArray(scene.steps)) {
        const last = Math.min(stepIdx, scene.steps.length - 1);
        for (let i = 0; i <= last; i++) {
            const step = scene.steps[i];
            const cam  = step && step.camera;
            if (!cam) continue;
            if (Array.isArray(cam.position) && cam.position.length === 3) effective.position = cam.position.slice(0, 3);
            if (Array.isArray(cam.target)   && cam.target.length   === 3) effective.target   = cam.target.slice(0, 3);
            if (Array.isArray(cam.up)        && cam.up.length        === 3) effective.up       = cam.up.slice(0, 3);
        }
    }

    return effective;
}

export function animateCamera(view: string, duration?: number): void {
    duration = (duration == null) ? 800 : duration;
    deactivateFollowCam();
    deactivateExprCamera();
    const targetView = cameraState.CAMERA_VIEWS[view];
    if (!targetView || !cameraState.camera || !cameraState.controls) return;

    const startPos    = cameraState.camera.position.clone();
    const endPos      = new THREE.Vector3(...targetView.position);
    const startTarget = cameraState.controls.target.clone();
    const endTarget   = new THREE.Vector3(...targetView.target);
    const startUp     = cameraState.camera.up.clone();
    let endUp         = normalizeUpVector(targetView.up);

    // Nudge pole-aligned destinations off the OrbitControls singularity.
    const offset = endPos.clone().sub(endTarget);
    const perp   = offset.clone().sub(endUp.clone().multiplyScalar(offset.dot(endUp)));
    if (perp.length() < VIEW_EPSILON) {
        const helper = Math.abs(endUp.dot(new THREE.Vector3(0, 0, 1))) < 0.9
            ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const nudge    = new THREE.Vector3().crossVectors(endUp, helper).normalize();
        const nudgeMag = Math.min(VIEW_EPSILON, Math.max(0.0005, offset.length() * 0.01));
        endPos.addScaledVector(nudge, nudgeMag);
    }
    // Ensure camera up is not parallel to view direction.
    const viewDir = endTarget.clone().sub(endPos).normalize();
    if (Math.abs(viewDir.dot(endUp)) > 0.995) {
        const helper = Math.abs(viewDir.dot(new THREE.Vector3(0, 1, 0))) < 0.9
            ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        endUp = helper.clone().sub(viewDir.clone().multiplyScalar(helper.dot(viewDir))).normalize();
    }

    const startTime = performance.now();

    document.querySelectorAll<HTMLElement>('.cam-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector<HTMLElement>(`.cam-btn[data-view="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    cameraState.cameraAnimating = true;

    if (duration === 0) {
        cameraState.camera.position.copy(endPos);
        cameraState.controls.target.copy(endTarget);
        cameraState.camera.up.copy(endUp);
        cameraState.camera.lookAt(cameraState.controls.target);
        cameraState.cameraAnimating = false;
        return;
    }

    function step(now: number): void {
        const elapsed = now - startTime;
        // Non-null: `duration` was defaulted at the top of animateCamera; the
        // narrowing does not reach this hoisted declaration.
        let t = Math.min(elapsed / duration!, 1);
        t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

        cameraState.camera!.position.lerpVectors(startPos, endPos, t);
        cameraState.controls!.target.lerpVectors(startTarget, endTarget, t);
        cameraState.camera!.up.lerpVectors(startUp, endUp, t).normalize();
        cameraState.camera!.lookAt(cameraState.controls!.target);
        cameraState.controls!.update();

        if (t < 1) requestAnimationFrame(step);
        else cameraState.cameraAnimating = false;
    }
    requestAnimationFrame(step);
}

// ----- Camera Buttons -----

export function buildCameraButtons(spec: CameraScene | null | undefined): void {
    const container = document.getElementById('camera-buttons')!;
    container.innerHTML = '';
    cameraState.CAMERA_VIEWS = {};
    cameraState.sceneUp = (spec && spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3)
        ? spec.camera.up.slice(0, 3)
        : [0, 1, 0];

    const views = (spec && spec.views) ? spec.views : DEFAULT_VIEWS;

    views.forEach(v => {
        const key = v.name.toLowerCase().replace(/\s+/g, '-');
        const btn = document.createElement('button');
        btn.className = 'cam-btn';
        btn.dataset.view = key;
        // Cast, not `|| ''`: assigning undefined sets the attribute to the
        // string "undefined", which is what the JS did.
        btn.title = v.description || v.name;
        btn.innerHTML = renderKaTeX(v.name, false);

        if (v.follow) {
            btn.classList.add('cam-btn-follow');
            btn.addEventListener('click', () => {
                deactivateExprCamera();
                if (cameraState.followCamState && cameraState.followCamState.viewKey === key) {
                    deactivateFollowCam();
                    document.querySelectorAll<HTMLElement>('.cam-btn').forEach(b => b.classList.remove('active'));
                    return;
                }
                document.querySelectorAll<HTMLElement>('.cam-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activateFollowCam({ ...v, _viewKey: key });
            });
        } else if (Array.isArray(v.positionExpr) && Array.isArray(v.targetExpr)) {
            btn.classList.add('cam-btn-follow');
            btn.addEventListener('click', () => {
                deactivateFollowCam();
                if (cameraState.cameraExprState && cameraState.cameraExprState.viewKey === key) {
                    deactivateExprCamera();
                    document.querySelectorAll<HTMLElement>('.cam-btn').forEach(b => b.classList.remove('active'));
                    return;
                }
                document.querySelectorAll<HTMLElement>('.cam-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activateExprCamera(v, key);
            });
        } else {
            cameraState.CAMERA_VIEWS[key] = {
                // Non-null: this is the plain-view branch (not follow, not expr), but
                // the schema still permits a view with none of the three. The JS passed
                // undefined straight through to dataCameraToWorld, so keep it throwing.
                position: dataCameraToWorld(v.position! as Vec3),
                target:   dataCameraToWorld((v.target || [0, 0, 0]) as Vec3),
                up:       Array.isArray(v.up) ? v.up.slice(0, 3) : cameraState.sceneUp.slice(0, 3),
            };
            btn.addEventListener('click', (e) => {
                deactivateFollowCam();
                deactivateExprCamera();
                if (e.shiftKey)     animateCamera(key, 0);
                else if (e.altKey)  animateCamera(key, 200);
                else                animateCamera(key, 800);
            });
        }
        container.appendChild(btn);
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cam-btn';
    resetBtn.dataset.view = 'reset';
    resetBtn.title = 'Reset camera';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', (e) => {
        deactivateFollowCam();
        deactivateExprCamera();
        const activeScene = (cameraState.lessonSpec && cameraState.currentSceneIndex >= 0 && cameraState.lessonSpec.scenes)
            ? cameraState.lessonSpec.scenes[cameraState.currentSceneIndex]
            : cameraState.currentSpec;
        const camSpec = resolveEffectiveStepCamera(activeScene, cameraState.currentStepIndex)
            || (cameraState.currentSpec && cameraState.currentSpec.camera)
            || null;
        const pos = dataCameraToWorld(((camSpec && camSpec.position) || DEFAULT_CAMERA.position) as Vec3);
        const tgt = dataCameraToWorld(((camSpec && camSpec.target)   || DEFAULT_CAMERA.target) as Vec3);
        cameraState.CAMERA_VIEWS.reset = {
            position: pos,
            target:   tgt,
            up: (camSpec && Array.isArray(camSpec.up)) ? camSpec.up.slice(0, 3) : [0, 1, 0],
        };
        if (e.shiftKey)    animateCamera('reset', 0);
        else if (e.altKey) animateCamera('reset', 200);
        else               animateCamera('reset', 800);
    });
    container.appendChild(resetBtn);
    updateFollowAngleLockButtonState();
}
