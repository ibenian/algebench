// Ambient declarations for the libraries AlgeBench loads as CDN globals, and
// for the small set of first-party globals the converted modules touch.
//
// These libraries are NOT bundled — index.html/prove.html/renderproof.html load
// them as classic <script> tags from jsdelivr, so at runtime they are plain
// globals. The matching npm packages are dev-only devDependencies, installed
// solely so `typeof import(...)` can borrow their types; nothing here reaches
// the browser.
//
// These four are pinned EXACTLY in package.json — no caret. A caret would let
// `npm update` pull types a minor ahead of the CDN bundle (mathjs ^13.0.0
// reaches 13.2.3, marked ^12.0.0 reaches 12.0.2), which types the code against
// APIs the page never loaded: it compiles, then fails at runtime. Bump these
// only together with the corresponding <script> tag in the HTML.
//
//   three   0.137.0   @types/three@0.137.0   (index.html)
//   katex   0.16.9    @types/katex@0.16.8    (all three pages)
//   marked  12.0.0    bundled types          (index.html, prove.html)
//   mathjs  13.0.0    bundled types          (index.html)
//   d3      7          @types/d3@7.4.3        (CDN import in d3-semantic-graph)
//   dagre   1.1.4     bundled types          (CDN <script> in d3-semantic-graph)
//
// d3 and dagre differ from the four above in HOW they load — d3 via an `+esm`
// dynamic import and dagre via an injected <script> that self-attaches to
// `window`, both from inside src/graph-panel/d3-semantic-graph.ts rather than
// from an HTML <script> tag. The pinning rule is the same either way: the
// devDependency exists only to borrow types, and must track the CDN URL.
//
// @types/katex is one patch behind on purpose: 0.16.8 is the newest published,
// and a KaTeX patch release adds no API.
//
// MathBox (2.3.1) is absent here on purpose: it has no published types and no
// npm package to borrow from, so its chained-builder API is hand-written in
// src/mathbox.d.ts instead — deliberately minimal, covering only the surface
// the converted modules actually drive.

/**
 * The orbit/trackball controls index.html loads from three's deprecated
 * `examples/js/` path, which attaches them onto the THREE global rather than
 * exporting a module. @types/three@0.137 does not cover that path (the typed
 * versions live under `examples/jsm/`), so the slice src/camera.ts drives is
 * declared by hand. Retiring `examples/js/` is tracked in the migration
 * proposal's post-migration work.
 */
interface ThreeControls {
    target: import('three').Vector3;
    enabled: boolean;
    update(): void;
    dispose(): void;
    addEventListener(type: string, listener: () => void): void;

    // ---- OrbitControls ----
    enableDamping?: boolean;
    dampingFactor?: number;
    enableZoom?: boolean;
    enableRotate?: boolean;
    enablePan?: boolean;
    screenSpacePanning?: boolean;
    mouseButtons?: Record<string, unknown>;
    touches?: Record<string, unknown>;
    minDistance?: number;
    maxDistance?: number;

    // ---- TrackballControls ----
    // Same concepts under the older names, plus its own damping model.
    rotateSpeed?: number;
    zoomSpeed?: number;
    panSpeed?: number;
    noRotate?: boolean;
    noZoom?: boolean;
    noPan?: boolean;
    staticMoving?: boolean;
    dynamicDampingFactor?: number;
}

type ThreeControlsCtor = new (
    camera: import('three').Camera,
    domElement: HTMLElement,
) => ThreeControls;

/** three.js, loaded from CDN as a global (index.html). */
declare const THREE: typeof import('three') & {
    OrbitControls?: ThreeControlsCtor;
    TrackballControls?: ThreeControlsCtor;
};

/** KaTeX, loaded from CDN as a global on every page. */
declare const katex: typeof import('katex');

/** Marked, loaded from CDN as a global (index.html, prove.html). */
declare const marked: typeof import('marked');

/** math.js, loaded from CDN as a global (index.html). */
declare const math: typeof import('mathjs');

/**
 * A domain library's exported functions, as registered by
 * static/domains/<name>/index.js. `_init` is an optional lifecycle hook the
 * expression sandbox calls once with scene accessors; every other key is a
 * function callable from scene expressions.
 */
