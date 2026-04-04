// ============================================================
// Camera system — MathBox init, arcball rotation, projection
// switching, trackpad pan, camera animation, and camera buttons.
// Also owns line/arrow sizing helpers used by object renderers.
// ============================================================

import { state } from '/state.js';
import { dataToWorld, dataCameraToWorld } from '/coords.js';
import { activateFollowCam, deactivateFollowCam, updateFollowCam, updateFollowAngleLockButtonState } from '/follow-cam.js';
import { compileExpr, evalExpr } from '/expr.js';
import { renderKaTeX, updateLabels } from '/labels.js';
// sliders.js and overlay.js are created later in the refactor;
// these imports will resolve once all modules are in place.
import { runAnimUpdaters } from '/sliders.js';
import { updateStatusBar } from '/overlay.js';

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

export const DEFAULT_VIEWS = [
    { name: 'Iso',   position: [2.5, 1.8, 2.5], target: [0, 0, 0], description: 'Isometric perspective — balanced 3D view showing all axes' },
    { name: 'Front', position: [0, 0, 4.5],      target: [0, 0, 0], description: 'Front view along Z axis — see the XY plane directly' },
    { name: 'Top',   position: [0, 4.5, 0.01],   target: [0, 0, 0], description: 'Top view along Y axis — look straight down at the XZ plane' },
    { name: 'Right', position: [4.5, 0, 0],       target: [0, 0, 0], description: 'Right view along X axis — see the YZ plane from the right' },
];

const CONTROL_CLASS = (typeof THREE !== 'undefined' && THREE.OrbitControls)
    ? THREE.OrbitControls
    : (typeof THREE !== 'undefined' ? THREE.TrackballControls : null);

// ----- Line / Arrow Sizing Helpers -----

export function worldPerPixelAt(anchorDataPos) {
    if (!state.camera || !state.renderer) return 1;
    const h = Math.max(state.renderer.domElement?.clientHeight || 1, 1);
    if (state.camera.isOrthographicCamera) {
        return Math.abs((state.camera.top - state.camera.bottom) / h);
    }
    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor));
    const dist = Math.max(state.camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((state.camera.fov || 75) * Math.PI) / 180;
    return (2 * dist * Math.tan(fov / 2)) / h;
}

export function getAbstractWidthScale(el) {
    return (el && el.abstract === true) ? ABSTRACT_LINE_THICKNESS_FACTOR : 1.0;
}

export function worldLenToPixels(worldLen, anchorDataPos) {
    if (!state.camera || !state.renderer) return worldLen;
    const h = Math.max(state.renderer.domElement?.clientHeight || 1, 1);
    if (state.camera.isOrthographicCamera) {
        const worldPerPixel = Math.abs((state.camera.top - state.camera.bottom) / h);
        return worldLen / Math.max(worldPerPixel, 1e-6);
    }
    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor));
    const dist = Math.max(state.camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((state.camera.fov || 75) * Math.PI) / 180;
    const worldPerPixel = (2 * dist * Math.tan(fov / 2)) / h;
    return worldLen / Math.max(worldPerPixel, 1e-6);
}

export function resolveLineWidth(entry) {
    const scale = state.displayParams[entry.widthParam || 'lineWidth'] ?? 1;
    return Math.max(entry.baseWidth * scale, 0.1);
}

export function applyLineWidth(entry) {
    if (!entry || !entry.node) return;
    entry.node.set('width', resolveLineWidth(entry));
}

export function resolveShaftThicknessScale(mesh) {
    const base = mesh?.userData?.baseThicknessScale ?? 1;
    const auto = mesh?.userData?.autoThicknessScale ?? 1;
    return Math.max(base * auto * (state.displayParams.vectorWidth || 1) * VECTOR_SHAFT_THICKNESS_MULTIPLIER, 0.05);
}

