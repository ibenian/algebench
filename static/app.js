// ============================================================
// AlgeBench Client Application
// ============================================================

// ----- State -----
let mathbox = null;
let three = null;
let camera = null;
let controls = null;
let renderer = null;
let currentSpec = null;
let labels = [];
let animationFrameId = null;
let cameraAnimating = false;
let currentProjection = 'perspective';
let perspCamera = null;  // store the original perspective camera
let arrowMeshes = [];
let axisLineNodes = [];   // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
let vectorLineNodes = []; // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
let lineNodes = [];       // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
let planeMeshes = [];     // Three.js meshes for planes/polygons
let pointNodes = [];      // { node } for MathBox point elements
let worldStarfield = null; // Three.js Points object used as inertial background reference
let worldSkybox = null;    // { texture } for scene.background skybox
let _planeMeshSerial = 0; // monotonically increasing counter for stable depth ordering

// Lesson navigation state
let lessonSpec = null;
let currentSceneIndex = -1;
let currentStepIndex = -1;      // -1 = base elements only
let autoPlayTimer = null;
const AUTO_PLAY_DEFAULT_DURATION = 3000; // default step duration in ms when playing
let visitedSteps = new Set();   // track visited steps as "sceneIdx:stepIdx"
let sceneView = null;           // MathBox cartesian view for current scene
let mainDirLight = null;        // main directional light, controlled via settings panel
let stepTrackers = [];          // per-step tracking for incremental add/remove
let elementRegistry = {};       // id -> { tracker, hidden } for named elements
let sceneSliders = {};          // { id: { value, min, max, step, label, default } }
let followCamState = null;      // non-null when a follow-cam view is active
let followCamStartTime = 0;     // performance.now() when follow-cam was activated
let followCamAngleLock = false; // when true, follow-cam rotates with target's angular motion
let followCamSavedControls = null; // stores control damping flags while follow-cam is active
const animatedElementPos = {};  // id -> [x,y,z] in data space — updated each animation frame
// Shared animation scheduler.
// Each animated object registers { animState, updateFrame(nowMs) } and is ticked in updateLoop.
// This keeps all animated transforms and follow-cam sampling on the same frame clock.
let activeAnimUpdaters = [];
let sceneStartTime = 0;  // shared time origin for all animated elements in a scene
const _sliderDrag = { active: false, startX: 0, startY: 0, startLeft: 0, startBottom: 0 };
let videoRecorder = null;
let videoRecordedChunks = [];
let videoRecordingStream = null;
let videoRecordingExt = 'webm';
let videoRecordingMime = 'video/webm';
let videoExportFormatPreference = 'auto';
let activeVirtualTimeExpr = null;
let activeVirtualTimeCompiled = null;
let activeSceneExprFunctions = {}; // scene-level expression helpers defined in scene.functions
let activeSceneFunctionDefs = [];  // compiled descriptors for scene-level functions
let _activeDomainFunctions = {};   // functions imported from domain libraries for this lesson

// Domain library registry — domain scripts self-register here.
// Populated by files under static/domains/<name>/index.js.
window.AlgeBenchDomains = {
    _registry: {},
    register(name, functions) {
        this._registry[name] = functions;
        console.log(`[domains] registered: ${name} (${Object.keys(functions).join(', ')})`);
    },
};
let _activeExprEvalFrame = null;   // tracks current eval scope for nested scene-function calls

// ----- Expression Sandbox -----
// Sandboxed math.js instance — no browser API access from expressions
const _mathjs = math.create(math.all);
// ── Math.js extensions ────────────────────────────────────────────────────────
// Add custom helper functions HERE ONLY. They are automatically imported into
// both the math.js evaluator (_mathjs.import) and the JS fallback scope
// (_EXPR_HELPERS), so both evaluators always stay consistent.
// Do NOT add helpers directly to _mathjs.import or _EXPR_HELPERS.
const _MATHJS_EXTENSIONS = {
    toFixed: (val, decimals) => Number(val).toFixed(Number(decimals)),
};

_mathjs.import({
    ..._MATHJS_EXTENSIONS,
    // Disable escape hatches — must come after custom functions
    import:     function() { throw new Error('import disabled'); },
    createUnit: function() { throw new Error('createUnit disabled'); },
}, { override: true });
// Note: parse/evaluate/simplify/derivative are kept — math.js uses parse internally
// during compile(). Security comes from the scope object, not from disabling these.

// Detects expressions that require native JS (loops, IIFE, closures, etc.)
// Detects expressions that require native JS execution.
// \.[a-zA-Z_]\w*\s*\( catches method calls like .toFixed( .constructor( — prevents
// prototype-chain escapes (e.g. (0).constructor.constructor('return fetch(...)')()).
// Decimal numbers (3.14) are safe because digits follow the dot, not letters.
const _JS_ONLY_RE = /\blet\b|\bconst\b|\bvar\b|\breturn\b|\bfor\s*\(|\bwhile\s*\(|=>|\bfunction\b|\bMath\.|\.([a-zA-Z_]\w*)\s*\(/;

// Trust state for the currently loaded scene
// null = clean (math.js only, no dialog shown)
// 'trusted' = user approved JS execution
// 'untrusted' = user denied JS execution (JS exprs become no-ops)
let _sceneJsTrustState = null;
// Issues collected by _scanSpecForUnsafeJs; reset on each scene load.
// Each entry: { path, expr, type }  where type is 'expr' or 'template'.
let _sceneJsIssues = [];
// True when the scene has "unsafe":true — entire scene opted in to native JS.
let _sceneIsUnsafe = false;
// Author-provided explanation shown in the trust dialog (unsafe_explanation field).
let _sceneUnsafeExplanation = '';
// Prefer OrbitControls so modifier-based pan behavior is consistent.
const CONTROL_CLASS = (typeof THREE !== 'undefined' && THREE.OrbitControls) ? THREE.OrbitControls : THREE.TrackballControls;
let sceneUp = [0, 1, 0];           // scene's up vector (set per-scene in buildCameraButtons)
const VIEW_EPSILON = 0.05;         // world-space nudge to keep top-down views off the pole
let rollDrag = null;
let arcballMomentum    = 0.5;   // 0 = no inertia, 1 = maximum inertia
let arcballInertiaId   = null;  // rAF handle for the deceleration loop
let arcballInertiaQ    = null;  // EMA of world-space rotation delta (velocity estimate)
let arcballLastMoveTime = 0;    // performance.now() of last mousemove during drag
let currentSceneSourceLabel = '';
let currentSceneSourcePath = '';
let camPopupPinned = false;

// Shared SVG icons
const AI_SPARKLE_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 1c0 4-3 6.5-7 7 4 .5 7 3 7 7 0-4 3-6.5 7-7-4-.5-7-3-7-7z"/></svg>';

// Display scale multipliers (adjusted via settings panel)
const displayParams = {
    labelScale: 1.0, arrowScale: 1.0, axisWidth: 1.0, vectorWidth: 1.0,
    labelOpacity: 1.0, arrowOpacity: 1.0, axisOpacity: 1.0, vectorOpacity: 1.0, lineWidth: 1.0, lineOpacity: 1.0, planeScale: 1.0, planeOpacity: 0.2,
    captionScale: 1.0, overlayOpacity: 0.7,
};
const ABSTRACT_LINE_THICKNESS_FACTOR = 1 / 20;
const VECTOR_SHAFT_THICKNESS_MULTIPLIER = 1;
const ARROW_HEAD_SIZE_MULTIPLIER = 2;
const ARROW_HEAD_MIN_FACTOR = 0.004;
const ARROW_HEAD_MAX_FACTOR = 0.012;
const ARROW_HEAD_RADIUS_RATIO = 0.35;
const SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO = 0.35;
const SHAFT_CONE_OVERLAP_HEAD_RATIO = 0.0;
const SMALL_VECTOR_HEAD_RATIO_LIMIT = 3;   // apply auto-shrink when vectorLen <= 3 * coneHeight
const SMALL_VECTOR_AUTOSCALE_MIN = 0.05;   // keep tiny vectors visible

// Current scene coordinate mapping (set per scene load)
let currentRange = [[-5, 5], [-5, 5], [-5, 5]];
let currentScale = [1, 1, 1];

// Default camera position
const DEFAULT_CAMERA = { position: [2.5, 1.8, 2.5], target: [0, 0, 0] };

// ----- Coordinate Conversion -----
// MathBox cartesian maps data range to [-scale, +scale] in world space
function dataToWorld(pos) {
    if (!currentRange || !currentRange[0] || !currentRange[1] || !currentRange[2]) {
        return [0, 0, 0];  // Fallback when range not yet initialized
    }
    return [
        ((pos[0] - currentRange[0][0]) / (currentRange[0][1] - currentRange[0][0]) * 2 - 1) * currentScale[0],
        ((pos[1] - currentRange[1][0]) / (currentRange[1][1] - currentRange[1][0]) * 2 - 1) * currentScale[1],
        ((pos[2] - currentRange[2][0]) / (currentRange[2][1] - currentRange[2][0]) * 2 - 1) * currentScale[2],
    ];
}

// Convert a camera position/target from data-space to world-space using uniform normalization.
// Unlike dataToWorld (which normalizes per-axis), this uses the largest half-span so that
// 2D scenes with a tiny z-range don't blow up the camera distance.
function dataCameraToWorld(pos) {
    if (!currentRange || !currentRange[0] || !currentRange[1] || !currentRange[2]) {
        return [0, 0, 0];
    }
    const hx = (currentRange[0][1] - currentRange[0][0]) / 2;
    const hy = (currentRange[1][1] - currentRange[1][0]) / 2;
    const hz = (currentRange[2][1] - currentRange[2][0]) / 2;
    const maxH = Math.max(hx, hy, hz, 0.001);
    const cx = (currentRange[0][0] + currentRange[0][1]) / 2;
    const cy = (currentRange[1][0] + currentRange[1][1]) / 2;
    const cz = (currentRange[2][0] + currentRange[2][1]) / 2;
    return [
        (pos[0] - cx) / maxH * currentScale[0],
        (pos[1] - cy) / maxH * currentScale[1],
        (pos[2] - cz) / maxH * currentScale[2],
    ];
}

// Convert a data-space length to world-space length (average across axes)
function dataLenToWorld(len) {
    const sx = 2 * currentScale[0] / (currentRange[0][1] - currentRange[0][0]);
    const sy = 2 * currentScale[1] / (currentRange[1][1] - currentRange[1][0]);
    const sz = 2 * currentScale[2] / (currentRange[2][1] - currentRange[2][0]);
    return len * (sx + sy + sz) / 3;
}

function clearWorldStarfield() {
    if (!worldStarfield || !three || !three.scene) return;
    three.scene.remove(worldStarfield);
    if (worldStarfield.geometry) worldStarfield.geometry.dispose();
    if (worldStarfield.material) worldStarfield.material.dispose();
    worldStarfield = null;
}

function clearWorldSkybox() {
    if (!three || !three.scene) return;
    if (worldSkybox && worldSkybox.texture && typeof worldSkybox.texture.dispose === 'function') {
        worldSkybox.texture.dispose();
    }
    worldSkybox = null;
    three.scene.background = null;
}

function _makeGradientSkyboxTexture(topHex, bottomHex, starCount = 0, starColor = '#e6efff', starMin = 0.5, starMax = 2.0) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, topHex || '#070b18');
    grad.addColorStop(1, bottomHex || '#010205');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const n = Math.max(0, Math.floor(starCount || 0));
    if (n > 0) {
        ctx.fillStyle = starColor || '#e6efff';
        for (let i = 0; i < n; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const r = (starMin || 0.5) + Math.random() * Math.max(0.05, (starMax || 2.0) - (starMin || 0.5));
            const a = 0.35 + Math.random() * 0.65;
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function renderSkybox(el) {
    if (!three || !three.scene) return null;
    clearWorldSkybox();

    const style = (el.style || el.mode || 'solid').toLowerCase();
    if (style === 'none' || style === 'off') {
        return { type: 'skybox', style };
    }

    if (style === 'solid' || style === 'color') {
        three.scene.background = new THREE.Color(el.color || '#02040b');
        return { type: 'skybox', style };
    }

    if (style === 'gradient') {
        const tex = _makeGradientSkyboxTexture(
            el.topColor || el.top,
            el.bottomColor || el.bottom,
            el.starCount || 0,
            el.starColor || '#e6efff',
            el.starMinSize || 0.5,
            el.starMaxSize || 2.0
        );
        three.scene.background = tex;
        worldSkybox = { texture: tex };
        return { type: 'skybox', style };
    }

    if (style === 'cubemap' && Array.isArray(el.urls) && el.urls.length === 6) {
        try {
            const loader = new THREE.CubeTextureLoader();
            const tex = loader.load(el.urls);
            tex.colorSpace = THREE.SRGBColorSpace;
            three.scene.background = tex;
            worldSkybox = { texture: tex };
            return { type: 'skybox', style };
        } catch (err) {
            console.warn('skybox cubemap load failed:', err);
            three.scene.background = new THREE.Color('#02040b');
            return { type: 'skybox', style: 'fallback-solid' };
        }
    }

    console.warn('Unknown skybox style:', style);
    three.scene.background = new THREE.Color(el.color || '#02040b');
    return { type: 'skybox', style: 'fallback-solid' };
}

function configureWorldStarfield(spec) {
    clearWorldStarfield();
    const cfg = spec && spec.starfield;
    if (!cfg || cfg.enabled === false) return;

    const spanX = Math.abs(currentRange[0][1] - currentRange[0][0]);
    const spanY = Math.abs(currentRange[1][1] - currentRange[1][0]);
    const spanZ = Math.abs(currentRange[2][1] - currentRange[2][0]);
    const halfMaxSpan = Math.max(spanX, spanY, spanZ, 1) / 2;

    const count = Math.max(50, Math.floor(cfg.count || 900));
    const radiusMin = Number.isFinite(cfg.radiusMin) ? cfg.radiusMin : halfMaxSpan * 3;
    const radiusMax = Number.isFinite(cfg.radiusMax) ? cfg.radiusMax : halfMaxSpan * 7;
    const size = Number.isFinite(cfg.size) ? cfg.size : 2.1;
    const opacity = Number.isFinite(cfg.opacity) ? cfg.opacity : 0.9;
    const twinkle = Number.isFinite(cfg.twinkle) ? Math.max(0, Math.min(1, cfg.twinkle)) : 0.25;
    const baseColor = new THREE.Color(cfg.color || '#d9e6ff');

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // Uniform random direction on the sphere
        const z = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const rXY = Math.sqrt(Math.max(0, 1 - z * z));
        const dirX = rXY * Math.cos(theta);
        const dirY = rXY * Math.sin(theta);
        const dirZ = z;

        // Sample radius in [radiusMin, radiusMax], biased for a deep shell feel
        const u = Math.random();
        const radius = radiusMin + (radiusMax - radiusMin) * Math.pow(u, 0.6);
        const dataPos = [dirX * radius, dirY * radius, dirZ * radius];
        const w = dataToWorld(dataPos);

        const pi = i * 3;
        positions[pi] = w[0];
        positions[pi + 1] = w[1];
        positions[pi + 2] = w[2];

        const f = 1 - twinkle * Math.random();
        colors[pi] = baseColor.r * f;
        colors[pi + 1] = baseColor.g * f;
        colors[pi + 2] = baseColor.b * f;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
        size: size,
        transparent: true,
        opacity: opacity,
        sizeAttenuation: true,
        vertexColors: true,
        depthWrite: false,
    });

    worldStarfield = new THREE.Points(geom, mat);
    worldStarfield.renderOrder = -1000;
    worldStarfield.frustumCulled = false;
    three.scene.add(worldStarfield);
}

function worldPerPixelAt(anchorDataPos) {
    if (!camera || !renderer) return 1;
    const h = Math.max(renderer.domElement?.clientHeight || 1, 1);
    if (camera.isOrthographicCamera) {
        return Math.abs((camera.top - camera.bottom) / h);
    }
    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor));
    const dist = Math.max(camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((camera.fov || 75) * Math.PI) / 180;
    return (2 * dist * Math.tan(fov / 2)) / h;
}

function getAbstractWidthScale(el) {
    return (el && el.abstract === true) ? ABSTRACT_LINE_THICKNESS_FACTOR : 1.0;
}

function worldLenToPixels(worldLen, anchorDataPos) {
    if (!camera || !renderer) return worldLen;
    const h = Math.max(renderer.domElement?.clientHeight || 1, 1);

    if (camera.isOrthographicCamera) {
        const worldPerPixel = Math.abs((camera.top - camera.bottom) / h);
        return worldLen / Math.max(worldPerPixel, 1e-6);
    }

    const anchor = anchorDataPos || [0, 0, 0];
    const anchorWorld = new THREE.Vector3(...dataToWorld(anchor));
    const dist = Math.max(camera.position.distanceTo(anchorWorld), 0.001);
    const fov = ((camera.fov || 75) * Math.PI) / 180;
    const worldPerPixel = (2 * dist * Math.tan(fov / 2)) / h;
    return worldLen / Math.max(worldPerPixel, 1e-6);
}

function resolveLineWidth(entry) {
    const scale = displayParams[entry.widthParam || 'lineWidth'] ?? 1;
    return Math.max(entry.baseWidth * scale, 0.1);
}

function applyLineWidth(entry) {
    if (!entry || !entry.node) return;
    entry.node.set('width', resolveLineWidth(entry));
}

function resolveShaftThicknessScale(mesh) {
    const base = mesh && mesh.userData && typeof mesh.userData.baseThicknessScale === 'number'
        ? mesh.userData.baseThicknessScale
        : 1;
    const auto = mesh && mesh.userData && typeof mesh.userData.autoThicknessScale === 'number'
        ? mesh.userData.autoThicknessScale
        : 1;
    return Math.max(base * auto * (displayParams.vectorWidth || 1) * VECTOR_SHAFT_THICKNESS_MULTIPLIER, 0.05);
}

function applyShaftThickness(mesh) {
    if (!mesh) return;
    const thickness = resolveShaftThicknessScale(mesh);
    const baseShaftRadius = mesh.userData && typeof mesh.userData.baseShaftRadius === 'number'
        ? Math.max(mesh.userData.baseShaftRadius, 1e-6)
        : 1;
    const maxRadiusFromHead = mesh.userData && typeof mesh.userData.maxRadiusFromHead === 'number'
        ? mesh.userData.maxRadiusFromHead
        : Infinity;
    // `thickness` is a scale multiplier. Convert radius cap to a scale cap.
    const maxThicknessScale = Number.isFinite(maxRadiusFromHead)
        ? (maxRadiusFromHead / baseShaftRadius)
        : Infinity;
    const cappedThickness = Math.min(thickness, maxThicknessScale);
    const lengthScale = mesh.userData && typeof mesh.userData.lengthScale === 'number'
        ? mesh.userData.lengthScale
        : 1;
    mesh.scale.set(cappedThickness, lengthScale, cappedThickness);
}

function isShaftEntry(entry) {
    if (!entry || !entry.mesh) return false;
    if (entry.isShaft) return true;
    return entry.mesh.geometry && entry.mesh.geometry.type === 'CylinderGeometry';
}

function resolveArrowSizeScale(localScale) {
    return (localScale || 1) * ARROW_HEAD_SIZE_MULTIPLIER;
}

function resolveSmallVectorAutoScale(vectorLen, coneLen) {
    if (vectorLen <= 0 || coneLen <= 0) return 1;
    const limit = SMALL_VECTOR_HEAD_RATIO_LIMIT * coneLen;
    if (vectorLen > limit) return 1;
    return Math.max(vectorLen / Math.max(limit, 1e-6), SMALL_VECTOR_AUTOSCALE_MIN);
}

function updateAdaptiveLineWidths() { return; }

function updateControlsHint() {
    const hint = document.getElementById('controls-hint');
    if (hint) hint.innerHTML = 'Drag: rotate &middot; Shift+drag or 2-finger scroll: pan &middot; Pinch/wheel: zoom &middot; &#8997;+drag: roll';
}

function configureControlsInstance(ctrl, target) {
    if (!ctrl) return;
    if (target) ctrl.target.copy(target);
    if (ctrl instanceof THREE.TrackballControls) {
        ctrl.rotateSpeed = 3.5;
        ctrl.zoomSpeed = 1.2;
        ctrl.panSpeed = 0.9;
        ctrl.staticMoving = false;
        ctrl.dynamicDampingFactor = 0.1;
        ctrl.noRotate = true;  // Arcball handler owns rotation.
        ctrl.noZoom = false;
        ctrl.noPan = false;
    } else if (THREE.MOUSE && THREE.TOUCH) {
        ctrl.enableDamping = true;
        ctrl.dampingFactor = 0.06;
        ctrl.enableZoom = true;
        ctrl.screenSpacePanning = true;
        // Arcball handler owns left-drag rotate; controls handles pan/zoom.
        ctrl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        ctrl.touches  = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    ctrl.update();
}

// ----- Arcball Rotation -----
// Projects a screen-space mouse position onto a virtual unit sphere centred on
// the canvas.  Points inside the circle land on the sphere; points outside are
// projected onto the edge of the sphere (giving a smooth "hyperbolic" region).
function screenToArcball(clientX, clientY) {
    if (!renderer) return new THREE.Vector3(0, 0, 1);
    const el   = renderer.domElement;
    const rect = el.getBoundingClientRect();
    const nx   =  (clientX - rect.left   - rect.width  * 0.5) / (rect.width  * 0.5);
    const ny   = -(clientY - rect.top    - rect.height * 0.5) / (rect.height * 0.5);
    const r2   = nx * nx + ny * ny;
    if (r2 <= 1.0) return new THREE.Vector3(nx, ny, Math.sqrt(1.0 - r2));
    const r = Math.sqrt(r2);
    return new THREE.Vector3(nx / r, ny / r, 0);
}

// Rotates the camera around controls.target so that the arcball point
// prevPt moves to currPt.  Feels like rolling a physical sphere.
function applyArcballOrbit(prevPt, currPt) {
    if (!camera || !controls) return;
    if (prevPt.distanceToSquared(currPt) < 1e-10) return;

    // Quaternion representing the rotation in view/camera space.
    // Swap order so the scene follows the drag (camera moves opposite to finger).
    const q = new THREE.Quaternion().setFromUnitVectors(
        currPt.clone().normalize(),
        prevPt.clone().normalize()
    );

    // Convert from camera space to world space: worldQ = C · q · C⁻¹
    const camQ   = camera.quaternion.clone();
    const worldQ = camQ.clone().multiply(q).multiply(camQ.clone().conjugate());

    // Rotate the offset vector (camera → target) and the camera's up direction.
    const target = controls.target.clone();
    const offset = camera.position.clone().sub(target);
    offset.applyQuaternion(worldQ);
    camera.up.applyQuaternion(worldQ).normalize();
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    controls.update();
    // EMA toward current per-frame delta so velocity tracks actual drag speed.
    // If the user slows down before releasing, the estimate decays toward zero.
    arcballLastMoveTime = performance.now();
    arcballInertiaQ = arcballInertiaQ
        ? arcballInertiaQ.slerp(worldQ, 0.5)
        : worldQ.clone();
}

// Decelerates the scene after the user releases the mouse.
// slerpT controls per-frame decay: pow(0.01, momentum) gives a nice exponential
// curve (momentum=0.5 → ~1s coast, momentum=1 → ~5s+ coast).
function startArcballInertia() {
    if (arcballInertiaId) { cancelAnimationFrame(arcballInertiaId); arcballInertiaId = null; }
    const identity = new THREE.Quaternion();
    // Skip inertia if: no momentum set, mouse was stationary before release
    // (> 80ms since last move), or velocity has already decayed to negligible.
    if (!arcballInertiaQ || arcballMomentum < 0.01 ||
        performance.now() - arcballLastMoveTime > 80 ||
        arcballInertiaQ.angleTo(identity) < 0.0002) {
        arcballInertiaQ = null; return;
    }
    const slerpT   = Math.pow(0.01, arcballMomentum); // high momentum → small t → slow decay
    function step() {
        if (!arcballInertiaQ || !camera || !controls) { arcballInertiaId = null; return; }
        if (arcballInertiaQ.angleTo(identity) < 0.00005) {
            arcballInertiaQ = null; arcballInertiaId = null; return;
        }
        const tgt    = controls.target.clone();
        const offset = camera.position.clone().sub(tgt);
        offset.applyQuaternion(arcballInertiaQ);
        camera.up.applyQuaternion(arcballInertiaQ).normalize();
        camera.position.copy(tgt).add(offset);
        camera.lookAt(tgt);
        controls.update();
        arcballInertiaQ.slerp(identity, slerpT);   // decay velocity toward zero
        arcballInertiaId = requestAnimationFrame(step);
    }
    arcballInertiaId = requestAnimationFrame(step);
}

function applyCameraRoll(deltaAngle) {
    if (!camera || !controls) return;
    const viewDir = new THREE.Vector3().subVectors(controls.target, camera.position);
    if (viewDir.lengthSq() < 1e-12) return;
    viewDir.normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(viewDir, deltaAngle);
    camera.up.applyQuaternion(q).normalize();
    camera.lookAt(controls.target);
    controls.update();
}


function setupRollDrag(container) {
    if (!container) return;
    const inputSurface = container;
    let orbitDrag = null;

    inputSurface.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;

        // Alt + primary drag rolls around the current view axis.
        if (e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            rollDrag = { x: e.clientX, awaitingMouseUp: false };
            document.body.classList.add('rotating');
            if (controls) controls.enabled = false;
            return;
        }

        // Shift+drag is pan mode; let controls handle it.
        if (e.shiftKey) return;
        // Keep ctrl/meta click behavior available for context/right-click semantics.
        if (e.ctrlKey || e.metaKey) return;

        // All left-drag rotation uses arcball ("roll a physical sphere").
        e.preventDefault();
        e.stopImmediatePropagation();
        // Cancel any running inertia so the new drag takes over immediately.
        if (arcballInertiaId) { cancelAnimationFrame(arcballInertiaId); arcballInertiaId = null; }
        arcballInertiaQ = null;
        orbitDrag = { pt: screenToArcball(e.clientX, e.clientY) };
        document.body.classList.add('rotating');
        if (controls) controls.enabled = false;
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

        if (!rollDrag) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        // If Option is released mid-drag, stop rolling immediately but keep controls
        // disabled until mouseup to avoid handing drag state back to Trackball.
        if (!e.altKey) {
            rollDrag.awaitingMouseUp = true;
            return;
        }
        if ((e.buttons & 1) === 0) return endRollDrag();
        if (rollDrag.awaitingMouseUp) return;
        const dx = e.clientX - rollDrag.x;
        rollDrag.x = e.clientX;
        const rollSpeed = 0.0045;
        applyCameraRoll(-dx * rollSpeed);
    });

    function endOrbitDrag() {
        if (!orbitDrag) return;
        orbitDrag = null;
        document.body.classList.remove('rotating');
        if (controls) {
            controls.enabled = true;
            controls.update();
        }
        startArcballInertia();
    }

    function endRollDrag() {
        // Always restore controls, even if rollDrag state was lost.
        document.body.classList.remove('rotating');
        if (controls) {
            controls.enabled = true;
            controls.update();
        }
        if (!rollDrag) return;
        rollDrag = null;
    }

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt' && rollDrag) {
            rollDrag.awaitingMouseUp = true;
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (rollDrag || orbitDrag) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        endOrbitDrag();
        endRollDrag();
    }, { capture: true });
    // Extra safety: some browsers/devices emit pointerup without a matching mouseup path.
    window.addEventListener('pointerup', () => { endOrbitDrag(); endRollDrag(); }, { capture: true });
    document.addEventListener('mouseup', () => { endOrbitDrag(); endRollDrag(); }, true);
    window.addEventListener('mouseleave', () => { endOrbitDrag(); endRollDrag(); });
    window.addEventListener('blur', () => { endOrbitDrag(); endRollDrag(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            endOrbitDrag();
            endRollDrag();
        }
    });
    // Recovery path: if anything was left disabled, restore controls on next press.
    window.addEventListener('mousedown', () => {
        if (!rollDrag && !orbitDrag && controls && !controls.enabled) controls.enabled = true;
    }, { capture: true });
}

// ----- MathBox Initialization -----
function initMathBox() {
    const container = document.getElementById('mathbox-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    mathbox = MathBox.mathBox({
        element: container,
        plugins: ['core', 'controls', 'cursor'],
        controls: { klass: CONTROL_CLASS },
        camera: { fov: 75 },
        renderer: { antialias: true },
    });

    three = mathbox.three;
    camera = three.camera;
    perspCamera = camera;
    renderer = three.renderer;
    controls = three.controls;

    renderer.setClearColor(new THREE.Color(0x0a0a0f), 1);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);

    // Add lights for shaded arrow cones
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    three.scene.add(ambientLight);
    mainDirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainDirLight.position.set(5, 10, 7);
    three.scene.add(mainDirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-3, -5, -4);
    three.scene.add(dirLight2);

    // Initial camera - dataToWorld uses currentRange which defaults to [-5,5]
    const initPos = dataToWorld(DEFAULT_CAMERA.position);
    const initTgt = dataToWorld(DEFAULT_CAMERA.target);
    camera.position.set(initPos[0], initPos[1], initPos[2]);
    camera.lookAt(initTgt[0], initTgt[1], initTgt[2]);
    if (controls) {
        const target = new THREE.Vector3(initTgt[0], initTgt[1], initTgt[2]);
        configureControlsInstance(controls, target);
    }
    updateControlsHint();

    window.addEventListener('resize', () => {
        const w2 = container.clientWidth;
        const h2 = container.clientHeight;
        renderer.setSize(w2, h2);
        if (camera.isOrthographicCamera) {
            const aspect2 = w2 / h2;
            const halfH = (camera.top - camera.bottom) / 2;
            camera.left = -halfH * aspect2;
            camera.right = halfH * aspect2;
        } else {
            camera.aspect = w2 / h2;
        }
        camera.updateProjectionMatrix();
    });

    let _statusFrameTick = 0;
    function updateLoop() {
        animationFrameId = requestAnimationFrame(updateLoop);
        const nowMs = performance.now();
        // Order is deliberate:
        // 1) update all animated objects for this exact frame timestamp
        // 2) let controls apply damping/input
        // 3) apply follow-cam using freshly updated target positions
        // This eliminates periodic desync jitter from independent RAF loops.
        runAnimUpdaters(nowMs);
        if (controls && typeof controls.update === 'function') controls.update();
        // Apply follow-cam after controls damping so lock is exact on this frame.
        updateFollowCam();
        updateAdaptiveLineWidths();
        updateLabels();
        if (++_statusFrameTick % 6 === 0) updateStatusBar(); // ~10 fps view update
    }
    updateLoop();
}

// ----- Projection Switching -----
function switchProjection(mode) {
    if (mode === currentProjection) return;
    currentProjection = mode;

    const container = document.getElementById('mathbox-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;

    // Save current camera state
    const pos = camera.position.clone();
    const target = controls ? controls.target.clone() : new THREE.Vector3();

    let newCamera;
    if (mode === 'orthographic') {
        // Compute frustum size from distance to target
        const dist = Math.max(pos.distanceTo(target), 0.001);
        const frustumHeight = dist * Math.tan((perspCamera.fov / 2) * Math.PI / 180) * 2;
        const frustumWidth = frustumHeight * aspect;
        // Use near=-1000 so coplanar geometry (e.g. axes on a face-on XY plane) doesn't
        // get clipped by the near plane or suffer depth-precision issues with zBias offsets.
        newCamera = new THREE.OrthographicCamera(
            -frustumWidth / 2, frustumWidth / 2,
            frustumHeight / 2, -frustumHeight / 2,
            -1000, 1000
        );
        newCamera.updateProjectionMatrix();
    } else {
        newCamera = perspCamera;
    }

    // Preserve the current up vector so arcball-rotated views don't snap orientation.
    newCamera.up.copy(camera.up);
    newCamera.position.copy(pos);
    newCamera.lookAt(target);

    // Replace camera in Three.js and MathBox's internal references
    three.camera = newCamera;
    camera = newCamera;

    // Override the renderer.render to force our camera
    if (!renderer._origRender) {
        renderer._origRender = renderer.render.bind(renderer);
    }
    renderer.render = function(scene, cam) {
        renderer._origRender(scene, camera);
    };

    // Recreate controls with new camera
    if (controls) controls.dispose();
    controls = new CONTROL_CLASS(camera, renderer.domElement);
    configureControlsInstance(controls, target);
    three.controls = controls;

    // Update button states
    document.querySelectorAll('.proj-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.proj === mode);
    });
}

function setupProjectionToggle() {
    document.querySelectorAll('.proj-btn').forEach(btn => {
        btn.addEventListener('click', () => switchProjection(btn.dataset.proj));
    });
}

// ----- Trackpad Two-Finger Pan -----
// Intercepts wheel events before OrbitControls in capture phase.
// ctrlKey=true → pinch gesture → let OrbitControls zoom.
// deltaMode !== 0 → physical mouse wheel → let OrbitControls zoom.
// Otherwise → two-finger trackpad scroll → pan camera.
function setupTrackpadPan() {
    const canvas = renderer && renderer.domElement;
    if (!canvas) return;
    canvas.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.deltaMode !== 0) return; // pinch or mouse wheel → OrbitControls handles zoom
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!camera || !controls) return;

        const distance = camera.position.distanceTo(controls.target);
        const panFactor = distance / canvas.clientHeight * 0.8;

        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up    = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const panOffset = new THREE.Vector3()
            .addScaledVector(right,  e.deltaX * panFactor)
            .addScaledVector(up,    -e.deltaY * panFactor);

        camera.position.add(panOffset);
        controls.target.add(panOffset);
        controls.update();
    }, { capture: true, passive: false });
}

// ----- Custom Touch Gestures -----
// Legacy custom gesture layer disabled in favor of native control behavior.
function setupTouchGestures(container) {
    void container;
}