interface AlgeBenchDomainFunctions {
  _init?: (api: { getSlider(id: string, fallback?: number): number }) => void;
  [fn: string]: unknown;
}

/**
 * Domain library registry (src/main.js). Domains are injected as <script> at
 * runtime from a URL built out of lesson data, so they can never be bundled —
 * they self-register onto this global.
 */
interface AlgeBenchDomainRegistry {
  _registry: Record<string, AlgeBenchDomainFunctions | undefined>;
  register(name: string, functions: AlgeBenchDomainFunctions): void;
}

/**
 * The semantic-graph controller (src/graph-view.ts) publishes itself on
 * `window.__algebenchGraph` so other modules can drive the graph without
 * importing it. Now that graph-view is TypeScript, its publish site is checked
 * against this interface, so the two cannot drift. Members stay optional
 * because the module is loaded lazily — every call site still guards with
 * `typeof … === 'function'`.
 */
interface AlgeBenchGraphController {
  /** Returns true when a page was opened or re-focused, false when there was
   *  nothing to show (no `latex`, and no artifact matching `id`). */
  openFunctionAnalysis?(opts?: { id?: string | null; latex?: string | null }): boolean;
  /**
   * Leave the full-screen Math view and show the scene dock's Scenes tab.
   * src/scene-loader.ts prefers this over toggling the tab classes itself, and
   * falls back to doing so when the graph controller is absent.
   */
  showSceneView?(): void;
  /** Close a Function Analysis page left open by the previous view. */
  closeFunctionAnalysis?(): void;
  /** The artifact id of the Function Analysis page currently showing, if any. */
  getFunctionAnalysisId?(): string | null;
  /** 'math' when the Math tab is active, else 'scene'. */
  getCurrentView?(): string;
  /** Show the Math (graph) view; resolves once the graph has rendered. */
  showGraphView?(): Promise<void> | void;
  /** Ordered node selection, last entry = active. */
  getSelection?(): string[];
  /** Stash a selection for the graph to apply once its renderer has drawn. */
  applyDeeplinkSelection?(ids: string[]): void;
  /** True when the graph is in the docked (split) layout. */
  isDocked?(): boolean;
  /** Force the docked layout on/off WITHOUT persisting the preference. */
  setDocked?(on: boolean): void;
  /** Fetch a pre-baked proof animation and dock it onto `nodeId`. */
  dockProofAnimation?(
    proofPath: string,
    nodeId?: string | null,
    step?: number,
  ): Promise<void> | void;
}

/**
 * First-party events dispatched on `window`. Only the ones whose `detail` a
 * converted module reads are mapped — the rest stay plain `Event` listeners.
 */
interface WindowEventMap {
  /**
   * The Function Analysis page opened, closed, or renamed itself.
   * `detail.replace` marks the rename (same view, new id), which
   * src/view-state-bridge.ts turns into a replaceView rather than a push.
   */
  'algebench:fachange': CustomEvent<{ replace?: boolean } | undefined>;
}

// ── gemini-live-tools browser globals ───────────────────────────────────────
// index.html loads voice-character-selector.js and tts-audio-player.js as
// CLASSIC <script> tags served out of the installed gemini_live_tools Python
// package (backend/server.py). They are not on npm and ship no types, so the
// slice src/chat.ts actually uses is declared by hand here.

/** One entry of `CHARACTER_OPTIONS` from voice-character-selector.js. */
interface GeminiCharacterOption {
  id: string;
  defaultVoice?: string;
  [key: string]: unknown;
}

/** The picker instance returned by `new lib.CharacterPicker(...)`. */
interface GeminiCharacterPicker {
  /** Wire up the DOM and return the initially-selected character id. */
  init(): string;
}

interface GeminiCharacterPickerConfig {
  buttonEl: HTMLElement;
  paletteEl: HTMLElement;
  searchEl: HTMLElement;
  listEl: HTMLElement;
  backdropEl: HTMLElement;
  options: GeminiCharacterOption[];
  groupMap: unknown;
  groupOrder: unknown;
  storageKey: string;
  recentsKey: string;
  defaultId: string;
  hotkey: string;
  onChange(characterId: string): void;
}

