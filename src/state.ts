// ============================================================
// Shared mutable application state.
// All modules import this object and read/write its properties.
// ============================================================

import type { CompiledExpr } from '/expr.js';
import type { ResolvedCameraView } from '/camera.js';
import type { Label3D } from '/labels.js';
import type { SceneSlider, AnimExprEntry, AnimUpdater } from '/sliders.js';
import type { ProofEntry } from '/proof.js';
import type { TrustIssue } from '/trust.js';
import type {
    BufferGeometry, Camera, DirectionalLight, Material, Mesh, Points, Quaternion,
    Texture, WebGLRenderer,
} from 'three';

// ------------------------------------------------------------
// The shapes the fields below hold.
//
// Types owned and EXPORTED by the module that writes them are imported above
// rather than restated. The rest are declared here because their owning module
// keeps them private; each names that owner so the two can be compared. This
// module deliberately does NOT reach into feature modules for private types —
// state is imported by every module in the app, so a type-only import of a
// private shape would be an invitation to a real cycle later.
//
// Every module still casts `state` down to its own narrow slice
// (`state as unknown as FooState`). Those slices stay: they document what one
// module touches, which this whole-object type cannot.
// ------------------------------------------------------------

/**
 * A line/axis/vector-line registry entry. Union of what the src/objects/
 * renderers push and what src/camera.ts, src/overlay.ts and
 * src/scene-loader.ts read back — hence everything but `node` is optional;
 * different renderers publish different subsets.
 *
 * NOTE: the per-array comments below (carried over verbatim) list
 * `{ node, baseWidth, widthParam, anchorDataPos|anchorDataPosFn }` and omit
 * `baseOpacity`, which src/scene-loader.ts reads.
 */
interface LineNodeEntry {
    node: MathBoxNode | null;
    baseWidth?: number;
    widthParam?: string;
    baseOpacity?: number;
    anchorDataPos?: number[];
    anchorDataPosFn?: unknown;
}

/** A MathBox point primitive's registry entry (src/objects/point.ts). */
interface PointNodeEntry {
    node: MathBoxNode | null;
}

/** A mesh the scene loader can hide or dispose. `_hiddenByRemove` is the
 *  codebase's own flag (src/objects/). */
type RemovableMesh = Mesh<BufferGeometry, Material> & { _hiddenByRemove?: boolean };

/** An arrow-registry entry: the head or shaft mesh of a vector, plus the
 *  bookkeeping src/scene-loader.ts uses to slice one element's meshes back
 *  out. */
interface ArrowMeshEntry {
    mesh: RemovableMesh;
    isShaft?: boolean;
    owner?: object;
}

/** An element's entry in the id → element registry. `tracker` is
 *  src/scene-loader.ts's private SubTracker; only that module opens it. */
interface ElementRegistryEntry {
    tracker: unknown;
    hidden: boolean;
    type?: string;
    prompt?: string | null;
    label?: string | null;
}

/**
 * One entry of the animated-element position registry, written each frame by
 * the animated renderers (src/objects/animated-*.ts).
 *
 * NOTE: the field comment below says "id -> [x,y,z]", but the value has never
 * been a bare triple — it is this record. Kept as-is; src/follow-cam.ts
 * already documents the same drift.
 */
interface AnimPosEntry {
    pos: number[];
    time: number;
    /** Vector-shaped elements publish both endpoints; points publish neither. */
    from?: number[];
    to?: number[];
    /** When the element's animation began. */
    startTime?: number;
}

/** The in-flight alt-drag camera roll (src/camera.ts's private RollDragState). */
interface RollDragState {
    x: number;
    awaitingMouseUp: boolean;
}

/** The orbit/trackball controls fields the loader and follow-cam save and
 *  restore around a camera takeover. */
interface SavedControlsState {
    enableDamping?: boolean;
    dampingFactor?: number;
}

/** Display parameters, mutated by the settings panel (src/overlay.ts). */
interface DisplayParams {
    labelScale: number;
    arrowScale: number;
    axisWidth: number;
    vectorWidth: number;
    labelOpacity: number;
    arrowOpacity: number;
    axisOpacity: number;
    vectorOpacity: number;
    lineWidth: number;
    lineOpacity: number;
    planeScale: number;
    planeOpacity: number;
    captionScale: number;
    overlayOpacity: number;
    labelDeclutterMode: 'shade' | 'position' | 'off';
    labelDeclutterGap: number;
    labelDeclutterMaxStack: number;
    labelDeclutterAlpha: number;
    labelDimBase: number;
    labelDimFloor: number;
    labelDimDepthScale: number;
    labelDimAlpha: number;
    labelDimHideThreshold: number;
    labelDimHideLevel: number;
}