export function applyShaftThickness(mesh) {
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

export function isShaftEntry(entry) {
    if (!entry || !entry.mesh) return false;
    if (entry.isShaft) return true;
    return entry.mesh.geometry && entry.mesh.geometry.type === 'CylinderGeometry';
}

export function resolveArrowSizeScale(localScale) {
    return (localScale || 1) * ARROW_HEAD_SIZE_MULTIPLIER;
}

export function resolveSmallVectorAutoScale(vectorLen, coneLen) {
    if (vectorLen <= 0 || coneLen <= 0) return 1;
    const limit = SMALL_VECTOR_HEAD_RATIO_LIMIT * coneLen;
    if (vectorLen > limit) return 1;
    return Math.max(vectorLen / Math.max(limit, 1e-6), SMALL_VECTOR_AUTOSCALE_MIN);
}

// No-op stub — kept for call-site compatibility.
export function updateAdaptiveLineWidths() { return; }

// ----- Controls Helpers -----

export function updateControlsHint() {
    const hint = document.getElementById('controls-hint');
    if (hint) hint.innerHTML = 'Drag: rotate &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel: zoom &middot; &#8997;+drag: roll';
}

export function configureControlsInstance(ctrl, target) {
    if (!ctrl) return;
    if (target) ctrl.target.copy(target);
    if (ctrl instanceof THREE.TrackballControls) {
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

function screenToArcball(clientX, clientY) {
    if (!state.renderer) return new THREE.Vector3(0, 0, 1);
    const el   = state.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const nx   =  (clientX - rect.left   - rect.width  * 0.5) / (rect.width  * 0.5);
    const ny   = -(clientY - rect.top    - rect.height * 0.5) / (rect.height * 0.5);
    const r2   = nx * nx + ny * ny;
    if (r2 <= 1.0) return new THREE.Vector3(nx, ny, Math.sqrt(1.0 - r2));
    const r = Math.sqrt(r2);
    return new THREE.Vector3(nx / r, ny / r, 0);
}

function applyArcballOrbit(prevPt, currPt) {
    if (!state.camera || !state.controls) return;
    if (prevPt.distanceToSquared(currPt) < 1e-10) return;

    const q = new THREE.Quaternion().setFromUnitVectors(
        currPt.clone().normalize(),
        prevPt.clone().normalize()
    );

    const camQ   = state.camera.quaternion.clone();
    const worldQ = camQ.clone().multiply(q).multiply(camQ.clone().conjugate());

    const target = state.controls.target.clone();
    const offset = state.camera.position.clone().sub(target);
    offset.applyQuaternion(worldQ);
    state.camera.up.applyQuaternion(worldQ).normalize();
    state.camera.position.copy(target).add(offset);
    state.camera.lookAt(target);
    state.controls.update();

    state.arcballLastMoveTime = performance.now();
    state.arcballInertiaQ = state.arcballInertiaQ
        ? state.arcballInertiaQ.slerp(worldQ, 0.5)
        : worldQ.clone();
}

function startArcballInertia() {
    if (state.arcballInertiaId) {
        cancelAnimationFrame(state.arcballInertiaId);
        state.arcballInertiaId = null;
    }
    const identity = new THREE.Quaternion();
    if (!state.arcballInertiaQ || state.arcballMomentum < 0.01 ||
        performance.now() - state.arcballLastMoveTime > 80 ||
        state.arcballInertiaQ.angleTo(identity) < 0.0002) {
        state.arcballInertiaQ = null; return;
    }
    const slerpT = Math.pow(0.01, state.arcballMomentum);
    function step() {
        if (!state.arcballInertiaQ || !state.camera || !state.controls) {
            state.arcballInertiaId = null; return;
        }
        if (state.arcballInertiaQ.angleTo(identity) < 0.00005) {
            state.arcballInertiaQ = null; state.arcballInertiaId = null; return;
        }
        const tgt    = state.controls.target.clone();
        const offset = state.camera.position.clone().sub(tgt);
        offset.applyQuaternion(state.arcballInertiaQ);
        state.camera.up.applyQuaternion(state.arcballInertiaQ).normalize();
        state.camera.position.copy(tgt).add(offset);
        state.camera.lookAt(tgt);
        state.controls.update();
        state.arcballInertiaQ.slerp(identity, slerpT);
        state.arcballInertiaId = requestAnimationFrame(step);
    }
    state.arcballInertiaId = requestAnimationFrame(step);
}

function applyCameraRoll(deltaAngle) {
    if (!state.camera || !state.controls) return;
    const viewDir = new THREE.Vector3().subVectors(state.controls.target, state.camera.position);
    if (viewDir.lengthSq() < 1e-12) return;
    viewDir.normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(viewDir, deltaAngle);
    state.camera.up.applyQuaternion(q).normalize();
    state.camera.lookAt(state.controls.target);
    state.controls.update();
}

export function setupRollDrag(container) {
    if (!container) return;
    const inputSurface = container;
    let orbitDrag = null;

    inputSurface.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        if (e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            state.rollDrag = { x: e.clientX, awaitingMouseUp: false };
            document.body.classList.add('rotating');
            if (state.controls) state.controls.enabled = false;
            return;
        }

        if (e.shiftKey) return;
        if (e.ctrlKey || e.metaKey) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        if (state.arcballInertiaId) {
            cancelAnimationFrame(state.arcballInertiaId);
            state.arcballInertiaId = null;
        }
        state.arcballInertiaQ = null;
        orbitDrag = { pt: screenToArcball(e.clientX, e.clientY) };
        document.body.classList.add('rotating');
        if (state.controls) state.controls.enabled = false;
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

        if (!state.rollDrag) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.altKey) {
            state.rollDrag.awaitingMouseUp = true;
            return;
        }
        if ((e.buttons & 1) === 0) return endRollDrag();
        if (state.rollDrag.awaitingMouseUp) return;
        const dx = e.clientX - state.rollDrag.x;
        state.rollDrag.x = e.clientX;
        applyCameraRoll(-dx * 0.0045);
    });

    function endOrbitDrag() {
        if (!orbitDrag) return;
        orbitDrag = null;
        document.body.classList.remove('rotating');
        if (state.controls) {
            state.controls.enabled = true;
            state.controls.update();
        }
        startArcballInertia();
    }

    function endRollDrag() {
        document.body.classList.remove('rotating');
        if (state.controls) {
            state.controls.enabled = true;
            state.controls.update();
        }
        if (!state.rollDrag) return;
        state.rollDrag = null;
    }

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt' && state.rollDrag) {
            state.rollDrag.awaitingMouseUp = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (state.rollDrag || orbitDrag) {
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
        if (!state.rollDrag && !orbitDrag && state.controls && !state.controls.enabled) {
            state.controls.enabled = true;
        }
    }, { capture: true });
}