/** `window.GeminiVoiceCharacterSelector` (voice-character-selector.js). */
interface GeminiVoiceCharacterSelectorLib {
  CHARACTER_OPTIONS: GeminiCharacterOption[];
  CHARACTER_GROUPS: unknown;
  CHARACTER_GROUP_ORDER: unknown;
  CharacterPicker: new (config: GeminiCharacterPickerConfig) => GeminiCharacterPicker;
  /** Populate a <select> with voices; returns the selected voice name. */
  setupVoiceSelect(
    el: HTMLSelectElement,
    opts: { includeSystem: boolean; storageKey: string; defaultValue: string },
  ): string;
}

/** A `TTSAudioPlayer` instance (tts-audio-player.js). */
interface GeminiTTSAudioPlayer {
  /** Internal player phase, read directly by the chat button-state poller. */
  _state: 'idle' | 'loading' | 'playing';
  /** Internal AudioContext; absent until the first play. */
  _ctx: AudioContext | null;
  isPlaying(): boolean;
  isMuted(): boolean;
  getVolume(): number;
  setVolume(volume: number): void;
  toggleMute(): void;
  stop(): void;
  getMediaStream(): MediaStream | null;
  playStreamWithAbort(response: Response, abort: AbortController): Promise<void>;
}

/** `window.GeminiTTSPlayer` (tts-audio-player.js). */
interface GeminiTTSPlayerLib {
  TTSAudioPlayer: new (opts: {
    volume: number;
    persistKey: string;
    onVolumeChange(volume: number, muted: boolean): void;
  }) => GeminiTTSAudioPlayer;
}

// ── The chat context snapshot ───────────────────────────────────────────────
// Built by src/chat.ts and published as window.algebenchBuildChatContext,
// which src/json-browser.js reads. Declared here (rather than exported from
// chat.ts) because chat.ts is a side-effecting entry module with no exports.

interface AlgeBenchChatSceneTreeStep {
  stepNumber: number;
  title: string;
  description: string;
}

interface AlgeBenchChatSceneTreeEntry {
  sceneNumber: number;
  title: string;
  steps?: AlgeBenchChatSceneTreeStep[];
}

interface AlgeBenchChatRuntimeContext {
  stepNumber?: number;
  cameraPosition?: { x: number; y: number; z: number };
  cameraTarget?: { x: number; y: number; z: number };
  cameraViews?: string[];
  visibleElements?: { label: string; type: string }[];
  sliders?: Record<string, AlgeBenchSliderState>;
  currentCaption?: string;
  activeTab?: string;
  projection?: string;
  proof?: unknown;
  graphPanel?: AlgeBenchGraphPanelState;
  lastFocusedSurface?: string;
  userViewing?: string[];
  coach?: unknown;
}

interface AlgeBenchChatContext {
  lessonTitle?: string;
  totalScenes?: number;
  sceneNumber?: number;
  currentScene?: AlgeBenchSceneSpec;
  sceneTree?: AlgeBenchChatSceneTreeEntry[];
  runtime?: AlgeBenchChatRuntimeContext;
}

interface Window {
  AlgeBenchDomains: AlgeBenchDomainRegistry;
  katex: typeof katex;
  marked: typeof marked;
  /**
   * dagre, injected as a classic <script> from jsdelivr by
   * src/graph-panel/d3-semantic-graph.ts (loadDagre) the first time a semantic
   * graph is laid out. Optional: absent until that script has run.
   */
  dagre?: typeof import('@dagrejs/dagre');
  /**
   * src/labels.ts — published onto window so modules that cannot import it
   * (and the inline pages) can feature-detect it before calling.
   */
  renderKaTeX?: typeof renderKaTeX;
  /**
   * Every ProofAnimator the /renderproof page built, in card order
   * (src/renderproof.ts). A debugging handle, and how autoplay reaches the
   * animators after the load loop has finished.
   */
  __animators: import('/proof-animation/proof-animation.js').ProofAnimator[];
  __algebenchGraph?: AlgeBenchGraphController;
  /**
   * Mermaid, injected as a CDN <script> by src/graph-view.ts's loadMermaidLib()
   * on first use — index.html deliberately does NOT include it, so it is absent
   * until the Math tab is first opened. Every call site feature-detects with
   * `typeof window.mermaid === 'undefined'`, which is why this is optional.
   */
  mermaid?: MermaidLib;
  /** src/graph-view.ts — debugging handle on the semantic-graph controller. */
  graphView?: AlgeBenchGraphViewDebug;
  /**
   * src/graph-view.ts — switch to the Math (graph) view, resolving once the
   * graph has rendered. Separate from `__algebenchGraph.showGraphView` because
   * this one is also reachable from the inline pages.
   */
  algebenchEnsureGraphVisible?: () => Promise<boolean>;