/** The in-flight slider drag (src/sliders.ts). */
interface SliderDragState {
    active: boolean;
    startX: number;
    startY: number;
    startLeft: number;
    startBottom: number;
}

/** A validated scene function, before and after compilation. Mirrors
 *  src/expr.ts's private SceneFunctionDef — expr.ts is the only writer. */
interface SceneFunctionDefEntry {
    name: string;
    args: string[];
    expr: string;
    compiled: CompiledExpr;
}

/** The shared mutable application state. */
export interface AppState {
    // ----- Core Three.js / MathBox instances -----
    mathbox: MathBoxRoot | null;
    three: MathBoxThree | null;
    /**
     * The active camera. Perspective or orthographic — src/camera.ts swaps the
     * instance on projection change and declares the wider structural view it
     * needs; the base class is what is true for every reader.
     */
    camera: Camera | null;
    controls: ThreeControls | null;
    renderer: WebGLRenderer | null;

    // ----- Scene rendering -----
    /**
     * `| undefined` on purpose: loadScene(undefined) stores undefined here, so
     * the two absent-values stay observably distinct (src/scene-loader.ts).
     * Typed loosely rather than as the generated `Scene` because scenes also
     * arrive from the AI and are guarded field-by-field at each use site.
     */
    currentSpec: AlgeBenchSceneSpec | null | undefined;
    labels: Label3D[];
    animationFrameId: number | null;
    cameraAnimating: boolean;
    currentProjection: string;
    perspCamera: Camera | null;
    arrowMeshes: ArrowMeshEntry[];
    axisLineNodes: LineNodeEntry[];
    vectorLineNodes: LineNodeEntry[];
    lineNodes: LineNodeEntry[];
    planeMeshes: RemovableMesh[];
    pointNodes: PointNodeEntry[];
    worldStarfield: Points | null;
    worldSkybox: { texture: Texture } | null;
    _planeMeshSerial: number;
    currentRange: number[][];
    currentScale: number[];
    /** The scale the scene DECLARED, or [1,1,1] if it declared none. The
     *  effective scale content is drawn at is `currentScale`, which differs
     *  whenever the scene left it to `isotropicScale`. */
    declaredScale: number[];
    sceneView: MathBoxNode | null;
    mainDirLight: DirectionalLight | null;

    // ----- Lesson / navigation -----
    /** Loose for the same reason as `currentSpec`. */
    lessonSpec: AlgeBenchLessonSpec | null | undefined;
    currentSceneIndex: number;
    currentStepIndex: number;
    /**
     * `true` while auto-play is starting up, before the first timer id lands —
     * startAutoPlay() sets the flag so a re-entrant call bails, then
     * scheduleNextAutoPlay() overwrites it with the real handle.
     */
    autoPlayTimer: ReturnType<typeof setTimeout> | boolean | null;
    visitedSteps: Set<string>;
    /** src/scene-loader.ts's private StepTracker; only that module opens one. */
    stepTrackers: unknown[];
    elementRegistry: Record<string, ElementRegistryEntry>;
    sceneSliders: Record<string, SceneSlider>;

    // ----- Camera / controls -----
    sceneUp: number[];
    rollDrag: RollDragState | null;
    arcballMomentum: number;
    arcballInertiaId: number | null;
    arcballInertiaQ: Quaternion | null;
    arcballLastMoveTime: number;
    /** src/follow-cam.ts's private FollowCamStateShape. */
    followCamState: unknown;
    followCamStartTime: number;
    followCamAngleLock: boolean;
    followCamSavedControls: SavedControlsState | null;
    /** src/camera.ts's private CameraExprState. */
    cameraExprState: unknown;
    cameraExprStartTime: number;
    CAMERA_VIEWS: Record<string, ResolvedCameraView>;
    camPopupPinned: boolean;

    // ----- Animation -----
    animatedElementPos: Record<string, AnimPosEntry>;
    activeAnimUpdaters: AnimUpdater[];
    sceneStartTime: number;
    activeAnimExprs: AnimExprEntry[];