// ----- KaTeX Rendering Helper -----
function renderKaTeX(text, displayMode) {
    if (!text) return '';
    // Split into alternating plain-text / math segments
    const segments = text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);
    return segments.map((seg, i) => {
        if (i % 2 === 0) {
            // Plain text — process line by line for headings/hr, then inline markdown
            const lines = escapeHtml(seg).split(/\\n|\n/);
            return lines.map((line, li) => {
                const t = line.trim();
                const hm = t.match(/^(#{1,3})\s+(.*)/);
                if (hm) {
                    const sz = ['1.05em', '0.95em', '0.88em'][hm[1].length - 1];
                    return `<div style="font-size:${sz};font-weight:bold;margin:3px 0 1px">${hm[2]}</div>`;
                }
                if (t === '---') return '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0">';
                const inline = line
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');
                return li < lines.length - 1 ? inline + '<br>' : inline;
            }).join('');
        } else if (seg.startsWith('$$')) {
            const tex = seg.slice(2, -2);
            try { return katex.renderToString(tex, { throwOnError: false, displayMode: true }); }
            catch(e) { return escapeHtml(seg); }
        } else {
            const tex = seg.slice(1, -1);
            try { return katex.renderToString(tex, { throwOnError: false, displayMode: false }); }
            catch(e) { return escapeHtml(seg); }
        }
    }).join('');
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Strip LaTeX delimiters for plain-text contexts (tooltips, aria labels, etc.)
function stripLatex(text) {
    if (!text) return '';
    return text.replace(/\$\$([^$]*)\$\$/g, '$1').replace(/\$([^$]*)\$/g, '$1');
}

// ----- Markdown Rendering (LaTeX-safe two-pass) -----
function renderMarkdown(md) {
    if (!md) return '';
    let mathBlocks = [];

    // Pass 1: Extract display math $$...$$
    let safe = md.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
        mathBlocks.push({ tex: tex.trim(), display: true });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });

    // Pass 1b: Extract inline math $...$
    safe = safe.replace(/\$([^$\n]+)\$/g, (m, tex) => {
        mathBlocks.push({ tex: tex.trim(), display: false });
        return '%%MATH_BLOCK_' + (mathBlocks.length - 1) + '%%';
    });

    // Pass 2: Parse markdown (LaTeX safely placeholdered)
    let html = marked.parse(safe);

    // Pass 3: Restore LaTeX with KaTeX rendering
    html = html.replace(/%%MATH_BLOCK_(\d+)%%/g, (m, idx) => {
        const block = mathBlocks[parseInt(idx)];
        try {
            return katex.renderToString(block.tex, {
                throwOnError: false,
                displayMode: block.display
            });
        } catch(e) { return block.tex; }
    });

    return html;
}

// ----- AI Ask Button Helpers -----

function openChatPanel() {
    const panel = document.getElementById('explanation-panel');
    const handle = document.getElementById('panel-resize-handle');
    const toggle = document.getElementById('explain-toggle');
    if (panel && panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        if (handle) handle.style.display = 'block';
        if (toggle) { toggle.style.display = 'block'; toggle.classList.add('active'); }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    if (typeof switchPanelTab === 'function') switchPanelTab('chat');
}

function makeAiAskButton(className, title, getMessage) {
    const btn = document.createElement('button');
    btn.className = className;
    btn.title = title;
    btn.innerHTML = AI_SPARKLE_SVG;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof sendChatMessage !== 'function') return;
        openChatPanel();
        sendChatMessage(getMessage());
    });
    return btn;
}

// ----- Doc Ask Buttons -----

// Reconstruct markdown source from a rendered element by extracting original
// LaTeX from KaTeX's embedded MathML annotations instead of reading textContent.
function elementToMarkdown(el) {
    const clone = el.cloneNode(true);
    // Display math first ($$...$$) — katex-display wraps a katex span
    clone.querySelectorAll('.katex-display').forEach(dispEl => {
        const ann = dispEl.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) dispEl.replaceWith(`$$${ann.textContent.trim()}$$`);
    });
    // Inline math ($...$)
    clone.querySelectorAll('.katex').forEach(inlineEl => {
        const ann = inlineEl.querySelector('annotation[encoding="application/x-tex"]');
        if (ann) inlineEl.replaceWith(`$${ann.textContent.trim()}$`);
    });
    return clone.textContent.trim();
}

function injectAskButtons(contentEl) {
    contentEl.querySelectorAll('h1, h2, h3, p, li').forEach(el => {
        const markdown = el.dataset.markdown || elementToMarkdown(el);  // prefer stored original
        if (!markdown || markdown.length < 10) return;

        const btn = makeAiAskButton('ai-ask-btn', 'Explain this', () => 'Can you explain this:\n' + markdown.trim());
        // Trim trailing whitespace text nodes so button sits right after real content
        while (el.lastChild && el.lastChild.nodeType === 3 && !el.lastChild.textContent.trim()) {
            el.removeChild(el.lastChild);
        }
        // If the paragraph ends with a block-display element (e.g. katex-display),
        // mark the button so CSS can right-align it on its own line
        const lastEl = el.lastElementChild;
        if (lastEl && lastEl.classList && lastEl.classList.contains('katex-display')) {
            btn.classList.add('ai-ask-btn--after-block');
        }
        el.appendChild(btn);
    });
}

// ----- Explanation Panel -----
function updateExplanationPanel(spec) {
    const panel = document.getElementById('explanation-panel');
    const content = document.getElementById('explanation-content');
    const handle = document.getElementById('panel-resize-handle');
    const toggle = document.getElementById('explain-toggle');

    if (spec && spec.markdown) {
        content.innerHTML = renderMarkdown(spec.markdown);
        content.dataset.markdown = spec.markdown;
        injectAskButtons(content);
    } else {
        content.innerHTML = '<p style="color: rgba(180,180,200,0.5); font-style: italic;">No explanation available for this scene.</p>';
    }

    panel.classList.remove('hidden');
    handle.style.display = 'block';
    toggle.style.display = 'block';
    toggle.classList.add('active');

    // Restore saved width
    const savedWidth = localStorage.getItem('algebench-panel-width');
    if (savedWidth) {
        const w = parseInt(savedWidth);
        if (w >= 250 && w <= 600) panel.style.width = w + 'px';
    }

    // Trigger resize so MathBox/Three.js adapts to new viewport width
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
}

function setupPanelResize() {
    const handle = document.getElementById('panel-resize-handle');
    const panel = document.getElementById('explanation-panel');
    let dragging = false;
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        // Handle is to the left of the panel, so dragging left = wider panel
        const dx = startX - e.clientX;
        let newWidth = Math.max(250, Math.min(600, startWidth + dx));
        panel.style.width = newWidth + 'px';
        window.dispatchEvent(new Event('resize'));
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('algebench-panel-width', panel.offsetWidth);
    });
}

function setupExplainToggle() {
    const toggle = document.getElementById('explain-toggle');
    const panel = document.getElementById('explanation-panel');
    const handle = document.getElementById('panel-resize-handle');

    toggle.addEventListener('click', () => {
        const isHidden = panel.classList.toggle('hidden');
        toggle.classList.toggle('active', !isHidden);
        handle.style.display = isHidden ? 'none' : 'block';
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    });

    // Keyboard shortcut: 'e' to toggle
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Only toggle if there's markdown content
            if (currentSpec && currentSpec.markdown && toggle.style.display !== 'none') {
                toggle.click();
            }
        }
    });
}

function updateFollowAngleLockButtonState() {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.classList.toggle('active', !!followCamAngleLock);
    btn.classList.toggle('cam-active', !!followCamState);
    if (followCamState) {
        btn.title = followCamAngleLock
            ? 'Angle-lock ON: camera rotates with followed object'
            : 'Angle-lock OFF: camera follows position only';
    } else {
        btn.title = followCamAngleLock
            ? 'Angle-lock armed (applies in follow-cam views)'
            : 'Toggle angle-lock for follow camera';
    }
}

function setupFollowAngleLockToggle() {
    const btn = document.getElementById('follow-angle-lock-toggle');
    if (!btn) return;
    btn.style.display = 'block';
    btn.addEventListener('click', () => {
        followCamAngleLock = !followCamAngleLock;
        updateFollowAngleLockButtonState();
    });
    updateFollowAngleLockButtonState();
}

// ----- Doc Panel Speak / Commentate Buttons -----
function setupDocSpeakButtons() {
    const speakBtn = document.getElementById('doc-speak-btn');
    const commentateBtn = document.getElementById('doc-commentate-btn');
    if (!speakBtn || !commentateBtn) return;

    function resetSpeakBtn() {
        speakBtn.textContent = '🔊 Speak';
        speakBtn.classList.remove('active');
    }

    // --- Speak: read the doc content aloud ---
    speakBtn.addEventListener('click', () => {
        if (speakBtn.classList.contains('active')) {
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            resetSpeakBtn();
            return;
        }

        const contentEl = document.getElementById('explanation-content');
        const text = (currentSpec && currentSpec.markdown)
            ? currentSpec.markdown
            : (contentEl.dataset.markdown || contentEl.textContent);

        if (!text || !text.trim()) return;

        if (typeof window.algebenchSpeakText === 'function') {
            speakBtn.textContent = '⏹ Stop';
            speakBtn.classList.add('active');
            window.algebenchSpeakText(text, resetSpeakBtn);
        }
    });

    // --- Commentate: send as a chat message (visible in Chat tab, TTS via normal flow) ---
    commentateBtn.addEventListener('click', () => {
        if (typeof sendChatMessage !== 'function') return;

        // Stop any doc speak in progress
        if (speakBtn.classList.contains('active')) {
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            resetSpeakBtn();
        }

        // Open panel and switch to Chat tab so the exchange is visible
        const panel = document.getElementById('explanation-panel');
        const handle = document.getElementById('panel-resize-handle');
        const toggle = document.getElementById('explain-toggle');
        if (panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            handle.style.display = 'block';
            toggle.style.display = 'block';
            toggle.classList.add('active');
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        }
        if (typeof switchPanelTab === 'function') switchPanelTab('chat');

        sendChatMessage('Please commentate on the Documentation of this scene. Specifically go into the details of how the visualization ties to the equations that we see in the Documentation.');
    });
}

// ----- Title Bar Update -----
function updateTitle(spec) {
    const titleEl = document.getElementById('scene-title');
    const descEl = document.getElementById('scene-description');
    const sourceEl = document.getElementById('scene-source-file');
    if (spec && spec.title) {
        titleEl.innerHTML = renderKaTeX(spec.title, false);
    } else {
        titleEl.innerHTML = 'AlgeBench';
    }
    if (spec && spec.description) {
        descEl.innerHTML = renderKaTeX(spec.description, false);
        descEl.dataset.markdown = spec.description;
        const descText = spec.description;
        const btn = makeAiAskButton('ai-ask-btn', 'Ask AI to explain this scene', () => 'Can you explain this scene:\n' + descText.trim());
        descEl.appendChild(btn);
        resetSceneDescPosition(descEl);
    } else if (spec && spec.title) {
        descEl.innerHTML = '';
    } else {
        descEl.innerHTML = 'Load a scene to begin';
    }
    if (sourceEl) {
        sourceEl.textContent = currentSceneSourceLabel ? `- ${currentSceneSourceLabel}` : '- no file';
        sourceEl.title = currentSceneSourcePath || '';
    }
}

// ----- Color Parsing -----
function parseColor(c) {
    if (!c) return [0.5, 0.5, 1];
    if (typeof c === 'string') {
        if (c.startsWith('#')) {
            const hex = c.slice(1);
            return [
                parseInt(hex.substr(0,2), 16) / 255,
                parseInt(hex.substr(2,2), 16) / 255,
                parseInt(hex.substr(4,2), 16) / 255
            ];
        }
        const named = {
            'red': [1,0.2,0.2], 'green': [0.2,0.9,0.2], 'blue': [0.3,0.4,1],
            'yellow': [1,1,0.2], 'cyan': [0.2,1,1], 'magenta': [1,0.2,1],
            'orange': [1,0.6,0.1], 'purple': [0.7,0.3,1], 'white': [1,1,1],
            'gray': [0.5,0.5,0.5], 'grey': [0.5,0.5,0.5], 'pink': [1,0.5,0.7],
        };
        return named[c.toLowerCase()] || [0.5, 0.5, 1];
    }
    if (Array.isArray(c)) return c.map(v => v > 1 ? v/255 : v);
    return [0.5, 0.5, 1];
}

function colorToCSS(c) {
    const rgb = parseColor(c);
    return `rgb(${Math.round(rgb[0]*255)}, ${Math.round(rgb[1]*255)}, ${Math.round(rgb[2]*255)})`;
}

// ----- Label System -----
// Labels store data-space positions; updateLabels converts to screen via dataToWorld + camera projection
function addLabel3D(text, dataPos, color, cssClass) {
    const container = document.getElementById('labels-container');
    const el = document.createElement('div');
    el.className = cssClass || 'label-3d';
    el.innerHTML = renderKaTeX(text, false);
    if (color) el.style.color = colorToCSS(color);
    container.appendChild(el);
    const entry = { el, dataPos: dataPos.slice(), screenX: null, screenY: null, forceHidden: false };
    labels.push(entry);
    return entry;
}

function clearLabels() {
    const container = document.getElementById('labels-container');
    container.innerHTML = '';
    labels = [];
}

function updateLabels() {
    if (!camera || !renderer) return;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    for (const lbl of labels) {
        const world = dataToWorld(lbl.dataPos);
        const v = new THREE.Vector3(world[0], world[1], world[2]);
        const projected = v.project(camera);
        const targetX = (projected.x * 0.5 + 0.5) * w;
        const targetY = (-projected.y * 0.5 + 0.5) * h;
        const visible = !lbl.forceHidden && projected.z < 1 && targetX > -50 && targetX < w + 50 && targetY > -50 && targetY < h + 50;

        // Temporal smoothing reduces apparent HTML-overlay shimmer during inertial camera motion.
        if (lbl.screenX == null || lbl.screenY == null) {
            lbl.screenX = targetX;
            lbl.screenY = targetY;
        } else {
            const alpha = 0.3;
            lbl.screenX += (targetX - lbl.screenX) * alpha;
            lbl.screenY += (targetY - lbl.screenY) * alpha;
        }
        const s = displayParams.labelScale;
        lbl.el.style.transform = `translate(${lbl.screenX}px, ${lbl.screenY}px) translate(-50%, -50%)${s !== 1 ? ' scale(' + s + ')' : ''}`;
        lbl.el.style.opacity = visible ? displayParams.labelOpacity : '0';
    }
}

// ----- Legend Builder -----
let legendToggledOff = new Set(); // element IDs toggled off by user via legend clicks

function buildLegend(elements) {
    const legend = document.getElementById('legend');
    const items = [];
    for (const el of elements) {
        if (el.label && el.color && el.type !== 'axis' && el.type !== 'grid' && el.type !== 'text') {
            items.push({ label: el.label, color: el.color, id: el.id || null });
        }
    }
    if (items.length === 0) {
        legend.classList.add('hidden');
        return;
    }
    legend.classList.remove('hidden');
    legend.innerHTML = items.map(it => {
        const hidden = it.id && legendToggledOff.has(it.id);
        const cls = 'legend-item' + (it.id ? ' legend-clickable' : '') + (hidden ? ' legend-hidden' : '');
        const dataAttr = it.id ? ` data-element-id="${it.id}"` : '';
        const swatchStyle = hidden
            ? `background:${colorToCSS(it.color)}; opacity:0.3`
            : `background:${colorToCSS(it.color)}`;
        return `
        <div class="${cls}"${dataAttr}>
            <div class="legend-swatch" style="${swatchStyle}"></div>
            <span>${renderKaTeX(it.label, false)}</span>
        </div>`;
    }).join('');

    // Attach click handlers (only for elements currently in the registry)
    for (const div of legend.querySelectorAll('.legend-clickable')) {
        div.addEventListener('click', () => {
            const elId = div.dataset.elementId;
            if (!elId || !elementRegistry[elId]) return;
            if (legendToggledOff.has(elId)) {
                legendToggledOff.delete(elId);
                showElementById(elId);
                div.classList.remove('legend-hidden');
                div.querySelector('.legend-swatch').style.opacity = '';
            } else {
                legendToggledOff.add(elId);
                hideElementById(elId);
                div.classList.add('legend-hidden');
                div.querySelector('.legend-swatch').style.opacity = '0.3';
            }
        });
    }

    // Prune stale IDs and apply toggled-off state for elements hidden by user
    for (const id of [...legendToggledOff]) {
        if (!elementRegistry[id]) {
            legendToggledOff.delete(id);
        } else if (!elementRegistry[id].hidden) {
            hideElementById(id);
        }
    }
}

// ----- Camera System -----
const DEFAULT_VIEWS = [
    { name: "Iso",   position: [2.5, 1.8, 2.5], target: [0, 0, 0], description: "Isometric perspective — balanced 3D view showing all axes" },
    { name: "Front", position: [0, 0, 4.5],      target: [0, 0, 0], description: "Front view along Z axis — see the XY plane directly" },
    { name: "Top",   position: [0, 4.5, 0.01],   target: [0, 0, 0], description: "Top view along Y axis — look straight down at the XZ plane" },
    { name: "Right", position: [4.5, 0, 0],       target: [0, 0, 0], description: "Right view along X axis — see the YZ plane from the right" },
];

let CAMERA_VIEWS = {};

function normalizeUpVector(up) {
    const raw = Array.isArray(up) && up.length === 3 ? up : [0, 1, 0];
    const v = new THREE.Vector3(raw[0], raw[1], raw[2]);
    if (v.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
    return v.normalize();
}

function resolveEffectiveStepCamera(scene, stepIdx) {
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
            const cam = step && step.camera;
            if (!cam) continue;
            if (Array.isArray(cam.position) && cam.position.length === 3) {
                effective.position = cam.position.slice(0, 3);
            }
            if (Array.isArray(cam.target) && cam.target.length === 3) {
                effective.target = cam.target.slice(0, 3);
            }
            if (Array.isArray(cam.up) && cam.up.length === 3) {
                effective.up = cam.up.slice(0, 3);
            }
        }
    }

    return effective;
}

function animateCamera(view, duration) {
    duration = (duration == null) ? 800 : duration;
    deactivateFollowCam();
    const targetView = CAMERA_VIEWS[view];
    if (!targetView || !camera || !controls) return;

    const startPos = camera.position.clone();
    const endPos = new THREE.Vector3(...targetView.position);
    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(...targetView.target);

    const startUp = camera.up.clone();
    let endUp = normalizeUpVector(targetView.up);
    // Nudge any pole-aligned destination off the OrbitControls singularity.
    // If (position-target) is parallel to up, spherical azimuth becomes unstable
    // and a 180° roll/flip can occur after controls.update().
    const offset = endPos.clone().sub(endTarget);
    const perp = offset.clone().sub(endUp.clone().multiplyScalar(offset.dot(endUp)));
    if (perp.length() < VIEW_EPSILON) {
        const helper = Math.abs(endUp.dot(new THREE.Vector3(0, 0, 1))) < 0.9
            ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const nudge = new THREE.Vector3().crossVectors(endUp, helper).normalize();
        const nudgeMag = Math.min(VIEW_EPSILON, Math.max(0.0005, offset.length() * 0.01));
        endPos.addScaledVector(nudge, nudgeMag);
    }
    // Final safety: ensure camera up is not parallel to view direction.
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

    cameraAnimating = true;

    if (duration === 0) {
        camera.position.copy(endPos);
        controls.target.copy(endTarget);
        camera.up.copy(endUp);
        camera.lookAt(controls.target);
        cameraAnimating = false;
        return;
    }

    function step(now) {
        const elapsed = now - startTime;
        let t = Math.min(elapsed / duration, 1);
        t = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

        camera.position.lerpVectors(startPos, endPos, t);
        controls.target.lerpVectors(startTarget, endTarget, t);
        camera.up.lerpVectors(startUp, endUp, t).normalize();
        camera.lookAt(controls.target);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            cameraAnimating = false;
        }
    }
    requestAnimationFrame(step);
}

// ----- Element Renderers -----
// All renderers use MathBox data coordinates. Labels use addLabel3D with data coords.
// Arrowheads are drawn as MathBox line segments (triangles in data space).

function renderAxis(el, view) {
    const axis = el.axis || 'x';
    const range = el.range || [-5, 5];
    const color = parseColor(el.color || (axis === 'x' ? '#ff4444' : axis === 'y' ? '#44ff44' : '#4488ff'));
    const width = el.width || 2;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label || axis;
    const showTicks = el.showTicks !== false;
    const span = Math.abs((range[1] || 0) - (range[0] || 0));
    const defaultTickStep = span > 0 ? Math.max(1, Math.ceil(span / 24)) : 1;
    const tickStep = Math.max(1e-9, Number(el.tickStep || defaultTickStep));

    const axisMap = { x: [1,0,0], y: [0,1,0], z: [0,0,1] };
    const dir = axisMap[axis] || [1,0,0];

    const start = dir.map(d => d * range[0]);
    const end = dir.map(d => d * range[1]);

    // Shaft goes to end
    const axisMid = [
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
        (start[2] + end[2]) / 2,
    ];
    const axisEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'axisWidth',
        anchorDataPos: axisMid,
    };
    const axisW = resolveLineWidth(axisEntry);
    const axisLine = view
        .array({ channels: 3, width: 2, data: [start, end] })
        .line({ color: new THREE.Color(...color), width: axisW, opacity: baseOpacity * (displayParams.axisOpacity || 1) });
    axisEntry.node = axisLine;
    axisLineNodes.push(axisEntry);

    // Tick marks (bounded density for large coordinate spans)
    if (showTicks) {
        const ticks = [];
        const startTick = Math.ceil(range[0] / tickStep) * tickStep;
        const endTick = range[1];
        for (let i = startTick; i <= endTick + tickStep * 1e-6; i += tickStep) {
            if (Math.abs(i) < tickStep * 0.5) continue;
            ticks.push(dir.map(d => d * i));
        }
        if (ticks.length > 0) {
            view
                .array({ channels: 3, width: ticks.length, data: ticks })
                .point({ color: new THREE.Color(...color), size: 6 });
        }
    }

    if (label) {
        const labelPos = dir.map(d => d * (range[1] + 0.3));
        addLabel3D(label, labelPos, color, 'label-3d label-axis');
    }
}

function renderGrid(el, view) {
    const plane = el.plane || 'xy';
    const range = el.range || [-5, 5];
    const color = parseColor(el.color || [0.3, 0.3, 0.5]);
    const opacity = el.opacity !== undefined ? el.opacity : 0.15;
    const divideX = el.divisions || 10;
    const divideY = el.divisions || 10;

    const axes = { xy: [1, 2], xz: [1, 3], yz: [2, 3] };
    const gridAxes = axes[plane] || [1, 2];

    view
        .area({
            rangeX: range,
            rangeY: range,
            width: divideX + 1,
            height: divideY + 1,
            axes: gridAxes,
            channels: 3,
        })
        .surface({
            shaded: false,
            fill: false,
            lineX: true,
            lineY: true,
            color: new THREE.Color(...color),
            opacity: opacity,
            width: 1,
            zBias: -1,
        });
}

// Helper: create arrow (cylinder shaft + cone arrowhead) in world space
function makeArrowMesh(from, to, color, sizeScale, shaftBaseScale, baseOpacity = 1) {
    sizeScale = resolveArrowSizeScale(sizeScale);
    shaftBaseScale = shaftBaseScale || 1;

    const tipWorld = dataToWorld(to);
    const fromWorld = dataToWorld(from);
    const wdx = tipWorld[0]-fromWorld[0], wdy = tipWorld[1]-fromWorld[1], wdz = tipWorld[2]-fromWorld[2];
    const wLen = Math.sqrt(wdx*wdx + wdy*wdy + wdz*wdz);
    if (wLen < 0.0001) return;

    const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
    const baseHeadLen = Math.max(Math.min(wLen * 0.25, worldSceneSize * ARROW_HEAD_MAX_FACTOR), worldSceneSize * ARROW_HEAD_MIN_FACTOR) * sizeScale;
    const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
    const wHeadLen = baseHeadLen * autoScale;
    const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
    const overlapLen = Math.max(wHeadLen * SHAFT_CONE_OVERLAP_HEAD_RATIO, 0.0);
    // Shaft should terminate at the cone base.
    const shaftLen = Math.max(wLen - wHeadLen + overlapLen, 0.0001);
    const shaftRadius = wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO;
    const dir = new THREE.Vector3(wdx/wLen, wdy/wLen, wdz/wLen);

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);

    // Cylinder shaft: fromWorld → cone base
    const shaftGeom = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 16);
    const shaftOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
    const shaftMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 60,
        transparent: shaftOpacity < 0.999,
        opacity: shaftOpacity,
    });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.position.set(
        fromWorld[0] + dir.x * shaftLen / 2,
        fromWorld[1] + dir.y * shaftLen / 2,
        fromWorld[2] + dir.z * shaftLen / 2,
    );
    shaft.setRotationFromQuaternion(quat);
    shaft.userData.baseThicknessScale = shaftBaseScale;
    shaft.userData.autoThicknessScale = autoScale;
    shaft.userData.lengthScale = 1;
    shaft.userData.baseShaftRadius = shaftRadius;
    shaft.userData.maxRadiusFromHead = wHeadRadius * 0.75;
    applyShaftThickness(shaft);
    three.scene.add(shaft);
    const arrowPair = {
        fromWorld: new THREE.Vector3(...fromWorld),
        tipWorld: new THREE.Vector3(...tipWorld),
        dir: dir.clone(),
        baseHeadLen: wHeadLen,
        baseShaftLen: shaftLen,
        dynamic: false,
    };
    shaft.userData.arrowPair = arrowPair;
    shaft.userData.baseOpacity = shaftOpacity;
    arrowMeshes.push({ mesh: shaft, tipWorld: new THREE.Vector3(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen), dir: dir.clone(), wLen: shaftLen, isShaft: true });

    // Cone arrowhead: tip exactly at tipWorld
    const coneGeom = new THREE.ConeGeometry(wHeadRadius, wHeadLen, 16);
    const coneOpacity = Math.max(0, Math.min(1, Number.isFinite(baseOpacity) ? baseOpacity : 1));
    const coneMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 60,
        transparent: coneOpacity < 0.999,
        opacity: coneOpacity,
    });
    const cone = new THREE.Mesh(coneGeom, coneMat);
    cone.position.set(
        tipWorld[0] - dir.x * wHeadLen / 2,
        tipWorld[1] - dir.y * wHeadLen / 2,
        tipWorld[2] - dir.z * wHeadLen / 2,
    );
    cone.setRotationFromQuaternion(quat);
    cone.userData.arrowPair = arrowPair;
    cone.userData.baseOpacity = coneOpacity;
    arrowPair.shaft = shaft;
    arrowPair.cone = cone;
    three.scene.add(cone);
    arrowMeshes.push({ mesh: cone, tipWorld: new THREE.Vector3(...tipWorld), dir: dir.clone(), wLen: wHeadLen });
}

function renderVector(el, view) {
    const from = el.origin || el.from || [0, 0, 0];
    const to = el.to || [1, 0, 0];
    const color = parseColor(el.color || '#ff6644');
    const label = el.label;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;
    const shaftBaseScale = 1; // ignore per-element width for vectors; use global settings only

    // Cylinder shaft + cone arrowhead (both in world space)
    makeArrowMesh(from, to, color, displayParams.arrowScale, shaftBaseScale, elementOpacity);

    // Label
    if (label) {
        if (el.labelPosition) {
            addLabel3D(label, el.labelPosition, color);
        } else {
            const mid = [
                (from[0] + to[0]) / 2,
                (from[1] + to[1]) / 2 + 0.15,
                (from[2] + to[2]) / 2
            ];
            addLabel3D(label, mid, color);
        }
    }

    return { type: 'vector', color, label };
}

function renderVectors(el, view) {
    // Render an array of vectors from eval_math sweep results.
    // el.tos:   required — array of [x,y,z] endpoints
    // el.froms: optional — array of [x,y,z] origins (defaults to all [0,0,0])
    const tos   = el.tos   || [];
    const froms = el.froms || tos.map(() => [0, 0, 0]);
    const color = parseColor(el.color || '#ff8800');
    const shaftBaseScale = 1; // ignore per-element width for vectors; use global settings only
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;

    for (let i = 0; i < tos.length; i++) {
        const from = froms[i] || [0, 0, 0];
        const to   = tos[i];
        if (!to) continue;

        makeArrowMesh(from, to, color, displayParams.arrowScale, shaftBaseScale, elementOpacity);
    }

    return { type: 'vectors', color };
}

function renderPoint(el, view) {
    const pos = el.position || el.at || [0, 0, 0];
    const color = parseColor(el.color || '#ffcc00');
    const size = el.size || 12;
    const label = el.label;

    const positions = el.positions || [pos];

    const pointNode = view
        .array({ channels: 3, width: positions.length, data: positions })
        .point({ color: new THREE.Color(...color), size: size, zBias: 5 });
    pointNodes.push({ node: pointNode });

    if (label && positions.length === 1) {
        const labelPos = [positions[0][0], positions[0][1] + 0.2, positions[0][2]];
        addLabel3D(label, labelPos, color);
    }

    return { type: 'point', color, label };
}

function renderLine(el, view) {
    const points = el.points || el.data
        || (el.from && el.to ? [el.from, el.to] : null)
        || [[0,0,0],[1,1,1]];
    const color = parseColor(el.color || '#88aaff');
    const width = el.width || 3;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;

    const mid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const lineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: mid,
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineNode = view
        .array({ channels: 3, width: points.length, data: points })
        .line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    lineNodes.push(lineEntry);

    if (label) {
        const mid = points[Math.floor(points.length / 2)];
        addLabel3D(label, mid, color);
    }

    return { type: 'line', color, label };
}

function renderSurface(el, view) {
    const color = parseColor(el.color || '#4488ff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const rangeX = el.rangeX || [-2, 2];
    const rangeY = el.rangeY || [-2, 2];
    const expr = el.expression || el.expr || 'x + y';
    const res = el.resolution || 32;
    const label = el.label;

    const data = [];
    const dx = (rangeX[1] - rangeX[0]) / res;
    const dy = (rangeY[1] - rangeY[0]) / res;
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const x = rangeX[0] + i * dx;
            const y = rangeY[0] + j * dy;
            let z;
            try {
                if (_JS_ONLY_RE.test(expr) && _sceneJsTrustState === 'trusted') {
                        z = new Function('x', 'y', 'return ' + expr)(x, y);
                    } else if (_JS_ONLY_RE.test(expr)) {
                        z = 0;
                    } else {
                        z = _mathjs.evaluate(expr, { x, y });
                    }
            } catch(e) {
                z = 0;
            }
            data.push([x, z, y]);
        }
    }

    view
        .matrix({
            channels: 3,
            width: res + 1,
            height: res + 1,
            data: data,
        })
        .surface({
            shaded: true,
            color: new THREE.Color(...color),
            opacity: opacity,
            zBias: 0,
        });

    return { type: 'surface', color, label };
}