  // ---- gemini-live-tools classic scripts (index.html only) ----
  GeminiVoiceCharacterSelector?: GeminiVoiceCharacterSelectorLib;
  GeminiTTSPlayer?: GeminiTTSPlayerLib;

  // ---- Published by src/main.ts for the modules that still reach them via
  // `window` rather than an import. Declared as the exported functions
  // themselves so the publish site in main.ts and every reader agree.
  // (The rest of main.ts's publish list is already declared as bare globals in
  // the "First-party globals src/chat.ts READS" section further down; those
  // land on `typeof globalThis`, which `window.x` also resolves through.)
  /** src/scene-loader.ts — load a lesson (or single scene) spec. */
  loadLesson: typeof import('/scene-loader.js').loadLesson;
  /** src/scene-loader.ts — load one scene spec. */
  loadScene: typeof import('/scene-loader.js').loadScene;
  /** src/scene-loader.ts — true when a spec is the multi-scene lesson format. */
  isLessonFormat: typeof import('/scene-loader.js').isLessonFormat;
  /** src/view-state-bridge.js — snapshot the current view as a deeplink. */
  captureViewState: typeof import('/view-state-bridge.js').captureViewState;
  /** src/view-state-bridge.js — restore a deeplinked view. Read back by
   *  src/ui.ts's initial-load path and by the popstate listener. */
  applyViewState: typeof import('/view-state-bridge.js').applyViewState;
  /** src/proof.ts — load a proof into the proof panel. */
  loadProof: typeof import('/proof.js').loadProof;

  // ---- Read by src/chat.ts, published by other modules ----
  /** src/main.js — inline avatar SVGs for chat messages. */
  algebenchIcons?: { ai: string; user: string };
  /** src/graph-view.js — current semantic-graph dock state. */
  algebenchGetGraphPanelState?: () => AlgeBenchGraphPanelState | null;
  /** src/graph-view.ts — leave the full-screen Math view if the user is on it.
   *  Returns true when it actually switched tabs. */
  algebenchEnsureSceneVisible?: () => boolean;
  /** src/graph-view.js — start a client-side derivation on the current graph. */
  algebenchDeriveProof?: (args: {
    target_latex?: string;
    start_latex?: string;
    prompt?: string;
  }) => Promise<boolean>;
  /**
   * src/graph-view.js — dock a proof-step derivation into the semantic-graph
   * canvas. Resolves false when the step has no graph to dock onto, which is
   * how src/proof.ts knows to fall back to an in-panel box.
   */
  algebenchDeriveProofPayload?: (
    payload: import('/proof-animation/derive-payload.js').DerivePayload,
  ) => Promise<boolean>;
  /** src/json-browser.js — re-read the prompt-context popup. */
  algebenchRefreshPromptContext?: (reason?: string) => void;
  // ---- Circular-import shims, called by src/sliders.ts ----
  // sliders.ts is imported by overlay.js and scene-loader.js, so it cannot
  // import them back. Both publish these under the same names they call.
  /** src/overlay.js — re-evaluate every info overlay's interpolated values. */
  _algebenchUpdateInfoOverlays?: () => void;
  /** src/overlay.js — redraw the status bar's slider pill. */
  _algebenchUpdateStatusBar?: () => void;
  // Published by src/scene-loader.ts, called by src/overlay.js — the legend's
  // per-element toggles, reached this way for the same circular-import reason.
  /** src/scene-loader.ts — fade an element out and mark it hidden. */
  _algebenchHideElementById?: (id: string) => void;
  /** src/scene-loader.ts — fade a hidden element back in. */
  _algebenchShowElementById?: (id: string) => void;
  /** src/trust.ts, published by src/scene-loader.ts — redraw the JS-trust pill. */
  _algebenchUpdateJsTrustPill?: () => void;
  // ---- src/camera.js shims, called by src/overlay.ts's settings panel ----
  // Arrow/line geometry maths lives in camera.js, which imports overlay — so
  // the settings sliders reach it this way rather than the other direction.
  /** Rescale every arrow head/shaft to the given display scale. */
  _algebenchApplyArrowScale?: (scale: number) => void;
  /** Re-apply the display line width to one line/axis registry entry. */
  _algebenchApplyLineWidth?: (entry: unknown) => void;
  /** Re-apply the display shaft thickness to one arrow mesh. */
  _algebenchApplyShaftThickness?: (mesh: unknown) => void;
  /** True when an arrow-registry entry is a vector shaft rather than a head. */
  _algebenchIsShaftEntry?: (entry: unknown) => boolean;
  /** src/json-browser.ts — open the JSON browser focused on a spec path. */
  algebenchOpenJsonBrowserAtPath?: (path: string) => void;
  /** src/coach/registry.js — the guided-tour registry and engine. */
  AlgeBenchCoach?: {
    engine?: {
      status?: () => unknown;
      control?: (action: unknown, opts: { step?: unknown }) => void;
    };
  };

