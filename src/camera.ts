// ============================================================
// Camera system — MathBox init, arcball rotation, projection
// switching, trackpad pan, camera animation, and camera buttons.
// Also owns line/arrow sizing helpers used by object renderers.
// ============================================================

import { state } from '/state.js';
import { dataToWorld, dataCameraToWorld } from '/coords.js';
import { activateFollowCam, deactivateFollowCam, updateFollowCam, updateFollowAngleLockButtonState } from '/follow-cam.js';
import { compileExpr, evalExpr } from '/expr.js';
import { findCamButton } from '/cam-buttons.js';
import type { CompiledExpr } from '/expr.js';
import { renderKaTeX, updateLabels } from '/labels.js';
// sliders.js and overlay.js are created later in the refactor;
// these imports will resolve once all modules are in place.
import { runAnimUpdaters } from '/sliders.js';
import { updateStatusBar } from '/overlay.js';
import { Smoother, VectorSmoother, DEFAULT_SMOOTHING, isSmoothingMode } from '/smoothing.js';
import type { SmoothingMode } from '/smoothing.js';
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
/** The in-flight arcball orbit: the previous point on the virtual sphere. */
interface OrbitDragState {
    pt: Vector3;
    /** Camera-space axis the drag is pinned to, or null for a free arcball. */
    axis: Vector3 | null;
    /** Previous pointer x, for the roll axis — see applyAxisRoll. */
    x: number;
    /** Previous pointer y — where a drag switched to camera-space mode restarts. */
    y: number;
    /** Started on an axis cue: its axis holds for the whole drag, whatever keys change. */
    locked?: boolean;
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
    if (hint) hint.innerHTML = 'Drag: rotate &middot; &#8984;/Ctrl/&#8997;+drag: rotate about one axis &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel or Ctrl+right-drag: zoom';
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

/** The ball's on-screen radius, as a fraction of the viewport's shorter side.
 *  0.25 puts its DIAMETER at half the shorter side — the ball covers half the
 *  screen across, which is what "half the screen" asks for. Raising this makes
 *  a given pointer travel turn the view LESS: the drag angle is the arc swept
 *  on the ball, so a wider ball is a finer control, and past the rim the
 *  ARCBALL_OUTSIDE_RADIANS fallback takes over later than it used to. */
const ARCBALL_RADIUS_FRACTION = 0.25;
/** How much further the drag turns per ball-radius of travel outside the ball. */
const ARCBALL_OUTSIDE_RADIANS = 1.2;
/** Ceiling on the coast after a flick — about 170 degrees a second at 60fps. */
const MAX_INERTIA_RADIANS_PER_FRAME = 0.05;

// ----- Rotation pivot -----
//
// A drag turns the view about the point the pointer pressed on, not about the
// orbit target. The target stays the centre of the view; the drag pivot is a
// separate point, and the camera and its target turn together, rigidly, about
// it — so the view does not jump when a drag starts, and what was grabbed
// stays under the pointer. The pivot lives on through the inertia coast.

/** The drag's pivot, or null to turn about the orbit target. */
let dragPivot: Vector3 | null = null;
/** A rotation drag is under way (its pivot must not be dropped). */
let orbitDragActive = false;

/** Finds the scene point under a pixel; object-picker registers it at setup
 *  (a direct import would be circular — it already imports this module). */
let pivotPicker: ((clientX: number, clientY: number) => Vector3 | null) | null = null;

export function setRotationPivotPicker(fn: (clientX: number, clientY: number) => Vector3 | null): void {
    pivotPicker = fn;
}

/** The point rotation turns about right now. */
function rotationCentre(): Vector3 {
    return dragPivot ?? cameraState.controls!.target;
}

/**
 * The pivot for a drag pressed at a pixel: the geometry under it, or — over
 * empty space — the point under it at the orbit target's depth.
 */
function pivotUnder(clientX: number, clientY: number): Vector3 | null {
    const hit = pivotPicker ? pivotPicker(clientX, clientY) : null;
    if (hit) return hit;
    if (!cameraState.camera || !cameraState.controls || !cameraState.renderer) return null;
    const rect = cameraState.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cameraState.camera as unknown as Camera);
    const facing = new THREE.Vector3();
    (cameraState.camera as unknown as Camera).getWorldDirection(facing);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, cameraState.controls.target);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
}

/**
 * Where the ball sits on screen (its centre and pixel radius). The canvas rect
 * comes back with it: measuring it is the one layout read here, and callers
 * that need the rect themselves would otherwise ask for it a second time on
 * the pointer-move path.
 */
function arcballScreenDisc(at?: Vector3): { cx: number; cy: number; r: number; rect: DOMRect } | null {
    if (!cameraState.renderer || !cameraState.camera || !cameraState.controls) return null;
    // Resolved only past the guard: rotationCentre() reads controls.target.
    const centre = at ?? rotationCentre();
    const rect = cameraState.renderer.domElement.getBoundingClientRect();
    // A collapsed canvas has no disc, and saying so here is what keeps the
    // divisions in screenToArcball finite. A drag cannot start on a 0x0
    // canvas, but it can be in progress when one collapses — the move handler
    // is on `window`, not the canvas — and a NaN quaternion from that frame
    // would go straight into the camera, where nothing but a reload gets it
    // back out.
    if (rect.width <= 0 || rect.height <= 0) return null;
    // The ball is centred on the rotation pivot, not on the viewport, so
    // grabbing a point on it turns the same point that the rotation swings.
    const ndc = centre.clone().project(cameraState.camera as unknown as Camera);
    return {
        cx: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        cy: rect.top  + (-ndc.y * 0.5 + 0.5) * rect.height,
        r: Math.min(rect.width, rect.height) * ARCBALL_RADIUS_FRACTION,
        rect,
    };
}

/**
 * The point on the ball under a pixel, as a unit vector in camera space
 * (+Z toward the viewer), so that dragging turns the surface point the
 * pointer is actually on.
 *
 * This is a ray/sphere intersection, not the usual `z = sqrt(1 - x^2 - y^2)`
 * hemisphere: that mapping is orthographic, and under a perspective camera the
 * near side of the ball projects outward, so the grabbed point slipped ahead of
 * the cursor (measured at 1.4x the cursor's travel). Rays that miss the ball
 * carry on around the same great circle, so a drag outside it keeps turning
 * the same way as one inside.
 */
function screenToArcball(clientX: number, clientY: number): Vector3 {
    const disc = arcballScreenDisc();
    if (!disc || !cameraState.camera || !cameraState.renderer) return new THREE.Vector3(0, 0, 1);
    const rect = disc.rect;
    const radius = arcballWorldRadius(disc.r);

    // Camera space: the eye is at the origin looking down -Z. The ball sits on
    // the pivot, which is on the view axis only when it is the orbit target.
    cameraState.camera.updateMatrixWorld();
    const centre = rotationCentre().clone().applyMatrix4(cameraState.camera.matrixWorldInverse);
    const dist = Math.max(centre.length(), 1e-6);
    const ndcX =  ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    let origin: Vector3;
    let dir: Vector3;
    if (cameraState.camera.isOrthographicCamera) {
        const halfW = Math.abs((cameraState.camera.right! - cameraState.camera.left!) / 2);
        const halfH = Math.abs((cameraState.camera.top! - cameraState.camera.bottom!) / 2);
        const zoom = cameraState.camera.zoom || 1;
        origin = new THREE.Vector3(ndcX * halfW / zoom, ndcY * halfH / zoom, 0);
        dir = new THREE.Vector3(0, 0, -1);
    } else {
        const tanHalfFov = Math.tan(((cameraState.camera.fov || 75) * Math.PI) / 360);
        origin = new THREE.Vector3(0, 0, 0);
        dir = new THREE.Vector3(
            ndcX * tanHalfFov * (rect.width / rect.height),
            ndcY * tanHalfFov,
            -1,
        ).normalize();
    }

    // Closest approach of the ray to the centre; the hit is that point pulled
    // back toward the eye by the half-chord.
    const toCentre = centre.clone().sub(origin);
    const along = toCentre.dot(dir);
    const perp2 = toCentre.lengthSq() - along * along;
    const half2 = radius * radius - perp2;
    if (half2 > 0) {
        const hit = origin.clone().addScaledVector(dir, along - Math.sqrt(half2));
        return hit.sub(centre).normalize();
    }

    // Past the rim the ray misses. Pinning to the silhouette would stall the
    // drag there and turn further travel into a twist about the view axis,
    // whose sense depends on which side of the ball you are — so keep walking
    // the same great circle instead: the angle away from the eye carries on
    // growing, and a drag outside the ball turns the same way as one inside.
    const lateral = new THREE.Vector3(clientX - disc.cx, -(clientY - disc.cy), 0);
    if (lateral.lengthSq() < 1e-12) return new THREE.Vector3(0, 0, 1);
    const overshoot = lateral.length() / disc.r - 1;
    lateral.normalize();
    const rimAngle = cameraState.camera.isOrthographicCamera
        ? Math.PI / 2
        : Math.acos(Math.min(radius / dist, 1));
    const angle = rimAngle + overshoot * ARCBALL_OUTSIDE_RADIANS;
    return new THREE.Vector3(0, 0, 1).multiplyScalar(Math.cos(angle))
        .addScaledVector(lateral, Math.sin(angle));
}

/**
 * Keep only `q`'s rotation about `axis`, in place (a swing/twist split).
 *
 * The axis is the arcball's own, in camera space — so a constrained drag turns
 * about the ball as the viewer sees it, not about a world axis that may be
 * pointing anywhere on screen. The angle still comes from the arcball, so the
 * grab tracks the pointer along that one degree of freedom.
 */
function twistAboutAxis(q: Quaternion, axis: Vector3): void {
    const a = axis.clone().normalize();
    const projected = a.multiplyScalar(new THREE.Vector3(q.x, q.y, q.z).dot(a));
    q.set(projected.x, projected.y, projected.z, q.w);
    // A drag exactly perpendicular to the axis leaves nothing to normalize.
    if (q.lengthSq() < 1e-12) q.set(0, 0, 0, 1);
    else q.normalize();
}