function renderParametricCurve(el, view) {
    const color = parseColor(el.color || '#ff88aa');
    const width = el.width || 3;
    const range = el.range || [0, 2 * Math.PI];
    const samples = el.samples || 128;
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];

    const exprX = el.x || 'Math.cos(t)';
    const exprY = el.y || 'Math.sin(t)';
    const exprZ = el.z || '0';

    function buildPoints(fnX, fnY, fnZ) {
        const pts = [];
        const dt = (range[1] - range[0]) / samples;
        for (let i = 0; i <= samples; i++) {
            const t = range[0] + i * dt;
            try {
                const x = evalExpr(fnX, t, { useVirtualTime: false });
                const y = evalExpr(fnY, t, { useVirtualTime: false });
                const z = evalExpr(fnZ, t, { useVirtualTime: false });
                pts.push([isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0]);
            } catch(e) {
                pts.push([0, 0, 0]);
            }
        }
        return pts;
    }

    let fnX = compileExpr(exprX);
    let fnY = compileExpr(exprY);
    let fnZ = compileExpr(exprZ);
    const points = buildPoints(fnX, fnY, fnZ);

    const curveMid = points[Math.floor(points.length / 2)] || [0, 0, 0];
    const curveEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: curveMid,
    };
    const lineW = resolveLineWidth(curveEntry);
    const curveData = view
        .array({ channels: 3, width: points.length, data: points, live: true });
    const curveNode = curveData.line({ color: new THREE.Color(...color), width: lineW, opacity: baseOpacity * (displayParams.lineOpacity || 1) });
    curveEntry.node = curveNode;
    lineNodes.push(curveEntry);

    let labelEl = null;
    if (label) {
        const mid = points[Math.floor(points.length / 2)];
        labelEl = addLabel3D(label, [
            mid[0] + labelOffset[0],
            mid[1] + labelOffset[1],
            mid[2] + labelOffset[2],
        ], color);
    }

    // Register for slider reactivity — rebuild curve whenever sliders change
    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricCurve: true,
        _rebuildFn() {
            const newFnX = compileExpr(exprX);
            const newFnY = compileExpr(exprY);
            const newFnZ = compileExpr(exprZ);
            const pts = buildPoints(newFnX, newFnY, newFnZ);
            curveData.set('data', pts);
            if (labelEl) {
                const mid = pts[Math.floor(pts.length / 2)];
                labelEl.dataPos[0] = mid[0] + labelOffset[0];
                labelEl.dataPos[1] = mid[1] + labelOffset[1];
                labelEl.dataPos[2] = mid[2] + labelOffset[2];
            }
        },
    };
    registerAnimExpr(animExprEntry);

    return { type: 'parametric_curve', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderParametricSurface(el, view) {
    const color = parseColor(el.color || '#66aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const rangeU = el.rangeU || el.uRange || [0, 2 * Math.PI];
    const rangeV = el.rangeV || el.vRange || [0, 2 * Math.PI];
    const resU = el.resolutionU || el.uSamples || el.resolution || 32;
    const resV = el.resolutionV || el.vSamples || el.resolution || 32;
    const label = el.label;

    const exprX = el.x || 'Math.sin(v) * Math.cos(u)';
    const exprY = el.y || 'Math.sin(v) * Math.sin(u)';
    const exprZ = el.z || 'Math.cos(v)';

    function buildPositions(fnX, fnY, fnZ) {
        const numVerts = (resU + 1) * (resV + 1);
        const pos = new Float32Array(numVerts * 3);
        const du = (rangeU[1] - rangeU[0]) / resU;
        const dv = (rangeV[1] - rangeV[0]) / resV;
        let idx = 0;
        for (let j = 0; j <= resV; j++) {
            for (let i = 0; i <= resU; i++) {
                const u = rangeU[0] + i * du;
                const v = rangeV[0] + j * dv;
                let x = 0, y = 0, z = 0;
                try {
                    x = evalSurfaceExpr(fnX, u, v);
                    y = evalSurfaceExpr(fnY, u, v);
                    z = evalSurfaceExpr(fnZ, u, v);
                } catch(e) {}
                const w = dataToWorld([isFinite(x) ? x : 0, isFinite(y) ? y : 0, isFinite(z) ? z : 0]);
                pos[idx++] = w[0];
                pos[idx++] = w[1];
                pos[idx++] = w[2];
            }
        }
        return pos;
    }

    function buildIndices() {
        const indices = new Uint32Array(resU * resV * 6);
        let idx = 0;
        for (let j = 0; j < resV; j++) {
            for (let i = 0; i < resU; i++) {
                const a = j * (resU + 1) + i;
                const b = a + 1;
                const c = a + (resU + 1);
                const d = c + 1;
                indices[idx++] = a; indices[idx++] = b; indices[idx++] = d;
                indices[idx++] = a; indices[idx++] = d; indices[idx++] = c;
            }
        }
        return indices;
    }

    const fnX = compileSurfaceExpr(exprX);
    const fnY = compileSurfaceExpr(exprY);
    const fnZ = compileSurfaceExpr(exprZ);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buildPositions(fnX, fnY, fnZ), 3));
    geom.setIndex(new THREE.BufferAttribute(buildIndices(), 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        opacity: opacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        shininess: 40,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    mesh.userData.isParametricSurface = true;
    mesh.renderOrder = _planeMeshSerial;
    mesh.position.z = _planeMeshSerial * 0.0002;
    _planeMeshSerial++;
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    // Register for slider reactivity
    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprX, exprY, exprZ],
        animState,
        compiledFns: [fnX, fnY, fnZ],
        _isParametricSurface: true,
        _rebuildFn() {
            const nfX = compileSurfaceExpr(exprX);
            const nfY = compileSurfaceExpr(exprY);
            const nfZ = compileSurfaceExpr(exprZ);
            const pos = buildPositions(nfX, nfY, nfZ);
            geom.attributes.position.array.set(pos);
            geom.attributes.position.needsUpdate = true;
            geom.computeVertexNormals();
        },
    };
    registerAnimExpr(animExprEntry);

    return { type: 'parametric_surface', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function _makeSurfaceMaterial(el, color, opacity, defaults = {}) {
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : (defaults.shininess !== undefined ? defaults.shininess : 40);
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    return new matType(matOpts);
}

function _dataAxisScaleFromCenter(centerData, rx, ry, rz) {
    const centerW = new THREE.Vector3(...dataToWorld(centerData));
    const xW = new THREE.Vector3(...dataToWorld([centerData[0] + rx, centerData[1], centerData[2]]));
    const yW = new THREE.Vector3(...dataToWorld([centerData[0], centerData[1] + ry, centerData[2]]));
    const zW = new THREE.Vector3(...dataToWorld([centerData[0], centerData[1], centerData[2] + rz]));
    return {
        centerW,
        sx: Math.max(centerW.distanceTo(xW), 0.0001),
        sy: Math.max(centerW.distanceTo(yW), 0.0001),
        sz: Math.max(centerW.distanceTo(zW), 0.0001),
    };
}

function renderSphere(el, view) {
    const color = parseColor(el.color || '#66aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.8;
    const label = el.label;
    const widthSegments = el.widthSegments || el.segments || 32;
    const heightSegments = el.heightSegments || el.rings || 20;

    const centerExpr = Array.isArray(el.centerExpr) && el.centerExpr.length === 3
        ? el.centerExpr
        : ((Array.isArray(el.center) && el.center.length === 3 ? el.center : (Array.isArray(el.position) ? el.position : [0, 0, 0]))
            .map(v => String(v)));
    const radiusExpr = typeof el.radiusExpr === 'string'
        ? el.radiusExpr
        : String(el.radius !== undefined ? el.radius : 1);

    let centerFns, radiusFn;
    try {
        centerFns = centerExpr.map(e => compileExpr(e));
        radiusFn = compileExpr(radiusExpr);
    } catch (err) {
        console.warn('sphere expr compile error:', err);
        return null;
    }

    function evalState() {
        const c = centerFns.map(fn => evalExpr(fn, 0));
        const r = Math.max(Math.abs(evalExpr(radiusFn, 0)), 0.0001);
        return { center: c, radius: r };
    }

    const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
    const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    let labelEl = null;
    if (label) labelEl = addLabel3D(label, [0, 0, 0], color);

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [...centerExpr, radiusExpr],
        animState,
        _rebuildFn() {
            const state = evalState();
            const world = _dataAxisScaleFromCenter(state.center, state.radius, state.radius, state.radius);
            mesh.position.copy(world.centerW);
            mesh.scale.set(world.sx, world.sy, world.sz);
            if (labelEl) {
                labelEl.dataPos[0] = state.center[0];
                labelEl.dataPos[1] = state.center[1] + state.radius * 1.05;
                labelEl.dataPos[2] = state.center[2];
            }
        },
    };
    registerAnimExpr(animExprEntry);
    animExprEntry._rebuildFn();

    return { type: 'sphere', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderEllipsoid(el, view) {
    const color = parseColor(el.color || '#66aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.8;
    const label = el.label;
    const widthSegments = el.widthSegments || el.segments || 32;
    const heightSegments = el.heightSegments || el.rings || 20;

    const centerExpr = Array.isArray(el.centerExpr) && el.centerExpr.length === 3
        ? el.centerExpr
        : ((Array.isArray(el.center) && el.center.length === 3 ? el.center : (Array.isArray(el.position) ? el.position : [0, 0, 0]))
            .map(v => String(v)));
    const radiiExpr = Array.isArray(el.radiiExpr) && el.radiiExpr.length === 3
        ? el.radiiExpr
        : (() => {
            if (Array.isArray(el.radii) && el.radii.length === 3) return el.radii.map(v => String(v));
            const rx = el.rx !== undefined ? el.rx : (el.xRadius !== undefined ? el.xRadius : 1);
            const ry = el.ry !== undefined ? el.ry : (el.yRadius !== undefined ? el.yRadius : rx);
            const rz = el.rz !== undefined ? el.rz : (el.zRadius !== undefined ? el.zRadius : rx);
            return [String(rx), String(ry), String(rz)];
        })();

    let centerFns, radiiFns;
    try {
        centerFns = centerExpr.map(e => compileExpr(e));
        radiiFns = radiiExpr.map(e => compileExpr(e));
    } catch (err) {
        console.warn('ellipsoid expr compile error:', err);
        return null;
    }

    function evalState() {
        const c = centerFns.map(fn => evalExpr(fn, 0));
        const rx = Math.max(Math.abs(evalExpr(radiiFns[0], 0)), 0.0001);
        const ry = Math.max(Math.abs(evalExpr(radiiFns[1], 0)), 0.0001);
        const rz = Math.max(Math.abs(evalExpr(radiiFns[2], 0)), 0.0001);
        return { center: c, rx, ry, rz };
    }

    const geom = new THREE.SphereGeometry(1, widthSegments, heightSegments);
    const mat = _makeSurfaceMaterial(el, color, opacity, { shininess: 50 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    let labelEl = null;
    if (label) labelEl = addLabel3D(label, [0, 0, 0], color);

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [...centerExpr, ...radiiExpr],
        animState,
        _rebuildFn() {
            const state = evalState();
            const world = _dataAxisScaleFromCenter(state.center, state.rx, state.ry, state.rz);
            mesh.position.copy(world.centerW);
            mesh.scale.set(world.sx, world.sy, world.sz);
            if (labelEl) {
                labelEl.dataPos[0] = state.center[0];
                labelEl.dataPos[1] = state.center[1] + state.ry * 1.05;
                labelEl.dataPos[2] = state.center[2];
            }
        },
    };
    registerAnimExpr(animExprEntry);
    animExprEntry._rebuildFn();

    return { type: 'ellipsoid', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderVectorField(el, view) {
    const color = parseColor(el.color || '#88ccff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.6;
    const range = el.range || [[-2, 2], [-2, 2], [-2, 2]];
    const density = el.density || 3;
    const scale = el.scale || 0.3;
    const label = el.label;

    const exprX = el.fx || 'y';
    const exprY = el.fy || '-x';
    const exprZ = el.fz || '0';

    // Pre-compile each expression once — regex test + Function/mathjs compile happen here,
    // not on every grid point inside the triple loop.
    const _compileVF = (e) => {
        if (_JS_ONLY_RE.test(e)) {
            if (_sceneJsTrustState === 'trusted') {
                return new Function('x', 'y', 'z', 'return ' + e);
            }
            return null; // untrusted — will return 0
        }
        return _mathjs.compile(e);
    };
    const _evalVF = (compiled, x, y, z) => {
        if (!compiled) return 0;
        if (typeof compiled === 'function') return compiled(x, y, z);
        return compiled.evaluate({ x, y, z });
    };
    const compiledX = _compileVF(exprX);
    const compiledY = _compileVF(exprY);
    const compiledZ = _compileVF(exprZ);

    const starts = [];
    const ends = [];
    const rangeX = range[0], rangeY = range[1], rangeZ = range[2];
    const dxStep = (rangeX[1] - rangeX[0]) / density;
    const dyStep = (rangeY[1] - rangeY[0]) / density;
    const dzStep = (rangeZ[1] - rangeZ[0]) / density;

    for (let xi = 0; xi <= density; xi++) {
        for (let yi = 0; yi <= density; yi++) {
            for (let zi = 0; zi <= density; zi++) {
                const x = rangeX[0] + xi * dxStep;
                const y = rangeY[0] + yi * dyStep;
                const z = rangeZ[0] + zi * dzStep;
                try {
                    const vx = _evalVF(compiledX, x, y, z);
                    const vy = _evalVF(compiledY, x, y, z);
                    const vz = _evalVF(compiledZ, x, y, z);
                    starts.push([x, y, z]);
                    ends.push([x + vx*scale, y + vy*scale, z + vz*scale]);
                } catch(e) {}
            }
        }
    }

    for (let i = 0; i < starts.length; i++) {
        view
            .array({ channels: 3, width: 2, data: [starts[i], ends[i]] })
            .line({ color: new THREE.Color(...color), width: 2, opacity: opacity });
    }

    if (starts.length > 0) {
        view
            .array({ channels: 3, width: ends.length, data: ends })
            .point({ color: new THREE.Color(...color), size: 4, opacity: opacity });
    }

    return { type: 'vector_field', color, label };
}

function renderPlane(el, view) {
    const color = parseColor(el.color || '#4466aa');
    const opacity = el.opacity !== undefined ? el.opacity : 0.5;
    const normal = el.normal || [0, 1, 0];
    const point = el.point || [0, 0, 0];
    const size = el.size || 4;
    const label = el.label;

    // Use MathBox surface instead of Three.js mesh
    // Create a quad in data space centered at 'point', perpendicular to 'normal'
    const n = new THREE.Vector3(...normal).normalize();

    // Find two tangent vectors
    let t1;
    if (Math.abs(n.x) < 0.9) {
        t1 = new THREE.Vector3(1, 0, 0).cross(n).normalize();
    } else {
        t1 = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    }
    const t2 = n.clone().cross(t1).normalize();

    const half = size / 2;
    const res = 2;
    const data = [];
    for (let j = 0; j <= res; j++) {
        for (let i = 0; i <= res; i++) {
            const u = (i / res * 2 - 1) * half;
            const v = (j / res * 2 - 1) * half;
            data.push([
                point[0] + t1.x * u + t2.x * v,
                point[1] + t1.y * u + t2.y * v,
                point[2] + t1.z * u + t2.z * v,
            ]);
        }
    }

    view
        .matrix({ channels: 3, width: res + 1, height: res + 1, data: data })
        .surface({
            shaded: false,
            color: new THREE.Color(...color),
            opacity: opacity,
            zBias: -2,
        });

    if (label) {
        addLabel3D(label, point, color);
    }

    return { type: 'plane', color, label };
}

function renderText(el, view) {
    const text = el.text || el.value || '';
    const position = el.position || el.at || [0, 0, 0];
    const color = parseColor(el.color || '#ffffff');

    addLabel3D(text, position, color);

    return { type: 'text', color, label: text };
}

function renderAnimatedVector(el, view) {
    const color = parseColor(el.color || '#ff8844');
    const label = el.label;
    const elementOpacity = (typeof el.opacity === 'number' && isFinite(el.opacity))
        ? Math.max(0, Math.min(1, el.opacity))
        : 1;
    const labelOffset = (Array.isArray(el.labelOffset) && el.labelOffset.length === 3)
        ? [Number(el.labelOffset[0]) || 0, Number(el.labelOffset[1]) || 0, Number(el.labelOffset[2]) || 0]
        : [0, 0.3, 0];
    const keyframes = el.keyframes || [];
    const duration = el.duration || 2000;
    const loop = el.loop !== false;
    const exprStrings = el.expr || el.toExpr
        || (Array.isArray(el.to) && el.to.length === 3 ? el.to.map(v => String(v)) : null); // array of 3 JS expression strings using 't'
    const fromExprStrings = el.fromExpr; // optional array of 3 JS expression strings for dynamic origin
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;
    const labelShowAltitude = !!el.labelShowAltitude;
    const labelAltitudePrecision = Number.isFinite(el.labelAltitudePrecision) ? Math.max(0, Math.floor(el.labelAltitudePrecision)) : 1;
    const trailOpts = el.trail; // { color, width, length }
    const hasExplicitWidth = (typeof el.width === 'number' && isFinite(el.width));
    // Animated vectors default to 1.3x static vector width when width is omitted.
    // If width is explicitly provided, honor it exactly.
    const widthScale = hasExplicitWidth ? Math.max(0.01, el.width) : 1.3;
    // Keep head and shaft scaling coupled so thick vectors don't lose visible heads.
    const widthHeadScale = Math.max(0.4, Math.sqrt(widthScale));
    const localArrowScale = (el.arrowScale !== undefined ? el.arrowScale : 1) * widthHeadScale;
    const localArrowMinFactor = el.arrowMinFactor !== undefined ? el.arrowMinFactor : ARROW_HEAD_MIN_FACTOR;
    const localArrowMaxFactor = el.arrowMaxFactor !== undefined ? el.arrowMaxFactor : ARROW_HEAD_MAX_FACTOR;
    // Honor per-element thickness control for animated vectors.
    // `width` remains the primary scene knob; `shaftScale` can further tune it.
    const defaultAnimatedShaftMul = 1;
    const shaftBaseScale = (typeof el.shaftScale === 'number' && isFinite(el.shaftScale))
        ? Math.max(0.01, widthScale * el.shaftScale)
        : (widthScale * defaultAnimatedShaftMul);

    // Determine animation mode
    const useExpr = Array.isArray(exprStrings) && exprStrings.length === 3;
    const useFromExpr = Array.isArray(fromExprStrings) && fromExprStrings.length === 3;
    if (!useExpr && keyframes.length === 0) return null;

    // Initial positions
    const initFrom = el.origin || el.from || (keyframes.length > 0 ? (keyframes[0].origin || keyframes[0].from || [0,0,0]) : [0,0,0]);
    let initTo;
    if (useExpr) {
        // Evaluate at t=0 (with current slider values)
        try {
            initTo = exprStrings.map(e => evalExpr(compileExpr(e), 0));
        } catch (err) {
            console.warn('animated_vector expr eval error:', err);
            initTo = [1, 0, 0];
        }
    } else {
        initTo = keyframes[0].to || [1, 0, 0];
    }
    // Evaluate fromExpr at t=0 if present
    if (useFromExpr) {
        try {
            const evalFrom = fromExprStrings.map(e => evalExpr(compileExpr(e), 0));
            initFrom[0] = evalFrom[0]; initFrom[1] = evalFrom[1]; initFrom[2] = evalFrom[2];
        } catch (err) {
            console.warn('animated_vector fromExpr eval error:', err);
        }
    }

    // Current endpoints (updated each frame)
    let currentFrom = initFrom.slice();
    let currentTo = initTo.slice();

    // Shared helper: compute all world-space arrow geometry params from data-space endpoints.
    // IMPORTANT INVARIANT:
    // Animated vectors must be a pure function of CURRENT frame state:
    //   {from, to, displayParams.arrowScale, displayParams.vectorWidth}.
    // Do NOT read prior mesh scale/length state to derive new geometry; that causes
    // direction-dependent drift (gap/extension flips) when slider direction changes.
    function computeArrowParams(from, to) {
        const tipWorld = dataToWorld(to);
        const fromWorld = dataToWorld(from);
        const wdx = tipWorld[0]-fromWorld[0], wdy = tipWorld[1]-fromWorld[1], wdz = tipWorld[2]-fromWorld[2];
        const wLen = Math.sqrt(wdx*wdx + wdy*wdy + wdz*wdz);
        const worldSceneSize = Math.min(currentScale[0], currentScale[1]) * 2;
        const effectiveArrowScale = resolveArrowSizeScale(localArrowScale * (displayParams.arrowScale || 1));
        const baseHeadLen = Math.max(Math.min(wLen * 0.25, worldSceneSize * localArrowMaxFactor), worldSceneSize * localArrowMinFactor) * effectiveArrowScale;
        const autoScale = resolveSmallVectorAutoScale(wLen, baseHeadLen);
        const wHeadLen = baseHeadLen * autoScale;
        const wHeadRadius = wHeadLen * ARROW_HEAD_RADIUS_RATIO;
        const overlapLen = Math.max(wHeadLen * SHAFT_CONE_OVERLAP_HEAD_RATIO, 0.0);
        // Shaft should terminate at the cone base.
        const shaftLen = Math.max(wLen - wHeadLen + overlapLen, 0.0001);
        const shaftRadius = wHeadRadius * SHAFT_RADIUS_TO_HEAD_RADIUS_RATIO;
        const dir = wLen < 0.0001 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(wdx/wLen, wdy/wLen, wdz/wLen);
        return { tipWorld, fromWorld, wLen, wHeadLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale };
    }

    function computeShaftThicknessMul(autoScale) {
        // Keep dynamic shaft thickness deterministic from current settings.
        // Do not use mesh.userData.lengthScale/baseThicknessScale feedback here.
        const base = (shaftBaseScale || 1) * (displayParams.vectorWidth || 1) * (autoScale || 1);
        return Math.max(0.01, base);
    }

    // Create 3D cone arrowhead — tip exactly at dataToWorld(to)
    function createCone(from, to) {
        const { tipWorld, wLen, wHeadLen, wHeadRadius, dir } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        // Unit geometry for dynamic vectors:
        // We transform via scale every frame from current params, never by mutating geometry.
        const geom = new THREE.ConeGeometry(1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            shininess: 60,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
        });
        const cone = new THREE.Mesh(geom, mat);
        cone.userData.baseOpacity = elementOpacity;
        cone.userData.dynamicVector = true;
        cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);

        cone.position.set(
            tipWorld[0] - dir.x * wHeadLen / 2,
            tipWorld[1] - dir.y * wHeadLen / 2,
            tipWorld[2] - dir.z * wHeadLen / 2,
        );
        const up = new THREE.Vector3(0, 1, 0);
        cone.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));

        three.scene.add(cone);
        arrowMeshes.push({ mesh: cone, tipWorld: new THREE.Vector3(...tipWorld), dir: dir.clone(), wLen: wHeadLen });
        return cone;
    }

    // Create 3D cylinder shaft — runs from fromWorld to cone base (tipWorld - dir*wHeadLen)
    function createShaft(from, to) {
        const { fromWorld, wLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
        if (wLen < 0.0001) return null;

        // Unit geometry for dynamic vectors:
        // This avoids geometry rebuild races and stale length/scale carry-over.
        const geom = new THREE.CylinderGeometry(1, 1, 1, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...color),
            shininess: 60,
            transparent: elementOpacity < 0.999,
            opacity: elementOpacity,
        });
        const shaft = new THREE.Mesh(geom, mat);
        shaft.userData.baseOpacity = elementOpacity;
        shaft.userData.dynamicVector = true;

        shaft.position.set(
            fromWorld[0] + dir.x * shaftLen / 2,
            fromWorld[1] + dir.y * shaftLen / 2,
            fromWorld[2] + dir.z * shaftLen / 2,
        );
        const up = new THREE.Vector3(0, 1, 0);
        shaft.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
        // Cap shaft diameter to 75% of arrow-head diameter:
        // 2 * shaftR <= 0.75 * (2 * headR)  => shaftR <= 0.75 * headR
        const shaftRadiusScaled = Math.min(
            shaftRadius * computeShaftThicknessMul(autoScale),
            wHeadRadius * 0.75
        );
        shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);

        three.scene.add(shaft);
        arrowMeshes.push({ mesh: shaft, tipWorld: new THREE.Vector3(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen), dir: dir.clone(), wLen: shaftLen, isShaft: true });
        return shaft;
    }

    // Update both cone and shaft each animation frame.
    // IMPORTANT:
    // - No dependence on previous frame mesh scale/length.
    // - No threshold-based geometry recreation.
    // This keeps shaft/cone join stable regardless of slider direction.
    function updateArrow(cone, shaft, from, to) {
        const { tipWorld, fromWorld, wLen, wHeadLen, wHeadRadius, shaftLen, shaftRadius, dir, autoScale } = computeArrowParams(from, to);
        const visible = wLen >= 0.0001;

        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);

        if (cone) {
            cone.visible = visible;
            if (visible) {
                // Stateless transform from current frame values.
                cone.scale.set(wHeadRadius, wHeadLen, wHeadRadius);
                cone.position.set(
                    tipWorld[0] - dir.x * wHeadLen / 2,
                    tipWorld[1] - dir.y * wHeadLen / 2,
                    tipWorld[2] - dir.z * wHeadLen / 2,
                );
                cone.setRotationFromQuaternion(quat);
                const entry = arrowMeshes.find(e => e.mesh === cone);
                if (entry) { entry.wLen = wHeadLen; entry.tipWorld.set(...tipWorld); entry.dir.copy(dir); }
            }
        }

        if (shaft) {
            shaft.visible = visible;
            if (visible) {
                // Stateless transform from current frame values.
                shaft.position.set(
                    fromWorld[0] + dir.x * shaftLen / 2,
                    fromWorld[1] + dir.y * shaftLen / 2,
                    fromWorld[2] + dir.z * shaftLen / 2,
                );
                shaft.setRotationFromQuaternion(quat);
                // Keep the same geometric cap during animation updates.
                const shaftRadiusScaled = Math.min(
                    shaftRadius * computeShaftThicknessMul(autoScale),
                    wHeadRadius * 0.75
                );
                shaft.scale.set(shaftRadiusScaled, shaftLen, shaftRadiusScaled);
                const entry = arrowMeshes.find(e => e.mesh === shaft);
                if (entry) {
                    entry.wLen = shaftLen;
                    entry.tipWorld.set(fromWorld[0] + dir.x*shaftLen, fromWorld[1] + dir.y*shaftLen, fromWorld[2] + dir.z*shaftLen);
                    entry.dir.copy(dir);
                }
            }
        }
    }

    let arrowCone = null;
    let arrowShaft = createShaft(initFrom, initTo);
    if (el.arrow !== false) {
        arrowCone = createCone(initFrom, initTo);
    }

    // Trail setup
    let trailData = null;
    let trailLine = null;
    let trailBuffer = [];
    const trailMaxLen = (trailOpts && trailOpts.length) || 200;
    if (trailOpts) {
        const trailColor = parseColor(trailOpts.color || el.color || '#ff8844');
        const trailOpacityRaw = (trailOpts && trailOpts.opacity !== undefined) ? Number(trailOpts.opacity) : 1;
        const trailBaseOpacity = Math.max(0, Math.min(1, Number.isFinite(trailOpacityRaw) ? trailOpacityRaw : 1));
        const trailEntry = {
            node: null,
            baseWidth: trailOpts.width || 1,
            baseOpacity: trailBaseOpacity,
            widthParam: 'lineWidth',
            anchorDataPosFn: () => currentTo,
        };
        const trailWidth = resolveLineWidth(trailEntry);
        // Initialize with 2 points (minimum for a line)
        trailBuffer = [initTo.slice(), initTo.slice()];
        trailData = view
            .array({ channels: 3, width: 2, data: trailBuffer, live: true });
        trailLine = trailData.line({
            color: new THREE.Color(...trailColor),
            width: trailWidth,
            zBias: 1,
            opacity: trailBaseOpacity * (displayParams.lineOpacity || 1),
        });
        trailEntry.node = trailLine;
        lineNodes.push(trailEntry);
    }

    // Label (create a moving label element)
    let labelEl = null;
    if (label) {
        const labelPos = el.labelPosition || [
            (initFrom[0] + initTo[0]) / 2 + labelOffset[0],
            (initFrom[1] + initTo[1]) / 2 + labelOffset[1],
            (initFrom[2] + initTo[2]) / 2 + labelOffset[2]
        ];
        labelEl = addLabel3D(label, labelPos, color);
    }

    // Compiled expr functions (slider-aware)
    let exprFns = null;
    let fromExprFns = null;
    let visibleFn = null;
    const animExprEntry = { exprStrings, fromExprStrings, visibleExprString, animState: null, compiledFns: null, fromExprFns: null, visibleFn: null };
    if (useExpr) {
        try {
            exprFns = exprStrings.map(e => compileExpr(e));
            animExprEntry.compiledFns = exprFns;
        } catch (err) {
            console.warn('animated_vector expr compile error:', err);
        }
    }
    if (useFromExpr) {
        try {
            fromExprFns = fromExprStrings.map(e => compileExpr(e));
            animExprEntry.fromExprFns = fromExprFns;
        } catch (err) {
            console.warn('animated_vector fromExpr compile error:', err);
        }
    }
    if (visibleExprString) {
        try {
            visibleFn = compileExpr(visibleExprString);
            animExprEntry.visibleFn = visibleFn;
        } catch (err) {
            console.warn('animated_vector visibleExpr compile error:', err);
        }
    }

    // Animation control
    const animState = { stopped: false };
    animExprEntry.animState = animState;
    if (useExpr) registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            // Check if cone has been hidden by element remove (not by zero-length)
            if (arrowCone && !arrowCone.visible && arrowCone._hiddenByRemove) return;

            const elapsed = nowMs - startTime;
            const tSec = elapsed / 1000;
            let cf, ct;

            if (useExpr && (animExprEntry.compiledFns || exprFns)) {
                // Expression mode: evaluate expr(t) where t is seconds
                // Evaluate dynamic origin if fromExpr is present
                const fromFns = animExprEntry.fromExprFns || fromExprFns;
                if (fromFns) {
                    try {
                        cf = fromFns.map(fn => evalExpr(fn, tSec));
                    } catch (err) {
                        cf = initFrom.slice();
                    }
                } else {
                    cf = initFrom.slice();
                }
                const fns = animExprEntry.compiledFns || exprFns;
                try {
                    ct = fns.map(fn => evalExpr(fn, tSec));
                } catch (err) {
                    ct = initTo;
                }
            } else if (keyframes.length > 1) {
                // Keyframe mode
                const totalDur = duration * (keyframes.length - 1);
                let t = (elapsed % (loop ? totalDur || 1 : Infinity)) / duration;
                if (!loop && elapsed > totalDur) t = keyframes.length - 1;

                const idx = Math.min(Math.floor(t), keyframes.length - 2);
                const frac = t - idx;
                const kf0 = keyframes[idx];
                const kf1 = keyframes[Math.min(idx + 1, keyframes.length - 1)];

                const f0 = kf0.origin || kf0.from || [0,0,0];
                const t0 = kf0.to || [1,0,0];
                const f1 = kf1.origin || kf1.from || [0,0,0];
                const t1 = kf1.to || [1,0,0];

                cf = f0.map((v, i) => v + (f1[i] - v) * frac);
                ct = t0.map((v, i) => v + (t1[i] - v) * frac);
            } else {
                return; // Static single keyframe, no animation needed
            }

            currentFrom = cf;
            currentTo = ct;

            let isVisible = true;
            const curVisibleFn = animExprEntry.visibleFn || visibleFn;
            if (curVisibleFn) {
                try {
                    isVisible = !!evalExpr(curVisibleFn, tSec);
                } catch (_err) {
                    isVisible = true;
                }
            }
            if (!isVisible) {
                if (arrowCone) arrowCone.visible = false;
                if (arrowShaft) arrowShaft.visible = false;
                if (labelEl) labelEl.forceHidden = true;
                return;
            }

            // Lazy-create geometry if initial length was near-zero but later becomes valid.
            if (!arrowShaft) arrowShaft = createShaft(cf, ct);
            if (el.arrow !== false && !arrowCone) arrowCone = createCone(cf, ct);

            // Update cone + shaft
            updateArrow(arrowCone, arrowShaft, cf, ct);

            // Update trail
            if (trailOpts && trailData) {
                trailBuffer.push(ct.slice());
                if (trailBuffer.length > trailMaxLen) {
                    trailBuffer.shift();
                }
                trailData.set('width', trailBuffer.length);
                trailData.set('data', trailBuffer);
            }

            // Update label position to follow the vector
            if (labelEl) {
                labelEl.dataPos[0] = (cf[0] + ct[0]) / 2 + labelOffset[0];
                labelEl.dataPos[1] = (cf[1] + ct[1]) / 2 + labelOffset[1];
                labelEl.dataPos[2] = (cf[2] + ct[2]) / 2 + labelOffset[2];
                labelEl.forceHidden = false;
                if (labelShowAltitude) {
                    const rr = Math.sqrt(cf[0] * cf[0] + cf[1] * cf[1] + cf[2] * cf[2]);
                    const RpVal = sceneSliders.Rp ? Number(sceneSliders.Rp.value) : 0;
                    const alt = Math.max(0, rr - RpVal);
                    const txt = `h=${alt.toFixed(labelAltitudePrecision)} km`;
                    if (labelEl._lastDynamicText !== txt) {
                        labelEl.el.innerHTML = renderKaTeX(txt, false);
                        labelEl._lastDynamicText = txt;
                    }
                }
            }

            // Publish vector endpoints for follow-cam and orientation lock helpers
            if (el.id) {
                animatedElementPos[el.id] = {
                    pos: ct,
                    from: cf,
                    to: ct,
                    startTime,
                    time: nowMs,
                };
            }
        },
    });

    return { type: 'animated_vector', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

// ----- Master Element Renderer -----
function renderPolygon(el, view) {
    const color = parseColor(el.color || '#aa66ff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.5;
    const thickness = el.thickness || 0.02;

    // Resolve vertices: regular substructure or explicit list
    let vertices;
    if (el.regular && typeof el.regular === 'object') {
        const reg = el.regular;
        const N   = Math.max(3, Math.round(Number(reg.n) || 3));
        const r   = Number(reg.radius != null ? reg.radius : 1);
        const cx  = Array.isArray(reg.center) ? Number(reg.center[0] ?? 0) : 0;
        const cy  = Array.isArray(reg.center) ? Number(reg.center[1] ?? 0) : 0;
        const cz  = Array.isArray(reg.center) ? Number(reg.center[2] ?? 0) : 0;
        const rot = Number(reg.rotation ?? 0);
        vertices = [];
        for (let k = 0; k < N; k++) {
            const angle = rot + (2 * Math.PI * k) / N;
            vertices.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), cz]);
        }
    } else {
        vertices = el.vertices || el.points || [[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
    }
    const label = el.label;

    // Convert vertices to world space
    const wVerts = vertices.map(v => dataToWorld(v));

    // Compute face normal from first 3 vertices
    const a = new THREE.Vector3(wVerts[1][0]-wVerts[0][0], wVerts[1][1]-wVerts[0][1], wVerts[1][2]-wVerts[0][2]);
    const b = new THREE.Vector3(wVerts[2][0]-wVerts[0][0], wVerts[2][1]-wVerts[0][1], wVerts[2][2]-wVerts[0][2]);
    const normal = a.cross(b).normalize();

    // Base half-thickness in world space
    const baseHalf = dataLenToWorld(thickness / 2);

    function buildSlabGeometry(halfThick) {
        const positions = [];
        // Top and bottom face vertices offset along normal
        const top = wVerts.map(v => [v[0]+normal.x*halfThick, v[1]+normal.y*halfThick, v[2]+normal.z*halfThick]);
        const bot = wVerts.map(v => [v[0]-normal.x*halfThick, v[1]-normal.y*halfThick, v[2]-normal.z*halfThick]);

        // Top face (fan)
        for (let i = 1; i < top.length - 1; i++) {
            positions.push(...top[0], ...top[i], ...top[i+1]);
        }
        // Bottom face (fan, reversed winding)
        for (let i = 1; i < bot.length - 1; i++) {
            positions.push(...bot[0], ...bot[i+1], ...bot[i]);
        }
        // Side quads
        for (let i = 0; i < wVerts.length; i++) {
            const j = (i + 1) % wVerts.length;
            positions.push(...top[i], ...bot[i], ...top[j]);
            positions.push(...top[j], ...bot[i], ...bot[j]);
        }
        return positions;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(buildSlabGeometry(baseHalf * displayParams.planeScale), 3));
    geom.computeVertexNormals();

    // Material: support "shader" property for per-polygon material params
    // shader: { shininess, emissive, specular, flatShading, type }
    // type: "basic" for unlit, "phong" (default) for shaded
    const sh = el.shader || {};
    const matType = sh.type === 'basic' ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        opacity: displayParams.planeOpacity,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    };
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 30;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    mesh.userData.baseHalf = baseHalf;
    mesh.userData.wVerts = wVerts;
    mesh.userData.normal = normal.clone();
    mesh.userData.buildSlab = buildSlabGeometry;
    const _serial = el.renderOrder !== undefined ? el.renderOrder : _planeMeshSerial++;
    mesh.renderOrder = _serial;
    mesh.position.z = el.depthZ !== undefined ? el.depthZ : _serial * 0.0002;
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    if (label) {
        const cx = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
        const cy = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
        const cz = vertices.reduce((s, v) => s + v[2], 0) / vertices.length;
        addLabel3D(label, [cx, cy, cz], color);
    }

    // Optional static outline
    const outlineWidthVal = el.outlineWidth != null ? Number(el.outlineWidth) : (el.regular ? 1.5 : 0);
    if (outlineWidthVal > 0 && view) {
        const outlineColor = parseColor(el.outlineColor || el.color || '#aa66ff');
        const outlineOpacity = el.outlineOpacity != null ? Number(el.outlineOpacity) : Math.min(1, opacity * 2);
        const pts = vertices.slice();
        pts.push(pts[0]); // close the loop
        view.array({ channels: 3, width: pts.length, data: pts })
            .line({ color: new THREE.Color(...outlineColor), width: outlineWidthVal, opacity: outlineOpacity, zBias: 2 });
    }

    return { type: 'polygon', color, label };
}

