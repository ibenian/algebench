// ============================================================
// main.js — Application entry point (DOMContentLoaded).
// Wires all modules together and exposes globals for chat.js
// compatibility (chat.js references bare global names).
// ============================================================

import { state } from '/state.js';
import { initMathBox, animateCamera, setupRollDrag, setupProjectionToggle, setupTrackpadPan } from '/camera.js';
import { animateSlider } from '/sliders.js';
import { setupDragDrop, setupFilePicker, setupScenesDropdown, setupVideoExportControls,
         loadBuiltinScenesList, loadInitialSceneFromQuery } from '/ui.js';
import { setupSettingsPanel, initLightControls, setupPanelResize, setupExplainToggle,
         setupDocSpeakButtons, setupCaptionDrag, setupSceneDescDrag, setupCamStatusPopup, setupAboutPopup,
         getAllElements, addInfoOverlay, removeAllInfoOverlays, updateInfoOverlays,
         setBuildSceneTreeFn } from '/overlay.js';
import { setupFollowAngleLockToggle } from '/follow-cam.js';
import { dataCameraToWorld, worldCameraToData } from '/coords.js';
import { navigateTo, setupSceneDock, loadScene, loadLesson, isLessonFormat,
         updateDockVisibility } from '/scene-loader.js';
import { buildSceneTree } from '/context-browser.js';
import { setupJsonViewer, setupContextStatusPopup } from '/json-browser.js';
import { renderMarkdown, renderKaTeX } from '/labels.js';
import { setupProofPanel, navigateProof, loadProof, getProofContext, refreshProofPanel } from '/proof.js';
import { captureViewState, applyViewState, setupViewSync, setupShareButton } from '/view-state-bridge.js';
import { setupPopstateListener } from '/nav-history.js';
import { setupObjectPicker } from '/object-picker.js';
import { AI_ICON, USER_ICON } from '/icons.js';
import { applyTheme, initialTheme } from '/theme.js';

// chat.js is a classic script (no ES imports), so expose the shared chat-avatar
// icons on window for it to read. Set at module-eval, well before any message
// renders; chat.js falls back to emoji if this is somehow absent.
window.algebenchIcons = { ai: AI_ICON, user: USER_ICON };

// Domain library registry — scripts under static/domains/<name>/index.js self-register here.
window.AlgeBenchDomains = window.AlgeBenchDomains || {
    _registry: {},
    register(name, functions) {
        this._registry[name] = functions;
        console.log(`[domains] registered: ${name} (${Object.keys(functions).join(', ')})`);
    },
};

// Wire the build-scene-tree function into overlay.js for use in updateStatusBar
setBuildSceneTreeFn(buildSceneTree);

document.addEventListener('DOMContentLoaded', async () => {
    // Unified precedence (?theme= → saved preference → dark) onto <html
    // data-theme>. The app chrome is fixed dark; today only the embedded
    // proof-animation surfaces respond, via the html[data-theme="light"]
    // var block in style.css.
    applyTheme(initialTheme());
    initMathBox();
    setupObjectPicker();
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
    setupProofPanel();
    setupSceneDock();
    setupCaptionDrag();
    setupSceneDescDrag();
    setupJsonViewer();
    setupContextStatusPopup();
    setupCamStatusPopup();
    setupAboutPopup();
    // Deeplink sync must be live before the initial scene loads so the URL
    // reflects navigation, and applyViewState exists before ui.js calls it.
    setupViewSync();
    setupShareButton();
    setupPopstateListener(applyViewState);
    loadBuiltinScenesList();
    await loadInitialSceneFromQuery();
});

// ============================================================
// Global exports for chat.js compatibility.
// chat.js accesses these as bare globals (not window.X), which
// works because ES module globals are not automatically exposed
// to the global scope. We assign them explicitly here.
// ============================================================

// Rendering helpers — chat.js uses these as bare globals
window.renderMarkdown = renderMarkdown;
window.renderKaTeX = renderKaTeX;

// Navigation
window.navigateTo = navigateTo;
window.animateCamera = animateCamera;
window.buildSceneTree = buildSceneTree;
window.addInfoOverlay = addInfoOverlay;
window.removeAllInfoOverlays = removeAllInfoOverlays;
window.updateInfoOverlays = updateInfoOverlays;
window.getAllElements = getAllElements;
window.loadLesson = loadLesson;
window.loadScene = loadScene;
window.isLessonFormat = isLessonFormat;
window.updateDockVisibility = updateDockVisibility;
window.animateSlider = animateSlider;
window.dataCameraToWorld = dataCameraToWorld;
window.worldCameraToData = worldCameraToData;

// Deeplinking — single entry point reused by ui.js init, popstate, and the
// future AI "jump to view" tool.
window.captureViewState = captureViewState;
window.applyViewState = applyViewState;

// Proof system
window.navigateProof = navigateProof;
window.loadProof = loadProof;
window.getProofContext = getProofContext;
window.refreshProofPanel = refreshProofPanel;

// State proxies — chat.js reads lessonSpec, currentSpec, currentSceneIndex,
// currentStepIndex, sceneSliders, and CAMERA_VIEWS as bare globals.
// We expose them as getters so chat.js always sees the current value.
Object.defineProperties(window, {
    lessonSpec: {
        get() { return state.lessonSpec; },
        set(v) { state.lessonSpec = v; },
        configurable: true,
    },
    currentSpec: {
        get() { return state.currentSpec; },
        set(v) { state.currentSpec = v; },
        configurable: true,
    },
    currentSceneIndex: {
        get() { return state.currentSceneIndex; },
        set(v) { state.currentSceneIndex = v; },
        configurable: true,
    },
    currentStepIndex: {
        get() { return state.currentStepIndex; },
        set(v) { state.currentStepIndex = v; },
        configurable: true,
    },
    sceneSliders: {
        get() { return state.sceneSliders; },
        set(v) { state.sceneSliders = v; },
        configurable: true,
    },
    CAMERA_VIEWS: {
        get() { return state.CAMERA_VIEWS; },
        set(v) { state.CAMERA_VIEWS = v; },
        configurable: true,
    },
    camera: {
        get() { return state.camera; },
        configurable: true,
    },
    controls: {
        get() { return state.controls; },
        configurable: true,
    },
    currentProjection: {
        get() { return state.currentProjection; },
        set(v) { state.currentProjection = v; },
        configurable: true,
    },
    elementRegistry: {
        get() { return state.elementRegistry; },
        configurable: true,
    },
    proofStepIndex: {
        get() { return state.proofStepIndex; },
        set(v) { state.proofStepIndex = v; },
        configurable: true,
    },
});