    // ----- Expression / eval -----
    activeVirtualTimeExpr: string | null;
    activeVirtualTimeCompiled: CompiledExpr | null;
    activeSceneExprFunctions: Record<string, (...args: unknown[]) => unknown>;
    activeSceneFunctionDefs: SceneFunctionDefEntry[];
    _activeDomainFunctions: Record<string, unknown>;
    /** src/expr.ts's private ExprEvalFrame — the per-frame eval memo. */
    _activeExprEvalFrame: unknown;

    // ----- Trust -----
    _sceneJsTrustState: 'trusted' | 'untrusted' | null;
    _sceneJsIssues: TrustIssue[];
    _sceneIsUnsafe: boolean;
    _sceneUnsafeExplanation: string;

    // ----- Video recording -----
    videoRecorder: MediaRecorder | null;
    videoRecordedChunks: Blob[];
    videoRecordingStream: MediaStream | null;
    videoRecordingExt: string;
    videoRecordingMime: string;
    /**
     * `'auto' | 'webm' | 'mp4'` in practice, but src/ui.ts assigns it straight
     * from a `data-format` attribute, so `string` is what can actually land.
     */
    videoExportFormatPreference: string;

    // ----- Display parameters (mutated by settings panel) -----
    displayParams: DisplayParams;

    // ----- UI -----
    legendToggledOff: Set<string>;
    currentSceneSourceLabel: string;
    currentSceneSourcePath: string;

    // ----- Proof / derivation -----
    proofSpec: ProofEntry[] | null;
    proofAllSpecs: ProofEntry[] | null;
    proofActiveIndex: number;
    proofStepIndex: number;
    proofStepMemory: Record<string, number>;
    proofViewMode: 'list' | 'slide';
    proofSyncEnabled: boolean;
    proofExpanded: boolean;
    _proofSyncInProgress: boolean;
    _graphSyncInProgress: boolean;
    _proofTabMode: 'context' | 'all';
    _proofPreRendered: HTMLElement[] | null;
    _proofPreRenderedAll: Record<string, HTMLElement[]>;

    // ----- Scene data tables (from JSON "data" field) -----
    sceneData: Record<string, unknown>;

    // ----- Slider drag (used within sliders.js) -----
    _sliderDrag: SliderDragState;
}

export const state: AppState = {
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
    declaredScale: [1, 1, 1],
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
    cameraExprState: null,
    cameraExprStartTime: 0,
    CAMERA_VIEWS: {},
    camPopupPinned: false,

    // ----- Animation -----
    // id -> { pos, time, from?, to?, startTime? } — updated each frame. NOT a
    // bare [x,y,z]: `from`/`to` are present only for vector-shaped elements, and
    // that is how follow-cam.ts tells a vector from a point. See AnimPosEntry.
    animatedElementPos: {},
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
        captionScale: 1.0, overlayOpacity: 1.0,
        // Declutter of overlapping 3D labels. Mode: 'shade' (dim the ones behind
        // by depth — never moves text), 'position' (nudge them apart vertically),
        // or 'off'. 'shade' is the default.
        labelDeclutterMode: 'shade',
        labelDeclutterGap: 4, labelDeclutterMaxStack: 5, labelDeclutterAlpha: 0.25, // position mode
        labelDimBase: 0.7, labelDimFloor: 0.4, labelDimDepthScale: 0.5, labelDimAlpha: 0.2, // shade mode
        // In shade mode, once a cluster stacks this many overlapping labels, the
        // nearest (labelDimHideThreshold - 1) are kept and every farther label
        // fades to labelDimHideLevel *opacity* (transparent, not darkened) so the
        // front labels read cleanly. e.g. threshold 4 keeps the 3 nearest.
        labelDimHideThreshold: 4, labelDimHideLevel: 0.1,
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
    _proofSyncInProgress: false,  // guard against infinite proof↔scene sync loops
    _graphSyncInProgress: false,  // guard against infinite graph↔proof sync loops
    _proofTabMode: 'context',    // 'context' | 'all' — which proof tab is active
    _proofPreRendered: null,      // cached pre-rendered step HTML nodes (per active proof)
    _proofPreRenderedAll: {},     // cached pre-rendered step HTML nodes keyed by proof id

    // ----- Scene data tables (from JSON "data" field) -----
    sceneData: {},

    // ----- Slider drag (used within sliders.js) -----
    _sliderDrag: { active: false, startX: 0, startY: 0, startLeft: 0, startBottom: 0 },
};