function renderAnimatedLine(el, view) {
    const color = parseColor(el.color || '#88aaff');
    const width = (el.width || 3) * getAbstractWidthScale(el);
    const opacity = (el.opacity !== undefined) ? Number(el.opacity) : 1;
    const baseOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
    const label = el.label;
    const pointExprs = el.points; // array of [exprX, exprY, exprZ] per point

    if (!Array.isArray(pointExprs) || pointExprs.length < 2) return null;

    // Compile all point expressions
    let compiledPoints = pointExprs.map(p => p.map(e => compileExpr(e)));

    function evalPoints(fns, tSec) {
        return fns.map(pfns => pfns.map(fn => evalExpr(fn, tSec)));
    }

    let currentPoints;
    try {
        currentPoints = evalPoints(compiledPoints, 0);
    } catch(err) {
        console.warn('animated_line eval error:', err);
        return null;
    }

    // Create MathBox line
    const lineEntry = {
        node: null,
        baseWidth: width,
        baseOpacity,
        widthParam: 'lineWidth',
        anchorDataPosFn: () => (currentPoints[Math.floor(currentPoints.length / 2)] || [0, 0, 0]),
    };
    const lineW = resolveLineWidth(lineEntry);
    const lineData = view
        .array({ channels: 3, width: currentPoints.length, data: currentPoints, live: true });
    const lineNode = lineData.line({ color: new THREE.Color(...color), width: lineW, zBias: 1, opacity: baseOpacity * (displayParams.lineOpacity || 1) });
    lineEntry.node = lineNode;
    lineNodes.push(lineEntry);

    // Label at midpoint
    let labelEl = null;
    if (label) {
        const mid = currentPoints[Math.floor(currentPoints.length / 2)];
        labelEl = addLabel3D(label, mid, color);
    }

    // Register for slider recompilation
    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: pointExprs.flat(),
        animState,
        compiledFns: compiledPoints.flat(),
        _isAnimatedLine: true,
        _pointExprs: pointExprs,
        _compiledPoints: compiledPoints,
    };
    registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry._compiledPoints;
            try {
                const pts = evalPoints(fns, tSec);
                lineData.set('data', pts);

                if (labelEl) {
                    const mid = pts[Math.floor(pts.length / 2)];
                    labelEl.dataPos[0] = mid[0];
                    labelEl.dataPos[1] = mid[1] + 0.3;
                    labelEl.dataPos[2] = mid[2];
                }
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_line', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderAnimatedPoint(el, view) {
    const color = parseColor(el.color || '#ffdd00');
    const radius = el.radius !== undefined ? el.radius : 0.25; // data-space radius (m in this scene)
    const label = el.label;
    const exprStrings = el.expr || el.positionExpr || el.toExpr
        || (Array.isArray(el.position) && el.position.length === 3 ? el.position.map(v => String(v)) : null);
    const visibleExprString = (typeof el.visibleExpr === 'string' && el.visibleExpr.trim()) ? el.visibleExpr.trim() : null;

    if (!Array.isArray(exprStrings) || exprStrings.length !== 3) return null;

    let exprFns;
    let visibleFn = null;
    let initPos;
    try {
        exprFns = exprStrings.map(e => compileExpr(e));
        initPos = exprFns.map(fn => evalExpr(fn, 0));
        if (visibleExprString) visibleFn = compileExpr(visibleExprString);
    } catch (err) {
        console.warn('animated_point expr compile/eval error:', err);
        return null;
    }

    const initWorld = dataToWorld(initPos);
    const geom = new THREE.SphereGeometry(1, 20, 16);
    const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(...color),
        shininess: 50,
        transparent: true,
        opacity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(initWorld[0], initWorld[1], initWorld[2]);
    const initWorldRadius = Math.max(dataLenToWorld(radius), 0.0005);
    mesh.scale.setScalar(initWorldRadius);
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    let labelEl = null;
    if (label) {
        labelEl = addLabel3D(label, [initPos[0], initPos[1], initPos[2] + 0.3], color);
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings,
        animState,
        compiledFns: exprFns,
        visibleExprString,
        visibleFn,
    };
    registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const fns = animExprEntry.compiledFns || exprFns;
            let p = initPos;
            try {
                p = fns.map(fn => evalExpr(fn, tSec));
            } catch (err) {
                // keep previous position
            }

            // Always publish position so follow-cam keeps tracking even when element is hidden.
            // Step-removal competition (same id re-added) is guarded by _hiddenByRemove below.
            if (el.id) {
                animatedElementPos[el.id] = { pos: p, startTime, time: nowMs };
            }

            // If hidden by element removal, don't override the hide state or update visuals.
            if (mesh._hiddenByRemove) return;

            let isVisible = true;
            const curVisibleFn = animExprEntry.visibleFn || visibleFn;
            if (curVisibleFn) {
                try {
                    isVisible = !!evalExpr(curVisibleFn, tSec);
                } catch (_err) {
                    isVisible = true;
                }
            }
            mesh.visible = isVisible;

            const w = dataToWorld(p);
            mesh.position.set(w[0], w[1], w[2]);
            const worldRadius = Math.max(dataLenToWorld(radius), 0.0005);
            mesh.scale.setScalar(worldRadius);

            if (labelEl) {
                labelEl.dataPos[0] = p[0];
                labelEl.dataPos[1] = p[1];
                labelEl.dataPos[2] = p[2] + 0.3;
                labelEl.forceHidden = !isVisible;
            }
        },
    });

    return { type: 'animated_point', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function _axisToDataDir(axis) {
    if (axis === 'x') return [1, 0, 0];
    if (axis === 'y') return [0, 1, 0];
    return [0, 0, 1];
}

function _resolveCylinderDataEndpoints(el) {
    const from = Array.isArray(el.from) ? el.from.slice(0, 3) : null;
    const to = Array.isArray(el.to) ? el.to.slice(0, 3) : null;
    if (from && to) return { from, to };

    const center = Array.isArray(el.center) ? el.center.slice(0, 3)
        : (Array.isArray(el.position) ? el.position.slice(0, 3) : [0, 0, 0]);
    const h = el.height !== undefined ? el.height : 1;
    const dir = _axisToDataDir(el.axis || 'z');
    const half = h / 2;
    return {
        from: [center[0] - dir[0] * half, center[1] - dir[1] * half, center[2] - dir[2] * half],
        to:   [center[0] + dir[0] * half, center[1] + dir[1] * half, center[2] + dir[2] * half],
    };
}

function _setCylinderTransformFromData(mesh, fromData, toData, radiusData) {
    const fromW = new THREE.Vector3(...dataToWorld(fromData));
    const toW = new THREE.Vector3(...dataToWorld(toData));
    const delta = new THREE.Vector3().subVectors(toW, fromW);
    const len = Math.max(delta.length(), 0.0001);
    const dir = delta.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const center = new THREE.Vector3().addVectors(fromW, toW).multiplyScalar(0.5);

    // Convert radius in data units using a perpendicular direction in data space.
    // This avoids over-scaling under anisotropic ranges (e.g., z range << x/y range).
    const dx = (toData[0] - fromData[0]);
    const dy = (toData[1] - fromData[1]);
    const dz = (toData[2] - fromData[2]);
    const dataDir = new THREE.Vector3(dx, dy, dz);
    if (dataDir.lengthSq() < 1e-12) dataDir.set(0, 0, 1);
    dataDir.normalize();
    const basis = Math.abs(dataDir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const perpData = new THREE.Vector3().crossVectors(dataDir, basis).normalize();
    const radiusDataSafe = isFinite(radiusData) ? Number(radiusData) : 0;
    const sampleData = [
        fromData[0] + perpData.x * radiusDataSafe,
        fromData[1] + perpData.y * radiusDataSafe,
        fromData[2] + perpData.z * radiusDataSafe,
    ];
    const sampleW = new THREE.Vector3(...dataToWorld(sampleData));
    const rWorld = Math.max(sampleW.distanceTo(fromW), 0.0005);

    mesh.position.copy(center);
    mesh.setRotationFromQuaternion(quat);
    mesh.scale.set(rWorld, len, rWorld);
}

function renderCylinder(el, view) {
    const color = parseColor(el.color || '#88aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.35;
    const radius = el.radius !== undefined ? el.radius : 1;
    const radialSegments = el.radialSegments || 32;
    const openEnded = !!el.openEnded;
    const label = el.label;

    const { from, to } = _resolveCylinderDataEndpoints(el);

    // Unit cylinder geometry; transform/scale in world space from data-space endpoints.
    const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 40;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    _setCylinderTransformFromData(mesh, from, to, radius);
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    if (label) {
        const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
        addLabel3D(label, mid, color);
    }

    return { type: 'cylinder', color, label };
}

function renderAnimatedCylinder(el, view) {
    const color = parseColor(el.color || '#88aaff');
    const opacity = el.opacity !== undefined ? el.opacity : 0.35;
    const radialSegments = el.radialSegments || 32;
    const openEnded = !!el.openEnded;
    const label = el.label;
    const radius = (typeof el.radius === 'number') ? el.radius : 1;
    const radiusExpr = (typeof el.radiusExpr === 'string')
        ? el.radiusExpr
        : (typeof el.radius === 'string' ? el.radius : null);

    const fromExpr = Array.isArray(el.fromExpr) && el.fromExpr.length === 3
        ? el.fromExpr
        : (Array.isArray(el.from) && el.from.length === 3 ? el.from.map(v => String(v)) : null);
    const toExpr = Array.isArray(el.expr) && el.expr.length === 3
        ? el.expr
        : (Array.isArray(el.toExpr) && el.toExpr.length === 3
            ? el.toExpr
            : (Array.isArray(el.to) && el.to.length === 3 ? el.to.map(v => String(v)) : null));
    if (!fromExpr || !toExpr) return null;

    let fromFns, toFns, radiusFn = null;
    try {
        fromFns = fromExpr.map(e => compileExpr(e));
        toFns = toExpr.map(e => compileExpr(e));
        if (radiusExpr) radiusFn = compileExpr(radiusExpr);
    } catch (err) {
        console.warn('animated_cylinder expr compile error:', err);
        return null;
    }

    function evalTriplet(fns, tSec) {
        return fns.map(fn => evalExpr(fn, tSec));
    }

    let initFrom, initTo;
    try {
        initFrom = evalTriplet(fromFns, 0);
        initTo = evalTriplet(toFns, 0);
    } catch (err) {
        console.warn('animated_cylinder expr eval error:', err);
        return null;
    }

    const geom = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
    const matType = (el.shader && el.shader.type === 'basic') ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
    };
    const sh = el.shader || {};
    if (sh.depthWrite !== undefined) matOpts.depthWrite = !!sh.depthWrite;
    if (sh.depthTest !== undefined) matOpts.depthTest = !!sh.depthTest;
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 40;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
        if (sh.flatShading) matOpts.flatShading = true;
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.targetOpacity = opacity;
    let initRadius = radius;
    if (radiusFn) {
        try { initRadius = evalExpr(radiusFn, 0); } catch (err) {}
    }
    _setCylinderTransformFromData(mesh, initFrom, initTo, initRadius);
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    let labelEl = null;
    if (label) {
        const mid = [(initFrom[0] + initTo[0]) / 2, (initFrom[1] + initTo[1]) / 2, (initFrom[2] + initTo[2]) / 2];
        labelEl = addLabel3D(label, mid, color);
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: toExpr,
        fromExprStrings: fromExpr,
        radiusExprString: radiusExpr || null,
        animState,
        compiledFns: toFns,
        fromExprFns: fromFns,
        radiusFn,
    };
    registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            const curFromFns = animExprEntry.fromExprFns || fromFns;
            const curToFns = animExprEntry.compiledFns || toFns;
            const curRadiusFn = animExprEntry.radiusFn || radiusFn;
            let fromData = initFrom;
            let toData = initTo;
            let curRadius = radius;
            try {
                fromData = evalTriplet(curFromFns, tSec);
                toData = evalTriplet(curToFns, tSec);
                if (curRadiusFn) curRadius = evalExpr(curRadiusFn, tSec);
            } catch (err) {
                // keep last transform
            }

            _setCylinderTransformFromData(mesh, fromData, toData, curRadius);
            if (labelEl) {
                labelEl.dataPos[0] = (fromData[0] + toData[0]) / 2;
                labelEl.dataPos[1] = (fromData[1] + toData[1]) / 2;
                labelEl.dataPos[2] = (fromData[2] + toData[2]) / 2;
            }
        },
    });

    return { type: 'animated_cylinder', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderAnimatedPolygon(el, view) {
    const color = parseColor(el.color || '#aa66ff');
    const opacityRaw = el.opacity !== undefined ? el.opacity : 0.3;
    const opacityExpr = typeof opacityRaw === 'string' ? compileExpr(opacityRaw) : null;
    const opacity = opacityExpr ? 0.3 : opacityRaw; // initial value; updated per-frame if expr
    const thickness = el.thickness || 0.02;
    const label = el.label;
    const sh = el.shader || {};

    const animState = { stopped: false };
    const isRegular = el.regular && typeof el.regular === 'object';
    let getVerts;       // (tSec) → [[x,y,z], ...]
    let animExprEntry;

    if (isRegular) {
        // Regular polygon mode: vertices computed from n, radius, center, rotation
        const reg = el.regular;
        const nExpr   = String(reg.n        != null ? reg.n        : '3');
        const rExpr   = String(reg.radius   != null ? reg.radius   : '1');
        const cxExpr  = String(Array.isArray(reg.center) && reg.center[0] != null ? reg.center[0] : '0');
        const cyExpr  = String(Array.isArray(reg.center) && reg.center[1] != null ? reg.center[1] : '0');
        const czExpr  = String(Array.isArray(reg.center) && reg.center[2] != null ? reg.center[2] : '0');
        const rotExpr = String(reg.rotation != null ? reg.rotation : '0');
        const regExprs = [nExpr, rExpr, cxExpr, cyExpr, czExpr, rotExpr];

        const regState = {
            cN:   compileExpr(nExpr),
            cR:   compileExpr(rExpr),
            cCx:  compileExpr(cxExpr),
            cCy:  compileExpr(cyExpr),
            cCz:  compileExpr(czExpr),
            cRot: compileExpr(rotExpr),
        };

        getVerts = (tSec) => {
            const N   = Math.max(3, Math.round(evalExpr(regState.cN,   tSec)));
            const r   = evalExpr(regState.cR,   tSec);
            const cx  = evalExpr(regState.cCx,  tSec);
            const cy  = evalExpr(regState.cCy,  tSec);
            const cz  = evalExpr(regState.cCz,  tSec);
            const rot = evalExpr(regState.cRot, tSec);
            const verts = [];
            for (let k = 0; k < N; k++) {
                const angle = rot + (2 * Math.PI * k) / N;
                verts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle), cz]);
            }
            return verts;
        };

        animExprEntry = {
            exprStrings: regExprs,
            animState,
            compiledFns: Object.values(regState),
            _isRegularPolygon: true,
            _regExprs: regExprs,
            _regState: regState,
        };
    } else {
        // Explicit vertices mode: array of [exprX, exprY, exprZ] per vertex
        const vertexExprs = el.vertices;
        if (!Array.isArray(vertexExprs) || vertexExprs.length < 3) return null;

        let compiledVerts = vertexExprs.map(v => v.map(e => compileExpr(e)));
        getVerts = (tSec) => animExprEntry._compiledVerts.map(vfns => vfns.map(fn => evalExpr(fn, tSec)));

        animExprEntry = {
            exprStrings: vertexExprs.flat(),
            animState,
            compiledFns: compiledVerts.flat(),
            _isAnimatedPolygon: true,
            _vertexExprs: vertexExprs,
            _compiledVerts: compiledVerts,
        };
    }

    let currentDataVerts;
    try {
        currentDataVerts = getVerts(0);
    } catch(err) {
        console.warn('animated_polygon eval error:', err);
        return null;
    }

    // Build mesh geometry from data-space vertices
    function rebuildGeometry(dataVerts) {
        const wVerts = dataVerts.map(v => dataToWorld(v));
        const a = new THREE.Vector3(wVerts[1][0]-wVerts[0][0], wVerts[1][1]-wVerts[0][1], wVerts[1][2]-wVerts[0][2]);
        const b = new THREE.Vector3(wVerts[2][0]-wVerts[0][0], wVerts[2][1]-wVerts[0][1], wVerts[2][2]-wVerts[0][2]);
        const normal = a.cross(b).normalize();
        const halfThick = dataLenToWorld(thickness / 2) * (displayParams.planeScale || 1);

        const positions = [];
        const top = wVerts.map(v => [v[0]+normal.x*halfThick, v[1]+normal.y*halfThick, v[2]+normal.z*halfThick]);
        const bot = wVerts.map(v => [v[0]-normal.x*halfThick, v[1]-normal.y*halfThick, v[2]-normal.z*halfThick]);
        for (let i = 1; i < top.length - 1; i++) positions.push(...top[0], ...top[i], ...top[i+1]);
        for (let i = 1; i < bot.length - 1; i++) positions.push(...bot[0], ...bot[i+1], ...bot[i]);
        for (let i = 0; i < wVerts.length; i++) {
            const j = (i + 1) % wVerts.length;
            positions.push(...top[i], ...bot[i], ...top[j]);
            positions.push(...top[j], ...bot[i], ...bot[j]);
        }
        return new Float32Array(positions);
    }

    // Pre-allocate fill buffer large enough for any practical N (512 sides max).
    // Three.js cannot grow a GPU buffer in place — replacing the attribute mid-frame
    // silently stalls for larger sizes. Instead we over-allocate once and use
    // setDrawRange to tell the renderer how many vertices are actually active.
    const FILL_MAX_FLOATS = 12 * 512 * 3;
    const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
    fillAttr.setUsage(THREE.DynamicDrawUsage);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', fillAttr);
    function applyGeomVerts(dataVerts) {
        const arr = rebuildGeometry(dataVerts);
        fillAttr.array.set(arr);
        fillAttr.needsUpdate = true;
        geom.setDrawRange(0, arr.length / 3);
        geom.computeVertexNormals();
    }
    applyGeomVerts(currentDataVerts);

    const matType = sh.type === 'basic' ? THREE.MeshBasicMaterial : THREE.MeshPhongMaterial;
    const matOpts = {
        color: new THREE.Color(...color),
        opacity: displayParams.planeOpacity * (opacity / 0.5), // scale relative to default
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    };
    if (matType === THREE.MeshPhongMaterial) {
        matOpts.shininess = sh.shininess !== undefined ? sh.shininess : 30;
        if (sh.emissive) matOpts.emissive = new THREE.Color(sh.emissive);
        if (sh.specular) matOpts.specular = new THREE.Color(sh.specular);
    }
    const mat = new matType(matOpts);
    const mesh = new THREE.Mesh(geom, mat);
    const _serialA = el.renderOrder !== undefined ? el.renderOrder : _planeMeshSerial++;
    mesh.renderOrder = _serialA;
    mesh.position.z = el.depthZ !== undefined ? el.depthZ : _serialA * 0.0002;
    three.scene.add(mesh);
    planeMeshes.push(mesh);

    // Optional outline: MathBox geometry-based line (supports real variable width unlike gl.lineWidth).
    // Points are padded to a fixed max size; setDrawRange equivalent is achieved by repeating the
    // last valid point so extra segments are zero-length and invisible.
    let outlineArrayNode = null;
    let outlineLineNode = null;
    let outlineWidthExpr = null;
    let outlineOpacityExpr = null;
    const OUTLINE_MAX_PTS = 513; // max N + 1 for loop closure
    function buildOutlinePts(dataVerts) {
        const pts = dataVerts.slice(); // data-space — MathBox transforms internally
        pts.push(pts[0]); // close the loop
        const last = pts[pts.length - 1];
        while (pts.length < OUTLINE_MAX_PTS) pts.push(last); // pad — zero-length segments are invisible
        return pts;
    }
    const outlineWidthRaw = el.outlineWidth != null ? el.outlineWidth : (isRegular ? 1.5 : 0);
    const outlineOpacityRaw = el.outlineOpacity != null ? el.outlineOpacity : null;
    const outlineWidthInit = typeof outlineWidthRaw === 'string' ? (evalExpr(compileExpr(outlineWidthRaw), 0) || 1.5) : outlineWidthRaw;
    if (outlineWidthInit > 0 || typeof outlineWidthRaw === 'string') {
        if (typeof outlineWidthRaw === 'string') outlineWidthExpr = compileExpr(outlineWidthRaw);
        if (outlineOpacityRaw != null && typeof outlineOpacityRaw === 'string') outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
        const outlineColor = parseColor(el.outlineColor || el.color || '#aa66ff');
        const outlineOpacityInit = outlineOpacityRaw != null
            ? (typeof outlineOpacityRaw === 'string' ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw))
            : Math.min(1, opacity * 2);

        outlineArrayNode = view.array({ channels: 3, width: OUTLINE_MAX_PTS, data: buildOutlinePts(currentDataVerts), live: true });
        outlineLineNode = outlineArrayNode.line({
            color: new THREE.Color(...outlineColor),
            width: outlineWidthInit,
            opacity: outlineOpacityInit,
            zBias: 2,
        });
    }

    // Label at centroid
    let labelEl = null;
    if (label) {
        const cx = currentDataVerts.reduce((s, v) => s + v[0], 0) / currentDataVerts.length;
        const cy = currentDataVerts.reduce((s, v) => s + v[1], 0) / currentDataVerts.length;
        const cz = currentDataVerts.reduce((s, v) => s + v[2], 0) / currentDataVerts.length;
        labelEl = addLabel3D(label, [cx, cy, cz], color);
    }

    registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            if (!mesh.visible) return;

            const tSec = (nowMs - startTime) / 1000;
            try {
                const verts = getVerts(tSec);
                applyGeomVerts(verts);

                if (opacityExpr) {
                    const op = evalExpr(opacityExpr, tSec);
                    mat.opacity = displayParams.planeOpacity * (op / 0.5);
                    if (outlineLineNode && !outlineOpacityExpr) outlineLineNode.set('opacity', Math.min(1, op * 2));
                }
                if (outlineArrayNode) {
                    outlineArrayNode.set('data', buildOutlinePts(verts));
                }
                if (outlineLineNode && outlineWidthExpr) {
                    outlineLineNode.set('width', evalExpr(outlineWidthExpr, tSec));
                }
                if (outlineLineNode && outlineOpacityExpr) {
                    outlineLineNode.set('opacity', evalExpr(outlineOpacityExpr, tSec));
                }

                if (labelEl) {
                    labelEl.dataPos[0] = verts.reduce((s, v) => s + v[0], 0) / verts.length;
                    labelEl.dataPos[1] = verts.reduce((s, v) => s + v[1], 0) / verts.length + 0.3;
                    labelEl.dataPos[2] = verts.reduce((s, v) => s + v[2], 0) / verts.length;
                }
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_polygon', color, label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderAnimatedCurve(el, view) {
    const color = parseColor(el.color || '#ff8844');
    const width = el.width != null ? el.width : 3;
    const opacityRaw = el.opacity != null ? el.opacity : 1;
    const opacityExpr = typeof opacityRaw === 'string' ? compileExpr(opacityRaw) : null;
    const lineOpacity = opacityExpr ? evalExpr(opacityExpr, 0) : Number(opacityRaw);
    const samples = el.samples || 200;

    // Range: static array or expression strings
    let rangeLExpr = null, rangeRExpr = null;
    let rangeL = -1, rangeR = 1;
    const rangeSpec = el.range_expr || el.range || [-1, 1];
    const rSpec0 = rangeSpec[0], rSpec1 = rangeSpec[1];
    if (typeof rSpec0 === 'string') { rangeLExpr = compileExpr(rSpec0); rangeL = evalExpr(rangeLExpr, 0); }
    else { rangeL = Number(rSpec0) || 0; }
    if (typeof rSpec1 === 'string') { rangeRExpr = compileExpr(rSpec1); rangeR = evalExpr(rangeRExpr, 0); }
    else { rangeR = Number(rSpec1) || 1; }

    const exprStr = el.expr || '0';
    const cCurve = compileExpr(exprStr);

    function evalRange(tSec) {
        const rL = rangeLExpr ? evalExpr(rangeLExpr, tSec) : rangeL;
        const rR = rangeRExpr ? evalExpr(rangeRExpr, tSec) : rangeR;
        return [rL, rR];
    }

    function evalAtX(x, tSec) {
        try {
            const y = evalExpr(cCurve, tSec, { extraScope: { x } });
            return isFinite(y) ? y : 0;
        } catch(e) { return 0; }
    }

    function buildCurvePoints(tSec) {
        const [rL, rR] = evalRange(tSec);
        const pts = [];
        for (let i = 0; i <= samples; i++) {
            const x = rL + (rR - rL) * (i / samples);
            pts.push([x, evalAtX(x, tSec), 0]);
        }
        return pts;
    }

    const initPts = buildCurvePoints(0);
    const curveEntry = {
        node: null,
        baseWidth: width,
        baseOpacity: lineOpacity,
        widthParam: 'lineWidth',
        anchorDataPos: initPts[Math.floor(initPts.length / 2)] || [0, 0, 0],
    };
    const lineW = resolveLineWidth(curveEntry);
    const curveData = view.array({ channels: 3, width: initPts.length, data: initPts, live: true });
    const curveNode = curveData.line({
        color: new THREE.Color(...color),
        width: lineW,
        opacity: lineOpacity * (displayParams.lineOpacity || 1),
        visible: el.showCurve !== false,
    });
    curveEntry.node = curveNode;
    lineNodes.push(curveEntry);

    // Fill regions
    const fillRegions = Array.isArray(el.fill_regions) ? el.fill_regions : [];
    // Per-quad: 2 triangles × 3 verts × 3 floats = 18 floats; allow 1024 sample quads max
    const FILL_MAX_FLOATS = 1024 * 18;

    const fillEntries = fillRegions.map(fr => {
        const frColor = parseColor(fr.color || el.color || '#ff8844');
        const frOpacityRaw = fr.opacity != null ? fr.opacity : 0.35;
        const frOpacityExpr = typeof frOpacityRaw === 'string' ? compileExpr(frOpacityRaw) : null;
        const frOpacity = frOpacityExpr ? evalExpr(frOpacityExpr, 0) : Number(frOpacityRaw);
        const cAbove   = fr.above   != null ? compileExpr(String(fr.above))   : null;
        const cBelow   = fr.below   != null ? compileExpr(String(fr.below))   : null;
        const cRightOf = fr.rightOf != null ? compileExpr(String(fr.rightOf)) : null; // fill where x >= rightOf
        const cLeftOf  = fr.leftOf  != null ? compileExpr(String(fr.leftOf))  : null; // fill where x <= leftOf

        const fillAttr = new THREE.Float32BufferAttribute(new Float32Array(FILL_MAX_FLOATS), 3);
        fillAttr.setUsage(THREE.DynamicDrawUsage);
        const fillGeom = new THREE.BufferGeometry();
        fillGeom.setAttribute('position', fillAttr);
        const fillMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(...frColor),
            opacity: displayParams.planeOpacity * (frOpacity / 0.5),
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        const fillMesh = new THREE.Mesh(fillGeom, fillMat);
        const _ser = _planeMeshSerial++;
        fillMesh.renderOrder = _ser;
        fillMesh.position.z = el.depthZ !== undefined ? el.depthZ : _ser * 0.0002;
        three.scene.add(fillMesh);
        planeMeshes.push(fillMesh);

        // Optional boundary line along the boundary expression (above or below).
        // Drawn only when outlineWidth is explicitly set — default is no boundary.
        let outlineArrayNode = null, outlineLineNode = null;
        let outlineWidthExpr = null, outlineOpacityExpr = null;
        const outlineWidthRaw = fr.outlineWidth != null ? fr.outlineWidth : null;
        const outlineOpacityRaw = fr.outlineOpacity != null ? fr.outlineOpacity : null;
        // Boundary compiled expr: above takes priority over below; fallback to y=0
        const cBoundary = cAbove || cBelow || null;
        if (outlineWidthRaw != null) {
            if (typeof outlineWidthRaw === 'string') outlineWidthExpr = compileExpr(outlineWidthRaw);
            if (outlineOpacityRaw != null && typeof outlineOpacityRaw === 'string') outlineOpacityExpr = compileExpr(String(outlineOpacityRaw));
            const outlineColor = parseColor(fr.outlineColor || fr.color || el.color || '#ff8844');
            const outlineWidthInit = typeof outlineWidthRaw === 'string' ? (evalExpr(compileExpr(outlineWidthRaw), 0) || 2) : outlineWidthRaw;
            const outlineOpacityInit = outlineOpacityRaw != null
                ? (typeof outlineOpacityRaw === 'string' ? evalExpr(compileExpr(String(outlineOpacityRaw)), 0) : Number(outlineOpacityRaw))
                : Math.min(1, frOpacity * 2);
            // Full perimeter: curve side forward + right cap + boundary side backward + left cap + closure
            const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
            const initBndPts = Array(OUTLINE_MAX_PTS).fill([0, 0, 0]);
            outlineArrayNode = view.array({ channels: 3, width: OUTLINE_MAX_PTS, data: initBndPts, live: true });
            outlineLineNode = outlineArrayNode.line({
                color: new THREE.Color(...outlineColor),
                width: outlineWidthInit,
                opacity: outlineOpacityInit,
                zBias: 2,
            });
        }

        return { fr, frOpacityExpr, frOpacity, cAbove, cBelow, cRightOf, cLeftOf, fillAttr, fillGeom, fillMat,
                 cBoundary, outlineArrayNode, outlineLineNode, outlineWidthExpr, outlineOpacityExpr, outlineOpacityRaw, frOpacity };
    });

    // Evaluate a boundary expression at a given x and tSec.
    // Boundary exprs may be constant (e.g. "0") or x-dependent (e.g. "cos(x) - 1").
    function evalBound(compiled, x, tSec) {
        try {
            const v = evalExpr(compiled, tSec, { extraScope: { x } });
            return isFinite(v) ? v : 0;
        } catch(e) { return 0; }
    }

    function updateFillMesh(entry, tSec, pts) {
        const { cAbove, cBelow, cRightOf, cLeftOf, fillAttr, fillGeom } = entry;
        const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null; // fill where x >= rightOfX
        const leftOfX  = cLeftOf  ? evalExpr(cLeftOf,  tSec) : null; // fill where x <= leftOfX
        const floats = fillAttr.array;
        let idx = 0;

        for (let i = 0; i < pts.length - 1; i++) {
            const x0 = pts[i][0],   x1 = pts[i + 1][0];
            const cy0 = pts[i][1],  cy1 = pts[i + 1][1];

            if (rightOfX != null && x1 < rightOfX) continue; // quad fully left of rightOf bound
            if (leftOfX  != null && x0 > leftOfX)  continue; // quad fully right of leftOf bound

            // Evaluate per-sample boundaries (supports x-dependent exprs like "cos(x)-1")
            const aboveY0 = cAbove ? evalBound(cAbove, x0, tSec) : null;
            const aboveY1 = cAbove ? evalBound(cAbove, x1, tSec) : null;
            const belowY0 = cBelow ? evalBound(cBelow, x0, tSec) : null;
            const belowY1 = cBelow ? evalBound(cBelow, x1, tSec) : null;

            let yTop0, yBot0, yTop1, yBot1, show0, show1;
            if (cAbove != null && cBelow != null) {
                // Band fill: shade directly from above_expr (lower) to below_expr (upper), curve not required as boundary
                yBot0 = aboveY0; yTop0 = belowY0;
                yBot1 = aboveY1; yTop1 = belowY1;
                show0 = yTop0 > yBot0;
                show1 = yTop1 > yBot1;
            } else if (cAbove != null) {
                show0 = cy0 >= aboveY0; show1 = cy1 >= aboveY1;
                yTop0 = cy0; yBot0 = aboveY0; yTop1 = cy1; yBot1 = aboveY1;
            } else if (cBelow != null) {
                show0 = cy0 <= belowY0; show1 = cy1 <= belowY1;
                yTop0 = belowY0; yBot0 = cy0; yTop1 = belowY1; yBot1 = cy1;
            } else {
                show0 = show1 = true;
                yTop0 = Math.max(0, cy0); yBot0 = Math.min(0, cy0);
                yTop1 = Math.max(0, cy1); yBot1 = Math.min(0, cy1);
            }

            if (!show0 && !show1) continue;
            if (idx + 18 > FILL_MAX_FLOATS) break;

            const w00 = dataToWorld([x0, yBot0, 0]);
            const w01 = dataToWorld([x0, yTop0, 0]);
            const w10 = dataToWorld([x1, yBot1, 0]);
            const w11 = dataToWorld([x1, yTop1, 0]);

            // Triangle 1: bottom-left, bottom-right, top-left
            floats[idx++] = w00[0]; floats[idx++] = w00[1]; floats[idx++] = w00[2];
            floats[idx++] = w10[0]; floats[idx++] = w10[1]; floats[idx++] = w10[2];
            floats[idx++] = w01[0]; floats[idx++] = w01[1]; floats[idx++] = w01[2];
            // Triangle 2: top-left, bottom-right, top-right
            floats[idx++] = w01[0]; floats[idx++] = w01[1]; floats[idx++] = w01[2];
            floats[idx++] = w10[0]; floats[idx++] = w10[1]; floats[idx++] = w10[2];
            floats[idx++] = w11[0]; floats[idx++] = w11[1]; floats[idx++] = w11[2];
        }

        fillAttr.needsUpdate = true;
        fillGeom.setDrawRange(0, idx / 3);
    }

    // Build a closed perimeter loop for a fill region outline.
    // Traces: top side left→right, right vertical cap, bottom side right→left, left vertical cap, closure.
    function buildOutlinePts(entry, tSec, pts) {
        const { cAbove, cBelow, cRightOf, cLeftOf } = entry;
        const rightOfX = cRightOf ? evalExpr(cRightOf, tSec) : null;
        const leftOfX  = cLeftOf  ? evalExpr(cLeftOf,  tSec) : null;

        // Collect samples within the x membership bounds
        const clipped = [];
        for (const p of pts) {
            const x = p[0], cy = p[1];
            if (rightOfX != null && x < rightOfX - 1e-9) continue;
            if (leftOfX  != null && x > leftOfX  + 1e-9) continue;
            let topY, botY;
            if (cAbove != null && cBelow != null) {
                // Band fill: outline spans between the two expressions directly
                topY = evalBound(cBelow, x, tSec);
                botY = evalBound(cAbove, x, tSec);
            } else if (cAbove != null) {
                topY = cy; botY = evalBound(cAbove, x, tSec);
            } else if (cBelow != null) {
                topY = evalBound(cBelow, x, tSec); botY = cy;
            } else {
                topY = Math.max(0, cy); botY = Math.min(0, cy);
            }
            clipped.push({ x, topY, botY });
        }

        if (clipped.length === 0) return [[0, 0, 0]];

        const perimeter = [];
        // Top side: left → right
        for (const s of clipped) perimeter.push([s.x, s.topY, 0]);
        // Right vertical cap
        const last = clipped[clipped.length - 1];
        perimeter.push([last.x, last.botY, 0]);
        // Bottom side: right → left
        for (let i = clipped.length - 1; i >= 0; i--) perimeter.push([clipped[i].x, clipped[i].botY, 0]);
        // Left vertical cap
        perimeter.push([clipped[0].x, clipped[0].topY, 0]);
        // Close
        perimeter.push(perimeter[0]);

        // Pad to fixed max size
        const OUTLINE_MAX_PTS = 2 * (samples + 1) + 4;
        const padPt = perimeter[perimeter.length - 1];
        while (perimeter.length < OUTLINE_MAX_PTS) perimeter.push(padPt);
        return perimeter;
    }

    // Initial fill
    for (const entry of fillEntries) updateFillMesh(entry, 0, initPts);
    for (const entry of fillEntries) {
        if (entry.outlineArrayNode) {
            entry.outlineArrayNode.set('data', buildOutlinePts(entry, 0, initPts));
        }
    }

    const animState = { stopped: false };
    const animExprEntry = {
        exprStrings: [exprStr],
        animState,
        compiledFns: [cCurve],
        _isAnimatedCurve: true,
    };
    registerAnimExpr(animExprEntry);

    const startTime = sceneStartTime;
    registerAnimUpdater({
        animState,
        updateFrame(nowMs) {
            const tSec = (nowMs - startTime) / 1000;
            try {
                const pts = buildCurvePoints(tSec);
                curveData.set('data', pts);
                if (opacityExpr) {
                    curveNode.set('opacity', evalExpr(opacityExpr, tSec) * (displayParams.lineOpacity || 1));
                }
                for (const entry of fillEntries) {
                    updateFillMesh(entry, tSec, pts);
                    if (entry.frOpacityExpr) {
                        entry.fillMat.opacity = displayParams.planeOpacity * (evalExpr(entry.frOpacityExpr, tSec) / 0.5);
                    }
                    if (entry.outlineArrayNode) {
                        entry.outlineArrayNode.set('data', buildOutlinePts(entry, tSec, pts));
                    }
                    if (entry.outlineLineNode && entry.outlineWidthExpr) {
                        entry.outlineLineNode.set('width', evalExpr(entry.outlineWidthExpr, tSec));
                    }
                    if (entry.outlineLineNode && entry.outlineOpacityExpr) {
                        entry.outlineLineNode.set('opacity', evalExpr(entry.outlineOpacityExpr, tSec));
                    }
                }
            } catch(err) { /* keep last frame */ }
        },
    });

    return { type: 'animated_curve', color, label: el.label, _animState: animState, _animExprEntry: animExprEntry };
}