/**
 * The rotation pivot's depth along the view axis. Perspective scale at a point
 * depends on this camera-space depth, not on its straight-line distance: the
 * two agree only on the view axis, and a drag pivot is usually off it.
 */
function pivotDepth(): number {
    const cam = cameraState.camera!;
    cam.updateMatrixWorld();
    const local = rotationCentre().clone().applyMatrix4(cam.matrixWorldInverse);
    return Math.max(-local.z, 0.001);
}

/** World units per screen pixel at the rotation pivot. */
function worldPerPixelAtTarget(): number {
    if (!cameraState.camera || !cameraState.renderer || !cameraState.controls) return 1;
    const h = Math.max(cameraState.renderer.domElement?.clientHeight || 1, 1);
    if (cameraState.camera.isOrthographicCamera) {
        // The frustum spans (top - bottom) / zoom world units vertically —
        // pinch and wheel zoom an orthographic camera through `zoom`.
        const zoom = cameraState.camera.zoom || 1;
        return Math.abs((cameraState.camera.top! - cameraState.camera.bottom!) / zoom / h);
    }
    const dist = pivotDepth();
    const fov = ((cameraState.camera.fov || 75) * Math.PI) / 180;
    return (2 * dist * Math.tan(fov / 2)) / h;
}

/**
 * World radius of a ball whose *silhouette* has a radius of `pixels` on screen
 * (a radius, not a width — every caller passes `disc.r`).
 *
 * Not `pixels * worldPerPixel`: that measures across the plane through the
 * pivot, while a perspective camera sees a sphere's silhouette from its
 * tangent, which is wider. Getting this wrong draws a ball bigger than the
 * sphere the pointer is mapped onto, so a grab near the rim visibly slips.
 */
function arcballWorldRadius(pixels: number): number {
    if (!cameraState.camera || !cameraState.controls) return pixels;
    const perPixel = worldPerPixelAtTarget();
    if (cameraState.camera.isOrthographicCamera) return pixels * perPixel;
    const dist = pivotDepth();
    return dist * Math.sin(Math.atan((pixels * perPixel) / dist));
}

// ----- Arcball debug overlay -----
//
// The drag maps the pointer onto a virtual sphere centred on the orbit pivot.
// This draws that sphere while a drag is in flight, so the thing being turned
// is visible. It lingers for BALL_LINGER_MS after the drag ends — long enough
// to press it again, or one of its axis cues — and then it is removed.

let ballHelper: import('three').Group | null = null;

/** Draw (or resize) the translucent ball the drag is notionally grabbing. */
// The rotate cue: the trackball drawn while a drag turns the view, and the
// marker on it under the pointer. 'off' draws neither. Chosen in the settings panel.
type RotateCue = 'trackball' | 'off';
const ROTATE_CUE_KEY = 'algebench.rotateCue';
let rotateCue: RotateCue = loadRotateCue();

function loadRotateCue(): RotateCue {
    try { return localStorage.getItem(ROTATE_CUE_KEY) === 'off' ? 'off' : 'trackball'; } catch { return 'trackball'; }
}

export function setRotateCue(cue: RotateCue): void {
    rotateCue = cue;
    if (cue === 'off') { cancelBallFlash(); hideArcballBall(); hideGrabMarker(); }   // no invisible linger left behind
    try { localStorage.setItem(ROTATE_CUE_KEY, cue); } catch { /* storage blocked */ }
}