  // ---- Published BY src/chat.ts ----
  // chat.js used to be a classic script, so every top-level `function` became
  // a window property automatically. As a module it must assign them back, or
  // every consumer breaks at runtime with no compile error. Replacing this
  // flat surface with an AlgeBench namespace is issue #406 — post-migration.
  _escHtml: (s: string) => string;
  _classifyFocusTarget: (target: EventTarget | null) => string | null;
  setPresetPrompts: (prompts: string[] | null | undefined) => void;
  shouldSkipWelcome: () => boolean;
  buildChatContext: () => AlgeBenchChatContext;
  switchPanelTab: (tabName: string) => void;
  setupChat: () => void;
  initChatTtsControls: () => void;
  sendChatMessage: (text: string, opts?: { silent?: boolean }) => Promise<void>;
  addChatMessage: (role: string, content: string) => HTMLDivElement;
  addChatLoading: () => HTMLDivElement;
  renderToolCallChip: (tc: AlgeBenchChatToolCall) => HTMLDivElement;
  _ensureTTSPlayer: () => GeminiTTSAudioPlayer | null;
  speakText: (text: string, opts?: { explicit?: boolean }) => Promise<void>;
  logContextIfChanged: () => void;
  startContextPolling: () => void;
  sendWelcomeMessage: () => void;
  renderMemoryPopup: (
    mem: Record<string, AlgeBenchMemoryEntry> | null,
    queryText?: string | null,
  ) => void;
  updateMemoryStatus: () => void;

  // Assigned explicitly by chat.js today, and still explicitly by chat.ts.
  algebenchBuildChatContext: () => AlgeBenchChatContext;
  algebenchGetTTSAudioStream: () => MediaStream | null;
  algebenchIsTTSSpeaking: () => boolean;
  algebenchIsTTSPaused: () => boolean;
  algebenchIsTTSLoading: () => boolean;
  algebenchPauseTTS: () => void;
  algebenchResumeTTS: () => void;
  algebenchStopTTS: () => void;
  algebenchSpeakText: (text: string, onEnd?: () => void) => void;
  /** Full Gemini transcript of the last turn — a debugging handle. */
  geminiChatHistory?: { systemPrompt?: string; contents: unknown[] };
  /** Raw agent-memory values, read by info-overlay `{{expr}}` bindings. */
  agentMemoryValues?: Record<string, unknown>;
}

// ── Globals defined by src/chat.ts ──────────────────────────────────────────
// chat.js was a classic, non-module script until phase 4e; modules still reach
// these as bare globals behind `typeof … === 'function'` guards, because the
// page can load without the chat module and the guards must stay honest.
// (src/overlay.js, src/labels.ts, src/scene-loader.js.)

/** Switch the right-hand panel to a named tab (chat.ts). */
declare function switchPanelTab(tabName: string): void;

/** Send a message to the AI chat (chat.ts). */
declare function sendChatMessage(text: string, opts?: { silent?: boolean }): Promise<void>;

/** Replace the preset-prompt buttons under the chat input (chat.ts). */
declare function setPresetPrompts(prompts: string[] | null | undefined): void;