function renderElement(el, view) {
    switch (el.type) {
        case 'skybox': return renderSkybox(el);
        case 'axis': return renderAxis(el, view);
        case 'grid': return renderGrid(el, view);
        case 'vector': return renderVector(el, view);
        case 'point': return renderPoint(el, view);
        case 'line': return renderLine(el, view);
        case 'surface': return renderSurface(el, view);
        case 'parametric_curve': return renderParametricCurve(el, view);
        case 'parametric_surface': return renderParametricSurface(el, view);
        case 'sphere': return renderSphere(el, view);
        case 'ellipsoid': return renderEllipsoid(el, view);
        case 'vectors': return renderVectors(el, view);
        case 'vector_field': return renderVectorField(el, view);
        case 'plane': return renderPlane(el, view);
        case 'polygon': return renderPolygon(el, view);
        case 'cylinder': return renderCylinder(el, view);
        case 'text': return renderText(el, view);
        case 'animated_vector': return renderAnimatedVector(el, view);
        case 'animated_line': return renderAnimatedLine(el, view);
        case 'animated_point': return renderAnimatedPoint(el, view);
        case 'animated_cylinder': return renderAnimatedCylinder(el, view);
        case 'animated_polygon': return renderAnimatedPolygon(el, view);
        case 'animated_curve': return renderAnimatedCurve(el, view);
        default:
            console.warn('Unknown element type:', el.type);
            return null;
    }
}

// ----- Scene Loader -----
function loadScene(spec) {
    // Clear MathBox elements
    const root = mathbox.select('*');
    if (root) root.remove();

    // Clear 3D arrow meshes
    for (const entry of arrowMeshes) {
        three.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
    }
    arrowMeshes = [];
    axisLineNodes = [];
    vectorLineNodes = [];
    lineNodes = [];
    for (const m of planeMeshes) { three.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    planeMeshes = [];
    pointNodes = [];
    _planeMeshSerial = 0;

    clearLabels();
    followCamState = null;
    if (controls && followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(controls, 'enableDamping')) {
            controls.enableDamping = followCamSavedControls.enableDamping;
            if (Number.isFinite(followCamSavedControls.dampingFactor)) {
                controls.dampingFactor = followCamSavedControls.dampingFactor;
            }
        }
    }
    followCamSavedControls = null;
    updateFollowAngleLockButtonState();
    for (const k in animatedElementPos) delete animatedElementPos[k];
    // Scene reload performs a full animation lifecycle reset.
    activeAnimExprs = [];
    activeAnimUpdaters = [];
    sceneStartTime = performance.now();
    clearWorldStarfield();
    clearWorldSkybox();
    currentSpec = spec;
    _setActiveSceneFunctions(spec);
    _setActiveVirtualTimeExpr(spec, -1);
    updateTitle(spec);
    updateExplanationPanel(spec);

    // Show/hide empty state
    const emptyState = document.getElementById('empty-state');
    if (!spec || !spec.elements || spec.elements.length === 0) {
        currentRange = [[-5, 5], [-5, 5], [-5, 5]];
        currentScale = [1, 1, 1];
        buildCameraButtons(spec);
        emptyState.style.display = 'block';
        const view = mathbox.cartesian({
            range: currentRange,
            scale: currentScale,
        });
        renderGrid({ plane: 'xz', color: [0.3, 0.3, 0.5], opacity: 0.1, divisions: 10 }, view);
        renderAxis({ axis: 'x', range: [-5, 5], color: [0.5, 0.2, 0.2], label: 'x', width: 1 }, view);
        renderAxis({ axis: 'y', range: [-5, 5], color: [0.2, 0.5, 0.2], label: 'y', width: 1 }, view);
        renderAxis({ axis: 'z', range: [-5, 5], color: [0.2, 0.2, 0.5], label: 'z', width: 1 }, view);
        buildLegend([]);
        return;
    }
    emptyState.style.display = 'none';

    // Store range/scale for coordinate conversion (must be set before buildCameraButtons which calls dataToWorld)
    currentRange = spec.range || [[-5, 5], [-5, 5], [-5, 5]];
    currentScale = spec.scale || [1, 1, 1];
    configureWorldStarfield(spec);
    buildCameraButtons(spec);

    const view = mathbox.cartesian({
        range: currentRange,
        scale: currentScale,
    });

    for (const el of spec.elements) {
        try {
            renderElement(el, view);
        } catch (e) {
            console.error('Error rendering element:', el, e);
        }
    }

    buildLegend(spec.elements);

    if (spec.camera) {
        const up = (spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3)
            ? spec.camera.up
            : ((spec.cameraUp && Array.isArray(spec.cameraUp) && spec.cameraUp.length === 3)
                ? spec.cameraUp
                : [0, 1, 0]);
        camera.up.set(up[0], up[1], up[2]);
        const pos = dataCameraToWorld(spec.camera.position || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld(spec.camera.target || DEFAULT_CAMERA.target);
        camera.position.set(pos[0], pos[1], pos[2]);
        if (controls) {
            controls.target.set(tgt[0], tgt[1], tgt[2]);
            controls.update();
        }
    }
}

// ----- Built-in Scenes Dropdown -----
async function loadBuiltinScenesList() {
    try {
        const resp = await fetch('/api/scenes', { cache: 'no-store' });
        const data = await resp.json();
        const menu = document.getElementById('scenes-menu');
        menu.innerHTML = '';
        if (data.scenes && data.scenes.length > 0) {
            for (const name of data.scenes) {
                const item = document.createElement('div');
                item.className = 'scene-item';
                item.textContent = name.replace(/-/g, ' ');
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadBuiltinScene(name);
                });
                menu.appendChild(item);
            }
        } else {
            const item = document.createElement('div');
            item.className = 'scene-item';
            item.textContent = '(no scenes available)';
            item.style.opacity = '0.5';
            menu.appendChild(item);
        }
    } catch (e) {
        console.error('Failed to load scenes list:', e);
    }
}

async function loadBuiltinScene(name) {
    try {
        const resp = await fetch('/scenes/' + encodeURIComponent(name), { cache: 'no-store' });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} loading scene '${name}'`);
        }
        const spec = await resp.json();
        currentSceneSourceLabel = `${name}.json`;
        currentSceneSourcePath = `/scenes/${name}`;
        // Force a full re-init path so selecting from scenes always reloads.
        stopAutoPlay();
        loadLesson(spec);
        updateSceneUrl({ builtin: name });
        document.getElementById('scenes-menu').classList.remove('open');
        return true;
    } catch (e) {
        console.error('Failed to load scene:', name, e);
        return false;
    }
}

async function loadSceneFromPath(path) {
    const resp = await fetch('/api/scene_file?path=' + encodeURIComponent(path), { cache: 'no-store' });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} loading scene file`);
    }
    const data = await resp.json();
    if (!data || typeof data.spec !== 'object') {
        throw new Error('Invalid scene payload');
    }
    currentSceneSourceLabel = data.label || path.split(/[\\/]/).pop() || path;
    currentSceneSourcePath = data.path || path;
    stopAutoPlay();
    loadLesson(data.spec);
    updateSceneUrl({ path: currentSceneSourcePath });
}

function updateSceneUrl(opts = {}) {
    const url = new URL(window.location.href);
    if (opts.builtin) {
        url.searchParams.set('builtin', opts.builtin);
        url.searchParams.delete('scene');
    } else if (opts.path) {
        url.searchParams.set('scene', opts.path);
        url.searchParams.delete('builtin');
    } else {
        url.searchParams.delete('scene');
        url.searchParams.delete('builtin');
    }
    window.history.replaceState({}, '', url.toString());
}

async function loadInitialSceneFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const builtin = params.get('builtin');
    const scenePath = params.get('scene');
    if (builtin) {
        const loaded = await loadBuiltinScene(builtin);
        if (loaded) return;
    }
    if (!scenePath) {
        loadScene(null);
        return;
    }
    try {
        await loadSceneFromPath(scenePath);
    } catch (e) {
        console.error('Failed to load initial scene:', scenePath, e);
        loadScene(null);
    }
}

// ----- Drag and Drop -----
function setupDragDrop() {
    const viewport = document.getElementById('viewport');
    const overlay = document.getElementById('drop-overlay');

    viewport.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('active');
    });

    viewport.addEventListener('dragleave', (e) => {
        if (e.relatedTarget && viewport.contains(e.relatedTarget)) return;
        overlay.classList.remove('active');
    });

    viewport.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('active');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const spec = JSON.parse(ev.target.result);
                    currentSceneSourceLabel = file.name || '';
                    currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || '';
                    loadLesson(spec);
                    if (currentSceneSourcePath) updateSceneUrl({ path: currentSceneSourcePath });
                } catch (err) {
                    console.error('Invalid JSON:', err);
                }
            };
            reader.readAsText(file);
        }
    });
}

// ----- File Picker -----
function setupFilePicker() {
    const btn = document.getElementById('btn-load');
    const input = document.getElementById('file-input');

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const spec = JSON.parse(ev.target.result);
                    currentSceneSourceLabel = file.name || '';
                    currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || '';
                    loadLesson(spec);
                    if (currentSceneSourcePath) updateSceneUrl({ path: currentSceneSourcePath });
                } catch (err) {
                    console.error('Invalid JSON:', err);
                }
            };
            reader.readAsText(file);
        }
        input.value = '';
    });
}

// ----- Scenes Dropdown Toggle -----
function setupScenesDropdown() {
    const btn = document.getElementById('btn-scenes');
    const menu = document.getElementById('scenes-menu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        menu.classList.remove('open');
    });
}

// ----- Follow-Cam System -----
// A "follow" camera view tracks an animated element in real-time.
// In scene JSON, a view entry may have:
//   { "name": "Ride Along", "follow": "person_walk", "offset": [0, -30, 10] }
// The camera will be placed at the world position of the element's tip plus
// the given data-space offset, looking at the element position.

function findElementSpecById(id) {
    if (!currentSpec) return null;
    // Search base elements
    for (const el of (currentSpec.elements || [])) {
        if (el.id === id) return el;
    }
    // Search step add arrays (lessons)
    for (const step of (currentSpec.steps || [])) {
        for (const el of (step.add || [])) {
            if (el.id === id) return el;
        }
    }
    // Also search lesson scenes
    for (const scene of (lessonSpec && lessonSpec.scenes || [])) {
        for (const el of (scene.elements || [])) {
            if (el.id === id) return el;
        }
        for (const step of (scene.steps || [])) {
            for (const el of (step.add || [])) {
                if (el.id === id) return el;
            }
        }
    }
    return null;
}

function activateFollowCam(viewSpec) {
    // follow can be a string or array of strings (tried in order)
    const followTargets = Array.isArray(viewSpec.follow) ? viewSpec.follow : [viewSpec.follow];
    const offset = viewSpec.offset || [0, 0, 30]; // data-space offset

    const normalizeExprTriplet = (triplet) => {
        if (!Array.isArray(triplet) || triplet.length !== 3) return null;
        return triplet.map(v => (typeof v === 'number' ? String(v) : v));
    };

    // Find element spec for expressions — skip elements with no usable expression.
    let el = null;
    for (const tid of followTargets) {
        const candidate = findElementSpecById(tid);
        if (!candidate) continue;
        const hasExpr = normalizeExprTriplet(candidate.expr || candidate.toExpr) !== null
            || (Array.isArray(candidate.points) && candidate.points.length > 0);
        if (hasExpr) { el = candidate; break; }
    }
    if (!el) {
        console.warn('follow-cam: no element with a valid expression found for targets:', followTargets);
        return;
    }

    // Support animated_vector/animated_point style (expr/toExpr)
    // and animated_line style (points: [[x,y,z], ...]).
    let exprStrings = normalizeExprTriplet(el.expr || el.toExpr);
    let fromExprStrings = normalizeExprTriplet(el.fromExpr);
    if (!exprStrings && Array.isArray(el.points) && el.points.length > 0) {
        exprStrings = normalizeExprTriplet(el.points[0]);
        if (el.points.length > 1) fromExprStrings = normalizeExprTriplet(el.points[1]);
    }
    if (!exprStrings) {
        console.warn('follow-cam: element has no expr:', el.id);
        return;
    }
    let compiledExprs, compiledFromExprs = null;
    try {
        compiledExprs = exprStrings.map(e => compileExpr(e));
    } catch (err) {
        console.warn('follow-cam: expr compile error', err);
        return;
    }
    if (Array.isArray(fromExprStrings) && fromExprStrings.length === 3) {
        try {
            compiledFromExprs = fromExprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('follow-cam: fromExpr compile error', err);
        }
    }
    // Parse the up vector for the view
    const up = Array.isArray(viewSpec.up) ? viewSpec.up.slice(0, 3) : sceneUp.slice(0, 3);
    const angleLockAxisData = (Array.isArray(viewSpec.angleLockAxis) && viewSpec.angleLockAxis.length === 3)
        ? viewSpec.angleLockAxis.slice(0, 3)
        : (Array.isArray(currentSpec && currentSpec.angleLockAxis) && currentSpec.angleLockAxis.length === 3)
            ? currentSpec.angleLockAxis.slice(0, 3)
            : sceneUp.slice(0, 3);
    const angleLockDirectionTargets = (Array.isArray(viewSpec.angleLockDirection) && viewSpec.angleLockDirection.length === 2)
        ? viewSpec.angleLockDirection.slice(0, 2)
        : null;
    const angleLockDirectionVectorTargets = (typeof viewSpec.angleLockDirection === 'string' && viewSpec.angleLockDirection.trim())
        ? [viewSpec.angleLockDirection.trim()]
        : null;
    const angleLockVectorTargets = Array.isArray(viewSpec.angleLockVector)
        ? viewSpec.angleLockVector.slice()
        : (typeof viewSpec.angleLockVector === 'string' && viewSpec.angleLockVector.trim())
            ? [viewSpec.angleLockVector.trim()]
            : null;
    const resolvedAngleLockVectorTargets = angleLockVectorTargets || angleLockDirectionVectorTargets;

    // Determine initial target position
    let initDataPos;
    const freshEntry = _getFreshAnimEntry(followTargets);
    if (freshEntry) {
        initDataPos = freshEntry.pos;
    } else {
        try {
            initDataPos = compiledExprs.map(fn => evalExpr(fn, 0));
        } catch (err) {
            initDataPos = [0, 0, 0];
        }
    }
    const initTargetWorld = dataToWorld(initDataPos);
    const initCamDataPos = [
        initDataPos[0] + offset[0],
        initDataPos[1] + offset[1],
        initDataPos[2] + offset[2],
    ];
    const initCamWorld = dataToWorld(initCamDataPos);

    // Place camera at initial position
    if (camera && controls) {
        camera.position.set(initCamWorld[0], initCamWorld[1], initCamWorld[2]);
        controls.target.set(initTargetWorld[0], initTargetWorld[1], initTargetWorld[2]);
        camera.up.copy(normalizeUpVector(up));
        camera.lookAt(controls.target);
        controls.update();
    }

    // Build optional angle-lock direction evaluators so direction sampling uses one shared time base.
    let directionEval = null;
    if (resolvedAngleLockVectorTargets) {
        for (const vid of resolvedAngleLockVectorTargets) {
            const vel = findElementSpecById(vid);
            if (!vel) continue;
            const toStr = normalizeExprTriplet(vel.expr || vel.toExpr)
                || (Array.isArray(vel.points) && vel.points.length > 0 ? normalizeExprTriplet(vel.points[0]) : null);
            const fromStr = normalizeExprTriplet(vel.fromExpr)
                || (Array.isArray(vel.points) && vel.points.length > 1 ? normalizeExprTriplet(vel.points[1]) : null)
                || ['0', '0', '0'];
            if (!toStr) continue;
            try {
                const toFns = toStr.map(e => compileExpr(e));
                const fromFns = fromStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec) {
                        const to = toFns.map(fn => evalExpr(fn, tSec));
                        const from = fromFns.map(fn => evalExpr(fn, tSec));
                        const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
                        const len = d.length();
                        return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
                    }
                };
                break;
            } catch (err) { /* try next source */ }
        }
    }
    if (!directionEval && angleLockDirectionTargets) {
        const aEl = findElementSpecById(angleLockDirectionTargets[0]);
        const bEl = findElementSpecById(angleLockDirectionTargets[1]);
        const aStr = aEl ? (normalizeExprTriplet(aEl.expr || aEl.toExpr)
            || (Array.isArray(aEl.points) && aEl.points.length > 0 ? normalizeExprTriplet(aEl.points[0]) : null)) : null;
        const bStr = bEl ? (normalizeExprTriplet(bEl.expr || bEl.toExpr)
            || (Array.isArray(bEl.points) && bEl.points.length > 0 ? normalizeExprTriplet(bEl.points[0]) : null)) : null;
        if (aStr && bStr) {
            try {
                const aFns = aStr.map(e => compileExpr(e));
                const bFns = bStr.map(e => compileExpr(e));
                directionEval = {
                    evalDir(tSec) {
                        const a = aFns.map(fn => evalExpr(fn, tSec));
                        const b = bFns.map(fn => evalExpr(fn, tSec));
                        const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
                        const len = d.length();
                        return len > 1e-8 ? d.multiplyScalar(1 / len) : null;
                    }
                };
            } catch (err) { /* fall back to live tracking */ }
        }
    }

    followCamState = {
        followTargets,
        offset,
        compiledExprs,
        compiledFromExprs,
        up,
        exprStrings,
        fromExprStrings: fromExprStrings || null,
        lastTargetWorld: new THREE.Vector3(...initTargetWorld),
        axisWorld: normalizeUpVector(angleLockAxisData).clone().normalize(),
        axisCenterWorld: new THREE.Vector3(...dataToWorld([0, 0, 0])),
        vectorTargets: resolvedAngleLockVectorTargets,
        directionTargets: angleLockDirectionTargets,
        lastDirectionWorld: _getDirectionWorldFromVectorTargets(resolvedAngleLockVectorTargets)
            || _getDirectionWorldFromTargets(angleLockDirectionTargets)
            || _computeDerivedDirectionWorld(followTargets),
        directionEval,
        refStartTime: (freshEntry && Number.isFinite(freshEntry.startTime)) ? freshEntry.startTime : performance.now(),
        viewKey: (viewSpec && viewSpec._viewKey) ? viewSpec._viewKey : null,
    };
    followCamStartTime = performance.now();
    console.log('🎥 follow-cam activated for targets:', followTargets);
    if (controls && Object.prototype.hasOwnProperty.call(controls, 'enableDamping')) {
        followCamSavedControls = {
            enableDamping: !!controls.enableDamping,
            dampingFactor: Number.isFinite(controls.dampingFactor) ? controls.dampingFactor : 0,
        };
        controls.enableDamping = false;
    }
    updateFollowAngleLockButtonState();
}

function deactivateFollowCam() {
    if (!followCamState) return;
    followCamState = null;
    if (controls && followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(controls, 'enableDamping')) {
            controls.enableDamping = followCamSavedControls.enableDamping;
            if (Number.isFinite(followCamSavedControls.dampingFactor)) {
                controls.dampingFactor = followCamSavedControls.dampingFactor;
            }
        }
    }
    followCamSavedControls = null;
    console.log('🎥 follow-cam deactivated');
    updateFollowAngleLockButtonState();
}

// Returns the freshest animatedElementPos entry among the given target IDs (within 500ms), or null.
function _getFreshAnimEntry(targets) {
    let best = null;
    for (const tid of targets) {
        const entry = animatedElementPos[tid];
        if (entry && performance.now() - entry.time < 500) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

// Returns the newest animatedElementPos entry among target IDs without any age cutoff.
function _getLatestAnimEntry(targets) {
    let best = null;
    for (const tid of targets) {
        const entry = animatedElementPos[tid];
        if (entry) {
            if (!best || entry.time > best.time) best = entry;
        }
    }
    return best;
}

// Compute the world-space direction of the derived segment for angle-lock tracking.
// Uses the same FROM/TO logic as _computeDerivedTargetPos.
// Returns a normalized THREE.Vector3, or null if unavailable/degenerate.
function _computeDerivedDirectionWorld(targets) {
    if (!Array.isArray(targets) || targets.length < 2) return null;
    const first = animatedElementPos[targets[0]];
    const last  = animatedElementPos[targets[targets.length - 1]];
    if (!first || !last) return null;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        fromPos = first.from; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        fromPos = first.pos; toPos = last.pos;
    } else {
        const v1d = [first.pos[0]-first.from[0], first.pos[1]-first.from[1], first.pos[2]-first.from[2]];
        const v2d = [last.pos[0]-last.from[0],   last.pos[1]-last.from[1],   last.pos[2]-last.from[2]];
        fromPos = first.from;
        toPos   = [first.from[0]+v1d[0]+v2d[0], first.from[1]+v1d[1]+v2d[1], first.from[2]+v1d[2]+v2d[2]];
    }

    const fromW = new THREE.Vector3(...dataToWorld(fromPos));
    const toW   = new THREE.Vector3(...dataToWorld(toPos));
    const dir = toW.sub(fromW);
    return dir.length() > 1e-6 ? dir.normalize() : null;
}

// Compute the camera target position from a follow target spec.
// Single target → follow .pos (point position or vector tip).
// Two targets (first + last only, intermediates ignored):
//   [p1, p2] → midpoint of segment p1→p2
//   [v,  p]  → midpoint of segment v.base→p
//   [p,  v]  → midpoint of segment p→v.tip
//   [v1, v2] → midpoint of summed vector (v1.base → v1.base + v1.dir + v2.dir)
// Returns null when entries are unavailable.
function _computeDerivedTargetPos(targets) {
    if (!Array.isArray(targets) || targets.length === 0) return null;
    if (targets.length === 1) {
        const e = animatedElementPos[targets[0]];
        return e ? e.pos : null;
    }
    const first = animatedElementPos[targets[0]];
    const last  = animatedElementPos[targets[targets.length - 1]];
    if (!first && !last) return null;
    if (!first) return last.pos;
    if (!last)  return first.pos;

    const firstIsVec = first.from !== undefined;
    const lastIsVec  = last.from  !== undefined;
    let fromPos, toPos;

    if (!firstIsVec && !lastIsVec) {
        // [p1, p2]: segment from p1 to p2
        fromPos = first.pos; toPos = last.pos;
    } else if (firstIsVec && !lastIsVec) {
        // [v, p]: from base of v to p
        fromPos = first.from; toPos = last.pos;
    } else if (!firstIsVec && lastIsVec) {
        // [p, v]: from p to tip of v
        fromPos = first.pos; toPos = last.pos;
    } else {
        // [v1, v2]: summed vector — v1.base → v1.base + v1.dir + v2.dir
        const v1d = [first.pos[0]-first.from[0], first.pos[1]-first.from[1], first.pos[2]-first.from[2]];
        const v2d = [last.pos[0]-last.from[0],   last.pos[1]-last.from[1],   last.pos[2]-last.from[2]];
        fromPos = first.from;
        toPos   = [first.from[0]+v1d[0]+v2d[0], first.from[1]+v1d[1]+v2d[1], first.from[2]+v1d[2]+v2d[2]];
    }
    return [
        (fromPos[0] + toPos[0]) / 2,
        (fromPos[1] + toPos[1]) / 2,
        (fromPos[2] + toPos[2]) / 2,
    ];
}

function _getDirectionWorldFromTargets(targetPair) {
    if (!Array.isArray(targetPair) || targetPair.length !== 2) return null;
    const fromEntry = _getFreshAnimEntry([targetPair[0]]);
    const toEntry = _getFreshAnimEntry([targetPair[1]]);
    if (!fromEntry || !toEntry) return null;
    const fromWorld = new THREE.Vector3(...dataToWorld(fromEntry.pos));
    const toWorld = new THREE.Vector3(...dataToWorld(toEntry.pos));
    const dir = toWorld.sub(fromWorld);
    const len = dir.length();
    if (len < 1e-8) return null;
    return dir.multiplyScalar(1 / len);
}

function _getDirectionWorldFromVectorTargets(vectorTargets) {
    if (!Array.isArray(vectorTargets) || vectorTargets.length === 0) return null;
    for (const vid of vectorTargets) {
        const entry = _getFreshAnimEntry([vid]);
        if (!entry) continue;
        if (Array.isArray(entry.from) && entry.from.length === 3 && Array.isArray(entry.to) && entry.to.length === 3) {
            const fromWorld = new THREE.Vector3(...dataToWorld(entry.from));
            const toWorld = new THREE.Vector3(...dataToWorld(entry.to));
            const dir = toWorld.sub(fromWorld);
            const len = dir.length();
            if (len > 1e-8) return dir.multiplyScalar(1 / len);
        }
    }
    return null;
}

function updateFollowCam() {
    if (!followCamState || !camera || !controls) return;
    const { followTargets, compiledExprs } = followCamState;

    let targetDataPos;
    const tSecRef = (performance.now() - (followCamState.refStartTime || followCamStartTime)) / 1000;
    // 1) Non angle-lock mode: follow the rendered object's live position directly.
    // This keeps camera and visible target in the same frame source (avoids hitching).
    // 2) Angle-lock mode: prefer shared expression-time sampling for coherence.
    const latest = _getLatestAnimEntry(followTargets);
    if (!followCamAngleLock && latest) {
        targetDataPos = latest.pos;
    }
    if (!targetDataPos && followCamAngleLock && compiledExprs) {
        try {
            targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSecRef));
        } catch (err) { targetDataPos = null; }
    }
    if (!targetDataPos && latest) {
        targetDataPos = latest.pos;
    }
    if (!targetDataPos) {
        // 2. Fall back: evaluate expression at the element's own animation clock
        //    so phase matches what the element would show if still running.
        let staleEntry = null;
        for (const tid of followTargets) {
            if (animatedElementPos[tid]) { staleEntry = animatedElementPos[tid]; break; }
        }
        if (staleEntry && compiledExprs) {
            const tSec = (performance.now() - staleEntry.startTime) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else if (compiledExprs) {
            // No entry at all yet — evaluate at follow-cam's own time (best we can do)
            const tSec = (performance.now() - followCamStartTime) / 1000;
            try { targetDataPos = compiledExprs.map(fn => evalExpr(fn, tSec)); }
            catch (err) { return; }
        } else {
            return;
        }
    }

    const newTargetWorld = new THREE.Vector3(...dataToWorld(targetDataPos));
    const oldTargetWorld = followCamState.lastTargetWorld.clone();
    const delta = newTargetWorld.clone().sub(oldTargetWorld);

    // Translate both camera and orbit target by how much the tracked point moved.
    // This preserves whatever zoom/pan/rotate the user has applied.
    camera.position.add(delta);
    controls.target.copy(newTargetWorld);
    if (followCamAngleLock) {
        const axis = followCamState.axisWorld;
        const center = followCamState.axisCenterWorld;
        const oldDir = followCamState.lastDirectionWorld ? followCamState.lastDirectionWorld.clone() : null;
        const newDir = (followCamState.directionEval && typeof followCamState.directionEval.evalDir === 'function')
            ? followCamState.directionEval.evalDir(tSecRef)
            : (_computeDerivedDirectionWorld(followTargets)
                || _getDirectionWorldFromVectorTargets(followCamState.vectorTargets)
                || _getDirectionWorldFromTargets(followCamState.directionTargets));
        const prevBase = oldDir || oldTargetWorld.clone().sub(center);
        const nextBase = newDir || newTargetWorld.clone().sub(center);
        const prevProj = prevBase.sub(axis.clone().multiplyScalar(prevBase.dot(axis)));
        const nextProj = nextBase.sub(axis.clone().multiplyScalar(nextBase.dot(axis)));
        const prevLen = prevProj.length();
        const nextLen = nextProj.length();
        if (prevLen > 1e-6 && nextLen > 1e-6) {
            prevProj.multiplyScalar(1 / prevLen);
            nextProj.multiplyScalar(1 / nextLen);
            const cross = new THREE.Vector3().crossVectors(prevProj, nextProj);
            const sinA = axis.dot(cross);
            const cosA = THREE.MathUtils.clamp(prevProj.dot(nextProj), -1, 1);
            const dAngle = Math.atan2(sinA, cosA);
            if (Number.isFinite(dAngle) && Math.abs(dAngle) > 1e-7) {
                const offset = camera.position.clone().sub(newTargetWorld);
                offset.applyAxisAngle(axis, dAngle);
                camera.position.copy(newTargetWorld).add(offset);
                camera.up.applyAxisAngle(axis, dAngle).normalize();
            }
        }
        if (newDir) followCamState.lastDirectionWorld = newDir;
    }
    camera.lookAt(controls.target);

    followCamState.lastTargetWorld.copy(newTargetWorld);
}

// ----- Dynamic Camera Buttons -----
function buildCameraButtons(spec) {
    const container = document.getElementById('camera-buttons');
    container.innerHTML = '';
    CAMERA_VIEWS = {};
    sceneUp = (spec && Array.isArray(spec.cameraUp) && spec.cameraUp.length === 3)
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
            // Follow-cam view: dynamically tracks an animated element
            btn.classList.add('cam-btn-follow');
            btn.addEventListener('click', () => {
                // Toggle: clicking active follow-cam deactivates it
                if (followCamState && followCamState.viewKey === key) {
                    deactivateFollowCam();
                    document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                    return;
                }
                document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activateFollowCam({ ...v, _viewKey: key });
            });
        } else {
            CAMERA_VIEWS[key] = {
                position: dataCameraToWorld(v.position),
                target: dataCameraToWorld(v.target || [0, 0, 0]),
                up: Array.isArray(v.up) ? v.up.slice(0, 3) : sceneUp.slice(0, 3),
            };
            btn.addEventListener('click', (e) => {
                deactivateFollowCam();
                if (e.shiftKey) animateCamera(key, 0);
                else if (e.altKey) animateCamera(key, 200);
                else animateCamera(key, 800);
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
        const activeScene = (lessonSpec && currentSceneIndex >= 0 && lessonSpec.scenes)
            ? lessonSpec.scenes[currentSceneIndex]
            : currentSpec;
        const camSpec = resolveEffectiveStepCamera(activeScene, currentStepIndex)
            || (currentSpec && currentSpec.camera)
            || null;
        const pos = dataCameraToWorld((camSpec && camSpec.position) || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld((camSpec && camSpec.target) || DEFAULT_CAMERA.target);
        CAMERA_VIEWS.reset = {
            position: pos,
            target: tgt,
            up: (camSpec && Array.isArray(camSpec.up))
                ? camSpec.up.slice(0, 3)
                : [0, 1, 0],
        };
        if (e.shiftKey) animateCamera('reset', 0);
        else if (e.altKey) animateCamera('reset', 200);
        else animateCamera('reset', 800);
    });
    container.appendChild(resetBtn);
    updateFollowAngleLockButtonState();
}

// ----- Expression Trust System -----

function _scanSpecForUnsafeJs(spec) {
    // Scan for JS-only patterns and collect issues with their JSON paths.
    // Only inspects known expression-bearing keys to avoid false positives from
    // natural-language text that contains 'let', '=>', 'return', etc.
    // Also extracts {{...}} blocks from content strings.
    const issues = [];
    const EXPR_KEYS = new Set(['expr', 'x', 'y', 'z', 'expression', 'fx', 'fy', 'fz']);
    const _TEMPLATE_RE = /\{\{([\s\S]*?)\}\}/g;
    function walk(obj, parentKey, path) {
        if (typeof obj === 'string') {
            if (parentKey && EXPR_KEYS.has(parentKey) && _JS_ONLY_RE.test(obj)) {
                issues.push({ path, expr: obj, type: 'expr' });
            }
            return;
        }
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walk(item, parentKey, `${path}[${i}]`));
            return;
        }
        if (obj && typeof obj === 'object') {
            Object.entries(obj).forEach(([k, v]) => {
                const childPath = path ? `${path}.${k}` : k;
                if (k === 'content' && typeof v === 'string') {
                    let m;
                    _TEMPLATE_RE.lastIndex = 0;
                    while ((m = _TEMPLATE_RE.exec(v)) !== null) {
                        if (_JS_ONLY_RE.test(m[1])) {
                            issues.push({ path: childPath, expr: m[1].trim(), type: 'template' });
                        }
                    }
                }
                walk(v, k, childPath);
            });
        }
    }
    walk(spec, null, '');
    _sceneJsIssues = issues;
    return issues.length > 0;
}

function _showTrustDialog(explanation, imports) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('trust-dialog-overlay');
        const body = document.getElementById('trust-dialog-body');
        const allowBtn = document.getElementById('trust-btn-allow');
        const denyBtn = document.getElementById('trust-btn-deny');
        if (!overlay) { resolve(false); return; }

        body.innerHTML = '';
        const explanationEl = document.createElement('p');
        explanationEl.textContent = explanation;
        body.appendChild(explanationEl);

        if (Array.isArray(imports) && imports.length > 0) {
            const domainNote = document.createElement('div');
            domainNote.className = 'trust-dialog-domains';
            const label = document.createElement('span');
            label.textContent = 'Built-in domain libraries loaded:';
            domainNote.appendChild(label);
            const pills = document.createElement('span');
            pills.className = 'trust-dialog-domain-pills';
            imports.forEach(name => {
                const pill = document.createElement('span');
                pill.className = 'trust-dialog-domain-pill';
                pill.textContent = name;
                pills.appendChild(pill);
            });
            domainNote.appendChild(pills);
            body.appendChild(domainNote);
        }

        overlay.classList.remove('hidden');
        function cleanup(result) {
            overlay.classList.add('hidden');
            allowBtn.removeEventListener('click', onAllow);
            denyBtn.removeEventListener('click', onDeny);
            resolve(result);
        }
        function onAllow() { cleanup(true); }
        function onDeny() { cleanup(false); }
        allowBtn.addEventListener('click', onAllow);
        denyBtn.addEventListener('click', onDeny);
    });
}

function _updateJsTrustPill() {
    const pill = document.getElementById('js-trust-pill');
    const icon = document.getElementById('js-trust-pill-icon');
    const label = document.getElementById('js-trust-pill-label');
    if (!pill) return;
    if (_sceneJsTrustState === 'trusted') {
        pill.className = 'js-trusted';
        icon.textContent = '⚡';
        label.textContent = 'Native JS';
        pill.classList.remove('hidden');
    } else if (_sceneJsTrustState === 'untrusted') {
        pill.className = 'js-untrusted';
        icon.textContent = '⚠';
        label.textContent = 'JS disabled';
        pill.classList.remove('hidden');
    } else {
        pill.classList.add('hidden');
    }
    // Clicking the pill opens the JSON viewer and jumps straight to the issues report.
    const pillClickable = _sceneIsUnsafe || _sceneJsIssues.length > 0;
    pill.onclick = pillClickable ? () => {
        document.getElementById('btn-show-json').click();
        _toggleJsIssuesPanel(document.getElementById('json-viewer-issues'));
    } : null;
    pill.style.cursor = pillClickable ? 'pointer' : '';
}