function activateExprCamera(viewSpec, key) {
    const posExpr = Array.isArray(viewSpec.positionExpr) && viewSpec.positionExpr.length === 3 ? viewSpec.positionExpr : null;
    const tgtExpr = Array.isArray(viewSpec.targetExpr) && viewSpec.targetExpr.length === 3 ? viewSpec.targetExpr : null;
    if (!posExpr || !tgtExpr || !state.camera || !state.controls) return;
    let posFns, tgtFns;
    try {
        posFns = posExpr.map(e => compileExpr(typeof e === 'number' ? String(e) : e));
        tgtFns = tgtExpr.map(e => compileExpr(typeof e === 'number' ? String(e) : e));
    } catch (err) {
        console.warn('expr-camera compile error:', err);
        return;
    }
    state.cameraExprState = {
        posFns,
        tgtFns,
        up: Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : state.sceneUp.slice(0, 3),
        viewKey: key || null,
    };
    state.cameraExprStartTime = performance.now();
    updateExprCamera();
}

function deactivateExprCamera() {
    state.cameraExprState = null;
}

function updateExprCamera() {
    if (!state.cameraExprState || !state.camera || !state.controls) return;
    const tSec = (performance.now() - state.cameraExprStartTime) / 1000;
    let posData, tgtData;
    try {
        posData = state.cameraExprState.posFns.map(fn => evalExpr(fn, tSec));
        tgtData = state.cameraExprState.tgtFns.map(fn => evalExpr(fn, tSec));
    } catch (err) {
        return;
    }
    const posWorld = dataCameraToWorld(posData);
    const tgtWorld = dataCameraToWorld(tgtData);
    state.camera.position.set(posWorld[0], posWorld[1], posWorld[2]);
    state.controls.target.set(tgtWorld[0], tgtWorld[1], tgtWorld[2]);
    state.camera.up.copy(normalizeUpVector(state.cameraExprState.up));
    state.camera.lookAt(state.controls.target);
}

// ----- MathBox Initialization -----