// ── First-party globals src/chat.ts READS ───────────────────────────────────
// src/main.js publishes these onto `window` (some as accessors over `state`)
// precisely so chat could reach them as bare globals. chat.ts keeps doing
// exactly that; rewiring it to import from '/state.js' is issue #406's job.

/** One step of a scene, as chat reads it. */
interface AlgeBenchSceneStepSpec {
  title?: string;
  description?: string;
  sliders?: unknown[];
  [key: string]: unknown;
}

/** One scene, as chat reads it. */
interface AlgeBenchSceneSpec {
  title?: string;
  steps?: AlgeBenchSceneStepSpec[];
  elements?: unknown[];
  prompt?: unknown;
  [key: string]: unknown;
}

/** A lesson (multi-scene) spec, as chat reads it. */
interface AlgeBenchLessonSpec {
  title?: string;
  scenes?: AlgeBenchSceneSpec[];
  [key: string]: unknown;
}

/** A scene element, as chat reads it when listing what is visible. */
interface AlgeBenchElementSpec {
  type: string;
  id?: string;
  label?: string;
  [key: string]: unknown;
}

/** Live slider state (src/state.js `sceneSliders`). */
interface AlgeBenchSliderState {
  value: number;
  min: number;
  max: number;
  step: number;
  label?: string;
}

/** A named camera view (src/state.js `CAMERA_VIEWS`). */
interface AlgeBenchCameraView {
  position: number[];
  target: number[];
  up?: number[];
}

/**
 * Mermaid 11.4.0, loaded from CDN (see `Window.mermaid`). Deliberately minimal:
 * only the two methods src/graph-view.ts drives are declared. `initialize`
 * takes an open config bag rather than an enumerated one — Mermaid validates it
 * at runtime, and a half-accurate config type would reject valid settings while
 * proving nothing (same reasoning as src/mathbox.d.ts).
 */
interface MermaidLib {
  initialize(config: Record<string, unknown>): void;
  /** Renders `code` to SVG under a fresh element id. */
  render(id: string, code: string): Promise<{ svg: string }>;
}

/**
 * `window.graphView` — the debugging handle src/graph-view.ts publishes
 * ("Expose for debugging" at its foot). Nothing in the app calls through it;
 * it exists so the console can drive the dock.
 */
interface AlgeBenchGraphViewDebug {
  setDockTab(name: string): Promise<void> | void;
  rebuildProofTree(): void;
  renderCurrentStepGraph(force?: boolean): Promise<void>;
  toggleDockMode(forceDocked?: boolean, persist?: boolean): void;
}

/**
 * Semantic-graph dock state (src/graph-view.ts `getGraphPanelState`) — the
 * snapshot src/chat.ts folds into the tutor's prompt context (issue #124).
 *
 * This replaces an `{ open?: boolean; [key: string]: unknown }` stub. Now that
 * graph-view is TypeScript its return value is checked against this interface,
 * so the two cannot drift. The optional members are genuinely conditional: the
 * node/edge blocks appear only when the step has a graph, `parseError` only
 * when derivation failed, and the selection pair only when something is
 * selected.
 */
interface AlgeBenchGraphPanelState {
  /** True when the user is on the Math dock (even with no graph to show). */
  open: boolean | null;
  /** True only in the split layout AND on the Math dock. */
  docked: boolean | null;
  hasGraph: boolean;
  source: string | null;
  /** 1-based, for display. Null when no proof step is active. */
  stepNumber: number | null;
  theme: string;
  labelMode: string;
  direction: string;
  /** Percent (100 = default view), read from whichever renderer is live. */
  zoom: number;
  nodeCount: number;
  edgeCount: number;
  /** Present only when the step carries a `semanticGraph.error`. */
  parseError?: string;
  /** Compacted nodes/edges, capped at 60/80 to keep the prompt small. */
  nodes?: AlgeBenchGraphPanelNode[];
  edges?: { from: string; to: string; semantic?: string }[];
  /** How many nodes/edges the caps dropped, when they did. */
  nodesTruncated?: number;
  edgesTruncated?: number;
  /** The active (last-selected) node — same object as selectedNodes' tail. */
  selectedNode?: AlgeBenchGraphPanelSelectedNode;
  /** Full ordered selection, active node last. */
  selectedNodes?: AlgeBenchGraphPanelSelectedNode[];
}