// ----- Lesson Navigation -----

function isLessonFormat(spec) {
    return spec && Array.isArray(spec.scenes) && spec.scenes.length > 0;
}

async function loadLesson(spec) {
    // --- Trust check ---
    // If "unsafe":true, treat as unsafe immediately (no scan needed).
    // Otherwise scan expression fields; only ask if JS patterns are found.
    // The unsafe_explanation is shown in the dialog in either case.
    _sceneJsTrustState = null;
    _sceneJsIssues = [];
    _sceneIsUnsafe = false;
    _sceneUnsafeExplanation = '';
    if (spec) {
        _sceneIsUnsafe = spec.unsafe === true;
        _sceneUnsafeExplanation = spec.unsafe_explanation || '';
        const scanned = _scanSpecForUnsafeJs(spec);
        const needsDialog = _sceneIsUnsafe || scanned;
        if (needsDialog) {
            const explanation = spec.unsafe_explanation ||
                'This scene contains native JavaScript expressions that execute in your browser.\nAllow execution only if you trust the source of this file.';
            const imports = Array.isArray(spec.import) ? spec.import : [];
            const trusted = await _showTrustDialog(explanation, imports);
            _sceneJsTrustState = trusted ? 'trusted' : 'untrusted';
        }
    }
    _updateJsTrustPill();

    // Set starter chips so users have an obvious entry point into chat
    if (typeof setPresetPrompts === 'function') {
        if (spec) {
            setPresetPrompts(['Explain this scene', 'Walk me through this', 'What\'s the key insight?']);
        } else {
            setPresetPrompts([]);
        }
    }

    if (!isLessonFormat(spec)) {
        // Legacy single-scene format or null — load directly
        lessonSpec = null;
        currentSceneIndex = -1;
        currentStepIndex = -1;
        visitedSteps = new Set();
        stopAutoPlay();
        _activeDomainFunctions = {};
        await _importDomains(spec && spec.import);
        updateDockVisibility();
        loadScene(spec);
        return;
    }
    lessonSpec = spec;
    currentSceneIndex = -1;
    currentStepIndex = -1;
    visitedSteps = new Set();
    stopAutoPlay();
    await _importDomains(spec.import);
    buildSceneTree(spec);
    updateDockVisibility();
    navigateTo(0, -1);
}

function buildSceneTree(spec) {
    const tree = document.getElementById('scene-tree');
    tree.innerHTML = '';
    if (!spec || !spec.scenes) return;

    spec.scenes.forEach((scene, i) => {
        const sceneDiv = document.createElement('div');
        sceneDiv.className = 'tree-scene';
        sceneDiv.dataset.sceneIdx = i;

        const header = document.createElement('div');
        header.className = 'tree-scene-header';

        const arrow = document.createElement('span');
        arrow.className = 'tree-scene-arrow';
        arrow.textContent = '\u25B6'; // ▶
        header.appendChild(arrow);

        const title = document.createElement('span');
        title.innerHTML = renderKaTeX(scene.title || ('Scene ' + (i + 1)), false);
        header.appendChild(title);

        header.addEventListener('click', (e) => {
            // Toggle expand if clicking arrow area, otherwise navigate
            const rect = arrow.getBoundingClientRect();
            if (e.clientX < rect.right + 4) {
                sceneDiv.classList.toggle('expanded');
                console.log('🌳 Tree: toggled expand scene', i);
            } else {
                sceneDiv.classList.add('expanded');
                console.log('🌳 Tree: navigating to scene', i, 'step -1');
                navigateTo(i, -1);
            }
        });

        sceneDiv.appendChild(header);

        if (scene.steps && scene.steps.length > 0) {
            const stepsDiv = document.createElement('div');
            stepsDiv.className = 'tree-steps';

            scene.steps.forEach((step, j) => {
                const stepDiv = document.createElement('div');
                stepDiv.className = 'tree-step';
                stepDiv.dataset.sceneIdx = i;
                stepDiv.dataset.stepIdx = j;
                stepDiv.innerHTML = renderKaTeX(step.title || ('Step ' + (j + 1)), false);
                stepDiv.addEventListener('click', () => navigateTo(i, j));
                stepsDiv.appendChild(stepDiv);
            });

            sceneDiv.appendChild(stepsDiv);
        }

        tree.appendChild(sceneDiv);
    });
}

// ----- Slider System -----

function getSliderIds() {
    const ids = Object.keys(sceneSliders);
    const launchIdx = ids.indexOf('h');
    const injectionIdx = ids.indexOf('h_target');
    if (launchIdx >= 0 && injectionIdx >= 0 && launchIdx !== injectionIdx - 1) {
        ids.splice(launchIdx, 1);
        const newInjectionIdx = ids.indexOf('h_target');
        ids.splice(newInjectionIdx, 0, 'h');
    }
    return ids;
}

function _sliderValueNum(id, fallback = 0) {
    const s = sceneSliders[id];
    if (!s) return fallback;
    const v = Number(s.value);
    return Number.isFinite(v) ? v : fallback;
}

// --- Orbital simulation moved to static/domains/astrodynamics/index.js ---

// Populated from _MATHJS_EXTENSIONS — do not add helpers here directly.
const _EXPR_HELPERS = { ..._MATHJS_EXTENSIONS };

// Core math/helper names for JS fallback execution.
const _CORE_MATH_NAMES = ['sin','cos','tan','asin','acos','atan','atan2','sinh','cosh','tanh',
    'abs','sqrt','cbrt','pow','exp','log','log2','log10','floor','ceil','round','trunc',
    'min','max','sign','hypot','PI','E'];

// Precomputed scope of core math functions for JS fallback expressions.
// Spread into _buildScope so IIFE-style expressions can use max/min/floor etc.
const _MATH_SCOPE = Object.fromEntries(
    _CORE_MATH_NAMES.map(n => [n, Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]])
);

const _SCENE_FN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function _isValidSceneFunctionName(name) {
    return typeof name === 'string' && _SCENE_FN_NAME_RE.test(name);
}

function _getMathNamesAndValues() {
    const names = _CORE_MATH_NAMES.slice();
    const vals = names.map(n => (Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, n) ? _EXPR_HELPERS[n] : Math[n]));
    for (const src of [_activeDomainFunctions, activeSceneExprFunctions]) {
        for (const [name, fn] of Object.entries(src || {})) {
            if (typeof fn !== 'function') continue;
            if (names.includes(name)) continue;
            names.push(name);
            vals.push(fn);
        }
    }
    return { names, vals };
}

function _buildScope(extras) {
    const scope = { ..._MATH_SCOPE, ..._EXPR_HELPERS, ..._activeDomainFunctions, ...(activeSceneExprFunctions || {}), ...extras };
    for (const [id, s] of Object.entries(sceneSliders)) scope[id] = s ? s.value : 0;
    return scope;
}