function showArcballBall(): void {
    if (rotateCue === 'off') return;
    if (!cameraState.three || !cameraState.controls) return;
    const disc = arcballScreenDisc();
    if (!disc) return;
    const radius = arcballWorldRadius(disc.r);

    if (!ballHelper) {
        ballHelper = new THREE.Group();
        // A faint shell plus latitude/longitude wires: the shell alone reads as
        // a flat disc, the wires are what make it look like a sphere turning.
        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(1, 48, 32),
            new THREE.MeshBasicMaterial({
                color: 0x9fd4ff, transparent: true, opacity: 0.03,
                depthWrite: false, side: THREE.FrontSide,
            }),
        );
        // `wireframe: true` on a mesh draws GL lines, and face culling applies
        // only to triangles — so `side: FrontSide` does NOT hide the far half's
        // wires. Drop the away-facing fragments in the shader instead, which
        // needs no renderer-wide clipping state.
        const wires = new THREE.LineSegments(
            new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 24, 16)),
            new THREE.ShaderMaterial({
                transparent: true, depthWrite: false,
                uniforms: {
                    uColor: { value: new THREE.Color(0x9fd4ff) },
                    uOpacity: { value: 0.16 },
                },
                vertexShader: `
                    varying vec3 vWorldPos;
                    varying vec3 vNormalW;
                    void main() {
                        vec4 wp = modelMatrix * vec4(position, 1.0);
                        vWorldPos = wp.xyz;
                        // Unit sphere centred on the group's origin, so the
                        // surface normal is just the vertex direction.
                        vNormalW = normalize(mat3(modelMatrix) * position);
                        gl_Position = projectionMatrix * viewMatrix * wp;
                    }`,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform float uOpacity;
                    varying vec3 vWorldPos;
                    varying vec3 vNormalW;
                    void main() {
                        if (dot(vNormalW, normalize(cameraPosition - vWorldPos)) < 0.0) discard;
                        gl_FragColor = vec4(uColor, uOpacity);
                    }`,
            }),
        );
        ballHelper.add(shell, wires);
        for (const child of ballHelper.children) {
            child.renderOrder = 9998;
            child.frustumCulled = false;
        }
        cameraState.three.scene.add(ballHelper);
    }
    // A unit sphere scaled to size: the radius follows zoom without rebuilding
    // the geometry on every pointer move.
    ballHelper.scale.setScalar(radius);
    ballHelper.position.copy(rotationCentre());
    showAxisCues(disc);
}

function hideArcballBall(): void {
    hideAxisCues();
    if (!ballHelper) return;
    cameraState.three?.scene.remove(ballHelper);
    for (const child of ballHelper.children as (import('three').Mesh | import('three').LineSegments)[]) {
        child.geometry.dispose();
        (child.material as import('three').Material).dispose();
    }
    ballHelper = null;
}

// ----- Axis cues -----
// Three handles on the trackball's rim for the axis-locked drags that Cmd,
// Ctrl and Alt give from the keyboard. Pressing one starts that drag with no
// key held. They come and go with the ball, and hovering one holds a
// lingering ball up so there is time to reach it.

type CueAxis = 'x' | 'y' | 'z';
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const AXIS_CUES: { axis: CueAxis; glyph: string; label: string; deg: number }[] = [
    { axis: 'x', glyph: '↕', deg: 90, label: `Tilt: drag up or down (same as ${IS_MAC ? '⌘' : 'Win'}-drag)` },
    { axis: 'y', glyph: '↔', deg: 0,  label: 'Turn: drag left or right (same as Ctrl-drag)' },
    { axis: 'z', glyph: '⟲', deg: 45, label: `Roll: drag around the ball (same as ${IS_MAC ? '⌥' : 'Alt'}-drag)` },
];
/** Gap between the ball's rim and a cue's centre, in CSS px. */
const CUE_GAP_PX = 18;

let cueHost: HTMLElement | null = null;
let cueEls: HTMLElement[] = [];

function ensureAxisCues(): void {
    if (cueEls.length || !cueHost) return;
    for (const c of AXIS_CUES) {
        const el = document.createElement('div');
        el.className = 'axis-cue';
        el.dataset.axis = c.axis;
        el.textContent = c.glyph;
        el.title = c.label;
        el.setAttribute('aria-hidden', 'true');   // a pointer affordance; the keys do the same
        el.hidden = true;
        // Hovering a cue holds a lingering ball up; leaving re-arms its timer.
        el.addEventListener('mouseenter', () => {
            if (lingerPivot && pivotFlashTimer !== null) { clearTimeout(pivotFlashTimer); pivotFlashTimer = null; }
        });
        el.addEventListener('mouseleave', () => {
            if (lingerPivot && pivotFlashTimer === null && !document.body.classList.contains('rotating')) {
                lingerArcballBall(lingerPivot);
            }
        });
        cueHost.appendChild(el);
        cueEls.push(el);
    }
}

function showAxisCues(disc: { cx: number; cy: number; r: number }): void {
    if (!cueHost) return;
    ensureAxisCues();
    const host = cueHost.getBoundingClientRect();
    const reach = disc.r + CUE_GAP_PX;
    const pad = 14;
    AXIS_CUES.forEach((c, i) => {
        const el = cueEls[i]!;
        const a = c.deg * Math.PI / 180;
        const x = Math.min(host.width - pad, Math.max(pad, disc.cx + reach * Math.cos(a) - host.left));
        const y = Math.min(host.height - pad, Math.max(pad, disc.cy - reach * Math.sin(a) - host.top));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.hidden = false;
    });
}

function hideAxisCues(): void {
    for (const el of cueEls) el.hidden = true;
}

/** The axis lock of the cue under a press, if it is on one. */
function axisCueUnder(target: EventTarget | null): { axis: Vector3; cls: string } | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('.axis-cue') : null;
    switch (el?.dataset.axis) {
        case 'x': return { axis: new THREE.Vector3(1, 0, 0), cls: 'rotating-axis-x' };
        case 'y': return { axis: new THREE.Vector3(0, 1, 0), cls: 'rotating-axis-y' };
        case 'z': return { axis: new THREE.Vector3(0, 0, 1), cls: 'rotating-axis-z' };
        default: return null;
    }
}

let grabHelper: import('three').Mesh | null = null;

/** Mark the point on the ball the pointer is holding (`pt` is camera-space). */
function showGrabMarker(pt: Vector3): void {
    if (rotateCue === 'off') return;
    if (!cameraState.three || !cameraState.camera || !cameraState.controls) return;
    const disc = arcballScreenDisc();
    if (!disc) return;
    const radius = arcballWorldRadius(disc.r);

    if (!grabHelper) {
        grabHelper = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 12),
            new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false, depthWrite: false }),
        );
        grabHelper.renderOrder = 10000;
        grabHelper.frustumCulled = false;
        cameraState.three.scene.add(grabHelper);
    }
    // The arcball point lives in camera space; carry it into world space with
    // the camera's own orientation, then push it out onto the ball's surface.
    const world = pt.clone().applyQuaternion(cameraState.camera.quaternion).multiplyScalar(radius);
    grabHelper.position.copy(rotationCentre()).add(world);
    grabHelper.scale.setScalar(worldPerPixelAtTarget() * 6);
}

function hideGrabMarker(): void {
    if (!grabHelper) return;
    cameraState.three?.scene.remove(grabHelper);
    grabHelper.geometry.dispose();
    (grabHelper.material as import('three').Material).dispose();
    grabHelper = null;
}

// ----- Rotate mode -----
//
// 'arcball' maps the pointer onto a virtual sphere (above). 'camera' is a
// trackball in camera space: the drag's screen delta turns the view about the
// in-screen axis perpendicular to it, by an angle proportional to its length.
// Both turn about the same pivot — the point pressed on — and share the
// axis-pinned and roll drags; only how a drag becomes a rotation differs.
// 'camera' also makes pan and zoom start-relative (see "Start-relative
// interaction"), and is the default; 'arcball' keeps the older incremental
// behaviour for anyone who picks it in the settings panel.
type RotateMode = 'arcball' | 'camera';
const ROTATE_MODE_KEY = 'algebench.rotateMode';
const isRotateMode = (m: unknown): m is RotateMode => m === 'arcball' || m === 'camera';
let rotateMode: RotateMode = loadRotateMode();

function loadRotateMode(): RotateMode {
    try {
        const q = new URLSearchParams(window.location.search).get('rotmode');
        if (isRotateMode(q)) return q;
        const saved = localStorage.getItem(ROTATE_MODE_KEY);
        if (isRotateMode(saved)) return saved;
    } catch { /* storage blocked */ }
    return 'camera';
}

export function setRotateMode(mode: RotateMode): void {
    rotateMode = mode;
    // Nothing a gesture in the old mode left in flight — a smoothed turn, pan
    // or zoom still settling, or a coast — may carry on under the new one.
    haltSmoothedRotation();
    haltSmoothedZoom();
    haltSmoothedPan();
    // A drag under way carries on in the new mode from wherever the pointer
    // is: dropping its start snapshot turns a camera-space drag into an
    // arcball one, and the move handler starts a fresh snapshot for an
    // arcball drag switched to camera-space.
    trackballStart = null;
    if (cameraState.arcballInertiaId) {
        cancelAnimationFrame(cameraState.arcballInertiaId);
        cameraState.arcballInertiaId = null;
    }
    cameraState.arcballInertiaQ = null;
    releaseDragPivotIfIdle(false);
    try { localStorage.setItem(ROTATE_MODE_KEY, mode); } catch { /* storage blocked */ }
}

// ----- Start-relative interaction -----
//
// In the camera-space mode every gesture — rotate, pan, zoom — snapshots the
// view when it starts and rebuilds the view from that snapshot and the
// gesture's total travel on each event, rather than stacking per-event
// deltas: the same pointer position always gives the same view, and nothing
// drifts from rounding or from the path taken. If something else moved the
// camera mid-gesture (a zoom during a rotate drag, say), the gesture rebases
// onto the view as it now is, so it never snaps that change back out.

/** The view a gesture starts from. */
interface ViewSnapshot {
    position: Vector3;
    target: Vector3;
    up: Vector3;
    quaternion: Quaternion;
    zoom: number;
}

function snapshotView(): ViewSnapshot | null {
    const cam = cameraState.camera, ctrl = cameraState.controls;
    if (!cam || !ctrl) return null;
    return {
        position: cam.position.clone(),
        target: ctrl.target.clone(),
        up: cam.up.clone(),
        quaternion: cam.quaternion.clone(),
        zoom: cam.zoom || 1,
    };
}

/** The camera is still where a gesture last put it. */
function viewUnchangedSince(s: ViewSnapshot | null): boolean {
    const cam = cameraState.camera, ctrl = cameraState.controls;
    if (!s || !cam || !ctrl) return false;
    const eps = 1e-9;
    return cam.position.distanceToSquared(s.position) < eps
        && ctrl.target.distanceToSquared(s.target) < eps
        && cam.up.distanceToSquared(s.up) < eps
        && Math.abs((cam.zoom || 1) - s.zoom) < eps;
}

/** Put the camera at an absolute view; returns it as it landed. */
function setView(position: Vector3, target: Vector3, up?: Vector3, zoom?: number): ViewSnapshot | null {
    const cam = cameraState.camera, ctrl = cameraState.controls;
    if (!cam || !ctrl) return null;
    if (up) cam.up.copy(up).normalize();
    if (zoom !== undefined && cam.isOrthographicCamera && cam.zoom !== zoom) {
        cam.zoom = zoom;
        cam.updateProjectionMatrix!();
    }
    cam.position.copy(position);
    ctrl.target.copy(target);
    cam.lookAt(target);
    ctrl.update();
    return snapshotView();
}

/** The camera's screen right and up, in world space. */
function screenAxes(): { right: Vector3; up: Vector3 } {
    const cam = cameraState.camera!;
    cam.updateMatrixWorld();
    return {
        right: new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0),
        up: new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1),
    };
}

/**
 * A camera-space trackball drag: the view it started from and where the
 * pointer pressed. See "Start-relative interaction" above.
 *
 * The drag goes through the rotate smoother like every other gesture, so the
 * settings panel's smoothing applies here too. What is smoothed is the
 * pointer's total travel since the press; the rotation is always computed
 * from the smoothed travel and the start view, so smoothing only shapes the
 * path to an absolute goal and never stacks steps onto the camera.
 */
interface TrackballStart {
    /** The press: the pointer's travel is measured from here. */
    x: number;
    y: number;
    /** Ball radius in pixels at the press, held for the drag so the rate cannot shift under it. */
    r: number;
    pivot: Vector3;
    view: ViewSnapshot;
    /** Smoothed travel already shown when `view` was taken. */
    baseX: number;
    baseY: number;
    /** Camera-space axis the drag is pinned to, or null; `roll` turns about the view axis. */
    axis: Vector3 | null;
    roll: boolean;
    /** The view it last set, to tell whether something else has moved it since. */
    last: ViewSnapshot | null;
    /** The world rotation it last showed — its change per frame is the coast's speed. */
    applied: Quaternion;
}
/** The drag in progress. */
let trackballStart: TrackballStart | null = null;
/** The drag, or after release the tail its smoothing is still settling. */
let activeTrackball: TrackballStart | null = null;

function beginCameraTrackball(clientX: number, clientY: number, axis: Vector3 | null, roll: boolean): void {
    const view = snapshotView();
    if (!view) { trackballStart = null; return; }
    srRotLoop.cancel();
    rotSmoother.reset();
    const disc = arcballScreenDisc();
    trackballStart = activeTrackball = {
        x: clientX,
        y: clientY,
        r: disc ? Math.max(disc.r, 1) : 200,
        pivot: rotationCentre().clone(),
        view,
        baseX: 0,
        baseY: 0,
        axis,
        roll,
        last: view,
        applied: new THREE.Quaternion(),
    };
}

/**
 * Restart the trackball from the view as it is now, keeping its goal — after
 * something else moved the camera, or the modifier keys changed the axis.
 * False with no view to restart from.
 */
function rebaseCameraTrackball(s: TrackballStart): boolean {
    const now = snapshotView();
    if (!now) return false;
    const [ax, ay] = rotSmoother.axes;
    s.view = now;
    s.last = now;
    s.baseX = ax.pos;
    s.baseY = ay.pos;
    s.applied.identity();
    return true;
}

/**
 * The modifier keys changed mid-drag: the new axis takes over from the view as
 * it is now, with the pointer at (x, y). Whatever the smoothing had not yet
 * shown is dropped rather than rebased — carried over, it would keep turning
 * under the new axis while the pointer stood still.
 */
function setTrackballAxis(axis: Vector3 | null, roll: boolean, x: number, y: number): void {
    const s = trackballStart;
    if (!s) return;
    srRotLoop.cancel();
    rotSmoother.reset();
    if (!rebaseCameraTrackball(s)) return;
    s.x = x;
    s.y = y;
    s.axis = axis;
    s.roll = roll;
}

/**
 * Show the drag's smoothed travel (dx, dy) as a turn of its start view about
 * the screen axis perpendicular to it — the start camera's screen — by an
 * angle proportional to its length. The sense and rate match the arcball at
 * the ball's centre: one ball radius of travel is one radian. A roll drag
 * turns about the view axis by sideways travel.
 */
function showCameraTrackball(s: TrackballStart): void {
    const [ax, ay] = rotSmoother.axes;
    const dx = ax.pos - s.baseX;
    const dy = ay.pos - s.baseY;
    const q = new THREE.Quaternion();
    if (s.roll) {
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), dx * ROLL_RADIANS_PER_PIXEL);
    } else {
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) q.setFromAxisAngle(new THREE.Vector3(-dy / len, -dx / len, 0), len / s.r);
        if (s.axis) twistAboutAxis(q, s.axis);
    }
    const v = s.view;
    const worldQ = v.quaternion.clone().multiply(q).multiply(v.quaternion.clone().conjugate());
    const pivot = s.pivot;
    s.last = setView(
        v.position.clone().sub(pivot).applyQuaternion(worldQ).add(pivot),
        v.target.clone().sub(pivot).applyQuaternion(worldQ).add(pivot),
        v.up.clone().applyQuaternion(worldQ),
    );
    // The coast carries on at this frame's step, not the whole turn so far.
    const step = worldQ.clone().multiply(s.applied.clone().conjugate());
    s.applied.copy(worldQ);
    cameraState.arcballInertiaQ = cameraState.arcballInertiaQ
        ? cameraState.arcballInertiaQ.slerp(step, 0.5)
        : step;
}

const srRotLoop = frameLoop((dt) => {
    const s = activeTrackball;
    if (!s) return false;
    if (!viewUnchangedSince(s.last) && !rebaseCameraTrackball(s)) return false;
    rotSmoother.step(dt);
    showCameraTrackball(s);
    if (!rotSmoother.settled) return true;
    if (s !== trackballStart) activeTrackball = null;
    return false;
});

/** Move the drag's pointer to (clientX, clientY): its total travel is the smoother's goal. */
function applyCameraTrackball(clientX: number, clientY: number): void {
    const s = trackballStart;
    if (!s || !cameraState.camera || !cameraState.controls) return;
    if (!viewUnchangedSince(s.last) && !rebaseCameraTrackball(s)) return;
    const [ax, ay] = rotSmoother.axes;
    rotSmoother.push(clientX - s.x - ax.goal, clientY - s.y - ay.goal, 0);
    rotSmoother.step(0);   // 'instant' lands now; the others start their path
    showCameraTrackball(s);
    showArcballBall();
    cameraState.arcballLastMoveTime = performance.now();
    if (!rotSmoother.settled) srRotLoop.kick();
}

function applyArcballOrbit(prevPt: Vector3, currPt: Vector3, axis: Vector3 | null = null): void {
    if (!cameraState.camera || !cameraState.controls) return;
    if (prevPt.distanceToSquared(currPt) < 1e-10) return;

    // curr -> prev, applied to the camera, turns the world by its inverse: the
    // point of the ball under the pointer follows the pointer, so a drag feels
    // like grabbing the near face of the ball and turning it.
    const q = new THREE.Quaternion().setFromUnitVectors(
        currPt.clone().normalize(),
        prevPt.clone().normalize()
    );
    if (axis) twistAboutAxis(q, axis);

    applyCameraSpaceRotation(q);
}

/**
 * Turn the view by `worldQ` about the rotation pivot. Camera and orbit target
 * move together, rigidly, so the view keeps looking where it did relative to
 * the scene and only the pivot stays put. With no drag pivot this is the old
 * turn about the target, which then does not move.
 */
function turnAboutPivot(worldQ: Quaternion): void {
    if (!cameraState.camera || !cameraState.controls) return;
    const pivot = rotationCentre().clone();
    const target = cameraState.controls.target.clone().sub(pivot).applyQuaternion(worldQ).add(pivot);
    const position = cameraState.camera.position.clone().sub(pivot).applyQuaternion(worldQ).add(pivot);
    cameraState.camera.up.applyQuaternion(worldQ).normalize();
    cameraState.camera.position.copy(position);
    cameraState.controls.target.copy(target);
    cameraState.camera.lookAt(target);
    cameraState.controls.update();
}

/** Turn the view about its pivot by `q`, a rotation given in camera space. */
function applyCameraSpaceRotation(q: Quaternion): void {
    if (!cameraState.camera || !cameraState.controls) return;
    const camQ   = cameraState.camera.quaternion.clone();
    const worldQ = camQ.clone().multiply(q).multiply(camQ.clone().conjugate());

    if (rotSmoother.mode === 'instant') turnAboutPivot(worldQ);
    else pushSmoothedRotation(worldQ);

    showArcballBall();

    cameraState.arcballLastMoveTime = performance.now();
    cameraState.arcballInertiaQ = cameraState.arcballInertiaQ
        ? cameraState.arcballInertiaQ.slerp(worldQ, 0.5)
        : worldQ.clone();
}

/**
 * Roll about the screen normal, driven by sideways pointer travel.
 *
 * The arcball's own twist about that axis would mean rolling by swinging the
 * pointer in a circle around the pivot, and sideways travel would do nothing —
 * so roll keeps the rule it has always had. The axis is still the arcball's,
 * and the ball is still drawn; only the angle comes from elsewhere.
 */
const ROLL_RADIANS_PER_PIXEL = 0.0045;

function applyAxisRoll(dx: number): void {
    if (Math.abs(dx) < 1e-6) return;
    applyCameraSpaceRotation(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), dx * ROLL_RADIANS_PER_PIXEL));
}

/** A smoothing mode from `?<param>=`, else localStorage, else `fallback`. */
function loadSmoothingMode(param: string, key: string, fallback: SmoothingMode = DEFAULT_SMOOTHING): SmoothingMode {
    try {
        const q = new URLSearchParams(location.search).get(param);
        if (isSmoothingMode(q)) return q;
        const saved = localStorage.getItem(key);
        if (isSmoothingMode(saved)) return saved;
    } catch { /* storage blocked */ }
    return fallback;
}

function saveSmoothingMode(key: string, mode: SmoothingMode): void {
    try { localStorage.setItem(key, mode); } catch { /* storage blocked */ }
}

/** A requestAnimationFrame loop that runs `tick(dt)` while it returns true. */
function frameLoop(tick: (dt: number) => boolean) {
    let id: number | null = null;
    let last = 0;
    const frame = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        id = tick(dt) ? requestAnimationFrame(frame) : null;
    };
    return {
        kick(): void { if (id === null) { last = performance.now(); id = requestAnimationFrame(frame); } },
        cancel(): void { if (id !== null) cancelAnimationFrame(id); id = null; },
        get running(): boolean { return id !== null; },
    };
}

// A drag's rotation can be smoothed like pinch zoom. Each pointer move adds
// its world rotation, as a rotation vector (axis * angle), to a goal; one
// smoother per component carries the view there frame by frame. Per-move
// rotations are small, so summing their vectors composes them closely enough.
// The mode is chosen in the settings panel, or ?rotsmooth=<mode> for a visit.
const ROTATE_SMOOTHING_KEY = 'algebench.rotateSmoothing';
const rotSmoother = new VectorSmoother(loadSmoothingMode('rotsmooth', ROTATE_SMOOTHING_KEY));
const rotLoop = frameLoop((dt) => {
    const v = new THREE.Vector3(...rotSmoother.step(dt));
    const angle = v.length();
    if (angle > 0) turnAboutPivot(new THREE.Quaternion().setFromAxisAngle(v.divideScalar(angle), angle));
    if (!rotSmoother.settled) return true;
    rotSmoother.reset();
    releaseDragPivotIfIdle(false);
    return false;
});

export function setRotateSmoothingMode(mode: SmoothingMode): void {
    rotSmoother.mode = mode;
    haltSmoothedRotation();
    saveSmoothingMode(ROTATE_SMOOTHING_KEY, mode);
}

function pushSmoothedRotation(worldQ: Quaternion): void {
    const q = worldQ.clone();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);   // the short way round
    const half = Math.acos(Math.min(1, q.w));
    const k = half > 1e-9 ? (2 * half) / Math.sin(half) : 2;
    rotSmoother.push(q.x * k, q.y * k, q.z * k);
    rotLoop.kick();
}

/** Drop what's left of a smoothed turn, e.g. when a new drag takes over. */
function haltSmoothedRotation(): void {
    rotLoop.cancel();
    srRotLoop.cancel();
    activeTrackball = null;
    rotSmoother.reset();
}

/** The drag pivot outlives the drag while a coast or a smoothed turn still uses it. */
function releaseDragPivotIfIdle(rotating = rotLoop.running): void {
    if (!orbitDragActive && !rotating && !cameraState.arcballInertiaId) dragPivot = null;
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
        cameraState.arcballInertiaQ = null;
        releaseDragPivotIfIdle();   // no coast: the drag's pivot has nothing left to do
        return;
    }
    // The coast replays the last pointer move once per frame, so a flick hands
    // it however far that one move turned the view — measured at 1.59 rad, and
    // 91 degrees per frame reads as the view spinning on by itself long after
    // the button is up. Cap the speed; the decay below still ends it.
    const flick = cameraState.arcballInertiaQ.angleTo(identity);
    if (flick > MAX_INERTIA_RADIANS_PER_FRAME) {
        cameraState.arcballInertiaQ = new THREE.Quaternion()
            .slerp(cameraState.arcballInertiaQ, MAX_INERTIA_RADIANS_PER_FRAME / flick);
    }
    const slerpT = Math.pow(0.01, cameraState.arcballMomentum);
    function step() {
        if (!cameraState.arcballInertiaQ || !cameraState.camera || !cameraState.controls) {
            cameraState.arcballInertiaId = null; releaseDragPivotIfIdle(); return;
        }
        if (cameraState.arcballInertiaQ.angleTo(identity) < 0.00005) {
            cameraState.arcballInertiaQ = null; cameraState.arcballInertiaId = null; releaseDragPivotIfIdle(); return;
        }
        // The coast keeps turning about the drag's own pivot.
        turnAboutPivot(cameraState.arcballInertiaQ);
        cameraState.arcballInertiaQ.slerp(identity, slerpT);
        cameraState.arcballInertiaId = requestAnimationFrame(step);
    }
    cameraState.arcballInertiaId = requestAnimationFrame(step);
}

// ----- Pivot -----

/** How long the pivot takes to slide to a double-clicked point. */
const PIVOT_MOVE_MS = 350;
/** How long the ball lingers afterwards, to say where the pivot landed. */
const PIVOT_FLASH_MS = 700;

let pivotMoveId: number | null = null;
let pivotFlashTimer: number | null = null;

/** Show the ball and take it away again, unless a drag has claimed it. */
function flashArcballBall(): void {
    cancelBallFlash();
    showArcballBall();
    pivotFlashTimer = window.setTimeout(() => {
        pivotFlashTimer = null;
        // A drag that started during the flash owns the ball now; hiding it
        // here would pull the sphere out from under the pointer mid-rotation.
        if (!document.body.classList.contains('rotating')) hideArcballBall();
    }, PIVOT_FLASH_MS);
}

/** Stop a pivot slide mid-flight, leaving the target wherever it reached. */
function cancelPivotMove(): void {
    if (pivotMoveId === null) return;
    cancelAnimationFrame(pivotMoveId);
    pivotMoveId = null;
}

/** Drop a pending flash or linger, so a drag's own ball outlives it. */
function cancelBallFlash(): void {
    lingerPivot = null;
    if (pivotFlashTimer === null) return;
    clearTimeout(pivotFlashTimer);
    pivotFlashTimer = null;
}

/**
 * How long the ball stays up after a rotate drag ends. Pressing on it again
 * within that time grabs another point of the same ball — same pivot, ball
 * left where it is — so a turn can be built up from several short drags.
 * Every mouse up re-arms it.
 */
const BALL_LINGER_MS = 1500;
/** The pivot of the ball still up after a drag; null once it has gone. */
let lingerPivot: Vector3 | null = null;

function lingerArcballBall(pivot: Vector3): void {
    cancelBallFlash();
    if (!ballHelper) return;   // rotate cue off: nothing to linger
    lingerPivot = pivot.clone();
    pivotFlashTimer = window.setTimeout(() => {
        pivotFlashTimer = null;
        lingerPivot = null;
        if (!document.body.classList.contains('rotating')) hideArcballBall();
    }, BALL_LINGER_MS);
}

/** A pan or zoom moves the view off the lingering ball: take it away now. */
function dropLingeringBall(): void {
    if (lingerPivot === null) return;
    cancelBallFlash();
    hideArcballBall();
}

/** The lingering ball's pivot, if a press at this pixel lands on the ball. */
function lingeringPivotUnder(clientX: number, clientY: number): Vector3 | null {
    if (!lingerPivot) return null;
    const disc = arcballScreenDisc(lingerPivot);
    if (!disc) return null;
    return Math.hypot(clientX - disc.cx, clientY - disc.cy) <= disc.r ? lingerPivot.clone() : null;
}

/**
 * Turn the view about `world` from now on.
 *
 * The camera does not move: OrbitControls keeps its offset from the target, so
 * shifting the target swings the aim rather than the viewpoint, and the point
 * double-clicked ends up in the middle of the viewport with the orbit radius
 * equal to the distance to it. Panning or a camera-view button moves the pivot
 * again, exactly as they did before.
 */
export function setOrbitPivot(world: Vector3, duration: number = PIVOT_MOVE_MS): void {
    if (!cameraState.camera || !cameraState.controls) return;
    // A flash still pending from the last double-click would fire part-way
    // through this slide — `rotating` is not set, so it would dispose the ball
    // and leave the next frame to build it again, a blink mid-animation.
    cancelBallFlash();
    // Both of these drive the target every frame and would fight the slide.
    deactivateFollowCam();
    deactivateExprCamera();
    if (cameraState.arcballInertiaId) {
        cancelAnimationFrame(cameraState.arcballInertiaId);
        cameraState.arcballInertiaId = null;
    }
    cameraState.arcballInertiaQ = null;
    cancelPivotMove();
    haltSmoothedRotation();
    haltSmoothedZoom();
    haltSmoothedPan();
    dragPivot = null;

    const start = cameraState.controls.target.clone();
    const end   = world.clone();
    // Double-clicking the current pivot still flashes the ball: the click did
    // land, and silence would read as a miss.
    if (duration <= 0 || start.distanceTo(end) < 1e-6) {
        cameraState.controls.target.copy(end);
        cameraState.controls.update();
        flashArcballBall();
        return;
    }

    const startTime = performance.now();
    function step(now: number): void {
        if (!cameraState.controls) { pivotMoveId = null; return; }
        const raw = Math.min((now - startTime) / duration, 1);
        const t = raw < 0.5 ? 4*raw*raw*raw : 1 - Math.pow(-2*raw + 2, 3) / 2;
        cameraState.controls.target.lerpVectors(start, end, t);
        cameraState.controls.update();
        // Redrawn each frame so the ball rides the pivot and keeps its
        // on-screen size as the orbit radius changes under it.
        showArcballBall();
        if (raw < 1) { pivotMoveId = requestAnimationFrame(step); return; }
        pivotMoveId = null;
        flashArcballBall();
    }
    pivotMoveId = requestAnimationFrame(step);
}


const AXIS_CLASSES = ['rotating-axis-x', 'rotating-axis-y', 'rotating-axis-z'];

/**
 * Cmd, Ctrl and Alt each pin a rotation drag to one axis of the arcball — its
 * horizontal, vertical and screen-normal axis in turn. They are read live, so
 * pressing or letting go of one mid-drag switches between a free and a pinned
 * turn without lifting the pointer.
 *
 * Turning about the horizontal axis moves the pointer up and down, and vice
 * versa, so the cursor class shows the direction that still does something
 * rather than the axis itself. Rolling has no such direction: it wants the
 * pointer swung around the pivot.
 */
function modifierAxis(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): { axis: Vector3 | null; cls: string | null } {
    if (e.metaKey) return { axis: new THREE.Vector3(1, 0, 0), cls: 'rotating-axis-x' };
    if (e.ctrlKey) return { axis: new THREE.Vector3(0, 1, 0), cls: 'rotating-axis-y' };
    if (e.altKey)  return { axis: new THREE.Vector3(0, 0, 1), cls: 'rotating-axis-z' };
    return { axis: null, cls: null };
}

export function setupRollDrag(container: HTMLElement | null): void {
    if (!container) return;
    const inputSurface = container;
    cueHost = container;   // the axis cues sit in here, so presses on them reach this handler
    let orbitDrag: OrbitDragState | null = null;
    // Shift+drag and right-drag pan. Handled here rather than by the orbit
    // controls so a pan goes through the pan smoother like every other move.
    let panDrag: { x: number; y: number; start: PanStart | null } | null = null;
    // Ctrl+right-drag zooms instead: the last pointer y.
    let zoomDrag: { y: number } | null = null;
    // A right press's context menu arrives on mousedown (macOS) or after
    // mouseup (Windows, Linux), when panDrag is already gone. Remember the
    // press until its menu shows up, so either order keeps the menu shut.
    let suppressContextMenu = false;
    // A right-button drag released outside the window gets no mouseup, and
    // later moves may still report the button held, so the pan or zoom never
    // ends. Capturing the pointer for the drag keeps its moves and release
    // coming here wherever the pointer goes. The id comes from the pointerdown
    // that precedes each mousedown.
    //
    // The capture goes on the canvas the orbit controls listen on, not on this
    // container. The controls start a drag of their own on the same press's
    // pointerdown and end it only on a pointerup at the canvas; capturing
    // anywhere else delivers the pointerup there instead, so the controls stay
    // mid-pan and, once this drag re-enables them, every plain mouse move
    // keeps panning the view.
    let pressPointerId: number | null = null;
    inputSurface.addEventListener('pointerdown', (e) => { pressPointerId = e.pointerId; }, { capture: true });
    function captureDragPointer(): void {
        if (pressPointerId === null) return;
        // The controls are built on the renderer's canvas (switchProjection).
        const target = cameraState.renderer?.domElement ?? inputSurface;
        try { target.setPointerCapture(pressPointerId); } catch { /* pointer already gone */ }
    }
    inputSurface.addEventListener('lostpointercapture', () => { endPanDrag(); endZoomDrag(); });

    inputSurface.addEventListener('mousedown', (e) => {
        suppressContextMenu = e.button === 2;
        if (e.button === 2 && e.ctrlKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // Like a pan, the zoom takes over the camera from any coasting rotation.
            if (cameraState.arcballInertiaId) {
                cancelAnimationFrame(cameraState.arcballInertiaId);
                cameraState.arcballInertiaId = null;
            }
            cameraState.arcballInertiaQ = null;
            haltSmoothedRotation();
            releaseDragPivotIfIdle();
            dropLingeringBall();   // the zoom moves the view off the lingering ball
            zoomDrag = { y: e.clientY };
            captureDragPointer();
            document.body.classList.add('zooming');
            if (cameraState.controls) cameraState.controls.enabled = false;
            return;
        }
        if ((e.button === 0 && e.shiftKey) || e.button === 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            // The pan takes over the camera: a rotation still coasting or
            // settling would keep turning the view under it.
            if (cameraState.arcballInertiaId) {
                cancelAnimationFrame(cameraState.arcballInertiaId);
                cameraState.arcballInertiaId = null;
            }
            cameraState.arcballInertiaQ = null;
            haltSmoothedRotation();
            releaseDragPivotIfIdle();
            haltSmoothedPan();
            dropLingeringBall();
            panDrag = { x: e.clientX, y: e.clientY, start: rotateMode === 'camera' ? beginPanDrag(e.clientX, e.clientY) : null };
            captureDragPointer();
            if (cameraState.controls) cameraState.controls.enabled = false;
            return;
        }
        if (e.button !== 0) return;
        // A press on an axis cue is a Cmd/Ctrl/Alt drag without the key.
        const cue = axisCueUnder(e.target);
        const { axis, cls: axisClass } = cue ?? modifierAxis(e);

        e.preventDefault();
        e.stopImmediatePropagation();
        if (cameraState.arcballInertiaId) {
            cancelAnimationFrame(cameraState.arcballInertiaId);
            cameraState.arcballInertiaId = null;
        }
        cameraState.arcballInertiaQ = null;
        haltSmoothedRotation();
        // Turn about whatever was pressed on. Picked before the ball is shown
        // (a flash from a double-click may still be up), and before the drag
        // maps the pointer onto the ball, which is centred on this pivot.
        //
        // A press on the ball still lingering from the last drag keeps that
        // drag's pivot, so it grabs another point of the same ball.
        const onBall = cue ? (lingerPivot ? lingerPivot.clone() : null) : lingeringPivotUnder(e.clientX, e.clientY);
        cancelBallFlash();
        if (!onBall && !cue) hideArcballBall();
        // A follow cam re-pins the target to what it tracks every frame, so a
        // pivot elsewhere would fight it: there the drag turns about the
        // target, as it always did. An expression-driven view rewrites the
        // whole camera every frame and overrides any drag (true before this
        // change too); it gets no drag pivot either, rather than a pivot that
        // would be thrown away one frame later.
        const viewLocked = !!(cameraState.followCamState || cameraState.cameraExprState);
        // A cue keeps the ball's own pivot (null: the ball is on the orbit
        // target, as after a double-click flash) — never the point under the cue.
        dragPivot = viewLocked ? null : cue ? onBall : (onBall ?? pivotUnder(e.clientX, e.clientY));
        orbitDrag = { pt: screenToArcball(e.clientX, e.clientY), axis, x: e.clientX, y: e.clientY, locked: !!cue };
        orbitDragActive = true;
        if (rotateMode === 'camera') beginCameraTrackball(e.clientX, e.clientY, axis, !!axis && axis.z === 1);
        else trackballStart = null;
        if (axisClass) document.body.classList.add(axisClass);
        // A pivot slide still running would keep lerping the target out from
        // under this drag, which turns about that same target — the two would
        // take turns moving the view. The drag wins; the pivot stops wherever
        // it got to.
        cancelPivotMove();
        cancelBallFlash();   // this drag owns the ball now
        showArcballBall();
        showGrabMarker(orbitDrag.pt);
        document.body.classList.add('rotating');
        if (cameraState.controls) cameraState.controls.enabled = false;
    }, { capture: true });

    window.addEventListener('mousemove', (e) => {
        if (zoomDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if ((e.buttons & 2) === 0) return endZoomDrag();
            dragZoom(e.clientY - zoomDrag.y);
            zoomDrag.y = e.clientY;
            return;
        }
        if (panDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if ((e.buttons & 3) === 0) return endPanDrag();
            // Follow the mode now active, from the last pointer position: a
            // camera-space pan needs a live start (new after an arcball→camera
            // switch, or after a mode switch or wheel pan dropped it), and an
            // arcball pan has none. Checked every move, so switching mid-drag
            // either way takes effect at once rather than freezing or lagging.
            if (rotateMode === 'camera') {
                if (!panDrag.start || panDrag.start !== activePan) panDrag.start = beginPanDrag(panDrag.x, panDrag.y);
            } else {
                panDrag.start = null;
            }
            if (panDrag.start) applyPanDrag(panDrag.start, e.clientX, e.clientY);
            else panByPixels(e.clientX - panDrag.x, e.clientY - panDrag.y);
            panDrag.x = e.clientX;
            panDrag.y = e.clientY;
            return;
        }
        if (orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if ((e.buttons & 1) === 0) return endOrbitDrag();
            updateDragAxis(e);
            const currPt = screenToArcball(e.clientX, e.clientY);
            const roll = !!orbitDrag.axis && orbitDrag.axis.z === 1;
            // Switched to camera-space mid-drag: start its snapshot from the
            // previous pointer position, so this move already counts.
            if (rotateMode === 'camera' && !trackballStart) {
                beginCameraTrackball(orbitDrag.x, orbitDrag.y, orbitDrag.axis, roll);
            }
            if (trackballStart) applyCameraTrackball(e.clientX, e.clientY);
            else if (roll) applyAxisRoll(e.clientX - orbitDrag.x);
            else applyArcballOrbit(orbitDrag.pt, currPt, orbitDrag.axis);
            orbitDrag.pt = currPt;
            orbitDrag.x = e.clientX;
            orbitDrag.y = e.clientY;
            showGrabMarker(currPt);
            return;
        }
    });

    /**
     * Follow the modifier keys mid-drag. A start-relative drag restarts from
     * the view as it is now, at the pointer's current position, so the new
     * axis takes over from here instead of reinterpreting the whole drag.
     */
    function updateDragAxis(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): void {
        if (!orbitDrag || orbitDrag.locked) return;
        const { axis, cls } = modifierAxis(e);
        const was = orbitDrag.axis;
        if (was === axis || (was && axis && was.equals(axis))) return;
        orbitDrag.axis = axis;
        document.body.classList.remove(...AXIS_CLASSES);
        if (cls) document.body.classList.add(cls);
        // orbitDrag.x/y are still the previous pointer position here.
        setTrackballAxis(axis, !!axis && axis.z === 1, orbitDrag.x, orbitDrag.y);
    }

    const onModifierKey = (e: KeyboardEvent) => {
        if (!orbitDrag || !['Meta', 'Control', 'Alt'].includes(e.key)) return;
        updateDragAxis(e);
    };
    window.addEventListener('keydown', onModifierKey);
    window.addEventListener('keyup', onModifierKey);

    function endPanDrag() {
        if (!panDrag) return;
        panDrag = null;
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
    }

    function endZoomDrag() {
        if (!zoomDrag) return;
        zoomDrag = null;
        document.body.classList.remove('zooming');
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
    }

    function endOrbitDrag() {
        endPanDrag();
        endZoomDrag();
        if (!orbitDrag) return;
        orbitDrag = null;
        orbitDragActive = false;
        trackballStart = null;
        document.body.classList.remove(...AXIS_CLASSES);
        // The ball stays a moment (BALL_LINGER_MS) so another press can grab it.
        lingerArcballBall(rotationCentre());
        hideGrabMarker();
        document.body.classList.remove('rotating');
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
        startArcballInertia();
    }

    window.addEventListener('mouseup', (e) => {
        if (orbitDrag || panDrag || zoomDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        endOrbitDrag();
    }, { capture: true });

    // Ctrl+click is a right-click on macOS: keep its menu out of the drag.
    // A right-drag pans (or zooms, with Ctrl), so its menu stays shut too.
    inputSurface.addEventListener('contextmenu', (e) => {
        if (orbitDrag || panDrag || zoomDrag || suppressContextMenu) e.preventDefault();
        suppressContextMenu = false;
    });

    window.addEventListener('pointerup', () => { endOrbitDrag(); }, { capture: true });
    document.addEventListener('mouseup', () => { endOrbitDrag(); }, true);
    window.addEventListener('mouseleave', () => { endOrbitDrag(); });
    window.addEventListener('blur', () => { endOrbitDrag(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { endOrbitDrag(); }
    });
    window.addEventListener('mousedown', () => {
        if (!orbitDrag && cameraState.controls && !cameraState.controls.enabled) {
            cameraState.controls.enabled = true;
        }
    }, { capture: true });
}

function activateExprCamera(viewSpec: CameraView, key: string): void {
    dropLingeringBall();   // the expression now drives the view, not the lingering drag
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
        // Install MathBox explicitly so its factory does not also install splash.
        // Custom Three.js-only scenes never enqueue MathBox geometry, so that
        // splash never receives a completion event. AlgeBench owns loading UI.
        plugins: ['core', 'controls', 'cursor', 'mathbox'],
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

    let lastWidth = -1, lastHeight = -1;
    const resizeViewport = () => {
        const w2 = container.clientWidth;
        const h2 = container.clientHeight;
        if (w2 <= 0 || h2 <= 0 || (w2 === lastWidth && h2 === lastHeight)) return;
        lastWidth = w2;
        lastHeight = h2;
        // The lingering ball and its cues were placed for the old size.
        dropLingeringBall();
        // initMathBox has initialized both renderer and camera before observation.
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
    };
    window.addEventListener('resize', resizeViewport);
    // Panel transitions and lesson CSS can resize the canvas without a window event.
    // Observe the container, not the canvas; the size guard avoids renderer feedback.
    const viewportObserver = new ResizeObserver(resizeViewport);
    viewportObserver.observe(container);

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

// Pinch-to-zoom arrives as a wheel event with ctrlKey set (the browser's own
// convention for trackpad pinch). OrbitControls turns each such event into one
// fixed 5% step whatever its size, so zoom speed tracked the event *rate* —
// which falls with frame rate, and a heavy scene at 25 fps barely moved. Zoom
// by the pinch's actual travel instead: exp(-deltaY * k), so the same finger
// motion gives the same zoom at any frame rate. A Ctrl+wheel notch steps.
const PINCH_ZOOM_PER_DELTA = 0.02;   // a pinch that doubles finger spread zooms ~4x
const PINCH_MAX_STEP = 20;           // safety limit only: never cap a real pinch
// A mouse wheel held with Ctrl sends the same ctrlKey wheel event, but in
// whole notches of ~100 (Chrome) or ~120 — a fixed step per notch, not the
// pinch rule, or one notch would jump ~7x. A pinch's deltaY is continuous
// (fractional, and small per event), so the two are told apart by that.
const WHEEL_NOTCH_STEP = 1.2;

function isWheelNotch(deltaY: number): boolean {
    const a = Math.abs(deltaY);
    return a >= 50 && Number.isInteger(a) && (a % 100 === 0 || a % 120 === 0 || a % 53 === 0);
}

// Each pinch event only moves a *goal*; a per-frame smoother carries the
// camera there (see smoothing.ts for the modes). The mode is chosen in the
// settings panel (saved in localStorage), or ?zoomsmooth=<mode> for a visit.
const ZOOM_SMOOTHING_KEY = 'algebench.zoomSmoothing';
const zoomSmoother = new Smoother(loadSmoothingMode('zoomsmooth', ZOOM_SMOOTHING_KEY));
const zoomLoop = frameLoop((dt) => {
    const d = zoomSmoother.step(dt);
    if (d !== 0 && !applyZoomFactor(Math.exp(d))) zoomSmoother.halt();   // hit a limit
    if (!zoomSmoother.settled) return true;
    zoomSmoother.reset();
    return false;
});

function haltSmoothedZoom(): void {
    zoomLoop.cancel();
    srZoomLoop.cancel();
    activeZoom = null;
    zoomSmoother.reset();
}

export function setZoomSmoothingMode(mode: SmoothingMode): void {
    zoomSmoother.mode = mode;
    haltSmoothedZoom();
    saveSmoothingMode(ZOOM_SMOOTHING_KEY, mode);
}

// Ctrl + two-finger scroll arrives as the same ctrlKey wheel event as a pinch,
// but runs the other way: fingers up scroll the page down (deltaY > 0), which
// for a pinch means spreading the fingers apart the other way — zoom out. A
// scroll should zoom in when the fingers go up, like pushing the scene away
// from you, so its sign flips. The two are told apart by their deltas: a
// pinch's are fractional, a trackpad scroll's whole pixels. The call is made
// once per gesture — a run of events with no long gap — so a pinch that
// happens to land on a whole number cannot flip direction mid-gesture.
let ctrlWheelGesture: { scroll: boolean; time: number } | null = null;

function isCtrlScroll(deltaX: number, deltaY: number): boolean {
    const now = performance.now();
    const g = ctrlWheelGesture;
    if (g && now - g.time <= WHEEL_GESTURE_GAP_MS) { g.time = now; return g.scroll; }
    const scroll = Number.isInteger(deltaY) && Number.isInteger(deltaX) && deltaY !== 0;
    ctrlWheelGesture = { scroll, time: now };
    return scroll;
}

function pinchZoom(deltaY: number, deltaX = 0): void {
    if (!cameraState.camera || !cameraState.controls) return;
    // A mouse-wheel notch is neither, and ends any scroll or pinch gesture, so
    // the next trackpad event is classified afresh rather than inheriting one.
    if (isWheelNotch(deltaY)) ctrlWheelGesture = null;
    else if (isCtrlScroll(deltaX, deltaY)) deltaY = -deltaY;
    // A pinch zooms by its travel, uncapped in practice, so a fast pinch
    // coalesced into few large events on a slow frame zooms as far as the
    // same pinch at 60 fps.
    const raw = isWheelNotch(deltaY)
        ? Math.pow(WHEEL_NOTCH_STEP, -Math.sign(deltaY) * Math.max(1, Math.round(Math.abs(deltaY) / 100)))
        : Math.exp(-deltaY * PINCH_ZOOM_PER_DELTA);
    const factor = Math.min(PINCH_MAX_STEP, Math.max(1 / PINCH_MAX_STEP, raw));   // >1 zooms in
    zoomByLog(Math.log(factor));
}

/** Zoom by ln `logFactor` (>0 zooms in) through the current mode and smoother. */
function zoomByLog(logFactor: number): void {
    if (rotateMode === 'camera') { pinchZoomStartRelative(logFactor); return; }
    if (zoomSmoother.mode === 'instant') { applyZoomFactor(Math.exp(logFactor)); return; }
    zoomSmoother.push(logFactor);
    zoomLoop.kick();
}

// Ctrl+right-drag zooms: dragging down pulls the scene toward you (zooms in),
// up pushes it away. 100 px of travel zooms about 2.7x.
const DRAG_ZOOM_PER_PX = 0.01;

/** Ctrl+right-drag: zoom by the pointer's vertical travel since the last move. */
function dragZoom(dy: number): void {
    if (!cameraState.camera || !cameraState.controls || dy === 0) return;
    zoomByLog(dy * DRAG_ZOOM_PER_PX);
}

// Pan — two-finger trackpad scroll, Shift+drag and right-drag — moves camera
// and target together by a world offset. Like zoom and rotation, each event
// adds to a goal that a smoother carries the view to. The mode is chosen in
// the settings panel, or ?pansmooth=<mode> for a visit.
const PAN_SMOOTHING_KEY = 'algebench.panSmoothing';
const panSmoother = new VectorSmoother(loadSmoothingMode('pansmooth', PAN_SMOOTHING_KEY));
const panLoop = frameLoop((dt) => {
    const [x, y, z] = panSmoother.step(dt);
    if (x || y || z) applyPan(new THREE.Vector3(x, y, z));
    if (!panSmoother.settled) return true;
    panSmoother.reset();
    return false;
});

function haltSmoothedPan(): void {
    panLoop.cancel();
    srPanLoop.cancel();
    activePan = null;
    panSmoother.reset();
}

export function setPanSmoothingMode(mode: SmoothingMode): void {
    panSmoother.mode = mode;
    haltSmoothedPan();
    saveSmoothingMode(PAN_SMOOTHING_KEY, mode);
}

function applyPan(offset: Vector3): void {
    if (!cameraState.camera || !cameraState.controls) return;
    cameraState.camera.position.add(offset);
    cameraState.controls.target.add(offset);
    cameraState.controls.update();
}

/** Pan by a world offset, through the pan smoother. */
function panBy(offset: Vector3): void {
    if (panSmoother.mode === 'instant') { applyPan(offset); return; }
    panSmoother.push(offset.x, offset.y, offset.z);
    panLoop.kick();
}

/** World units per screen pixel at the orbit target's depth, or null with no view. */
function panPerPixel(): number | null {
    const cam = cameraState.camera, ctrl = cameraState.controls;
    const h = cameraState.renderer?.domElement?.clientHeight;
    if (!cam || !ctrl || !h) return null;
    if (cam.isOrthographicCamera) return Math.abs((cam.top! - cam.bottom!) / (cam.zoom || 1) / h);
    cam.updateMatrixWorld();
    const depth = Math.max(-ctrl.target.clone().applyMatrix4(cam.matrixWorldInverse).z, 0.001);
    return (2 * depth * Math.tan(((cam.fov || 75) * Math.PI) / 360)) / h;
}

/** Pan so the scene moves (dx, dy) screen pixels, as if grabbed at the target's depth. */
function panByPixels(dx: number, dy: number): void {
    const perPixel = panPerPixel();
    if (perPixel === null) return;
    const { right, up } = screenAxes();
    panBy(new THREE.Vector3()
        .addScaledVector(right, -dx * perPixel)
        .addScaledVector(up,     dy * perPixel));
}

// Start-relative pan and zoom still go through the pan and zoom smoothers, so
// the settings panel's smoothing applies in both modes — without giving up
// start-relative input. The smoother's goal is the gesture's *total* travel
// (a world offset for pan, ln zoom for zoom), and each frame the view is
// rebuilt as the start snapshot plus the smoothed position: the smoother only
// shapes the path to an absolute goal, it never stacks steps onto the camera.
// If something else moves the camera mid-gesture, the snapshot rebases onto
// the view as it now is, and `base` records how much of the goal was already
// shown then.

/**
 * A start-relative pan: the view it started from, the screen axes and scale
 * held from then, and where its input began. The smoother's goal is the world
 * offset for the input's travel since.
 */
interface PanStart {
    view: ViewSnapshot;
    right: Vector3;
    up: Vector3;
    /** World units per unit of travel along each screen axis. */
    perX: number;
    perY: number;
    x: number;
    y: number;
    /** The input's current position, in the units of `x` and `y`. */
    curX: number;
    curY: number;
    /** Smoothed offset already shown when `view` was taken. */
    base: Vector3;
    last: ViewSnapshot | null;
}
let activePan: PanStart | null = null;

function beginPan(x: number, y: number, perX: number, perY: number): PanStart | null {
    const view = snapshotView();
    if (!view) return null;
    srPanLoop.cancel();
    panSmoother.reset();
    const { right, up } = screenAxes();
    activePan = { view, right, up, perX, perY, x, y, curX: x, curY: y, base: new THREE.Vector3(), last: view };
    return activePan;
}

function panSmoothedPos(): Vector3 {
    const [x, y, z] = panSmoother.axes;
    return new THREE.Vector3(x.pos, y.pos, z.pos);
}

/** Rebase onto the camera if something else moved it; false with no view. */
function rebasePan(p: PanStart): boolean {
    if (viewUnchangedSince(p.last)) return true;
    const now = snapshotView();
    if (!now) return false;
    p.view = now;
    p.last = now;
    p.base = panSmoothedPos();
    return true;
}

/** Show the pan's smoothed offset on its start view. */
function showPan(p: PanStart): void {
    const offset = panSmoothedPos().sub(p.base);
    p.last = setView(p.view.position.clone().add(offset), p.view.target.clone().add(offset));
}

const srPanLoop = frameLoop((dt) => {
    const p = activePan;
    if (!p || !rebasePan(p)) return false;
    panSmoother.step(dt);
    showPan(p);
    return !panSmoother.settled;
});

/** Move a start-relative pan's input to (x, y): its total travel sets the goal. */
function applyPanTo(p: PanStart, x: number, y: number): void {
    if (activePan !== p || !rebasePan(p)) return;
    p.curX = x;
    p.curY = y;
    const goal = new THREE.Vector3()
        .addScaledVector(p.right, (x - p.x) * p.perX)
        .addScaledVector(p.up,    (y - p.y) * p.perY);
    const [ax, ay, az] = panSmoother.axes;
    panSmoother.push(goal.x - ax.goal, goal.y - ay.goal, goal.z - az.goal);
    panSmoother.step(0);   // 'instant' lands now; the others start their path
    showPan(p);
    if (!panSmoother.settled) srPanLoop.kick();
}

/** Shift+drag / right-drag: the scene follows the pointer from where it pressed. */
function beginPanDrag(clientX: number, clientY: number): PanStart | null {
    const perPixel = panPerPixel();
    return perPixel === null ? null : beginPan(clientX, clientY, -perPixel, perPixel);
}

function applyPanDrag(p: PanStart, clientX: number, clientY: number): void {
    applyPanTo(p, clientX, clientY);
}

// Wheel gestures — two-finger scroll and pinch — have no press or release, so
// a gesture is a run of events with no gap longer than this. One still
// settling is carried on rather than restarted, so a pause mid-glide cannot
// drop the rest of its goal.
const WHEEL_GESTURE_GAP_MS = 200;

let wheelPanTime = 0;

/** Two-finger scroll: pan by the gesture's total scroll from its start view. */
function wheelPanStartRelative(deltaX: number, deltaY: number): void {
    const now = performance.now();
    let p = activePan;
    const fresh = !p || p.perX < 0   // a drag's pan, not a scroll's
        || (now - wheelPanTime > WHEEL_GESTURE_GAP_MS && panSmoother.settled);
    wheelPanTime = now;
    if (fresh) {
        const view = snapshotView();
        if (!view) return;
        const h = cameraState.renderer?.domElement?.clientHeight || 1;
        const perPixel = view.position.distanceTo(view.target) / h * 0.8;
        p = beginPan(0, 0, perPixel, -perPixel);
    }
    if (p) applyPanTo(p, p.curX + deltaX, p.curY + deltaY);
}

/** A start-relative zoom: the view it started from, and the smoothed ln zoom already shown then. */
interface ZoomStart {
    view: ViewSnapshot;
    base: number;
    last: ViewSnapshot | null;
    time: number;
}
let activeZoom: ZoomStart | null = null;

function rebaseZoom(g: ZoomStart): boolean {
    if (viewUnchangedSince(g.last)) return true;
    const now = snapshotView();
    if (!now) return false;
    g.view = now;
    g.last = now;
    g.base = zoomSmoother.pos;
    return true;
}

/** The ln zoom the limits allow from a view: [most out, most in]. */
function zoomLogRange(v: ViewSnapshot): [number, number] {
    const cam = cameraState.camera!;
    const ctrl = cameraState.controls as unknown as {
        minDistance?: number; maxDistance?: number; minZoom?: number; maxZoom?: number;
    };
    if (cam.isOrthographicCamera) {
        return [Math.log((ctrl.minZoom ?? 0) / v.zoom), Math.log((ctrl.maxZoom ?? Infinity) / v.zoom)];
    }
    const start = v.position.distanceTo(v.target);
    return [Math.log(start / (ctrl.maxDistance ?? Infinity)), Math.log(start / Math.max(ctrl.minDistance ?? 0, 1e-6))];
}

/** Show the zoom's smoothed ln zoom on its start view. */
function showZoom(g: ZoomStart): void {
    const v = g.view;
    const rel = zoomSmoother.pos - g.base;
    if (cameraState.camera!.isOrthographicCamera) {
        g.last = setView(v.position, v.target, undefined, v.zoom * Math.exp(rel));
    } else {
        const offset = v.position.clone().sub(v.target);
        g.last = setView(v.target.clone().add(offset.setLength(Math.max(offset.length() / Math.exp(rel), 1e-6))), v.target);
    }
}

const srZoomLoop = frameLoop((dt) => {
    const g = activeZoom;
    if (!g || !rebaseZoom(g)) return false;
    zoomSmoother.step(dt);
    showZoom(g);
    return !zoomSmoother.settled;
});

/**
 * Pinch (and Ctrl + two-finger scroll, which arrives as the same event): the
 * goal is the gesture's total ln zoom, held to what the zoom limits allow so
 * that pinching back out of a limit answers at once rather than first
 * unwinding travel that did nothing.
 */
function pinchZoomStartRelative(logFactor: number): void {
    if (!cameraState.camera || !cameraState.controls) return;
    const now = performance.now();
    let g = activeZoom;
    if (!g || (now - g.time > WHEEL_GESTURE_GAP_MS && zoomSmoother.settled)) {
        const view = snapshotView();
        if (!view) return;
        srZoomLoop.cancel();
        zoomLoop.cancel();
        zoomSmoother.reset();
        g = activeZoom = { view, base: 0, last: view, time: now };
    }
    g.time = now;
    if (!rebaseZoom(g)) return;
    const [lo, hi] = zoomLogRange(g.view);
    const rel = Math.min(hi, Math.max(lo, zoomSmoother.goal - g.base + logFactor));
    zoomSmoother.push(rel + g.base - zoomSmoother.goal);
    zoomSmoother.step(0);   // 'instant' lands now; the others start their path
    showZoom(g);
    if (!zoomSmoother.settled) srZoomLoop.kick();
}

/** Scale the view by `factor` (>1 zooms in). False when a limit clamped it. */
function applyZoomFactor(factor: number): boolean {
    if (!cameraState.camera || !cameraState.controls) return false;
    const ctrl = cameraState.controls as unknown as {
        target: Vector3; minDistance?: number; maxDistance?: number;
        minZoom?: number; maxZoom?: number; update(): void;
    };
    const cam = cameraState.camera;
    let free: boolean;
    if (cam.isOrthographicCamera) {
        const want = (cam.zoom || 1) * factor;
        const zoom = Math.min(ctrl.maxZoom ?? Infinity, Math.max(ctrl.minZoom ?? 0, want));
        free = zoom === want;
        cam.zoom = zoom;
        cam.updateProjectionMatrix!();
    } else {
        const offset = cam.position.clone().sub(ctrl.target);
        const want = offset.length() / factor;
        const dist = Math.min(ctrl.maxDistance ?? Infinity, Math.max(ctrl.minDistance ?? 0, want));
        free = dist === want;
        cam.position.copy(ctrl.target).add(offset.setLength(Math.max(dist, 1e-6)));
    }
    ctrl.update();
    return free;
}

/** Bind the settings panel's smoothing selects, rotate cue and rotate mode. */
function bindSmoothingSettings(): void {
    const bind = (id: string, current: SmoothingMode, set: (m: SmoothingMode) => void) => {
        const sel = document.getElementById(id) as HTMLSelectElement | null;
        if (!sel) return;
        sel.value = current;
        sel.addEventListener('change', () => { if (isSmoothingMode(sel.value)) set(sel.value); });
    };
    bind('zoom-smoothing-select', zoomSmoother.mode, setZoomSmoothingMode);
    bind('rotate-smoothing-select', rotSmoother.mode, setRotateSmoothingMode);
    bind('pan-smoothing-select', panSmoother.mode, setPanSmoothingMode);
    const cue = document.getElementById('rotate-cue-select') as HTMLSelectElement | null;
    if (cue) {
        cue.value = rotateCue;
        cue.addEventListener('change', () => setRotateCue(cue.value === 'off' ? 'off' : 'trackball'));
    }
    const mode = document.getElementById('rotate-mode-select') as HTMLSelectElement | null;
    if (mode) {
        mode.value = rotateMode;
        mode.addEventListener('change', () => { if (isRotateMode(mode.value)) setRotateMode(mode.value); });
    }
}

export function setupTrackpadPan(): void {
    const canvas = cameraState.renderer && cameraState.renderer.domElement;
    if (!canvas) return;
    bindSmoothingSettings();
    canvas.addEventListener('wheel', (e) => {
        dropLingeringBall();   // pinch, zoom or scroll-pan: the lingering ball is stale
        if (e.ctrlKey && e.deltaMode === 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pinchZoom(e.deltaY, e.deltaX);
            return;
        }
        if (e.ctrlKey || e.deltaMode !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!cameraState.camera || !cameraState.controls) return;
        if (rotateMode === 'camera') { wheelPanStartRelative(e.deltaX, e.deltaY); return; }

        const distance  = cameraState.camera.position.distanceTo(cameraState.controls.target);
        const panFactor = distance / canvas.clientHeight * 0.8;

        const right = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 0);
        const up    = new THREE.Vector3().setFromMatrixColumn(cameraState.camera.matrix, 1);
        panBy(new THREE.Vector3()
            .addScaledVector(right,  e.deltaX * panFactor)
            .addScaledVector(up,    -e.deltaY * panFactor));
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
    // Camera buttons, step changes, chat and deeplinks move the view off a
    // lingering ball; one left up would be grabbed at a stale pivot.
    dropLingeringBall();
    deactivateFollowCam();
    deactivateExprCamera();
    // A flick's coast still running would keep turning the view — and, about
    // a drag pivot, dragging the orbit target with it — while this animation
    // interpolates both: stop it, and drop the pivot it was turning about.
    if (cameraState.arcballInertiaId) {
        cancelAnimationFrame(cameraState.arcballInertiaId);
        cameraState.arcballInertiaId = null;
    }
    cameraState.arcballInertiaQ = null;
    haltSmoothedRotation();
    haltSmoothedZoom();
    haltSmoothedPan();
    dragPivot = null;
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
    const activeBtn = findCamButton(view);
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

// ----- Camera settled -----

/** How long the camera must stay still after moving before it counts as settled. */
const CAMERA_SETTLE_MS = 300;

/**
 * Announce `algebench:camerachange` once the camera settles after moving —
 * however it moved: a preset animation, a trackball or axis drag, a pan,
 * a wheel or pinch zoom, inertia. Those paths are many and custom, so this
 * watches the result instead of each input: once per frame it compares the
 * camera's position, target, up and zoom with the last frame's, and fires
 * one event when a move has been still for CAMERA_SETTLE_MS. Listeners (the
 * learning plan's resume point) get one event per gesture, not per frame.
 */
export function startCameraSettleWatch(): void {
    let last: number[] = [];
    let moving = false;
    let stillSince = 0;
    const snapshot = (): number[] => {
        const c = cameraState.camera, t = cameraState.controls?.target;
        if (!c || !t) return [];
        return [c.position.x, c.position.y, c.position.z, t.x, t.y, t.z,
                c.up.x, c.up.y, c.up.z, (c as { zoom?: number }).zoom ?? 1];
    };
    const frame = (now: number): void => {
        const cur = snapshot();
        const changed = cur.length !== last.length || cur.some((v, i) => Math.abs(v - last[i]!) > 1e-6);
        if (changed) {
            if (last.length) moving = true;   // the first sample is a baseline, not a move
            last = cur;
            stillSince = now;
        } else if (moving && now - stillSince >= CAMERA_SETTLE_MS) {
            moving = false;
            try { window.dispatchEvent(new CustomEvent('algebench:camerachange')); } catch (_) { /* ignore */ }
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
                dropLingeringBall();   // the follow cam now drives the view
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
