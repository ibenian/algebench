// ============================================================
// Shared mutable application state.
// All modules import this object and read/write its properties.
// ============================================================

export const state = {
    // ----- Core Three.js / MathBox instances -----
    mathbox: null,
    three: null,
    camera: null,
    controls: null,
    renderer: null,

    // ----- Scene rendering -----
    currentSpec: null,
    labels: [],
    animationFrameId: null,
    cameraAnimating: false,
    currentProjection: 'perspective',
    perspCamera: null,
    arrowMeshes: [],
    axisLineNodes: [],    // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
    vectorLineNodes: [],  // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
    lineNodes: [],        // { node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }
    planeMeshes: [],      // Three.js meshes for planes/polygons
    pointNodes: [],       // { node } for MathBox point elements
    worldStarfield: null, // Three.js Points for inertial background reference
    worldSkybox: null,    // { texture } for scene.background skybox
    _planeMeshSerial: 0,  // monotonically increasing counter for stable depth ordering
    currentRange: [[-5, 5], [-5, 5], [-5, 5]],
    currentScale: [1, 1, 1],
    sceneView: null,      // MathBox cartesian view for current scene
    mainDirLight: null,   // main directional light, controlled via settings panel

    // ----- Lesson / navigation -----
    lessonSpec: null,
    currentSceneIndex: -1,
    currentStepIndex: -1,   // -1 = base elements only
    autoPlayTimer: null,
    visitedSteps: new Set(), // "sceneIdx:stepIdx"
    stepTrackers: [],
    elementRegistry: {},    // id -> { tracker, hidden }
    sceneSliders: {},        // id -> { value, min, max, step, label, default }

    // ----- Camera / controls -----
    sceneUp: [0, 1, 0],
    rollDrag: null,
    arcballMomentum: 0.5,
    arcballInertiaId: null,
    arcballInertiaQ: null,
    arcballLastMoveTime: 0,
    followCamState: null,
    followCamStartTime: 0,
    followCamAngleLock: false,
    followCamSavedControls: null,
    CAMERA_VIEWS: {},
    camPopupPinned: false,

    // ----- Animation -----
    animatedElementPos: {},  // id -> [x,y,z] in data space — updated each frame
    activeAnimUpdaters: [],
    sceneStartTime: 0,
    activeAnimExprs: [],     // { exprStrings, animState, updateFns }

    // ----- Expression / eval -----
    activeVirtualTimeExpr: null,
    activeVirtualTimeCompiled: null,
    activeSceneExprFunctions: {},
    activeSceneFunctionDefs: [],
    _activeDomainFunctions: {},
    _activeExprEvalFrame: null,

    // ----- Trust -----
    _sceneJsTrustState: null,   // null | 'trusted' | 'untrusted'
    _sceneJsIssues: [],          // { path, expr, type }
    _sceneIsUnsafe: false,
    _sceneUnsafeExplanation: '',

    // ----- Video recording -----
    videoRecorder: null,
    videoRecordedChunks: [],
    videoRecordingStream: null,
    videoRecordingExt: 'webm',
    videoRecordingMime: 'video/webm',
    videoExportFormatPreference: 'auto',

    // ----- Display parameters (mutated by settings panel) -----
    displayParams: {
        labelScale: 1.0, arrowScale: 1.0, axisWidth: 1.0, vectorWidth: 1.0,
        labelOpacity: 1.0, arrowOpacity: 1.0, axisOpacity: 1.0, vectorOpacity: 1.0,
        lineWidth: 1.0, lineOpacity: 1.0, planeScale: 1.0, planeOpacity: 0.2,
        captionScale: 1.0, overlayOpacity: 0.7,
    },

    // ----- UI -----
    legendToggledOff: new Set(),
    currentSceneSourceLabel: '',
    currentSceneSourcePath: '',

    // ----- Proof / derivation -----
    proofSpec: null,              // normalized array of in-context proof objects (or empty array)
    proofAllSpecs: null,          // all proofs in the lesson (for "All" tab)
    proofActiveIndex: 0,          // which proof in proofSpec is currently selected
    proofStepIndex: -1,           // current proof step (-1 = goal overview)
    proofStepMemory: {},          // per-proof step index memory keyed by proof id
    proofViewMode: 'slide',       // 'list' | 'slide'
    proofSyncEnabled: true,       // bidirectional sceneStep linking
    proofExpanded: false,         // whether proof panel is expanded in chat tab
    _proofSyncInProgress: false,  // guard against infinite sync loops
    _proofTabMode: 'context',    // 'context' | 'all' — which proof tab is active
    _proofPreRendered: null,      // cached pre-rendered step HTML nodes (per active proof)
    _proofPreRenderedAll: {},     // cached pre-rendered step HTML nodes keyed by proof id

    // ----- Slider drag (used within sliders.js) -----
    _sliderDrag: { active: false, startX: 0, startY: 0, startLeft: 0, startBottom: 0 },
};