export function initMathBox() {
    const container = document.getElementById('mathbox-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    state.mathbox = MathBox.mathBox({
        element: container,
        plugins: ['core', 'controls', 'cursor'],
        controls: { klass: CONTROL_CLASS },
        camera: { fov: 75 },
        renderer: { antialias: true },
    });

    state.three    = state.mathbox.three;
    state.camera   = state.three.camera;
    state.perspCamera = state.camera;
    state.renderer = state.three.renderer;
    state.controls = state.three.controls;

    state.renderer.setClearColor(new THREE.Color(0x0a0a0f), 1);
    state.renderer.setPixelRatio(window.devicePixelRatio);
    state.renderer.setSize(w, h);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    state.three.scene.add(ambientLight);
    state.mainDirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    state.mainDirLight.position.set(5, 10, 7);
    state.three.scene.add(state.mainDirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-3, -5, -4);
    state.three.scene.add(dirLight2);

    const initPos = dataToWorld(DEFAULT_CAMERA.position);
    const initTgt = dataToWorld(DEFAULT_CAMERA.target);
    state.camera.position.set(initPos[0], initPos[1], initPos[2]);
    state.camera.lookAt(initTgt[0], initTgt[1], initTgt[2]);
    if (state.controls) {
        const target = new THREE.Vector3(initTgt[0], initTgt[1], initTgt[2]);
        configureControlsInstance(state.controls, target);
    }
    updateControlsHint();

    window.addEventListener('resize', () => {
        const w2 = container.clientWidth;
        const h2 = container.clientHeight;
        state.renderer.setSize(w2, h2);
        if (state.camera.isOrthographicCamera) {
            const aspect2 = w2 / h2;
            const halfH = (state.camera.top - state.camera.bottom) / 2;
            state.camera.left  = -halfH * aspect2;
            state.camera.right =  halfH * aspect2;
        } else {
            state.camera.aspect = w2 / h2;
        }
        state.camera.updateProjectionMatrix();
    });

    let _statusFrameTick = 0;
    function updateLoop() {
        state.animationFrameId = requestAnimationFrame(updateLoop);
        const nowMs = performance.now();
        runAnimUpdaters(nowMs);
        if (state.cameraExprState) {
            updateExprCamera();
        } else if (state.followCamState) {
            updateFollowCam();
        } else if (state.controls && typeof state.controls.update === 'function') {
            state.controls.update();
        }
        updateAdaptiveLineWidths();
        updateLabels();
        if (++_statusFrameTick % 6 === 0) updateStatusBar();
    }
    updateLoop();
}

// ----- Projection Switching -----

export function switchProjection(mode) {
    if (mode === state.currentProjection) return;
    state.currentProjection = mode;

    const container = document.getElementById('mathbox-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;

    const pos    = state.camera.position.clone();
    const target = state.controls ? state.controls.target.clone() : new THREE.Vector3();

    let newCamera;
    if (mode === 'orthographic') {
        const dist = Math.max(pos.distanceTo(target), 0.001);
        const frustumHeight = dist * Math.tan((state.perspCamera.fov / 2) * Math.PI / 180) * 2;
        const frustumWidth  = frustumHeight * aspect;
        newCamera = new THREE.OrthographicCamera(
            -frustumWidth / 2, frustumWidth / 2,
            frustumHeight / 2, -frustumHeight / 2,
            -1000, 1000
        );
        newCamera.updateProjectionMatrix();
    } else {
        newCamera = state.perspCamera;
    }

    newCamera.up.copy(state.camera.up);
    newCamera.position.copy(pos);
    newCamera.lookAt(target);

    state.three.camera = newCamera;
    state.camera = newCamera;

    if (!state.renderer._origRender) {
        state.renderer._origRender = state.renderer.render.bind(state.renderer);
    }
    state.renderer.render = function(scene, cam) {
        state.renderer._origRender(scene, state.camera);
    };

    if (state.controls) state.controls.dispose();
    state.controls = new CONTROL_CLASS(state.camera, state.renderer.domElement);
    configureControlsInstance(state.controls, target);
    state.three.controls = state.controls;

    document.querySelectorAll('.proj-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.proj === mode);
    });
}

export function setupProjectionToggle() {
    document.querySelectorAll('.proj-btn').forEach(btn => {
        btn.addEventListener('click', () => switchProjection(btn.dataset.proj));
    });
}

// ----- Trackpad Two-Finger Pan -----

export function setupTrackpadPan() {
    const canvas = state.renderer && state.renderer.domElement;
    if (!canvas) return;
    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.deltaMode !== 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!state.camera || !state.controls) return;

        const distance  = state.camera.position.distanceTo(state.controls.target);
        const panFactor = distance / canvas.clientHeight * 0.8;

        const right = new THREE.Vector3().setFromMatrixColumn(state.camera.matrix, 0);
        const up    = new THREE.Vector3().setFromMatrixColumn(state.camera.matrix, 1);
        const panOffset = new THREE.Vector3()
            .addScaledVector(right,  e.deltaX * panFactor)
            .addScaledVector(up,    -e.deltaY * panFactor);

        state.camera.position.add(panOffset);
        state.controls.target.add(panOffset);
        state.controls.update();
    }, { capture: true, passive: false });
}

// Legacy custom gesture layer disabled in favor of native control behavior.
export function setupTouchGestures(container) { void container; }