/** One compacted node in AlgeBenchGraphPanelState.nodes. */
interface AlgeBenchGraphPanelNode {
  id: string;
  type?: string;
  op?: string;
  label?: string;
  role?: string;
  /** Truncated to 120 chars with an ellipsis. */
  description?: string;
}

/**
 * A selected node: the full graph node plus its immediate neighbours.
 *
 * `subexpr` is Omit-ed and redeclared rather than intersected: the generated
 * Node types it `string | undefined`, and intersecting that with `string | null`
 * collapses to plain `string` — which would hide the explicit `|| null`
 * normalisation _buildGraphNodePayload does.
 */
type AlgeBenchGraphPanelSelectedNode =
  Omit<import('/types/semantic-graph.js').Node, 'subexpr'> & {
    subexpr: string | null;
    neighbors: { incoming: string[]; outgoing: string[] };
  };

/** One stored agent-memory entry (`GET /api/memory`). */
interface AlgeBenchMemoryEntry {
  summary?: string;
  value?: unknown;
}

/** One tool call in a `/api/chat` response. */
interface AlgeBenchChatToolCall {
  name: string;
  args: AlgeBenchChatToolArgs;
  rawArgs?: unknown;
  result?: AlgeBenchChatToolResult;
  /** Stashed by chat for debugging after an `add_scene`. */
  _generatedScene?: unknown;
}

/**
 * Tool-call arguments. Per-tool shapes differ (`position` is a `[x,y,z]` for
 * `set_camera` but a corner name for `set_info_overlay`), so anything not
 * uniformly typed stays `unknown` via the index signature and is narrowed at
 * its use site.
 */
interface AlgeBenchChatToolArgs {
  [key: string]: unknown;
  scene?: unknown;
  step?: unknown;
  reason?: string;
  view?: string;
  zoom?: number;
  values?: Record<string, unknown>;
  prompts?: string[];
  // ---- `derive_proof_animation` (handled in src/chat.ts) — forwarded whole to
  // window.algebenchDeriveProof, so its three fields are named here rather than
  // left to the index signature.
  target_latex?: string;
  start_latex?: string;
  prompt?: string;
  id?: string;
  content?: string;
  clear?: boolean;
  action?: string;
  title?: string;
  expression?: string;
  key?: string;
  parsedScene?: AlgeBenchSceneSpec;
}

/** A tool call's server-side result. */
interface AlgeBenchChatToolResult {
  [key: string]: unknown;
  status?: string;
  error?: string;
  message?: string;
  summary?: string;
  stored_as?: string;
  keys?: unknown;
  result?: unknown;
  step?: unknown;
}

declare var lessonSpec: AlgeBenchLessonSpec | null;
declare var currentSpec: AlgeBenchSceneSpec | null;
declare var currentSceneIndex: number;
declare var currentStepIndex: number;
declare var currentProjection: string;
declare var sceneSliders: Record<string, AlgeBenchSliderState>;
declare var elementRegistry: Record<string, { hidden?: boolean }>;
declare var CAMERA_VIEWS: Record<string, AlgeBenchCameraView>;
declare var camera: import('three').Camera | null;
declare var controls: { target: { x: number; y: number; z: number } } | null;

declare function getAllElements(
  scene: AlgeBenchSceneSpec,
  stepIndex: number,
): AlgeBenchElementSpec[];
declare function getProofContext(): unknown;
declare function navigateTo(sceneIndex: number, stepIndex: number): void;
declare function navigateProof(stepIndex: number): void;
declare function refreshProofPanel(): void;
declare function animateCamera(viewName: string, durationMs: number): void;
declare function animateSlider(id: string, value: number, durationMs: number): Promise<boolean>;
declare function buildSceneTree(lesson: AlgeBenchLessonSpec): void;
declare function updateDockVisibility(): void;
declare function addInfoOverlay(id: string, content: string, position: string): void;
declare function removeAllInfoOverlays(): void;
declare function updateInfoOverlays(): void;
declare function dataCameraToWorld(v: number[]): number[];
declare function worldCameraToData(v: number[]): number[];
declare function renderMarkdown(text: string): string;
declare function renderKaTeX(text: string, displayMode?: boolean): string;
