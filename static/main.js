// ============================================================
// main.js — Application entry point (DOMContentLoaded).
// Wires all modules together and exposes globals for chat.js
// compatibility (chat.js references bare global names).
// ============================================================

import { state } from '/state.js';
import { initMathBox, animateCamera, setupRollDrag, setupProjectionToggle, setupTrackpadPan } from '/camera.js';
import { _sliderValueNum } from '/sliders.js';
import { setupDragDrop, setupFilePicker, setupScenesDropdown, setupVideoExportControls,
         loadBuiltinScenesList, loadInitialSceneFromQuery } from '/ui.js';
import { setupSettingsPanel, initLightControls, setupPanelResize, setupExplainToggle,
         setupDocSpeakButtons, setupCaptionDrag, setupSceneDescDrag, setupCamStatusPopup,
         getAllElements, addInfoOverlay, setBuildSceneTreeFn } from '/overlay.js';
import { setupFollowAngleLockToggle } from '/follow-cam.js';
import { navigateTo, setupSceneDock, loadScene, loadLesson, isLessonFormat } from '/scene-loader.js';
import { buildSceneTree } from '/context-browser.js';
import { setupJsonViewer, setupContextStatusPopup } from '/json-browser.js';

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
    setupContextStatusPopup();
    setupCamStatusPopup();
    loadBuiltinScenesList();
    await loadInitialSceneFromQuery();
});

// ============================================================
// Global exports for chat.js compatibility.
// chat.js accesses these as bare globals (not window.X), which
// works because ES module globals are not automatically exposed
// to the global scope. We assign them explicitly here.
// ============================================================

// Navigation
// Domain library compat — astrodynamics/index.js calls _sliderValueNum() as a global.
window._sliderValueNum = _sliderValueNum;

window.navigateTo = navigateTo;
window.animateCamera = animateCamera;
window.buildSceneTree = buildSceneTree;
window.addInfoOverlay = addInfoOverlay;
window.getAllElements = getAllElements;
window.loadLesson = loadLesson;
window.loadScene = loadScene;
window.isLessonFormat = isLessonFormat;

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
});
