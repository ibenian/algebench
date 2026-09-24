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
/** The in-flight arcball orbit: the previous point on the virtual sphere. */
interface OrbitDragState {
    pt: Vector3;
    /** Camera-space axis the drag is pinned to, or null for a free arcball. */
    axis: Vector3 | null;
    /** Previous pointer x, for the roll axis — see applyAxisRoll. */
    x: number;
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
    if (hint) hint.innerHTML = 'Drag: rotate &middot; &#8984;/Ctrl/&#8997;+drag: rotate about one axis &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel: zoom';
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
function arcballScreenDisc(): { cx: number; cy: number; r: number; rect: DOMRect } | null {
    if (!cameraState.renderer || !cameraState.camera || !cameraState.controls) return null;
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
    const ndc = rotationCentre().clone().project(cameraState.camera as unknown as Camera);
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

/** World units per screen pixel at the rotation pivot. */
function worldPerPixelAtTarget(): number {
    if (!cameraState.camera || !cameraState.renderer || !cameraState.controls) return 1;
    const h = Math.max(cameraState.renderer.domElement?.clientHeight || 1, 1);
    if (cameraState.camera.isOrthographicCamera) {
        return Math.abs((cameraState.camera.top! - cameraState.camera.bottom!) / h);
    }
    const dist = Math.max(cameraState.camera.position.distanceTo(rotationCentre()), 0.001);
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
    const dist = Math.max(cameraState.camera.position.distanceTo(rotationCentre()), 1e-6);
    return dist * Math.sin(Math.atan((pixels * perPixel) / dist));
}

// ----- Arcball debug overlay -----
//
// The drag maps the pointer onto a virtual sphere centred on the orbit pivot.
// This draws that sphere while a drag is in flight, so the thing being turned
// is visible; it is removed as soon as the drag ends.

let ballHelper: import('three').Group | null = null;

/** Draw (or resize) the translucent ball the drag is notionally grabbing. */
function showArcballBall(): void {
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
}

function hideArcballBall(): void {
    if (!ballHelper) return;
    cameraState.three?.scene.remove(ballHelper);
    for (const child of ballHelper.children as (import('three').Mesh | import('three').LineSegments)[]) {
        child.geometry.dispose();
        (child.material as import('three').Material).dispose();
    }
    ballHelper = null;
}

let grabHelper: import('three').Mesh | null = null;

/** Mark the point on the ball the pointer is holding (`pt` is camera-space). */
function showGrabMarker(pt: Vector3): void {
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

    turnAboutPivot(worldQ);

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
            cameraState.arcballInertiaId = null; return;
        }
        if (cameraState.arcballInertiaQ.angleTo(identity) < 0.00005) {
            cameraState.arcballInertiaQ = null; cameraState.arcballInertiaId = null; return;
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

/** Drop a pending flash, so a drag's own ball outlives it. */
function cancelBallFlash(): void {
    if (pivotFlashTimer === null) return;
    clearTimeout(pivotFlashTimer);
    pivotFlashTimer = null;
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


export function setupRollDrag(container: HTMLElement | null): void {
    if (!container) return;
    const inputSurface = container;
    let orbitDrag: OrbitDragState | null = null;

    inputSurface.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        if (e.shiftKey) return;
        // Cmd, Ctrl and Alt each pin the drag to one axis of the arcball — its
        // horizontal, vertical and screen-normal axis in turn. Latched here, so
        // letting go of the key mid-drag cannot change what the drag is doing.
        const axis = e.metaKey ? new THREE.Vector3(1, 0, 0)
                  : e.ctrlKey ? new THREE.Vector3(0, 1, 0)
                  : e.altKey  ? new THREE.Vector3(0, 0, 1)
                  : null;
        // Turning about the horizontal axis moves the pointer up and down, and
        // vice versa, so the cursor shows the direction that still does
        // something rather than the axis itself. Rolling has no such direction:
        // it wants the pointer swung around the pivot.
        const axisClass = e.metaKey ? 'rotating-axis-x'
                        : e.ctrlKey ? 'rotating-axis-y'
                        : e.altKey  ? 'rotating-axis-z'
                        : null;

        e.preventDefault();
        e.stopImmediatePropagation();
        if (cameraState.arcballInertiaId) {
            cancelAnimationFrame(cameraState.arcballInertiaId);
            cameraState.arcballInertiaId = null;
        }
        cameraState.arcballInertiaQ = null;
        // Turn about whatever was pressed on. Picked before the ball is shown
        // (a flash from a double-click may still be up), and before the drag
        // maps the pointer onto the ball, which is centred on this pivot.
        cancelBallFlash();
        hideArcballBall();
        // A follow cam (or an expression-driven view) re-pins the target to
        // what it tracks every frame, so a pivot elsewhere would fight it:
        // there the drag keeps turning about the target, as it always did.
        const viewLocked = !!(cameraState.followCamState || cameraState.cameraExprState);
        dragPivot = viewLocked ? null : pivotUnder(e.clientX, e.clientY);
        orbitDrag = { pt: screenToArcball(e.clientX, e.clientY), axis, x: e.clientX };
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
        if (orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if ((e.buttons & 1) === 0) return endOrbitDrag();
            const currPt = screenToArcball(e.clientX, e.clientY);
            if (orbitDrag.axis && orbitDrag.axis.z === 1) applyAxisRoll(e.clientX - orbitDrag.x);
            else applyArcballOrbit(orbitDrag.pt, currPt, orbitDrag.axis);
            orbitDrag.pt = currPt;
            orbitDrag.x = e.clientX;
            showGrabMarker(currPt);
            return;
        }
    });

    function endOrbitDrag() {
        if (!orbitDrag) return;
        orbitDrag = null;
        document.body.classList.remove('rotating-axis-x', 'rotating-axis-y', 'rotating-axis-z');
        hideArcballBall();
        hideGrabMarker();
        document.body.classList.remove('rotating');
        if (cameraState.controls) {
            cameraState.controls.enabled = true;
            cameraState.controls.update();
        }
        startArcballInertia();
    }

    window.addEventListener('mouseup', (e) => {
        if (orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        endOrbitDrag();
    }, { capture: true });

    // Ctrl+click is a right-click on macOS: keep its menu out of the drag.
    inputSurface.addEventListener('contextmenu', (e) => {
        if (orbitDrag) e.preventDefault();
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

// Pinch-to-zoom arrives as a wheel event with ctrlKey set (the browser's own
// convention for trackpad pinch). OrbitControls turns each such event into one
// fixed 5% step whatever its size, so zoom speed tracked the event *rate* —
// which falls with frame rate, and a heavy scene at 25 fps barely moved. Zoom
// by the pinch's actual travel instead: exp(-deltaY * k), so the same finger
// motion gives the same zoom at any frame rate.
const PINCH_ZOOM_PER_DELTA = 0.02;   // a pinch that doubles finger spread zooms ~4x
const PINCH_MAX_STEP = 1.5;          // one event, e.g. a Ctrl+wheel notch, is capped at 1.5x

function pinchZoom(deltaY: number): void {
    if (!cameraState.camera || !cameraState.controls) return;
    const raw = Math.exp(-deltaY * PINCH_ZOOM_PER_DELTA);
    const factor = Math.min(PINCH_MAX_STEP, Math.max(1 / PINCH_MAX_STEP, raw));   // >1 zooms in
    const ctrl = cameraState.controls as unknown as {
        target: Vector3; minDistance?: number; maxDistance?: number;
        minZoom?: number; maxZoom?: number; update(): void;
    };
    const cam = cameraState.camera;
    if (cam.isOrthographicCamera) {
        const zoom = Math.min(ctrl.maxZoom ?? Infinity, Math.max(ctrl.minZoom ?? 0, (cam.zoom || 1) * factor));
        cam.zoom = zoom;
        cam.updateProjectionMatrix!();
    } else {
        const offset = cam.position.clone().sub(ctrl.target);
        const dist = Math.min(ctrl.maxDistance ?? Infinity, Math.max(ctrl.minDistance ?? 0, offset.length() / factor));
        cam.position.copy(ctrl.target).add(offset.setLength(Math.max(dist, 1e-6)));
    }
    ctrl.update();
}

export function setupTrackpadPan(): void {
    const canvas = cameraState.renderer && cameraState.renderer.domElement;
    if (!canvas) return;
    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey && e.deltaMode === 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            pinchZoom(e.deltaY);
            return;
        }
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