// ----- Camera Animation -----

export function normalizeUpVector(up) {
    const raw = Array.isArray(up) && up.length === 3 ? up : [0, 1, 0];
    const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
    if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
}

export function resolveEffectiveStepCamera(scene, stepIdx) {
    if (!scene) return null;

    const baseUp = (scene.camera && Array.isArray(scene.camera.up) && scene.camera.up.length === 3)
        ? scene.camera.up.slice(0, 3)
        : (Array.isArray(scene.cameraUp) && scene.cameraUp.length === 3)
            ? scene.cameraUp.slice(0, 3)
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

export function animateCamera(view, duration) {
    duration = (duration == null) ? 800 : duration;
    deactivateFollowCam();
    deactivateExprCamera();
    const targetView = state.CAMERA_VIEWS[view];
    if (!targetView || !state.camera || !state.controls) return;

    const startPos    = state.camera.position.clone();
    const endPos      = new THREE.Vector3(...targetView.position);
    const startTarget = state.controls.target.clone();
    const endTarget   = new THREE.Vector3(...targetView.target);
    const startUp     = state.camera.up.clone();
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

    document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.cam-btn[data-view="${view}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    state.cameraAnimating = true;

    if (duration === 0) {
        state.camera.position.copy(endPos);
        state.controls.target.copy(endTarget);
        state.camera.up.copy(endUp);
        state.camera.lookAt(state.controls.target);
        state.cameraAnimating = false;
        return;
    }

    function step(now) {
        const elapsed = now - startTime;
        let t = Math.min(elapsed / duration, 1);
        t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

        state.camera.position.lerpVectors(startPos, endPos, t);
        state.controls.target.lerpVectors(startTarget, endTarget, t);
        state.camera.up.lerpVectors(startUp, endUp, t).normalize();
        state.camera.lookAt(state.controls.target);
        state.controls.update();

        if (t < 1) requestAnimationFrame(step);
        else state.cameraAnimating = false;
    }
    requestAnimationFrame(step);
}

// ----- Camera Buttons -----

export function buildCameraButtons(spec) {
    const container = document.getElementById('camera-buttons');
    container.innerHTML = '';
    state.CAMERA_VIEWS = {};
    state.sceneUp = (spec && spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3)
        ? spec.camera.up.slice(0, 3)
        : (spec && Array.isArray(spec.cameraUp) && spec.cameraUp.length === 3)
            ? spec.cameraUp.slice(0, 3)
            : [0, 1, 0];

    const views = (spec && spec.views) ? spec.views : DEFAULT_VIEWS;

    views.forEach(v => {
        const key = v.name.toLowerCase().replace(/\s+/g, '-');
        const btn = document.createElement('button');
        btn.className = 'cam-btn';
        btn.dataset.view = key;
        btn.title = v.description || v.name;
        btn.innerHTML = renderKaTeX(v.name, false);

        if (v.follow) {
            btn.classList.add('cam-btn-follow');
            btn.addEventListener('click', () => {
                deactivateExprCamera();
                if (state.followCamState && state.followCamState.viewKey === key) {
                    deactivateFollowCam();
                    document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                    return;
                }
                document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activateFollowCam({ ...v, _viewKey: key });
            });
        } else if (Array.isArray(v.positionExpr) && Array.isArray(v.targetExpr)) {
            btn.classList.add('cam-btn-follow');
            btn.addEventListener('click', () => {
                deactivateFollowCam();
                if (state.cameraExprState && state.cameraExprState.viewKey === key) {
                    deactivateExprCamera();
                    document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                    return;
                }
                document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activateExprCamera(v, key);
            });
        } else {
            state.CAMERA_VIEWS[key] = {
                position: dataCameraToWorld(v.position),
                target:   dataCameraToWorld(v.target || [0, 0, 0]),
                up:       Array.isArray(v.up) ? v.up.slice(0, 3) : state.sceneUp.slice(0, 3),
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
        const activeScene = (state.lessonSpec && state.currentSceneIndex >= 0 && state.lessonSpec.scenes)
            ? state.lessonSpec.scenes[state.currentSceneIndex]
            : state.currentSpec;
        const camSpec = resolveEffectiveStepCamera(activeScene, state.currentStepIndex)
            || (state.currentSpec && state.currentSpec.camera)
            || null;
        const pos = dataCameraToWorld((camSpec && camSpec.position) || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld((camSpec && camSpec.target)   || DEFAULT_CAMERA.target);
        state.CAMERA_VIEWS.reset = {
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