function _loadDomainScript(name) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/domains/${name}/index.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load domain: ${name}`));
        document.head.appendChild(script);
    });
}

async function _importDomains(importList) {
    _activeDomainFunctions = {};
    if (!Array.isArray(importList) || importList.length === 0) return;
    for (const name of importList) {
        if (typeof name !== 'string') continue;
        if (!window.AlgeBenchDomains._registry[name]) {
            try {
                await _loadDomainScript(name);
            } catch (err) {
                console.warn(`[domains] could not load domain "${name}":`, err);
                continue;
            }
        }
        const fns = window.AlgeBenchDomains._registry[name];
        if (fns) Object.assign(_activeDomainFunctions, fns);
    }
}

function _setActiveSceneFunctions(scene) {
    activeSceneExprFunctions = {};
    activeSceneFunctionDefs = [];
    const defs = scene && Array.isArray(scene.functions) ? scene.functions : [];
    if (!defs.length) return;

    const used = new Set();
    const normalized = [];
    for (const raw of defs) {
        if (!raw || typeof raw !== 'object') continue;
        const name = typeof raw.name === 'string' ? raw.name : raw.id;
        if (!_isValidSceneFunctionName(name)) {
            console.warn('scene.functions entry skipped (invalid name):', raw);
            continue;
        }
        if (_CORE_MATH_NAMES.includes(name) || Object.prototype.hasOwnProperty.call(_EXPR_HELPERS, name)
                || Object.prototype.hasOwnProperty.call(_activeDomainFunctions, name)) {
            console.warn('scene.functions entry skipped (reserved name):', name);
            continue;
        }
        if (used.has(name)) {
            console.warn('scene.functions entry skipped (duplicate name):', name);
            continue;
        }
        const expr = typeof raw.expr === 'string' ? raw.expr : raw.expression;
        if (typeof expr !== 'string' || !expr.trim()) {
            console.warn('scene.functions entry skipped (missing expr):', name);
            continue;
        }
        const argsRaw = Array.isArray(raw.args) ? raw.args : [];
        const args = [];
        let badArgs = false;
        for (const a of argsRaw) {
            if (!_isValidSceneFunctionName(a)) {
                badArgs = true;
                break;
            }
            if (args.includes(a)) {
                badArgs = true;
                break;
            }
            args.push(a);
        }
        if (badArgs) {
            console.warn('scene.functions entry skipped (invalid args):', name);
            continue;
        }
        normalized.push({ name, args, expr });
        used.add(name);
    }

    // Reserve names first so JS fallback compilation can reference other scene functions.
    for (const def of normalized) {
        activeSceneExprFunctions[def.name] = () => 0;
    }

    for (const def of normalized) {
        let compiled;
        try {
            compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions compile error:', def.name, err);
            compiled = _mathjs.compile('0');
        }
        activeSceneFunctionDefs.push({ ...def, compiled });
    }

    for (const def of activeSceneFunctionDefs) {
        activeSceneExprFunctions[def.name] = (...callArgs) => {
            const frame = _activeExprEvalFrame || null;
            const scope = frame && frame.extraScope && typeof frame.extraScope === 'object'
                ? { ...frame.extraScope }
                : {};
            for (let i = 0; i < def.args.length; i++) {
                scope[def.args[i]] = i < callArgs.length ? callArgs[i] : 0;
            }
            if (frame && Number.isFinite(frame.t)) scope.t = frame.t;
            if (frame && Number.isFinite(frame.u)) scope.u = frame.u;
            if (frame && Number.isFinite(frame.v)) scope.v = frame.v;
            const tEval = (frame && Number.isFinite(frame.t)) ? frame.t : 0;
            return evalExpr(def.compiled, tEval, { useVirtualTime: false, extraScope: scope });
        };
    }
}

function _recompileActiveSceneFunctions() {
    if (!Array.isArray(activeSceneFunctionDefs) || !activeSceneFunctionDefs.length) return;
    for (const def of activeSceneFunctionDefs) {
        try {
            def.compiled = compileExpr(def.expr);
        } catch (err) {
            console.warn('scene.functions recompile error:', def.name, err);
            def.compiled = _mathjs.compile('0');
        }
    }
}

function _normalizeVirtualTimeExpr(spec) {
    if (typeof spec === 'string') return spec;
    if (spec && spec.options) {
        if (typeof spec.options.expr === 'string') return spec.options.expr;
        if (typeof spec.options.scale === 'number') return `${Number(spec.options.scale)}*t`;
    }
    if (spec && typeof spec.expr === 'string') return spec.expr;
    return null;
}

function _setActiveVirtualTimeExpr(scene, stepIdx) {
    const sceneExpr = _normalizeVirtualTimeExpr(scene && scene.virtualTime);
    let stepExpr = null;
    if (scene && Array.isArray(scene.steps) && stepIdx >= 0 && scene.steps[stepIdx]) {
        stepExpr = _normalizeVirtualTimeExpr(scene.steps[stepIdx].virtualTime);
    }
    activeVirtualTimeExpr = stepExpr || sceneExpr || null;
    if (!activeVirtualTimeExpr) {
        activeVirtualTimeCompiled = null;
        return;
    }
    try {
        activeVirtualTimeCompiled = compileExpr(activeVirtualTimeExpr);
    } catch (err) {
        console.warn('virtualTime compile error:', err);
        activeVirtualTimeCompiled = null;
    }
}

function _resolveVirtualAnimTime(rawT) {
    if (!activeVirtualTimeCompiled) return rawT;
    const tauSlider = sceneSliders.tau;
    const tau = tauSlider ? Number(tauSlider.value) : rawT;
    try {
        const mapped = evalExpr(activeVirtualTimeCompiled, rawT, {
            useVirtualTime: false,
            extraScope: { tau },
        });
        return Number.isFinite(mapped) ? mapped : rawT;
    } catch (_err) {
        return rawT;
    }
}

function compileExpr(exprStr) {
    if (_JS_ONLY_RE.test(exprStr)) {
        if (_sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        // Untrusted — return no-op compiled constant
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        // math.js parse failed (e.g. .toFixed() in content template) — JS fallback
        if (_sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

function evalExpr(compiled, t, opts = {}) {
    const useVirtualTime = opts.useVirtualTime !== false;
    const evalT = useVirtualTime ? _resolveVirtualAnimTime(t) : t;
    const extraScope = (opts && typeof opts.extraScope === 'object' && opts.extraScope) ? opts.extraScope : null;
    const prevFrame = _activeExprEvalFrame;
    _activeExprEvalFrame = { t: evalT, extraScope };
    try {
        if (compiled && compiled._isFallback) {
            return compiled(_buildScope({ t: evalT, ...(extraScope || {}) }));
        }
        return compiled.evaluate(_buildScope({ t: evalT, ...(extraScope || {}) }));
    } finally {
        _activeExprEvalFrame = prevFrame;
    }
}

function compileSurfaceExpr(exprStr) {
    if (_JS_ONLY_RE.test(exprStr)) {
        if (_sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
    try {
        return _mathjs.compile(exprStr);
    } catch (_e) {
        if (_sceneJsTrustState === 'trusted') {
            const fn = Function('scope', 'with (scope) { return (' + exprStr + '); }');
            fn._isFallback = true;
            return fn;
        }
        return _mathjs.compile('0');
    }
}

function evalSurfaceExpr(compiled, u, v) {
    const prevFrame = _activeExprEvalFrame;
    _activeExprEvalFrame = {
        t: prevFrame && Number.isFinite(prevFrame.t) ? prevFrame.t : 0,
        u,
        v,
        extraScope: prevFrame && prevFrame.extraScope ? prevFrame.extraScope : null,
    };
    try {
        if (compiled && compiled._isFallback) {
            return compiled(_buildScope({ u, v }));
        }
        return compiled.evaluate(_buildScope({ u, v }));
    } finally {
        _activeExprEvalFrame = prevFrame;
    }
}

function buildSliderOverlay() {
    const overlay = document.getElementById('slider-overlay');
    if (!overlay) return;

    const ids = getSliderIds();
    if (ids.length === 0) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
        return;
    }

    overlay.innerHTML = '';

    // Restore saved position (bottom-left anchoring)
    try {
        const saved = JSON.parse(localStorage.getItem('slider-overlay-pos') || 'null');
        if (saved && saved.left != null && saved.bottom != null) {
            overlay.style.left   = saved.left   + 'px';
            overlay.style.bottom = saved.bottom + 'px';
        }
    } catch (e) { /* ignore */ }

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'slider-drag-handle';
    dragHandle.textContent = '⠿ ⠿ ⠿';
    dragHandle.addEventListener('mousedown', (e) => setupSliderDrag(e, overlay));
    overlay.appendChild(dragHandle);

    for (const id of ids) {
        const s = sceneSliders[id];
        const row = document.createElement('div');
        row.className = 'slider-row';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'slider-label';
        labelSpan.innerHTML = renderKaTeX(s.label || id, false);
        labelSpan.title = stripLatex(s.label || id);
        row.appendChild(labelSpan);

        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'slider-range';
        input.dataset.sliderId = id;
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.value = s.value;
        row.appendChild(input);

        const valSpan = document.createElement('span');
        valSpan.className = 'slider-value';
        valSpan.textContent = Number(s.value).toFixed(1);
        row.appendChild(valSpan);

        input.addEventListener('input', () => {
            s.value = parseFloat(input.value);
            valSpan.textContent = Number(s.value).toFixed(1);
            recompileActiveExprs();
            syncSliderState();
        });

        if (s.animate) {
            const playBtn = document.createElement('button');
            playBtn.className = 'slider-play-btn';
            playBtn.dataset.sliderId = id;
            const updatePlayBtn = () => {
                playBtn.textContent = s._loopPlaying ? '⏸' : '▶';
                playBtn.title = s._loopPlaying ? 'Pause animation' : 'Play animation';
            };
            s._onPlayStateChange = updatePlayBtn;
            updatePlayBtn();
            playBtn.addEventListener('click', () => {
                if (s._loopPlaying) {
                    stopSliderLoop(id);
                } else {
                    startSliderLoop(id);
                }
                updatePlayBtn();
            });
            row.appendChild(playBtn);
        }

        overlay.appendChild(row);
    }
    overlay.classList.remove('hidden');
    syncSliderState();
}

function setupSliderDrag(e, overlay) {
    e.preventDefault();
    const parent = overlay.offsetParent || document.body;
    const parentH = parent.clientHeight;
    const rect = overlay.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    // Capture starting state in bottom-left coordinate space
    _sliderDrag.active   = true;
    _sliderDrag.startX   = e.clientX;
    _sliderDrag.startY   = e.clientY;
    _sliderDrag.startLeft   = rect.left - parentRect.left;
    _sliderDrag.startBottom = parentRect.bottom - rect.bottom;

    overlay.classList.add('dragging');

    const onMove = (me) => {
        if (!_sliderDrag.active) return;
        const dx = me.clientX - _sliderDrag.startX;
        const dy = me.clientY - _sliderDrag.startY;  // positive = moved down

        let newLeft   = _sliderDrag.startLeft   + dx;
        let newBottom = _sliderDrag.startBottom - dy; // subtract: moving down reduces bottom offset

        // Clamp so panel stays within parent
        newLeft   = Math.max(0, Math.min(newLeft,   parent.clientWidth  - overlay.offsetWidth));
        newBottom = Math.max(0, Math.min(newBottom, parentH - overlay.offsetHeight));

        overlay.style.left   = newLeft   + 'px';
        overlay.style.bottom = newBottom + 'px';
    };

    const onUp = () => {
        _sliderDrag.active = false;
        overlay.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);

        // Persist position
        const newLeft   = parseFloat(overlay.style.left)   || 0;
        const newBottom = parseFloat(overlay.style.bottom) || 0;
        try {
            localStorage.setItem('slider-overlay-pos', JSON.stringify({ left: newLeft, bottom: newBottom }));
        } catch (e) { /* ignore */ }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
}

function registerSliders(sliderDefs) {
    if (!sliderDefs || !Array.isArray(sliderDefs)) return [];
    const ids = [];
    for (const def of sliderDefs) {
        // Stop any existing loop for this id before overwriting the slider state.
        // The old tick closure still holds a reference to the old object, so
        // we must stop it here — otherwise two loops run for the same slider id.
        if (sceneSliders[def.id]) stopSliderLoop(def.id);
        sceneSliders[def.id] = {
            value: def.default !== undefined ? def.default : (def.min + def.max) / 2,
            min: def.min !== undefined ? def.min : 0,
            max: def.max !== undefined ? def.max : 1,
            step: def.step !== undefined ? def.step : 0.1,
            label: def.label || def.id,
            default: def.default,
            animate: def.animate || false,
            animateMode: String(def.animateMode || def.animationMode || 'loop').toLowerCase(),
            autoplay: def.autoplay !== false,
            duration: def.duration || 3000,
            _loopPlaying: false,
            _loopRaf: null,
        };
        ids.push(def.id);
    }
    // Auto-start animated sliders unless explicitly disabled.
    for (const id of ids) {
        const s = sceneSliders[id];
        if (s && s.animate && s.autoplay) startSliderLoop(id);
    }
    return ids;
}

// ----- Slider Loop Animation -----

function startSliderLoop(id) {
    const slider = sceneSliders[id];
    if (!slider) return;
    slider._loopPlaying = true;
    if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
    const range = slider.max - slider.min;
    const period = slider.duration;
    const mode = (slider.animateMode || 'loop');
    // Resume from current position; for 'once' mode already at end, restart from beginning.
    const rawResumeT = range > 0 ? Math.max(0, Math.min(1, (slider.value - slider.min) / range)) : 0;
    const resumeT = (mode === 'once' && rawResumeT >= 1) ? 0 : rawResumeT;
    const startTime = performance.now() - resumeT * period;

    function tick(now) {
        if (!slider._loopPlaying || !sceneSliders[id]) return;
        const elapsed = (now - startTime) / period;
        let tNorm;
        if (mode === 'loop') {
            tNorm = elapsed % 1;                            // sawtooth 0→1 loop
        } else if (mode === 'once') {
            tNorm = Math.min(elapsed, 1);                   // one-shot 0→1 then stop
            if (tNorm >= 1) {
                slider._loopPlaying = false;
                if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
            }
        } else {
            const phase = elapsed % 2;                      // 0–2 repeating
            tNorm = phase < 1 ? phase : 2 - phase;         // triangle wave 0→1→0
        }
        slider.value = slider.min + tNorm * range;
        const input = document.querySelector(`input[data-slider-id="${id}"]`);
        if (input) {
            input.value = slider.value;
            const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
            if (valSpan) valSpan.textContent = Number(slider.value).toFixed(2);
        }
        refreshActiveExprsForSliderValueChange();
        if (slider._loopPlaying) {
            slider._loopRaf = requestAnimationFrame(tick);
        } else {
            slider._loopRaf = null;
        }
    }
    slider._loopRaf = requestAnimationFrame(tick);
}

function stopSliderLoop(id) {
    const slider = sceneSliders[id];
    if (!slider) return;
    slider._loopPlaying = false;
    if (slider._loopRaf) {
        cancelAnimationFrame(slider._loopRaf);
        slider._loopRaf = null;
    }
    if (typeof slider._onPlayStateChange === 'function') slider._onPlayStateChange();
}

function stopAllSliderLoops() {
    for (const id of Object.keys(sceneSliders)) stopSliderLoop(id);
}

function removeSliderIds(ids) {
    for (const id of ids) {
        stopSliderLoop(id);
        delete sceneSliders[id];
    }
    if (activeVirtualTimeExpr) {
        try {
            activeVirtualTimeCompiled = compileExpr(activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            activeVirtualTimeCompiled = null;
        }
    }
    syncSliderState();
}

function refreshActiveExprsForSliderValueChange() {
    for (const entry of activeAnimExprs) {
        if (!entry || !entry.animState || entry.animState.stopped) continue;
        if (typeof entry._rebuildFn === 'function') {
            try {
                entry._rebuildFn();
            } catch (err) {
                console.warn('Slider reactive rebuild error:', err);
            }
        }
    }
    updateInfoOverlays();
}

// Recompile all active animated_vector expressions when slider set changes
let activeAnimExprs = []; // { exprStrings, animState, updateFns }

function registerAnimExpr(entry) {
    activeAnimExprs.push(entry);
}

function unregisterAnimExpr(animState) {
    activeAnimExprs = activeAnimExprs.filter(e => e.animState !== animState);
}

function registerAnimUpdater(entry) {
    activeAnimUpdaters.push(entry);
}

function unregisterAnimUpdater(animState) {
    activeAnimUpdaters = activeAnimUpdaters.filter(e => e.animState !== animState);
}

function runAnimUpdaters(nowMs) {
    if (!activeAnimUpdaters.length) return;
    // Compact the updater list as we run it so stopped animators are removed
    // without requiring a separate cleanup pass.
    const next = [];
    for (const entry of activeAnimUpdaters) {
        if (!entry || !entry.animState || entry.animState.stopped) continue;
        try {
            entry.updateFrame(nowMs);
            next.push(entry);
        } catch (err) {
            console.warn('Animation updater error:', err);
        }
    }
    activeAnimUpdaters = next;
}

function recompileActiveExprs() {
    _recompileActiveSceneFunctions();
    for (const entry of activeAnimExprs) {
        if (entry.animState.stopped) continue;
        if (typeof entry._rebuildFn === 'function') {
            try {
                entry._rebuildFn();
            } catch (err) {
                console.warn('Slider parametric recompile error:', err);
            }
            continue;
        }
        try {
            entry.compiledFns = entry.exprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('Slider recompile error:', err);
        }
        if (entry.fromExprStrings) {
            try {
                entry.fromExprFns = entry.fromExprStrings.map(e => compileExpr(e));
            } catch (err) {
                console.warn('Slider fromExpr recompile error:', err);
            }
        }
        if (entry.radiusExprString) {
            try {
                entry.radiusFn = compileExpr(entry.radiusExprString);
            } catch (err) {
                console.warn('Slider radiusExpr recompile error:', err);
            }
        }
        if (entry.visibleExprString) {
            try {
                entry.visibleFn = compileExpr(entry.visibleExprString);
            } catch (err) {
                console.warn('Slider visibleExpr recompile error:', err);
            }
        }
        if (entry._isAnimatedPolygon && entry._vertexExprs) {
            try {
                entry._compiledVerts = entry._vertexExprs.map(v => v.map(e => compileExpr(e)));
            } catch (err) {
                console.warn('Slider animated_polygon recompile error:', err);
            }
        }
        if (entry._isRegularPolygon && entry._regExprs) {
            try {
                const [nE, rE, cxE, cyE, czE, rotE] = entry._regExprs;
                entry._regState.cN   = compileExpr(nE);
                entry._regState.cR   = compileExpr(rE);
                entry._regState.cCx  = compileExpr(cxE);
                entry._regState.cCy  = compileExpr(cyE);
                entry._regState.cCz  = compileExpr(czE);
                entry._regState.cRot = compileExpr(rotE);
            } catch (err) {
                console.warn('Slider regular polygon recompile error:', err);
            }
        }
        if (entry._isAnimatedLine && entry._pointExprs) {
            try {
                entry._compiledPoints = entry._pointExprs.map(p => p.map(e => compileExpr(e)));
            } catch (err) {
                console.warn('Slider animated_line recompile error:', err);
            }
        }
    }
    // Recompile follow-cam expressions too (slider set may have changed)
    if (followCamState && followCamState.exprStrings) {
        try {
            followCamState.compiledExprs = followCamState.exprStrings.map(e => compileExpr(e));
        } catch (err) {
            console.warn('Follow-cam recompile error:', err);
        }
        if (followCamState.fromExprStrings) {
            try {
                followCamState.compiledFromExprs = followCamState.fromExprStrings.map(e => compileExpr(e));
            } catch (err) {
                console.warn('Follow-cam fromExpr recompile error:', err);
            }
        }
    }
    if (activeVirtualTimeExpr) {
        try {
            activeVirtualTimeCompiled = compileExpr(activeVirtualTimeExpr);
        } catch (err) {
            console.warn('virtualTime recompile error:', err);
            activeVirtualTimeCompiled = null;
        }
    }
    updateInfoOverlays();
}

// ----- Shared drag utility -----

/** After restoring a saved position, clamp element so at least `margin` px remains visible. */
function clampToParent(el, margin = 40) {
    const parent = el.offsetParent || document.body;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const ew = el.offsetWidth  || margin;
    const eh = el.offsetHeight || margin;
    let left = parseFloat(el.style.left) || 0;
    let top  = parseFloat(el.style.top)  || 0;
    left = Math.max(margin - ew, Math.min(left, pw - margin));
    top  = Math.max(0,           Math.min(top,  ph - margin));
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
}

// ----- Info Overlays -----

let activeInfoOverlays = {};  // id -> { content, el }

function _fmtNum(val) {
    if (typeof val === 'string') return val;  // expression already returned a formatted string (e.g. .toFixed())
    if (!isFinite(val)) return String(val);
    const n = Number(val);
    if (Number.isInteger(n)) return String(n);
    return parseFloat(n.toFixed(3)).toString();
}

function _isKnownInfoExprIdentifier(name) {
    if (!name) return false;
    if (Object.prototype.hasOwnProperty.call(sceneSliders, name)) return true;
    if (Object.prototype.hasOwnProperty.call(activeSceneExprFunctions, name)) return true;
    if (window.agentMemoryValues && Object.prototype.hasOwnProperty.call(window.agentMemoryValues, name)) return true;
    if (name === 't' || name === 'u' || name === 'v') return true;
    if (name === 'pi' || name === 'e' || name === 'PI' || name === 'E') return true;
    if (name === 'true' || name === 'false' || name === 'Infinity' || name === 'NaN') return true;
    if (name === 'toFixed') return true;
    return _getMathNamesAndValues().names.includes(name);
}

function _exprHasUnknownIdentifiers(expr) {
    const sanitized = String(expr).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
    const matches = sanitized.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!matches) return false;
    for (const id of matches) {
        if (!_isKnownInfoExprIdentifier(id)) return true;
    }
    return false;
}

function _evalInfoExpr(expr) {
    const trimmed = String(expr || '').trim();
    if (!trimmed) return '';
    if (_exprHasUnknownIdentifiers(trimmed)) {
        return null;
    }
    const memScope = (window.agentMemoryValues && typeof window.agentMemoryValues === 'object')
        ? window.agentMemoryValues
        : null;
    try {
        return _fmtNum(evalExpr(compileExpr(trimmed), 0, { extraScope: memScope }));
    } catch {
        // math.js failed (e.g. JS-only helpers/method calls)
        if (_sceneJsTrustState === 'trusted') {
            try {
                const ids = getSliderIds();
                const memNames = memScope ? Object.keys(memScope) : [];
                const { names, vals: mathVals } = _getMathNamesAndValues();
                const fn = Function('t', ...ids, ...memNames, ...names, 'return (' + trimmed + ')');
                const sliderVals = ids.map(id => { const s = sceneSliders[id]; return s ? s.value : 0; });
                const memVals = memNames.map(k => memScope[k]);
                return _fmtNum(fn(0, ...sliderVals, ...memVals, ...mathVals));
            } catch { /* fall through */ }
        }
        return '?';
    }
}

function _replaceDoubleBraceExprs(template, evaluator) {
    if (typeof template !== 'string' || template.indexOf('{{') === -1) return template;
    return template.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr) => {
        const v = evaluator(expr);
        return v == null ? _m : String(v);
    });
}

function _replaceInlineExprs(template, evaluator) {
    if (typeof template !== 'string' || template.indexOf('{') === -1) return template;
    let out = '';
    let i = 0;
    while (i < template.length) {
        const ch = template[i];
        if (ch !== '{') {
            out += ch;
            i += 1;
            continue;
        }
        let j = i + 1;
        let depth = 1;
        let quote = null;
        let escaped = false;
        while (j < template.length && depth > 0) {
            const cj = template[j];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (cj === '\\') {
                    escaped = true;
                } else if (cj === quote) {
                    quote = null;
                }
            } else if (cj === '"' || cj === "'") {
                quote = cj;
            } else if (cj === '{') {
                depth += 1;
            } else if (cj === '}') {
                depth -= 1;
            }
            j += 1;
        }
        if (depth !== 0) {
            out += ch;
            i += 1;
            continue;
        }
        const expr = template.slice(i + 1, j - 1).trim();
        if (!expr) {
            out += '{}';
        } else {
            const prev = i > 0 ? template[i - 1] : '';
            // If this brace group is an argument to a LaTeX command (e.g. \frac{...}, \text{...}),
            // keep it literal and do not treat it as a dynamic placeholder.
            let isLatexCommandArg = false;
            const latexLiteralArgCmds = new Set([
                // Structural/text commands whose immediate brace group is plain TeX.
                'begin', 'end', 'text', 'mathrm', 'mathbf', 'mathit', 'operatorname',
                // Commands where brace args are mathematical TeX, not dynamic placeholders.
                'frac', 'dfrac', 'tfrac', 'cfrac', 'binom', 'sqrt', 'left', 'right',
                'overline', 'underline', 'hat', 'bar', 'vec', 'dot', 'ddot'
            ]);
            const latexSecondLiteralArgCmds = new Set([
                'frac', 'dfrac', 'tfrac', 'cfrac', 'binom'
            ]);
            {
                let k = i - 1;
                while (k >= 0 && /\s/.test(template[k])) k -= 1;
                let end = k;
                while (k >= 0 && /[A-Za-z]/.test(template[k])) k -= 1;
                if (end >= 0 && k >= 0 && template[k] === '\\' && end > k) {
                    const cmd = template.slice(k + 1, end + 1);
                    if (latexLiteralArgCmds.has(cmd)) isLatexCommandArg = true;
                }
                // Also treat the *second* argument of commands like \frac{...}{...}
                // as literal TeX, where the previous character is '}'.
                if (!isLatexCommandArg && end >= 0 && template[end] === '}') {
                    const prefix = template.slice(0, i);
                    const m = prefix.match(/\\([A-Za-z]+)\{[^{}]*\}\s*$/);
                    if (m && latexSecondLiteralArgCmds.has(m[1])) {
                        isLatexCommandArg = true;
                    }
                }
            }
            // Treat LaTeX grouping like _{max}, ^{2}, {m_d} as literal unless
            // the token is an actual slider id or the expression has operators.
            const isSimpleIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(expr);
            const isSliderIdent = !!sceneSliders[expr];
            const shouldEval = !(isLatexCommandArg || (prev === '_' || prev === '^') || (isSimpleIdent && !isSliderIdent));
            out += shouldEval ? evaluator(expr) : ('{' + expr + '}');
        }
        i = j;
    }
    return out;
}

function resolveInfoContent(template) {
    // Explicit bindings only: evaluate {{expr}} and leave all single-brace
    // groups untouched as literal text/LaTeX.
    return _replaceDoubleBraceExprs(template, (expr) => _evalInfoExpr(expr));
}

function updateInfoOverlays() {
    for (const ov of Object.values(activeInfoOverlays)) {
        const resolved = resolveInfoContent(ov.content);
        ov.contentEl.innerHTML = renderKaTeX(resolved, false);
    }
}

function removeStepInfoOverlays() {
    for (const id of Object.keys(activeInfoOverlays)) {
        if (activeInfoOverlays[id].stepDefined) removeInfoOverlay(id);
    }
}

function applyStepInfoOverlays(infoDefs) {
    removeStepInfoOverlays();
    if (!infoDefs || !infoDefs.length) return;
    for (const def of infoDefs) {
        addInfoOverlay(def.id, def.content, def.position || 'top-left', true);
    }
}

function addInfoOverlay(id, content, position, stepDefined = false) {
    const container = document.getElementById('info-overlays');
    if (!container) return;
    const pos = position || 'top-left';
    let existing = activeInfoOverlays[id];
    let el = existing && existing.el;
    let contentEl = existing && existing.contentEl;
    const isNew = !el;

    if (isNew) {
        el = document.createElement('div');
        el.id = 'info-overlay-' + id;

        // Toggle button (ⓘ) — always visible
        const toggle = document.createElement('button');
        toggle.className = 'info-overlay-toggle';
        toggle.type = 'button';
        toggle.title = 'Expand / collapse';
        toggle.textContent = 'ⓘ';
        toggle.addEventListener('mousedown', e => e.stopPropagation()); // don't start drag
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            el.classList.toggle('collapsed');
            const collapsed = el.classList.contains('collapsed');
            const ov = activeInfoOverlays[id];
            if (ov) ov.collapsed = collapsed;
            try { localStorage.setItem('info-overlay-collapsed-' + id, collapsed ? '1' : '0'); } catch {}
        });
        el.appendChild(toggle);

        // AI ask button
        const aiBtn = makeAiAskButton('info-overlay-ai-btn', 'Ask AI about this',
            () => { const ov = activeInfoOverlays[id]; return 'Can you explain this:\n' + (ov ? resolveInfoContent(ov.content) : '').trim(); });
        aiBtn.addEventListener('mousedown', e => e.stopPropagation()); // prevent drag on overlay
        el.appendChild(aiBtn);

        // Content area
        contentEl = document.createElement('div');
        contentEl.className = 'info-overlay-content';
        el.appendChild(contentEl);

        container.appendChild(el);

        // Drag-to-reposition (mousedown on el, not toggle)
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const currentPos = (activeInfoOverlays[id] && activeInfoOverlays[id].pos) || 'top-left';
            const isRight  = currentPos.includes('right');
            const isBottom = currentPos.includes('bottom');
            const rect = el.getBoundingClientRect();
            const parentRect = container.getBoundingClientRect();

            // Compute offsets from the appropriate corner, then lock inline styles to that corner
            let startH = isRight  ? parentRect.right  - rect.right  : rect.left - parentRect.left;
            let startV = isBottom ? parentRect.bottom - rect.bottom : rect.top  - parentRect.top;
            if (isRight)  { el.style.right  = startH + 'px'; el.style.left   = ''; }
            else          { el.style.left   = startH + 'px'; el.style.right  = ''; }
            if (isBottom) { el.style.bottom = startV + 'px'; el.style.top    = ''; }
            else          { el.style.top    = startV + 'px'; el.style.bottom = ''; }
            el.style.transform = '';
            el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));

            const startX = e.clientX;
            const startY = e.clientY;
            el.classList.add('dragging');

            const onMove = (me) => {
                const dx = me.clientX - startX;
                const dy = me.clientY - startY;
                let newH = isRight  ? startH - dx : startH + dx;
                let newV = isBottom ? startV - dy : startV + dy;
                newH = Math.max(0, Math.min(newH, parentRect.width  - el.offsetWidth));
                newV = Math.max(0, Math.min(newV, parentRect.height - el.offsetHeight));
                if (isRight)  el.style.right  = newH + 'px';
                else          el.style.left   = newH + 'px';
                if (isBottom) el.style.bottom = newV + 'px';
                else          el.style.top    = newV + 'px';
            };
            const onUp = () => {
                el.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const h = parseFloat(isRight  ? el.style.right  : el.style.left)  || 0;
                const v = parseFloat(isBottom ? el.style.bottom : el.style.top)   || 0;
                try { localStorage.setItem('info-overlay-pos-' + id, JSON.stringify({ pos: currentPos, h, v })); } catch {}
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Determine collapsed state: localStorage on first creation, existing record on updates
    let collapsed = false;
    if (isNew) {
        try { collapsed = localStorage.getItem('info-overlay-collapsed-' + id) === '1'; } catch {}
    } else {
        collapsed = !!(existing && existing.collapsed);
    }

    // Preserve pos class (but not if already dragged to an explicit position)
    const wasDragged = !isNew && (el.style.left || el.style.right || el.style.bottom);
    el.className = 'info-overlay pos-' + pos + (collapsed ? ' collapsed' : '');

    // Restore saved drag position on first creation
    if (isNew) {
        try {
            const savedPos = JSON.parse(localStorage.getItem('info-overlay-pos-' + id) || 'null');
            if (savedPos && savedPos.pos != null && savedPos.h != null && savedPos.v != null) {
                // New corner-aware format
                const sr = savedPos.pos.includes('right');
                const sb = savedPos.pos.includes('bottom');
                el.style.left   = sr ? '' : savedPos.h + 'px';
                el.style.right  = sr ? savedPos.h + 'px' : '';
                el.style.top    = sb ? '' : savedPos.v + 'px';
                el.style.bottom = sb ? savedPos.v + 'px' : '';
                el.style.transform = '';
                el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));
            } else if (savedPos && savedPos.left && savedPos.top) {
                // Legacy top-left format
                el.style.left = savedPos.left;
                el.style.top  = savedPos.top;
                el.style.right = '';
                el.style.bottom = '';
                el.style.transform = '';
                el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));
                requestAnimationFrame(() => clampToParent(el));
            } else if (pos.includes('bottom')) {
                // No saved position for bottom overlay: stack just above the slider panel
                const sliderOv = document.getElementById('slider-overlay');
                if (sliderOv && !sliderOv.classList.contains('hidden')) {
                    const sliderBottom = parseFloat(sliderOv.style.bottom) || 56;
                    el.style.bottom = (sliderBottom + sliderOv.offsetHeight + 8) + 'px';
                    el.style.top = '';
                }
            }
        } catch {}
    }
    if (wasDragged) el.classList.remove(...[...el.classList].filter(c => c.startsWith('pos-')));

    el.style.opacity = displayParams.overlayOpacity;
    activeInfoOverlays[id] = { content, el, contentEl, collapsed, stepDefined, pos };
    updateInfoOverlays();
}

function removeInfoOverlay(id) {
    const ov = activeInfoOverlays[id];
    if (ov && ov.el) ov.el.remove();
    delete activeInfoOverlays[id];
}

function removeAllInfoOverlays() {
    for (const id of Object.keys(activeInfoOverlays)) removeInfoOverlay(id);
}

// ----- Animate Slider Programmatically -----

function animateSlider(id, target, duration) {
    return new Promise(resolve => {
        const slider = sceneSliders[id];
        if (!slider) { resolve(false); return; }
        target = Math.max(slider.min, Math.min(slider.max, target));
        const start = slider.value;
        if (start === target) { syncSliderState(); resolve(true); return; }
        const startTime = performance.now();
        function tick(now) {
            const t = Math.min((now - startTime) / duration, 1);
            const eased = t < 1 ? t * (2 - t) : 1;  // ease-out quad
            slider.value = start + (target - start) * eased;
            // Update the HTML range input and value display to match
            const input = document.querySelector(`input[data-slider-id="${id}"]`);
            if (input) {
                input.value = slider.value;
                const valSpan = input.parentElement && input.parentElement.querySelector('.slider-value');
                if (valSpan) valSpan.textContent = Number(slider.value).toFixed(1);
            }
            recompileActiveExprs();
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                syncSliderState();
                resolve(true);
            }
        }
        requestAnimationFrame(tick);
    });
}

// ----- Incremental Step Rendering -----

function snapshotBefore() {
    return {
        arrows: arrowMeshes.length,
        labels: labels.length,
        planes: planeMeshes.length,
        lines: lineNodes.length,
        vecLines: vectorLineNodes.length,
        axisLines: axisLineNodes.length,
        points: pointNodes.length,
    };
}

function buildSubTracker(group, before) {
    return {
        group,
        arrowMeshes:      arrowMeshes.slice(before.arrows),
        labels:           labels.slice(before.labels),
        planeMeshes:      planeMeshes.slice(before.planes),
        lineNodes:        lineNodes.slice(before.lines),
        vectorLineNodes:  vectorLineNodes.slice(before.vecLines),
        axisLineNodes:    axisLineNodes.slice(before.axisLines),
        pointNodes:       pointNodes.slice(before.points),
    };
}

function renderStepAdd(elements, sliderDefs) {
    // Register sliders first (so expressions can reference them during render)
    const sliderIds = registerSliders(sliderDefs);
    if (sliderIds.length > 0) {
        buildSliderOverlay();
        recompileActiveExprs();
    }

    const before = snapshotBefore();

    // Create a MathBox group for this step's elements
    const group = sceneView.group();

    // Render elements, tracking per-id sub-trackers
    // Auto-assign IDs to labeled elements so they're toggleable via legend
    let autoIdCounter = 0;
    const renderResults = [];
    const addedElementIds = [];
    for (const el of elements) {
        if (!el.id && el.label) {
            el.id = '__auto_' + (autoIdCounter++) + '_' + Date.now();
        }
        // If this step reuses an element id, hide any previously visible instance first.
        // This avoids double-rendered out-of-phase animations (e.g., person_walk across steps).
        if (el.id && elementRegistry[el.id] && !elementRegistry[el.id].hidden) {
            hideElementById(el.id);
        }
        const elBefore = el.id ? snapshotBefore() : null;
        const elGroup = el.id ? group.group() : group;
        let result = null;
        try { result = renderElement(el, elGroup); } catch (e) {
            console.error('Error rendering step element:', el, e);
        }
        if (result) renderResults.push(result);
        if (el.id) {
            addedElementIds.push(el.id);
            const subTracker = buildSubTracker(elGroup, elBefore);
            elementRegistry[el.id] = { tracker: subTracker, hidden: false, type: el.type };
        }
    }

    // Capture what was added (references into global arrays)
    const tracker = buildSubTracker(group, before);
    tracker.removedIds = [];  // ids removed by this step (for undo on backward)
    tracker.removedSliders = {}; // slider id -> def, removed by this step (for undo)
    tracker.sliderIds = sliderIds; // slider ids introduced by this step
    tracker.elementIds = addedElementIds; // element ids introduced by this step
    tracker.renderResults = renderResults; // for cleaning up anim expr entries

    // Start fade-in animation for new elements
    fadeInTracker(tracker);

    return tracker;
}

function hideElementById(id) {
    const reg = elementRegistry[id];
    if (!reg || reg.hidden) return;
    reg.hidden = true;
    const t = reg.tracker;

    fadeOutTracker(t, 200, () => {
        for (const entry of t.arrowMeshes) { entry.mesh.visible = false; entry.mesh._hiddenByRemove = true; }
        for (const m of t.planeMeshes) { m.visible = false; m._hiddenByRemove = true; }
        for (const lbl of t.labels) lbl.el.style.display = 'none';
        for (const entry of t.pointNodes) { try { entry.node.set('visible', false); } catch(e) {} }
        if (t.group) { try { t.group.set('visible', false); } catch(e) {} }
    });
    // Hide arrow cones immediately to prevent animated orphans
    for (const entry of t.arrowMeshes) { entry.mesh.visible = false; entry.mesh._hiddenByRemove = true; }
    // Hide plane meshes (animated points) immediately too
    for (const m of t.planeMeshes) { m.visible = false; m._hiddenByRemove = true; }
    // Hide points immediately too
    for (const entry of (t.pointNodes || [])) { try { entry.node.set('visible', false); } catch(e) {} }
}

function showElementById(id) {
    const reg = elementRegistry[id];
    if (!reg || !reg.hidden) return;
    reg.hidden = false;
    const t = reg.tracker;
    for (const entry of t.arrowMeshes) { entry.mesh._hiddenByRemove = false; }
    for (const m of t.planeMeshes) { m._hiddenByRemove = false; }

    for (const entry of t.arrowMeshes) entry.mesh.visible = true;
    for (const m of t.planeMeshes) m.visible = true;
    for (const lbl of t.labels) lbl.el.style.display = '';
    for (const entry of (t.pointNodes || [])) { try { entry.node.set('visible', true); } catch(e) {} }
    if (t.group) { try { t.group.set('visible', true); } catch(e) {} }

    fadeInTracker(t);
}

function removeTrackSliders(tracker) {
    // Save and remove all current sliders, recording them for undo
    // Skip sliders owned by this step (just registered)
    const ownIds = new Set(tracker.sliderIds || []);
    let changed = false;
    for (const id of Object.keys(sceneSliders)) {
        if (ownIds.has(id)) continue;
        if (!tracker.removedSliders[id]) {
            stopSliderLoop(id);
            tracker.removedSliders[id] = { ...sceneSliders[id] };
            delete sceneSliders[id];
            changed = true;
        }
    }
    if (changed) {
        buildSliderOverlay();
        recompileActiveExprs();
    }
}

function removeTrackSliderById(id, tracker) {
    // Skip sliders owned by this step
    if (tracker.sliderIds && tracker.sliderIds.includes(id)) return false;
    if (sceneSliders[id] && !tracker.removedSliders[id]) {
        stopSliderLoop(id);
        tracker.removedSliders[id] = { ...sceneSliders[id] };
        delete sceneSliders[id];
        return true;
    }
    return false;
}

function processStepRemoves(removeList, tracker) {
    if (!removeList || !Array.isArray(removeList)) return;
    const ownIds = new Set(tracker.elementIds || []);
    let slidersChanged = false;
    for (const item of removeList) {
        // Wildcard: remove all registered elements and sliders (skip own)
        if (item.id === '*' || item.type === '*') {
            for (const id of Object.keys(elementRegistry)) {
                if (ownIds.has(id)) continue;
                if (!elementRegistry[id].hidden) {
                    hideElementById(id);
                    tracker.removedIds.push(id);
                }
            }
            removeTrackSliders(tracker);
            continue;
        }
        // Remove by specific id (element or slider, skip own)
        if (item.id) {
            if (!ownIds.has(item.id) && elementRegistry[item.id] && !elementRegistry[item.id].hidden) {
                hideElementById(item.id);
                tracker.removedIds.push(item.id);
            }
            if (removeTrackSliderById(item.id, tracker)) slidersChanged = true;
            continue;
        }
        // Remove by type
        if (item.type === 'slider') {
            removeTrackSliders(tracker);
            continue;
        }
        if (item.type) {
            for (const [id, reg] of Object.entries(elementRegistry)) {
                if (ownIds.has(id)) continue;
                if (reg.type === item.type && !reg.hidden) {
                    hideElementById(id);
                    tracker.removedIds.push(id);
                }
            }
        }
    }
    if (slidersChanged) {
        buildSliderOverlay();
        recompileActiveExprs();
    }
}

function undoStepRemoves(tracker) {
    if (!tracker.removedIds) return;
    // Collect ids still removed by earlier remaining step trackers
    const stillRemoved = new Set();
    const stillRemovedSliders = new Set();
    for (const t of stepTrackers) {
        if (t === tracker) break; // only check trackers before this one
        if (t.removedIds) {
            for (const id of t.removedIds) stillRemoved.add(id);
        }
        if (t.removedSliders) {
            for (const id of Object.keys(t.removedSliders)) stillRemovedSliders.add(id);
        }
    }
    for (const id of tracker.removedIds) {
        if (!stillRemoved.has(id)) {
            showElementById(id);
        }
    }
    // Restore removed sliders
    if (tracker.removedSliders) {
        let slidersChanged = false;
        for (const [id, def] of Object.entries(tracker.removedSliders)) {
            if (!stillRemovedSliders.has(id) && !sceneSliders[id]) {
                sceneSliders[id] = def;
                slidersChanged = true;
            }
        }
        if (slidersChanged) {
            buildSliderOverlay();
            recompileActiveExprs();
        }
    }
}

function removeStepTracker(tracker) {
    // Remove sliders introduced by this step, but keep any that remaining trackers still need.
    // (A later step may have re-registered sliders owned by an earlier step, claiming them as
    // "own" and preventing them from being saved in removedSliders.  Blindly deleting them would
    // leave earlier steps without their sliders when navigating backward.)
    if (tracker.sliderIds && tracker.sliderIds.length > 0) {
        const stillNeeded = new Set(stepTrackers.flatMap(t => t.sliderIds || []));
        const toRemove = tracker.sliderIds.filter(id => !stillNeeded.has(id));
        if (toRemove.length > 0) {
            removeSliderIds(toRemove);
            buildSliderOverlay();
            recompileActiveExprs();
        }
    }

    // Stop animations and unregister expr entries
    if (tracker.renderResults) {
        for (const r of tracker.renderResults) {
            if (r && r._animState) r._animState.stopped = true;
            if (r && r._animExprEntry) unregisterAnimExpr(r._animExprEntry.animState);
            // Keep scheduler lifecycle in sync with step lifecycle.
            if (r && r._animState) unregisterAnimUpdater(r._animState);
        }
    }

    // Fade out then remove (quick 200ms)
    fadeOutTracker(tracker, 200, () => {
        // Remove MathBox group (and its children)
        if (tracker.group) {
            try { tracker.group.remove(); } catch(e) {}
        }

        // Remove Three.js arrow cone meshes
        for (const entry of tracker.arrowMeshes) {
            three.scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.mesh.material.dispose();
            const idx = arrowMeshes.indexOf(entry);
            if (idx >= 0) arrowMeshes.splice(idx, 1);
        }

        // Remove labels from DOM
        for (const lbl of tracker.labels) {
            if (lbl.el.parentNode) lbl.el.parentNode.removeChild(lbl.el);
            const idx = labels.indexOf(lbl);
            if (idx >= 0) labels.splice(idx, 1);
        }

        // Remove plane meshes
        for (const m of tracker.planeMeshes) {
            three.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
            const idx = planeMeshes.indexOf(m);
            if (idx >= 0) planeMeshes.splice(idx, 1);
        }

        // Remove from line tracking arrays
        for (const entry of tracker.lineNodes) {
            const idx = lineNodes.indexOf(entry);
            if (idx >= 0) lineNodes.splice(idx, 1);
        }
        for (const entry of tracker.vectorLineNodes) {
            const idx = vectorLineNodes.indexOf(entry);
            if (idx >= 0) vectorLineNodes.splice(idx, 1);
        }
        for (const entry of tracker.axisLineNodes) {
            const idx = axisLineNodes.indexOf(entry);
            if (idx >= 0) axisLineNodes.splice(idx, 1);
        }
        for (const entry of (tracker.pointNodes || [])) {
            const idx = pointNodes.indexOf(entry);
            if (idx >= 0) pointNodes.splice(idx, 1);
        }
    });
}

function fadeInTracker(tracker, duration) {
    duration = duration || 350;
    const startTime = performance.now();

    // Set initial opacity to 0
    for (const entry of tracker.arrowMeshes) {
        entry.mesh.material.transparent = true;
        entry.mesh.material.opacity = 0;
    }
    for (const m of tracker.planeMeshes) {
        m.material.transparent = true;
        m.material.opacity = 0;
    }
    for (const lbl of tracker.labels) {
        lbl.el.style.transition = 'none';
        lbl.el.style.opacity = '0';
    }
    // MathBox line nodes: set opacity 0
    for (const entry of tracker.lineNodes) {
        try { entry.node.set('opacity', 0); } catch(e) {}
    }
    for (const entry of tracker.vectorLineNodes) {
        try { entry.node.set('opacity', 0); } catch(e) {}
    }
    for (const entry of (tracker.pointNodes || [])) {
        try { entry.node.set('opacity', 0); } catch(e) {}
    }

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = t * t * (3 - 2 * t); // smoothstep

        for (const entry of tracker.arrowMeshes) {
            const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                ? entry.mesh.userData.baseOpacity
                : 1;
            const globalOp = entry.isShaft ? displayParams.vectorOpacity : displayParams.arrowOpacity;
            entry.mesh.material.opacity = ease * Math.max(0, Math.min(1, baseOp * globalOp));
        }
        for (const m of tracker.planeMeshes) {
            const targetOp = m.userData.targetOpacity !== undefined ? m.userData.targetOpacity : displayParams.planeOpacity;
            m.material.opacity = ease * targetOp;
        }
        for (const lbl of tracker.labels) {
            lbl.el.style.opacity = String(ease * displayParams.labelOpacity);
        }
        for (const entry of tracker.lineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node.set('opacity', ease * baseOp * displayParams.lineOpacity); } catch(e) {}
        }
        for (const entry of tracker.vectorLineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node.set('opacity', ease * baseOp * displayParams.vectorOpacity); } catch(e) {}
        }
        for (const entry of (tracker.pointNodes || [])) {
            try { entry.node.set('opacity', ease); } catch(e) {}
        }

        if (t < 1) requestAnimationFrame(step);
        else {
            // Restore CSS transition on labels
            for (const lbl of tracker.labels) {
                lbl.el.style.transition = '';
            }
        }
    }
    requestAnimationFrame(step);
}

function fadeOutTracker(tracker, duration, onComplete) {
    duration = duration || 200;
    const startTime = performance.now();

    // Capture current opacities
    const arrowOps = tracker.arrowMeshes.map(e => e.mesh.material.opacity);
    const planeOps = tracker.planeMeshes.map(m => m.material.opacity);

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = 1 - t * t; // inverse quadratic

        for (let i = 0; i < tracker.arrowMeshes.length; i++) {
            tracker.arrowMeshes[i].mesh.material.opacity = arrowOps[i] * ease;
        }
        for (let i = 0; i < tracker.planeMeshes.length; i++) {
            tracker.planeMeshes[i].material.opacity = planeOps[i] * ease;
        }
        for (const lbl of tracker.labels) {
            lbl.el.style.opacity = String(parseFloat(lbl.el.style.opacity || 1) * ease);
        }
        for (const entry of tracker.lineNodes) {
            try { entry.node.set('opacity', (entry.node.get('opacity') || 1) * ease); } catch(e) {}
        }
        for (const entry of tracker.vectorLineNodes) {
            try { entry.node.set('opacity', (entry.node.get('opacity') || 1) * ease); } catch(e) {}
        }
        for (const entry of (tracker.pointNodes || [])) {
            try { entry.node.set('opacity', (entry.node.get('opacity') || 1) * ease); } catch(e) {}
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            if (onComplete) onComplete();
        }
    }
    requestAnimationFrame(step);
}

function getAllElements(scene, stepIdx) {
    let elements = [...(scene.elements || [])];
    const removedIds = new Set();
    const removedTypes = new Set();
    let removeAll = false;
    if (scene.steps) {
        for (let i = 0; i <= stepIdx; i++) {
            const step = scene.steps[i];
            // Track removes before adding this step's elements
            if (step.remove) {
                for (const item of step.remove) {
                    if (item.id === '*' || item.type === '*') { removeAll = true; }
                    else if (item.id) removedIds.add(item.id);
                    else if (item.type) removedTypes.add(item.type);
                }
            }
            // Apply removes to current element list, then add this step's new elements
            if (removeAll || removedIds.size > 0 || removedTypes.size > 0) {
                elements = elements.filter(el => {
                    if (removeAll) return false;
                    if (el.id && removedIds.has(el.id)) return false;
                    if (el.type && removedTypes.has(el.type)) return false;
                    return true;
                });
                removedIds.clear();
                removedTypes.clear();
                removeAll = false;
            }
            elements = elements.concat(step.add || []);
        }
    }
    return elements;
}

function navigateTo(sceneIdx, stepIdx) {
    console.log('📍 navigateTo called:', {sceneIdx, stepIdx, currentSceneIndex, currentStepIndex, totalScenes: lessonSpec?.scenes?.length});
    if (!lessonSpec || !lessonSpec.scenes) { console.warn('📍 navigateTo: no lessonSpec'); return; }
    const scene = lessonSpec.scenes[sceneIdx];
    if (!scene) { console.warn('📍 navigateTo: scene', sceneIdx, 'not found'); return; }

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    stepIdx = Math.max(-1, Math.min(stepIdx, maxStep));

    // Same position — no-op
    if (sceneIdx === currentSceneIndex && stepIdx === currentStepIndex) { console.log('📍 navigateTo: same position, no-op'); return; }

    const sceneChanged = sceneIdx !== currentSceneIndex;

    if (sceneChanged) {
        // Full re-render: load base scene elements
        const baseSpec = {
            title: scene.title,
            description: scene.description,
            markdown: scene.markdown,
            range: scene.range,
            scale: scene.scale,
            cameraUp: scene.cameraUp,
            camera: scene.camera,
            views: scene.views,
            functions: scene.functions,
            elements: scene.elements || [],
        };
        loadScene(baseSpec);

        // Store the cartesian view for incremental step rendering
        sceneView = mathbox.select('cartesian');
        stepTrackers = [];
        elementRegistry = {};
        legendToggledOff = new Set();
        stopAllSliderLoops();
        sceneSliders = {};
        // loadScene() already resets animation registries before rendering base elements.
        removeAllInfoOverlays();
        buildSliderOverlay();

        // Add steps incrementally up to stepIdx
        for (let i = 0; i <= stepIdx; i++) {
            if (scene.steps && scene.steps[i]) {
                const step = scene.steps[i];
                const tracker = renderStepAdd(step.add || [], step.sliders);
                processStepRemoves(step.remove, tracker);
                stepTrackers.push(tracker);
                visitedSteps.add(sceneIdx + ':' + i);
            }
        }

        // Update legend with all current elements
        buildLegend(getAllElements(scene, stepIdx));

    } else {
        // Same scene — incremental add/remove
        if (stepIdx > currentStepIndex) {
            // Stepping forward: add new steps
            for (let i = currentStepIndex + 1; i <= stepIdx; i++) {
                if (scene.steps && scene.steps[i]) {
                    const step = scene.steps[i];
                    const tracker = renderStepAdd(step.add || [], step.sliders);
                    processStepRemoves(step.remove, tracker);
                    stepTrackers.push(tracker);
                    visitedSteps.add(sceneIdx + ':' + i);
                }
            }
        } else {
            // Stepping backward: undo removes then remove step elements
            while (stepTrackers.length > stepIdx + 1) {
                const tracker = stepTrackers.pop();
                undoStepRemoves(tracker);
                removeStepTracker(tracker);
            }
        }

        // Update legend
        buildLegend(getAllElements(scene, stepIdx));
    }

    // Animate camera using effective step camera (inherit nearest previous step camera
    // when this step has no explicit camera) — but only if no follow cam is active.
    if (!followCamState && stepIdx >= 0 && scene.steps) {
        const cam = resolveEffectiveStepCamera(scene, stepIdx);
        if (cam) {
        const pos = dataCameraToWorld(cam.position || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld(cam.target || DEFAULT_CAMERA.target);
        CAMERA_VIEWS['_step'] = {
            position: pos,
            target: tgt,
            up: Array.isArray(cam.up) ? cam.up.slice(0, 3) : [0, 1, 0],
        };
        animateCamera('_step', 600);
        }
    }

    currentSceneIndex = sceneIdx;
    currentStepIndex = stepIdx;
    _setActiveVirtualTimeExpr(scene, stepIdx);

    // Apply info overlays for the active step only (clears previous step's overlays)
    const activeStep = scene.steps && scene.steps[stepIdx];
    applyStepInfoOverlays(activeStep ? activeStep.info : null);

    updateTreeHighlight();
    updateStepCaption(scene, stepIdx);
    updateDebugStatus();

    // Trigger resize for layout changes
    if (sceneChanged) {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
}

function syncSliderState() {
    // Persist current slider values to localStorage
    const state = {};
    for (const [id, s] of Object.entries(sceneSliders)) {
        state[id] = s.value;
    }
    try { localStorage.setItem('algebench-sliders', JSON.stringify(state)); } catch(e) {}
    // Update status bar pill
    updateStatusBar();
}

function updateStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar) return;

    // --- JS trust pill ---
    _updateJsTrustPill();

    // --- Slider pill ---
    const pill = document.getElementById('slider-status');
    const countEl = pill && pill.querySelector('.slider-status-count');
    const tooltipEl = pill && pill.querySelector('.slider-status-tooltip');
    const ids = Object.keys(sceneSliders);
    if (pill) {
        if (ids.length > 0) {
            if (countEl) countEl.textContent = ids.length;
            if (tooltipEl) {
                tooltipEl.textContent = ids.map(id => {
                    const s = sceneSliders[id];
                    const label = (s.label || id).replace(/\$|\\[a-z]+\{?|\}|_|\^/gi, '').trim() || id;
                    return `${label} (${id}) = ${Number(s.value).toFixed(2)}  [${s.min} … ${s.max}]`;
                }).join('\n');
            }
            pill.classList.remove('hidden');
        } else {
            pill.classList.add('hidden');
        }
    }

    // --- Camera popup content ---
    const camPopup = document.getElementById('cam-popup-content');
    const camPopupText = document.getElementById('cam-popup-text');
    if (camPopup && camera && controls) {
        const p = camera.position;
        const t = controls.target;
        const u = camera.up;
        const dist = p.distanceTo(t);
        const fov = camera.isPerspectiveCamera ? camera.fov : null;
        const fmt = v => v.toFixed(3);
        const activeViewBtn = document.querySelector('.cam-btn.active');
        const viewName = activeViewBtn ? activeViewBtn.dataset.view : null;
        let txt = '';
        if (viewName) txt += `view ${viewName}\n`;
        txt += `pos  x: ${fmt(p.x)}  y: ${fmt(p.y)}  z: ${fmt(p.z)}\n`
             + `tgt  x: ${fmt(t.x)}  y: ${fmt(t.y)}  z: ${fmt(t.z)}\n`
             + `up   x: ${fmt(u.x)}  y: ${fmt(u.y)}  z: ${fmt(u.z)}\n`
             + `dist ${dist.toFixed(3)}`;
        if (fov != null) txt += `\nfov  ${Math.round(fov)}°`;
        if (camPopupText) camPopupText.textContent = txt;
        else camPopup.textContent = txt;
    }

    // --- Scene/step text ---
    const debugText = document.getElementById('debug-status-text');
    if (debugText) {
        const sceneNum = (typeof currentSceneIndex !== 'undefined' ? currentSceneIndex : 0) + 1;
        const totalScenes = (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes) ? lessonSpec.scenes.length : '?';
        const stepNum = (typeof currentStepIndex !== 'undefined' ? currentStepIndex : -1) + 1;
        const scene = (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes) ? lessonSpec.scenes[currentSceneIndex] : null;
        const totalSteps = scene && scene.steps ? scene.steps.length : 0;
        debugText.textContent = `scene ${sceneNum}/${totalScenes}  step ${stepNum}/${totalSteps}`;
    }
}

function setCamPopupPinned(pinned, suppressHover = false) {
    const camStatus = document.getElementById('cam-status');
    if (!camStatus) return;
    camPopupPinned = !!pinned;
    camStatus.classList.toggle('pinned', camPopupPinned);
    if (camPopupPinned) {
        camStatus.classList.remove('suppress-hover');
    } else if (suppressHover) {
        camStatus.classList.add('suppress-hover');
    }
}

function setupCamStatusPopup() {
    const camStatus = document.getElementById('cam-status');
    const closeBtn = document.getElementById('cam-popup-close');
    const copyBtn = document.getElementById('cam-popup-copy');
    const popupText = document.getElementById('cam-popup-text');
    if (!camStatus) return;

    camStatus.addEventListener('click', (e) => {
        if (e.target && e.target.closest('#cam-popup-close')) return;
        if (e.target && e.target.closest('#cam-popup-copy')) return;
        if (e.target && e.target.closest('.cam-status-popup')) return;
        setCamPopupPinned(!camPopupPinned, camPopupPinned);
    });

    camStatus.addEventListener('mouseleave', () => {
        camStatus.classList.remove('suppress-hover');
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setCamPopupPinned(false, true);
        });
    }

    if (copyBtn && popupText) {
        copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const txt = popupText.textContent || '';
            if (!txt) return;
            try {
                await navigator.clipboard.writeText(txt);
                const prev = copyBtn.textContent;
                copyBtn.textContent = 'Copied';
                setTimeout(() => { copyBtn.textContent = prev; }, 900);
            } catch (_err) {
                // Silently ignore clipboard failures (e.g., permissions policy).
            }
        });
    }
}

// Keep old name working (called from navigateTo)
function updateDebugStatus() { updateStatusBar(); }

function _applyBottomPos(el, bottom, left) {
    el.style.bottom = bottom;
    el.style.left   = left || '50%';
    el.style.top    = 'auto';
    el.style.right  = 'auto';
    el.style.width  = '';
    // When left is a pixel value the element is already placed by its left edge — no translateX needed
    const scale = 'scale(' + (displayParams.captionScale || 1) + ')';
    el.style.transform = (left && left.endsWith('px')) ? scale : ('translateX(-50%) ' + scale);
}

function _defaultCaptionPos(el) {
    _applyBottomPos(el, '64px', '50%');
}

function resetCaptionPosition(el) {
    try {
        const saved = JSON.parse(localStorage.getItem('caption-pos') || 'null');
        // Only restore a genuine pixel value (not the old "auto" saves)
        if (saved && typeof saved.bottom === 'string' && saved.bottom.endsWith('px')) {
            if (saved.width) el.style.width = saved.width;
            _applyBottomPos(el, saved.bottom, saved.left);
            // After paint, reset to default if element ended up outside viewport
            requestAnimationFrame(() => {
                const parent = el.offsetParent || document.body;
                const b = parseFloat(el.style.bottom) || 0;
                if (b < 0 || b > parent.clientHeight - 20) {
                    localStorage.removeItem('caption-pos');
                    _defaultCaptionPos(el);
                }
            });
            return;
        }
    } catch {}
    _defaultCaptionPos(el);
}

function updateStepCaption(scene, stepIdx) {
    const el = document.getElementById('step-caption');
    if (!el) return;
    let text = null;
    if (stepIdx >= 0 && scene.steps && scene.steps[stepIdx] && scene.steps[stepIdx].description) {
        text = scene.steps[stepIdx].description;
    } else if (stepIdx === -1 && scene.description) {
        text = scene.description;
    }
    if (text) {
        el.innerHTML = renderMarkdown(text);
        el.dataset.markdown = text;
        const btn = makeAiAskButton('ai-ask-btn caption-ai-btn', 'Ask AI to explain this', () => `Can you explain the step description: "${text}"`);
        el.appendChild(btn);
        el.style.opacity = displayParams.overlayOpacity;
        resetCaptionPosition(el);
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

function updateTreeHighlight() {
    // Update scene nodes
    document.querySelectorAll('.tree-scene').forEach(el => {
        const idx = parseInt(el.dataset.sceneIdx);
        el.classList.toggle('active', idx === currentSceneIndex);
        if (idx === currentSceneIndex) {
            el.classList.add('expanded');
        }
    });

    // Update step nodes
    document.querySelectorAll('.tree-step').forEach(el => {
        const si = parseInt(el.dataset.sceneIdx);
        const sti = parseInt(el.dataset.stepIdx);
        el.classList.toggle('active', si === currentSceneIndex && sti === currentStepIndex);
        el.classList.toggle('visited',
            visitedSteps.has(si + ':' + sti) && !(si === currentSceneIndex && sti === currentStepIndex));
    });
}

function stepNext() {
    if (!lessonSpec || !lessonSpec.scenes) return;
    const scene = lessonSpec.scenes[currentSceneIndex];
    if (!scene) return;

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;

    if (currentStepIndex < maxStep) {
        navigateTo(currentSceneIndex, currentStepIndex + 1);
    } else if (currentSceneIndex < lessonSpec.scenes.length - 1) {
        navigateTo(currentSceneIndex + 1, -1);
    } else {
        // At the end — stop auto-play
        stopAutoPlay();
    }
}

function stepPrev() {
    if (!lessonSpec || !lessonSpec.scenes) return;

    if (currentStepIndex > -1) {
        navigateTo(currentSceneIndex, currentStepIndex - 1);
    } else if (currentSceneIndex > 0) {
        const prevScene = lessonSpec.scenes[currentSceneIndex - 1];
        const prevMaxStep = (prevScene.steps ? prevScene.steps.length : 0) - 1;
        navigateTo(currentSceneIndex - 1, prevMaxStep);
    }
}

function toggleAutoPlay() {
    if (autoPlayTimer) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function getCurrentStepDuration() {
    const scene = lessonSpec && lessonSpec.scenes[currentSceneIndex];
    if (!scene || !scene.steps) return AUTO_PLAY_DEFAULT_DURATION;
    const step = scene.steps[currentStepIndex];
    if (step && step.duration != null) return step.duration;
    // Scene-level base duration (scene intro step at index -1)
    if (currentStepIndex === -1 && scene.duration != null) return scene.duration;
    return AUTO_PLAY_DEFAULT_DURATION;
}

function scheduleNextAutoPlay() {
    if (!autoPlayTimer) return; // stopped
    const scene = lessonSpec && lessonSpec.scenes[currentSceneIndex];
    if (!scene) { stopAutoPlay(); return; }
    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    const isLast = currentSceneIndex >= lessonSpec.scenes.length - 1 && currentStepIndex >= maxStep;
    if (isLast) { stopAutoPlay(); return; }

    // Pause on interactive steps (have sliders) unless an explicit duration is set
    const step = scene.steps && scene.steps[currentStepIndex];
    if (step && Array.isArray(step.sliders) && step.sliders.length > 0 && step.duration == null) {
        stopAutoPlay();
        return;
    }

    const dur = getCurrentStepDuration();
    autoPlayTimer = setTimeout(() => {
        stepNext();
        scheduleNextAutoPlay();
    }, dur);
}

function startAutoPlay() {
    if (autoPlayTimer) return;
    autoPlayTimer = true; // sentinel so scheduleNextAutoPlay runs
    scheduleNextAutoPlay();
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = '&#9646;&#9646;'; // pause icon
    }
}

function stopAutoPlay() {
    if (autoPlayTimer) {
        clearTimeout(autoPlayTimer);
        autoPlayTimer = null;
    }
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '&#9654;'; // play icon
    }
}

function updateDockVisibility() {
    const dock = document.getElementById('scene-dock');
    if (lessonSpec) {
        dock.classList.add('visible');
    } else {
        dock.classList.remove('visible');
    }
}

function setupSceneDock() {
    const toggle = document.getElementById('scene-dock-toggle');
    const panel = document.getElementById('scene-dock-panel');
    const prevBtn = document.getElementById('nav-prev');
    const playBtn = document.getElementById('nav-play');
    const nextBtn = document.getElementById('nav-next');

    // Restore saved state
    const savedOpen = localStorage.getItem('algebench-dock-open');
    if (savedOpen === 'true') {
        panel.classList.add('open');
        toggle.classList.add('active');
    }

    toggle.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('open');
        toggle.classList.toggle('active', isOpen);
        localStorage.setItem('algebench-dock-open', isOpen);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
    });

    prevBtn.addEventListener('click', () => stepPrev());
    playBtn.addEventListener('click', () => toggleAutoPlay());
    nextBtn.addEventListener('click', () => stepNext());

    // Keyboard shortcuts for lesson navigation
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!lessonSpec) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            stepNext();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            stepPrev();
        } else if (e.key === ' ') {
            e.preventDefault();
            toggleAutoPlay();
        } else if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            toggle.click();
        }
    });
}

// ----- Initialization -----
// ----- Settings Panel -----
function setupSettingsPanel() {
    const toggle = document.getElementById('settings-toggle');
    const panel = document.getElementById('settings-panel');
    toggle.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        toggle.classList.toggle('active');
    });

    // Momentum slider
    const momentumSlider = document.getElementById('momentum-slider');
    const valMomentum    = document.getElementById('val-momentum');
    const MOMENTUM_KEY   = 'algebench-momentum';
    const savedMomentum  = parseFloat(localStorage.getItem(MOMENTUM_KEY));
    if (!isNaN(savedMomentum)) arcballMomentum = Math.max(0, Math.min(1, savedMomentum));
    if (momentumSlider) {
        momentumSlider.value = Math.round(arcballMomentum * 100);
        if (valMomentum) valMomentum.textContent = Math.round(arcballMomentum * 100) + '%';
        momentumSlider.addEventListener('input', () => {
            arcballMomentum = momentumSlider.value / 100;
            if (valMomentum) valMomentum.textContent = Math.round(arcballMomentum * 100) + '%';
            localStorage.setItem(MOMENTUM_KEY, arcballMomentum);
        });
    }

    // Sync displayed values with actual displayParams
    for (const [key, val] of Object.entries(displayParams)) {
        const el = document.getElementById('val-' + key);
        if (el) el.textContent = val.toFixed(1);
    }

    // Apply initial overlayOpacity to floating panels
    const _iniOp = displayParams.overlayOpacity;
    const _sliderOv = document.getElementById('slider-overlay');
    const _legend = document.getElementById('legend');
    if (_sliderOv) _sliderOv.style.opacity = _iniOp;
    if (_legend) _legend.style.opacity = _iniOp;

    const isOpacity = (p) => p.endsWith('Opacity');

    panel.querySelectorAll('.sp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const param = btn.dataset.param;
            const dir = btn.dataset.dir === '+' ? 1 : -1;
            const step = isOpacity(param) ? 0.1 : 0.2;
            const min = isOpacity(param) ? 0.0 : 0.2;
            const max = isOpacity(param) ? 1.0 : 5.0;
            let val = displayParams[param] + dir * step;
            val = Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
            displayParams[param] = val;
            document.getElementById('val-' + param).textContent = val.toFixed(1);

            if (param === 'labelScale') {
                // updateLabels() picks up displayParams.labelScale every frame — no manual DOM walk needed
            } else if (param === 'labelOpacity') {
                document.querySelectorAll('.label-3d').forEach(el => {
                    el.style.opacity = val;
                });
            } else if (param === 'arrowScale') {
                const seenPairs = new Set();
                for (const entry of arrowMeshes) {
                    // Dynamic (animated) vectors handle arrowScale inside their own per-frame
                    // deterministic update path. Mutating them here re-introduces hidden
                    // state coupling and causes gap/extension artifacts.
                    if (entry.mesh && entry.mesh.userData && entry.mesh.userData.dynamicVector) continue;
                    if (entry.isShaft) continue; // shaft length = vector length, never scale it
                    const pair = entry.mesh.userData && entry.mesh.userData.arrowPair;
                    if (pair && pair.shaft && pair.cone && !seenPairs.has(pair)) {
                        if (pair.dynamic) continue; // animated vectors are updated deterministically each frame
                        seenPairs.add(pair);
                        const totalLen = pair.baseShaftLen + pair.baseHeadLen;
                        const desiredHeadLen = pair.baseHeadLen * val;
                        const autoScale = resolveSmallVectorAutoScale(totalLen, desiredHeadLen);
                        const scaledHeadLen = desiredHeadLen * autoScale;
                        const scaledShaftLen = Math.max(totalLen - scaledHeadLen, 0.0001);

                        // Keep cone tip fixed at vector tip, with scaled length/radius.
                        pair.cone.scale.set(val * autoScale, val * autoScale, val * autoScale);
                        pair.cone.position.copy(pair.tipWorld).addScaledVector(pair.dir, -scaledHeadLen * 0.5);

                        // Resize shaft along its axis so it always terminates at cone base.
                        pair.shaft.userData.autoThicknessScale = autoScale;
                        pair.shaft.userData.lengthScale = scaledShaftLen / Math.max(pair.baseShaftLen, 0.0001);
                        pair.shaft.userData.maxRadiusFromHead = (scaledHeadLen * ARROW_HEAD_RADIUS_RATIO) * 0.75;
                        applyShaftThickness(pair.shaft);
                        pair.shaft.position.copy(pair.fromWorld).addScaledVector(pair.dir, scaledShaftLen * 0.5);
                        continue;
                    }
                    entry.mesh.scale.set(val, val, val);
                    const half = entry.wLen * val * 0.5;
                    entry.mesh.position.copy(entry.tipWorld).addScaledVector(entry.dir, -half);
                }
            } else if (param === 'arrowOpacity') {
                for (const entry of arrowMeshes) {
                    if (entry.isShaft) continue;
                    const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                        ? entry.mesh.userData.baseOpacity
                        : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    entry.mesh.material.opacity = targetOp;
                    entry.mesh.material.transparent = targetOp < 1.0;
                }
            } else if (param === 'axisWidth') {
                for (const entry of axisLineNodes) {
                    applyLineWidth(entry);
                }
            } else if (param === 'axisOpacity') {
                for (const entry of axisLineNodes) {
                    const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
                    entry.node.set('opacity', baseOp * val);
                }
            } else if (param === 'vectorWidth') {
                for (const entry of arrowMeshes) {
                    if (!isShaftEntry(entry)) continue;
                    // Dynamic (animated) vectors compute shaft thickness from displayParams
                    // every frame; skip direct mutation here for determinism.
                    if (entry.mesh && entry.mesh.userData && entry.mesh.userData.dynamicVector) continue;
                    applyShaftThickness(entry.mesh);
                }
                for (const entry of vectorLineNodes) {
                    applyLineWidth(entry);
                }
            } else if (param === 'vectorOpacity') {
                for (const entry of arrowMeshes) {
                    if (!isShaftEntry(entry)) continue;
                    const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                        ? entry.mesh.userData.baseOpacity
                        : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    entry.mesh.material.opacity = targetOp;
                    entry.mesh.material.transparent = targetOp < 1.0;
                }
            } else if (param === 'lineWidth') {
                for (const entry of lineNodes) {
                    applyLineWidth(entry);
                }
            } else if (param === 'lineOpacity') {
                for (const entry of lineNodes) {
                    const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
                    entry.node.set('opacity', baseOp * val);
                }
            } else if (param === 'planeScale') {
                for (const m of planeMeshes) {
                    if (m.userData.buildSlab) {
                        const newPositions = m.userData.buildSlab(m.userData.baseHalf * val);
                        m.geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
                        m.geometry.computeVertexNormals();
                        m.geometry.attributes.position.needsUpdate = true;
                    }
                }
            } else if (param === 'planeOpacity') {
                for (const m of planeMeshes) {
                    const baseOp = (m.userData && typeof m.userData.targetOpacity === 'number')
                        ? m.userData.targetOpacity
                        : 1;
                    const targetOp = Math.max(0, Math.min(1, baseOp * val));
                    const isVisible = targetOp > 0.001;
                    m.visible = isVisible;
                    m.material.opacity = targetOp;
                    m.material.transparent = targetOp < 1;
                    // Prevent "ghost darkening" from depth writes when nearly/fully transparent.
                    m.material.depthWrite = targetOp >= 0.999;
                    m.material.needsUpdate = true;
                }
            } else if (param === 'captionScale') {
                const cap = document.getElementById('step-caption');
                if (cap) cap.style.transform = 'translateX(-50%) scale(' + val + ')';
            } else if (param === 'overlayOpacity') {
                const cap = document.getElementById('step-caption');
                if (cap && !cap.classList.contains('hidden')) cap.style.opacity = val;
                const sliderOv = document.getElementById('slider-overlay');
                if (sliderOv) sliderOv.style.opacity = val;
                const legend = document.getElementById('legend');
                if (legend) legend.style.opacity = val;
                document.querySelectorAll('.info-overlay').forEach(el => { el.style.opacity = val; });
            }
        });
    });
}


function initLightControls() {
    const azEl  = document.getElementById('light-az');
    const elEl  = document.getElementById('light-el');
    const intEl = document.getElementById('light-int');
    if (!azEl || !mainDirLight) return;

    function applyLight() {
        const azDeg = parseFloat(azEl.value);
        const elDeg = parseFloat(elEl.value);
        const intensity = parseFloat(intEl.value) / 100;
        const az = azDeg * Math.PI / 180;
        const el = elDeg * Math.PI / 180;
        const dist = 20;
        mainDirLight.position.set(
            dist * Math.cos(el) * Math.sin(az),
            dist * Math.sin(el),
            dist * Math.cos(el) * Math.cos(az)
        );
        mainDirLight.intensity = intensity;
        document.getElementById('val-light-az').textContent  = azDeg  + '°';
        document.getElementById('val-light-el').textContent  = elDeg  + '°';
        document.getElementById('val-light-int').textContent = intensity.toFixed(2);
    }

    azEl.addEventListener('input',  applyLight);
    elEl.addEventListener('input',  applyLight);
    intEl.addEventListener('input', applyLight);
    applyLight(); // sync with initial default values
}

function setupCaptionDrag() {
    const el = document.getElementById('step-caption');
    if (!el) return;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;

    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ai-ask-btn')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const parent = el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        startLeft   = elRect.left - parentRect.left;
        startBottom = parentRect.bottom - elRect.bottom;
        el.style.width     = elRect.width + 'px';   // lock width so it doesn't reflow
        el.style.left      = startLeft + 'px';
        el.style.bottom    = startBottom + 'px';
        el.style.top       = 'auto';
        el.style.right     = 'auto';
        el.style.transform = 'scale(' + displayParams.captionScale + ')';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        el.style.left   = (startLeft   + (e.clientX - startX)) + 'px';
        el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        try {
            localStorage.setItem('caption-pos', JSON.stringify({
                bottom: el.style.bottom,
                left:   el.style.left,
                width:  el.style.width,
            }));
        } catch {}
    });

    // Apply saved position on setup
    resetCaptionPosition(el);
}

// ----- Scene Description Drag (bottom-anchored) -----
function resetSceneDescPosition(el) {
    if (!el) el = document.getElementById('scene-description');
    if (!el) return;
    try {
        const saved = JSON.parse(localStorage.getItem('scene-desc-pos') || 'null');
        if (saved && typeof saved.bottom === 'string' && saved.bottom.endsWith('px')) {
            const left = saved.left || '50%';
            if (saved.width) el.style.width = saved.width;
            el.style.bottom    = saved.bottom;
            el.style.left      = left;
            el.style.top       = 'auto';
            el.style.transform = left.endsWith('px') ? 'none' : 'translateX(-50%)';
            // Reset to default if outside viewport after paint
            requestAnimationFrame(() => {
                const parent = el.offsetParent || document.body;
                const b = parseFloat(el.style.bottom) || 0;
                if (b < 0 || b > parent.clientHeight - 20) {
                    localStorage.removeItem('scene-desc-pos');
                    el.style.bottom    = '64px';
                    el.style.left      = '50%';
                    el.style.top       = 'auto';
                    el.style.transform = 'translateX(-50%)';
                }
            });
            return;
        }
    } catch {}
    el.style.bottom    = '64px';
    el.style.left      = '50%';
    el.style.top       = 'auto';
    el.style.transform = 'translateX(-50%)';
}

function setupSceneDescDrag() {
    const el = document.getElementById('scene-description');
    if (!el) return;
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startBottom = 0;

    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ai-ask-btn')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const parent = el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        startLeft   = elRect.left - parentRect.left;
        startBottom = parentRect.bottom - elRect.bottom;
        el.style.width     = elRect.width + 'px';   // lock width so it doesn't reflow
        el.style.left      = startLeft + 'px';
        el.style.bottom    = startBottom + 'px';
        el.style.top       = 'auto';
        el.style.transform = 'none';
        el.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        el.style.left   = (startLeft   + (e.clientX - startX)) + 'px';
        el.style.bottom = Math.max(0, startBottom - (e.clientY - startY)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        try {
            localStorage.setItem('scene-desc-pos', JSON.stringify({
                bottom: el.style.bottom,
                left:   el.style.left,
                width:  el.style.width,
            }));
        } catch {}
    });

    // Apply saved position on setup
    resetSceneDescPosition(el);
}

// ----- JSON Viewer -----

function _computeSceneSummary(spec) {
    if (!spec) return null;
    const isLesson = Array.isArray(spec.scenes) && spec.scenes.length > 0;
    const scenes = isLesson ? spec.scenes : [spec];

    let totalSteps = 0, totalSliders = 0, totalAnimated = 0, totalStatic = 0,
        totalFunctions = 0, totalExpressions = 0, totalPrompts = 0;

    const ANIMATED_TYPES = new Set([
        'animated_vector','animated_point','animated_line','animated_cylinder','animated_polygon'
    ]);

    function countExpressions(el) {
        // Count individual expression strings on an element
        let n = 0;
        const exprFields = ['expr','fromExpr','toExpr','radiusExpr','x','y','z','fx','fy','fz'];
        for (const f of exprFields) {
            if (typeof el[f] === 'string') n++;
            else if (Array.isArray(el[f])) n += el[f].filter(v => typeof v === 'string').length;
        }
        if (Array.isArray(el.points)) n += el.points.filter(v => typeof v === 'string').length;
        if (Array.isArray(el.vertices)) n += el.vertices.filter(v => typeof v === 'string').length;
        return n;
    }

    for (const scene of scenes) {
        if (scene.prompt && scene.prompt.trim().length > 0) totalPrompts++;
        totalSteps += (scene.steps || []).length;

        const allElements = [...(scene.elements || [])];
        for (const step of (scene.steps || [])) {
            allElements.push(...(step.add || []));
            for (const sl of (step.sliders || [])) {
                if (sl.id) totalSliders++;
            }
        }
        for (const el of allElements) {
            if (!el || !el.type) continue;
            if (ANIMATED_TYPES.has(el.type)) {
                totalAnimated++;
                totalExpressions += countExpressions(el);
            } else {
                totalStatic++;
            }
        }
        totalFunctions += Object.keys(scene.functions || {}).length;
        for (const step of (scene.steps || [])) {
            if (step.prompt && step.prompt.trim().length > 0) totalPrompts++;
        }
    }

    const imports = Array.isArray(spec.import) ? spec.import.length : 0;

    // Interactiveness score (0–100, asymptotic)
    // raw = unbounded weighted sum; score = 100 × (1 − e^(−raw/80))
    // k=80 means raw≈80 → score≈63, raw≈160 → score≈86, raw≈280 → score≈97
    // True 100 is unreachable by design — score differentiates across the full range.
    const raw =
        totalSliders     * 10 +
        totalAnimated    * 6  +
        totalSteps       * 4  +
        totalExpressions * 1  +
        totalFunctions   * 6  +
        imports          * 12;
    const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));

    const scoreLabel =
        score >= 80 ? 'Highly Interactive' :
        score >= 60 ? 'Rich' :
        score >= 40 ? 'Interactive' :
        score >= 20 ? 'Basic' : 'Static';

    const scoreColor =
        score >= 80 ? '#7cfc7c' :
        score >= 60 ? '#a0d4ff' :
        score >= 40 ? '#ffd070' :
        score >= 20 ? '#ff9966' : '#aaa';

    return {
        isLesson,
        sceneCount: scenes.length,
        description: spec.description || (isLesson ? '' : spec.title) || '',
        totalSteps,
        totalSliders,
        totalAnimated,
        totalStatic,
        totalFunctions,
        totalExpressions,
        totalPrompts,
        imports,
        score,
        scoreLabel,
        scoreColor,
    };
}

function _computeAgenticScore(spec) {
    if (!spec) return null;
    const isLesson = Array.isArray(spec.scenes) && spec.scenes.length > 0;
    const scenes = isLesson ? spec.scenes : [spec];

    let raw = 0;

    // Top-level description
    if (spec.description && spec.description.trim().length > 0) raw += 4;

    for (const scene of scenes) {
        // Markdown explanation quality
        if (scene.markdown && scene.markdown.trim().length > 0) {
            raw += 12;                                              // has markdown
            raw += Math.min(scene.markdown.length / 80, 20);       // length bonus (up to 20)
        }

        // Agent-specific prompt field
        if (scene.prompt && scene.prompt.trim().length > 10) {
            raw += 15;
            raw += Math.min(scene.prompt.length / 120, 10);        // length bonus (up to 10)
        }

        // Scene description
        if (scene.description && scene.description.trim().length > 0) raw += 3;

        // Step captions and titles
        for (const step of (scene.steps || [])) {
            if (step.caption && step.caption.trim().length > 0) raw += 3;
            if (step.title  && step.title.trim().length  > 0) raw += 1;
        }

        // Slider labels (descriptive label vs bare id)
        for (const step of (scene.steps || [])) {
            for (const sl of (step.sliders || [])) {
                if (sl.label && sl.label.trim() !== (sl.id || '').trim()) raw += 2;
            }
        }

        // Element ids and labels
        const elements = [...(scene.elements || [])];
        for (const step of (scene.steps || [])) elements.push(...(step.add || []));
        for (const el of elements) {
            if (!el) continue;
            if (el.id)    raw += 1;
            if (el.label) raw += 2;
        }

        // unsafe_explanation (explains why unsafe to user and agent)
        if (scene.unsafe && scene.unsafe_explanation) raw += 4;
    }

    // Domain docs bonus — imported domains have machine-readable docs
    const imports = Array.isArray(spec.import) ? spec.import : [];
    raw += imports.length * 10;

    // Top-level unsafe_explanation
    if (spec.unsafe && spec.unsafe_explanation) raw += 4;

    const score = Math.floor(100 * (1 - Math.exp(-raw / 80)));

    const label =
        score >= 80 ? 'Well Documented' :
        score >= 60 ? 'Good' :
        score >= 40 ? 'Moderate' :
        score >= 20 ? 'Sparse' : 'Minimal';

    const color =
        score >= 80 ? '#ffd700' :
        score >= 60 ? '#a0d4ff' :
        score >= 40 ? '#ffaa55' :
        score >= 20 ? '#ff9966' : '#aaa';

    return { score, label, color };
}

function _toggleJsIssuesPanel(panel) {
    if (!panel) return;
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        return;
    }

    const trusted = _sceneJsTrustState === 'trusted';
    const stateLabel = trusted
        ? '⚡ JS Trusted — expressions are running natively'
        : '⚠ JS Disabled — expressions are no-ops (returning 0 / "?")';
    const stateClass = trusted ? 'js-issues-state-trusted' : 'js-issues-state-untrusted';

    const explanationBlock = _sceneUnsafeExplanation
        ? `<div class="ji-explanation"><span class="ji-explanation-label">Scene-declared explanation:</span> ${_escHtml(_sceneUnsafeExplanation)}</div>`
        : '';

    const unsafeBanner = _sceneIsUnsafe
        ? `<div class="ji-unsafe-banner">⚠ This scene sets <code>unsafe: true</code> — all expressions execute as native JavaScript regardless of pattern matching.</div>`
        : '';

    const rows = _sceneJsIssues.map(({ path, expr, type }) => {
        const truncExpr = expr.length > 60 ? expr.slice(0, 57) + '…' : expr;
        const typeLabel = type === 'template' ? '{{…}} template' : 'expr field';
        const action = trusted ? '✅ Running' : '🚫 Disabled';
        return `<tr>
            <td class="ji-path" title="${_escHtml(path)}">${_escHtml(path)}</td>
            <td class="ji-expr" title="${_escHtml(expr)}"><code>${_escHtml(truncExpr)}</code></td>
            <td class="ji-type">${typeLabel}</td>
            <td class="ji-action ${trusted ? 'ji-running' : 'ji-disabled'}">${action}</td>
        </tr>`;
    }).join('');

    const noRows = _sceneJsIssues.length === 0
        ? `<tr><td colspan="4" class="ji-empty">No specific JS patterns detected — scene uses <code>unsafe: true</code> to opt in globally.</td></tr>`
        : '';

    panel.innerHTML =
        `<div class="ji-header ${stateClass}">${stateLabel}</div>` +
        explanationBlock +
        unsafeBanner +
        `<div class="ji-scroll"><table class="ji-table">` +
        `<thead><tr><th>JSON Path</th><th>Expression</th><th>Type</th><th>Action</th></tr></thead>` +
        `<tbody>${rows || noRows}</tbody></table></div>`;
    panel.classList.remove('hidden');
}

function _escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupJsonViewer() {
    const btn = document.getElementById('btn-show-json');
    const overlay = document.getElementById('json-viewer-overlay');
    const content = document.getElementById('json-viewer-content');
    const importsBar = document.getElementById('json-viewer-imports');
    const summaryBar = document.getElementById('json-viewer-summary');
    const closeBtn = document.getElementById('json-viewer-close');
    const copyBtn = document.getElementById('json-viewer-copy');

    const issuesPanel = document.getElementById('json-viewer-issues');

    if (!btn || !overlay) return;

    btn.addEventListener('click', () => {
        if (issuesPanel) issuesPanel.classList.add('hidden');
        let json;
        if (lessonSpec) {
            json = lessonSpec;
        } else if (typeof currentSpec !== 'undefined' && currentSpec) {
            json = currentSpec;
        }
        content.textContent = json ? JSON.stringify(json, null, 2) : '// No scene loaded';

        // Imports section
        const imports = json && Array.isArray(json.import) ? json.import : [];
        if (imports.length > 0 && importsBar) {
            importsBar.innerHTML = '<span class="imports-label">Imports</span>' +
                imports.map(name =>
                    `<a href="/api/domains/${encodeURIComponent(name)}" target="_blank" rel="noopener">${name} ↗</a>`
                ).join('');
            importsBar.classList.remove('hidden');
        } else if (importsBar) {
            importsBar.classList.add('hidden');
        }

        // Summary section
        const s = _computeSceneSummary(json);
        const ag = _computeAgenticScore(json);
        if (s && summaryBar) {
            const stats = [];
            if (s.isLesson) stats.push({ label: 'Scenes',      value: s.sceneCount,       tip: 'Number of scenes in this lesson' });
            stats.push(      { label: 'Steps',       value: s.totalSteps,        tip: 'Total progressive reveal steps across all scenes' });
            stats.push(      { label: 'Sliders',     value: s.totalSliders,      tip: 'Total interactive sliders defined across all steps' });
            stats.push(      { label: 'Animated',    value: s.totalAnimated,     tip: 'Elements re-evaluated every frame — respond to sliders and animation time' });
            stats.push(      { label: 'Static',      value: s.totalStatic,       tip: 'Elements built once at load — fixed geometry, zero per-frame cost' });
            if (s.totalExpressions > 0) stats.push({ label: 'Expressions', value: s.totalExpressions, tip: 'Individual math expression strings driving animated elements' });
            if (s.totalFunctions > 0)   stats.push({ label: 'Functions',   value: s.totalFunctions,   tip: 'Scene-level reusable expression helper functions (scene.functions)' });
            if (s.totalPrompts > 0)     stats.push({ label: 'Prompts',     value: s.totalPrompts,     tip: 'Scenes/steps with a prompt field — agent-specific teaching instructions injected into the AI system prompt' });
            if (s.imports > 0)          stats.push({ label: 'Domains',     value: s.imports,           tip: 'Built-in domain libraries imported (e.g. astrodynamics)' });

            const interactTip = 'Interactiveness Score (0–99)\n\nraw = Sliders × 10 + Animated × 6 + Steps × 4\n    + Expressions × 1 + Functions × 6 + Domains × 12\n\nscore = floor(100 × (1 − e^(−raw / 80)))\n\nApproaches 100 asymptotically — floor() ensures 100 is never displayed.\nraw ≈ 40 → score 39\nraw ≈ 80 → score 63\nraw ≈ 160 → score 86\nraw ≈ 280 → score 97';

            const agenticTip = 'Agentic Score (0–99) — how AI-agent-friendly this scene is\n\nMarkdown presence + length (up to 32)\nPrompt field per scene (up to 25 each)\nStep captions + titles (3 + 1 each)\nSlider labels — descriptive vs bare id (2 each)\nElement ids + labels (1 + 2 each)\nScene/lesson description (3–4)\nDomain imports with docs (10 each)\n\nscore = floor(100 × (1 − e^(−raw / 80)))';

            summaryBar.innerHTML =
                `<span class="summary-score" title="${interactTip}" style="--score-color:${s.scoreColor}">` +
                    `<span class="summary-score-value">${s.score}</span>` +
                    `<span class="summary-score-label">${s.scoreLabel}</span>` +
                `</span>` +
                (ag ? `<span class="summary-score summary-score-agentic" title="${agenticTip}" style="--score-color:${ag.color}">` +
                    `<span class="summary-score-value">${ag.score}</span>` +
                    `<span class="summary-score-label">${ag.label}</span>` +
                `</span>` : '') +
                `<span class="summary-divider"></span>` +
                stats.map(st =>
                    `<span class="summary-stat" title="${st.tip}"><span class="summary-stat-value">${st.value}</span><span class="summary-stat-label">${st.label}</span></span>`
                ).join('');
            if (s.description) {
                const desc = document.createElement('span');
                desc.className = 'summary-description';
                desc.textContent = s.description;
                summaryBar.appendChild(desc);
            }
            // JS Issues badge — shown when trust dialog was triggered
            const existingBadge = summaryBar.querySelector('.summary-stat-js-issues');
            if (existingBadge) existingBadge.remove();
            if (_sceneIsUnsafe || _sceneJsIssues.length > 0) {
                const trusted = _sceneJsTrustState === 'trusted';
                const count = _sceneIsUnsafe && _sceneJsIssues.length === 0 ? '!' : _sceneJsIssues.length;
                const badge = document.createElement('span');
                badge.className = 'summary-stat summary-stat-js-issues' + (trusted ? ' js-trusted' : ' js-untrusted');
                badge.title = 'Click to view detected JavaScript expressions and trust status';
                badge.innerHTML =
                    `<span class="summary-stat-value">${count}</span>` +
                    `<span class="summary-stat-label">JS ${trusted ? '⚡' : '⚠'}</span>`;
                summaryBar.appendChild(badge);
                badge.addEventListener('click', () => _toggleJsIssuesPanel(issuesPanel));
            } else if (issuesPanel) {
                issuesPanel.classList.add('hidden');
            }

            summaryBar.classList.remove('hidden');
        } else if (summaryBar) {
            summaryBar.classList.add('hidden');
        }

        overlay.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content.textContent).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
    });
}

function pickVideoRecorderFormat() {
    const webmOptions = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
    ];

    const mp4Options = [
        'video/mp4;codecs=avc3,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
    ];

    const preference = videoExportFormatPreference;
    const candidates = [];
    if (preference === 'webm') {
        candidates.push({ options: webmOptions, containerMime: 'video/webm', ext: 'webm' });
    } else if (preference === 'mp4') {
        candidates.push({ options: mp4Options, containerMime: 'video/mp4', ext: 'mp4' });
    } else {
        candidates.push(
            { options: webmOptions, containerMime: 'video/webm', ext: 'webm' },
            { options: mp4Options, containerMime: 'video/mp4', ext: 'mp4' },
        );
    }

    for (const candidate of candidates) {
        for (const mimeType of candidate.options) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                return {
                    mimeType,
                    containerMime: candidate.containerMime,
                    ext: candidate.ext,
                };
            }
        }
    }
    return null;
}

function sanitizeFilename(name) {
    return (name || 'algebench')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'algebench';
}

function updateVideoExportFormatUI() {
    const selected = videoExportFormatPreference;
    const label = document.getElementById('video-export-format-label');
    if (label) label.textContent = `(${selected === 'auto' ? 'Auto' : selected.toUpperCase()})`;
    document.querySelectorAll('#video-export-format-menu .toolbar-menu-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.format === selected);
    });
}

function getExportBaseName() {
    const title = (lessonSpec && lessonSpec.title)
        || (currentSpec && currentSpec.title)
        || 'algebench-export';
    return sanitizeFilename(title);
}

function cleanupVideoRecording() {
    if (videoRecordingStream) {
        videoRecordingStream.getTracks().forEach(track => track.stop());
        videoRecordingStream = null;
    }
}

function updateVideoRecordButtonUI() {
    const btn = document.getElementById('btn-video-record');
    if (!btn) return;
    updateVideoExportFormatUI();
    if (videoRecorder && videoRecorder.state === 'recording') {
        btn.classList.add('active');
        btn.title = 'Stop recording';
    } else {
        btn.classList.remove('active');
        btn.title = 'Record current tab video with TTS audio';
    }
}

async function startVideoExport() {
    const btn = document.getElementById('btn-video-record');
    if (!btn) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        alert('Screen recording is not supported in this browser.');
        return;
    }

    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'browser',
                cursor: 'never',
            },
            audio: false,
            preferCurrentTab: true,
        });

        const tracks = [...displayStream.getVideoTracks()];
        const getTTSStream = window.algebenchGetTTSAudioStream;
        if (typeof getTTSStream === 'function') {
            const ttsStream = getTTSStream();
            if (ttsStream) tracks.push(...ttsStream.getAudioTracks());
        }
        const combinedStream = new MediaStream(tracks);
        videoRecordingStream = displayStream;

        const selected = pickVideoRecorderFormat();
        if (!selected) throw new Error('No supported recorder format');
        videoRecordingMime = selected.containerMime;
        videoRecordingExt = selected.ext;

        videoRecordedChunks = [];
        videoRecorder = new MediaRecorder(combinedStream, {
            mimeType: selected.mimeType,
            videoBitsPerSecond: 3000000,
        });

        videoRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) videoRecordedChunks.push(event.data);
        };

        videoRecorder.onerror = (event) => {
            const error = event?.error || event;
            console.error('Video recorder error:', error);
        };

        videoRecorder.onstop = () => {
            const blob = new Blob(videoRecordedChunks, { type: videoRecordingMime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${getExportBaseName()}_${Date.now()}.${videoRecordingExt}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            cleanupVideoRecording();
            videoRecorder = null;
            updateVideoRecordButtonUI();
        };

        displayStream.getVideoTracks()[0].onended = () => {
            if (videoRecorder && videoRecorder.state === 'recording') videoRecorder.stop();
        };

        videoRecorder.start(150);
        updateVideoRecordButtonUI();
    } catch (err) {
        cleanupVideoRecording();
        videoRecorder = null;
        updateVideoRecordButtonUI();
        console.error('Video export failed:', err);
        alert('Failed to start video export. Select the current browser tab when prompted.');
    }
}

function setupVideoExportControls() {
    const btn = document.getElementById('btn-video-record');
    const menu = document.getElementById('video-export-format-menu');
    if (!btn || !menu) return;

    updateVideoRecordButtonUI();

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (videoRecorder && videoRecorder.state === 'recording') {
            videoRecorder.stop();
            return;
        }
        menu.classList.toggle('open');
    });

    menu.querySelectorAll('.toolbar-menu-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            videoExportFormatPreference = item.dataset.format || 'auto';
            updateVideoRecordButtonUI();
            menu.classList.remove('open');
            await startVideoExport();
        });
    });

    document.addEventListener('click', () => {
        menu.classList.remove('open');
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initMathBox();
    setupRollDrag(document.getElementById('mathbox-container'));
    setupTrackpadPan();
    setupDragDrop();
    setupFilePicker();
    setupScenesDropdown();
    setupVideoExportControls();
    setupSettingsPanel();
    initLightControls();
    setupProjectionToggle();
    setupPanelResize();
    setupExplainToggle();
    setupFollowAngleLockToggle();
    setupDocSpeakButtons();
    setupSceneDock();
    setupCaptionDrag();
    setupSceneDescDrag();
    setupJsonViewer();
    setupCamStatusPopup();
    loadBuiltinScenesList();
    await loadInitialSceneFromQuery();
});
