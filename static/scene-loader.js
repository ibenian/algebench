// ============================================================
// Scene Loader — loadScene, lesson navigation, step rendering,
// fade in/out, and auto-play.
// ============================================================

import { state } from '/state.js';
import { renderElement } from '/objects/index.js';
import { buildSliderOverlay, registerSliders, stopAllSliderLoops, stopSliderLoop,
         removeSliderIds, recompileActiveExprs, unregisterAnimExpr, unregisterAnimUpdater,
         syncSliderState } from '/sliders.js';
import { buildCameraButtons, animateCamera, resolveEffectiveStepCamera, DEFAULT_CAMERA } from '/camera.js';
import { dataCameraToWorld } from '/coords.js';
import { clearLabels } from '/labels.js';
import { scanSpecForUnsafeJs, showTrustDialog, updateJsTrustPill } from '/trust.js';
import { importDomains, setActiveSceneFunctions, setActiveVirtualTimeExpr } from '/expr.js';
import { clearWorldStarfield, clearWorldSkybox, configureWorldStarfield } from '/objects/skybox.js';
import { updateFollowAngleLockButtonState } from '/follow-cam.js';
import { updateTitle, updateExplanationPanel, buildLegend, addInfoOverlay,
         removeStepInfoOverlays, removeInfoOverlay, removeAllInfoOverlays,
         getAllElements, updateStatusBar, updateStepCaption } from '/overlay.js';
import { buildSceneTree, updateTreeHighlight, setNavigateFn } from '/context-browser.js';
import { loadProof, syncProofFromSceneStep } from '/proof.js';

const AUTO_PLAY_DEFAULT_DURATION = 3000;

// Wire up the navigation function into context-browser so tree clicks work.
setNavigateFn((si, sti) => navigateTo(si, sti));

// ----- Incremental Step Rendering -----

function snapshotBefore() {
    return {
        arrows:    state.arrowMeshes.length,
        labels:    state.labels.length,
        planes:    state.planeMeshes.length,
        lines:     state.lineNodes.length,
        vecLines:  state.vectorLineNodes.length,
        axisLines: state.axisLineNodes.length,
        points:    state.pointNodes.length,
    };
}

function buildSubTracker(group, before) {
    return {
        group,
        arrowMeshes:     state.arrowMeshes.slice(before.arrows),
        labels:          state.labels.slice(before.labels),
        planeMeshes:     state.planeMeshes.slice(before.planes),
        lineNodes:       state.lineNodes.slice(before.lines),
        vectorLineNodes: state.vectorLineNodes.slice(before.vecLines),
        axisLineNodes:   state.axisLineNodes.slice(before.axisLines),
        pointNodes:      state.pointNodes.slice(before.points),
    };
}

export function renderStepAdd(elements, sliderDefs) {
    // Register sliders first (so expressions can reference them during render)
    const { ids: sliderIds, prevStates: prevSliderStates } = registerSliders(sliderDefs);
    if (sliderIds.length > 0) {
        buildSliderOverlay();
        recompileActiveExprs();
    }

    const before = snapshotBefore();

    // Create a MathBox group for this step's elements
    const group = state.sceneView.group();

    // Auto-assign IDs to labeled elements so they're toggleable via legend
    let autoIdCounter = 0;
    const renderResults = [];
    const addedElementIds = [];
    let replacedElements = null;
    for (const el of elements) {
        if (!el.id && el.label) {
            el.id = '__auto_' + (autoIdCounter++) + '_' + Date.now();
        }
        // If this step reuses an element id, hide any previously visible instance first.
        // Save the old registry entry so removeStepTracker can restore it on backward nav.
        if (el.id && state.elementRegistry[el.id]) {
            if (!replacedElements) replacedElements = {};
            replacedElements[el.id] = state.elementRegistry[el.id];
            if (!state.elementRegistry[el.id].hidden) hideElementById(el.id);
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
            state.elementRegistry[el.id] = { tracker: subTracker, hidden: false, type: el.type };
        }
    }

    const tracker = buildSubTracker(group, before);
    tracker.removedIds = [];
    tracker.removedSliders = {};
    tracker.replacedElements = replacedElements;
    tracker.sliderIds = sliderIds;
    tracker.prevSliderStates = prevSliderStates;
    tracker.elementIds = addedElementIds;
    tracker.renderResults = renderResults;

    fadeInTracker(tracker);

    return tracker;
}

/**
 * Apply info overlays for a step and track them on the tracker.
 * Non-kept overlays from previous steps are removed first.
 * Kept overlays persist until the tracker is popped (backward nav).
 */
function applyTrackerInfoOverlays(tracker, step) {
    // Remove non-kept info overlays from previous steps
    removeStepInfoOverlays();
    tracker.infoIds = [];
    tracker.infoDefs = step.info || [];
    const infoDefs = step.info;
    if (!infoDefs || !infoDefs.length) return;
    for (const def of infoDefs) {
        addInfoOverlay(def.id, def.content, def.position || 'top-left', true, def.keep || false);
        tracker.infoIds.push(def.id);
    }
}

/** Remove info overlays that were added by this tracker (backward navigation). */
function undoTrackerInfoOverlays(tracker) {
    if (!tracker.infoIds) return;
    for (const id of tracker.infoIds) {
        removeInfoOverlay(id);
    }
}

export function hideElementById(id) {
    const reg = state.elementRegistry[id];
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
    for (const m of t.planeMeshes) { m.visible = false; m._hiddenByRemove = true; }
    for (const entry of (t.pointNodes || [])) { try { entry.node.set('visible', false); } catch(e) {} }
}

export function showElementById(id) {
    const reg = state.elementRegistry[id];
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

// Register shims so overlay.js can call these without circular imports
window._algebenchHideElementById = hideElementById;
window._algebenchShowElementById = showElementById;

function removeTrackSliders(tracker) {
    const ownIds = new Set(tracker.sliderIds || []);
    let changed = false;
    for (const id of Object.keys(state.sceneSliders)) {
        if (ownIds.has(id)) continue;
        if (!tracker.removedSliders[id]) {
            stopSliderLoop(id);
            tracker.removedSliders[id] = { ...state.sceneSliders[id] };
            delete state.sceneSliders[id];
            changed = true;
        }
    }
    if (changed) {
        buildSliderOverlay();
        recompileActiveExprs();
    }
}

function removeTrackSliderById(id, tracker) {
    if (tracker.sliderIds && tracker.sliderIds.includes(id)) return false;
    if (state.sceneSliders[id] && !tracker.removedSliders[id]) {
        stopSliderLoop(id);
        tracker.removedSliders[id] = { ...state.sceneSliders[id] };
        delete state.sceneSliders[id];
        return true;
    }
    return false;
}

function processStepRemoves(removeList, tracker) {
    if (!removeList || !Array.isArray(removeList)) return;
    const ownIds = new Set(tracker.elementIds || []);
    let slidersChanged = false;
    for (const item of removeList) {
        if (item.id === '*' || item.type === '*') {
            for (const id of Object.keys(state.elementRegistry)) {
                if (ownIds.has(id)) continue;
                if (!state.elementRegistry[id].hidden) {
                    hideElementById(id);
                    tracker.removedIds.push(id);
                }
            }
            removeTrackSliders(tracker);
            continue;
        }
        if (item.id) {
            if (!ownIds.has(item.id) && state.elementRegistry[item.id] && !state.elementRegistry[item.id].hidden) {
                hideElementById(item.id);
                tracker.removedIds.push(item.id);
            }
            if (removeTrackSliderById(item.id, tracker)) slidersChanged = true;
            continue;
        }
        if (item.type === 'info') {
            if (item.id) removeInfoOverlay(item.id);
            continue;
        }
        if (item.type === 'slider') {
            removeTrackSliders(tracker);
            continue;
        }
        if (item.type) {
            for (const [id, reg] of Object.entries(state.elementRegistry)) {
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
    const stillRemoved = new Set();
    const stillRemovedSliders = new Set();
    for (const t of state.stepTrackers) {
        if (t === tracker) break;
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
    if (tracker.removedSliders) {
        let slidersChanged = false;
        for (const [id, def] of Object.entries(tracker.removedSliders)) {
            if (!stillRemovedSliders.has(id) && !state.sceneSliders[id]) {
                state.sceneSliders[id] = def;
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
    if (tracker.sliderIds && tracker.sliderIds.length > 0) {
        const stillNeeded = new Set(state.stepTrackers.flatMap(t => t.sliderIds || []));
        const toRemove = tracker.sliderIds.filter(id => !stillNeeded.has(id));
        // Restore previous slider states for sliders that aren't being removed
        // (i.e., sliders that existed before this step overrode their defaults).
        if (tracker.prevSliderStates) {
            for (const [id, prev] of Object.entries(tracker.prevSliderStates)) {
                if (!toRemove.includes(id) && state.sceneSliders[id]) {
                    Object.assign(state.sceneSliders[id], prev);
                }
            }
        }
        if (toRemove.length > 0) {
            removeSliderIds(toRemove);
        }
        buildSliderOverlay();
        recompileActiveExprs();
        syncSliderState();
    }

    if (tracker.renderResults) {
        for (const r of tracker.renderResults) {
            if (r && r._animState) r._animState.stopped = true;
            if (r && r._animExprEntry) unregisterAnimExpr(r._animExprEntry.animState);
            if (r && r._animState) unregisterAnimUpdater(r._animState);
        }
    }

    // Restore any elements that were replaced (same id reused) by this step.
    // The replaced element's registry entry was saved in tracker.replacedElements;
    // restore it if no remaining tracker still has the id in its removedIds.
    if (tracker.replacedElements) {
        const stillRemoved = new Set();
        for (const t of state.stepTrackers) {
            if (t.removedIds) for (const id of t.removedIds) stillRemoved.add(id);
        }
        for (const [id, savedReg] of Object.entries(tracker.replacedElements)) {
            state.elementRegistry[id] = savedReg;
            if (!stillRemoved.has(id)) showElementById(id);
        }
    }

    fadeOutTracker(tracker, 200, () => {
        if (tracker.group) {
            try { tracker.group.remove(); } catch(e) {}
        }

        for (const entry of tracker.arrowMeshes) {
            state.three.scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.mesh.material.dispose();
            const idx = state.arrowMeshes.indexOf(entry);
            if (idx >= 0) state.arrowMeshes.splice(idx, 1);
        }

        for (const lbl of tracker.labels) {
            if (lbl.el.parentNode) lbl.el.parentNode.removeChild(lbl.el);
            const idx = state.labels.indexOf(lbl);
            if (idx >= 0) state.labels.splice(idx, 1);
        }

        for (const m of tracker.planeMeshes) {
            state.three.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
            const idx = state.planeMeshes.indexOf(m);
            if (idx >= 0) state.planeMeshes.splice(idx, 1);
        }

        for (const entry of tracker.lineNodes) {
            const idx = state.lineNodes.indexOf(entry);
            if (idx >= 0) state.lineNodes.splice(idx, 1);
        }
        for (const entry of tracker.vectorLineNodes) {
            const idx = state.vectorLineNodes.indexOf(entry);
            if (idx >= 0) state.vectorLineNodes.splice(idx, 1);
        }
        for (const entry of tracker.axisLineNodes) {
            const idx = state.axisLineNodes.indexOf(entry);
            if (idx >= 0) state.axisLineNodes.splice(idx, 1);
        }
        for (const entry of (tracker.pointNodes || [])) {
            const idx = state.pointNodes.indexOf(entry);
            if (idx >= 0) state.pointNodes.splice(idx, 1);
        }
    });
}

function fadeInTracker(tracker, duration) {
    duration = duration || 350;
    const startTime = performance.now();

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
                ? entry.mesh.userData.baseOpacity : 1;
            const globalOp = entry.isShaft ? state.displayParams.vectorOpacity : state.displayParams.arrowOpacity;
            entry.mesh.material.opacity = ease * Math.max(0, Math.min(1, baseOp * globalOp));
        }
        for (const m of tracker.planeMeshes) {
            const targetOp = m.userData.targetOpacity !== undefined ? m.userData.targetOpacity : state.displayParams.planeOpacity;
            m.material.opacity = ease * targetOp;
        }
        for (const lbl of tracker.labels) {
            lbl.el.style.opacity = String(ease * state.displayParams.labelOpacity);
        }
        for (const entry of tracker.lineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node.set('opacity', ease * baseOp * state.displayParams.lineOpacity); } catch(e) {}
        }
        for (const entry of tracker.vectorLineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node.set('opacity', ease * baseOp * state.displayParams.vectorOpacity); } catch(e) {}
        }
        for (const entry of (tracker.pointNodes || [])) {
            try { entry.node.set('opacity', ease); } catch(e) {}
        }

        if (t < 1) requestAnimationFrame(step);
        else {
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

// ----- Scene Loader -----

export async function loadScene(spec) {
    // Clear MathBox elements
    const root = state.mathbox.select('*');
    if (root) root.remove();

    // Clear 3D arrow meshes
    for (const entry of state.arrowMeshes) {
        state.three.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
    }
    state.arrowMeshes = [];
    state.axisLineNodes = [];
    state.vectorLineNodes = [];
    state.lineNodes = [];
    for (const m of state.planeMeshes) { state.three.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    state.planeMeshes = [];
    state.pointNodes = [];
    state._planeMeshSerial = 0;

    clearLabels();
    state.followCamState = null;
    if (state.controls && state.followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(state.controls, 'enableDamping')) {
            state.controls.enableDamping = state.followCamSavedControls.enableDamping;
            if (Number.isFinite(state.followCamSavedControls.dampingFactor)) {
                state.controls.dampingFactor = state.followCamSavedControls.dampingFactor;
            }
        }
    }
    state.followCamSavedControls = null;
    updateFollowAngleLockButtonState();
    for (const k in state.animatedElementPos) delete state.animatedElementPos[k];
    state.activeAnimExprs = [];
    state.activeAnimUpdaters = [];
    state.sceneStartTime = performance.now();
    clearWorldStarfield();
    clearWorldSkybox();
    state.currentSpec = spec;
    setActiveSceneFunctions(spec);
    setActiveVirtualTimeExpr(spec, -1);
    updateTitle(spec);
    updateExplanationPanel(spec);
    loadProof(state.lessonSpec || spec, state.currentSceneIndex, -1);

    // Show/hide empty state
    const emptyState = document.getElementById('empty-state');
    if (!spec || !spec.elements || spec.elements.length === 0) {
        state.currentRange = [[-5, 5], [-5, 5], [-5, 5]];
        state.currentScale = [1, 1, 1];
        buildCameraButtons(spec);
        emptyState.style.display = 'block';
        const view = state.mathbox.cartesian({
            range: state.currentRange,
            scale: state.currentScale,
        });
        // Import inline renderers for the default grid/axes
        const { renderGrid, renderAxis } = await _importDefaultRenderers();
        renderGrid({ plane: 'xz', color: [0.3, 0.3, 0.5], opacity: 0.1, divisions: 10 }, view);
        renderAxis({ axis: 'x', range: [-5, 5], color: [0.5, 0.2, 0.2], label: 'x', width: 1 }, view);
        renderAxis({ axis: 'y', range: [-5, 5], color: [0.2, 0.5, 0.2], label: 'y', width: 1 }, view);
        renderAxis({ axis: 'z', range: [-5, 5], color: [0.2, 0.2, 0.5], label: 'z', width: 1 }, view);
        buildLegend([]);
        return;
    }
    emptyState.style.display = 'none';

    state.currentRange = spec.range || [[-5, 5], [-5, 5], [-5, 5]];
    state.currentScale = spec.scale || [1, 1, 1];
    configureWorldStarfield(spec);
    buildCameraButtons(spec);

    const view = state.mathbox.cartesian({
        range: state.currentRange,
        scale: state.currentScale,
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
        state.camera.up.set(up[0], up[1], up[2]);
        const pos = dataCameraToWorld(spec.camera.position || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld(spec.camera.target || DEFAULT_CAMERA.target);
        state.camera.position.set(pos[0], pos[1], pos[2]);
        if (state.controls) {
            state.controls.target.set(tgt[0], tgt[1], tgt[2]);
            state.controls.update();
        }
    }
}

// Helper to dynamically import axis/grid renderers for the empty state.
// These are already imported in objects/index.js but we need them synchronously-ish here.
let _defaultRenderersCache = null;
async function _importDefaultRenderers() {
    if (_defaultRenderersCache) return _defaultRenderersCache;
    const mod = await import('/objects/index.js');
    // renderGrid and renderAxis are not individually exported from index.js,
    // so we use the renderElement dispatcher instead.
    _defaultRenderersCache = {
        renderGrid: (el, view) => mod.renderElement({ ...el, type: 'grid' }, view),
        renderAxis: (el, view) => mod.renderElement({ ...el, type: 'axis' }, view),
    };
    return _defaultRenderersCache;
}

// ----- Lesson Navigation -----

export function isLessonFormat(spec) {
    return spec && Array.isArray(spec.scenes) && spec.scenes.length > 0;
}

export async function loadLesson(spec) {
    // --- Trust check ---
    state._sceneJsTrustState = null;
    state._sceneJsIssues = [];
    state._sceneIsUnsafe = false;
    state._sceneUnsafeExplanation = '';
    if (spec) {
        state._sceneIsUnsafe = spec.unsafe === true;
        state._sceneUnsafeExplanation = spec.unsafe_explanation || '';
        const scanned = scanSpecForUnsafeJs(spec);
        const needsDialog = state._sceneIsUnsafe || scanned;
        if (needsDialog) {
            const explanation = spec.unsafe_explanation ||
                'This scene contains native JavaScript expressions that execute in your browser.\nAllow execution only if you trust the source of this file.';
            const imports = Array.isArray(spec.import) ? spec.import : [];
            const trusted = await showTrustDialog(explanation, imports);
            state._sceneJsTrustState = trusted ? 'trusted' : 'untrusted';
        }
    }
    updateJsTrustPill();
    // Register shim so overlay.js can reach it
    window._algebenchUpdateJsTrustPill = updateJsTrustPill;

    // Set starter chips
    if (typeof setPresetPrompts === 'function') {
        if (spec) {
            setPresetPrompts(['Explain this scene', 'Walk me through this', 'What\'s the key insight?']);
        } else {
            setPresetPrompts([]);
        }
    }

    if (!isLessonFormat(spec)) {
        state.lessonSpec = null;
        state.currentSceneIndex = -1;
        state.currentStepIndex = -1;
        state.visitedSteps = new Set();
        stopAutoPlay();
        state._activeDomainFunctions = {};
        await importDomains(spec && spec.import);
        updateDockVisibility();
        loadScene(spec);
        return;
    }
    state.lessonSpec = spec;
    state.currentSceneIndex = -1;
    state.currentStepIndex = -1;
    state.visitedSteps = new Set();
    stopAutoPlay();
    await importDomains(spec.import);
    buildSceneTree(spec);
    updateDockVisibility();
    navigateTo(0, -1);
}

export function navigateTo(sceneIdx, stepIdx) {
    if (!state.lessonSpec || !state.lessonSpec.scenes) { return; }
    const scene = state.lessonSpec.scenes[sceneIdx];
    if (!scene) { return; }

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    stepIdx = Math.max(-1, Math.min(stepIdx, maxStep));

    // Same position — no-op
    if (sceneIdx === state.currentSceneIndex && stepIdx === state.currentStepIndex) { return; }

    const sceneChanged = sceneIdx !== state.currentSceneIndex;

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

        state.sceneView = state.mathbox.select('cartesian');
        state.stepTrackers = [];
        state.elementRegistry = {};
        state.legendToggledOff = new Set();
        stopAllSliderLoops();
        state.sceneSliders = {};
        removeAllInfoOverlays();
        buildSliderOverlay();

        for (let i = 0; i <= stepIdx; i++) {
            if (scene.steps && scene.steps[i]) {
                const step = scene.steps[i];
                const tracker = renderStepAdd(step.add || [], step.sliders);
                processStepRemoves(step.remove, tracker);
                applyTrackerInfoOverlays(tracker, step);
                state.stepTrackers.push(tracker);
                state.visitedSteps.add(sceneIdx + ':' + i);
            }
        }

        buildLegend(getAllElements(scene, stepIdx));

    } else {
        if (stepIdx > state.currentStepIndex) {
            for (let i = state.currentStepIndex + 1; i <= stepIdx; i++) {
                if (scene.steps && scene.steps[i]) {
                    const step = scene.steps[i];
                    const tracker = renderStepAdd(step.add || [], step.sliders);
                    processStepRemoves(step.remove, tracker);
                    applyTrackerInfoOverlays(tracker, step);
                    state.stepTrackers.push(tracker);
                    state.visitedSteps.add(sceneIdx + ':' + i);
                }
            }
        } else {
            while (state.stepTrackers.length > stepIdx + 1) {
                const tracker = state.stepTrackers.pop();
                undoStepRemoves(tracker);
                undoTrackerInfoOverlays(tracker);
                removeStepTracker(tracker);
            }
            // Re-apply info overlays from the step we landed on, since they
            // were removed when a later step called removeStepInfoOverlays().
            const landingTracker = state.stepTrackers[state.stepTrackers.length - 1];
            if (landingTracker && landingTracker.infoDefs && landingTracker.infoDefs.length > 0) {
                removeStepInfoOverlays();
                for (const def of landingTracker.infoDefs) {
                    addInfoOverlay(def.id, def.content, def.position || 'top-left', true, def.keep || false);
                }
                landingTracker.infoIds = landingTracker.infoDefs.map(d => d.id);
            }
        }

        buildLegend(getAllElements(scene, stepIdx));
    }

    // Animate camera using effective step camera
    if (!state.followCamState && stepIdx >= 0 && scene.steps) {
        const cam = resolveEffectiveStepCamera(scene, stepIdx);
        if (cam) {
            const pos = dataCameraToWorld(cam.position || DEFAULT_CAMERA.position);
            const tgt = dataCameraToWorld(cam.target || DEFAULT_CAMERA.target);
            state.CAMERA_VIEWS['_step'] = {
                position: pos,
                target: tgt,
                up: Array.isArray(cam.up) ? cam.up.slice(0, 3) : [0, 1, 0],
            };
            animateCamera('_step', 600);
        }
    }

    state.currentSceneIndex = sceneIdx;
    state.currentStepIndex = stepIdx;
    setActiveVirtualTimeExpr(scene, stepIdx);

    const activeStep = scene.steps && scene.steps[stepIdx];

    updateTreeHighlight();
    updateStepCaption(scene, stepIdx);
    updateStatusBar();

    // Update proof panel (always update — visibility depends on current step)
    loadProof(state.lessonSpec || scene, sceneIdx, stepIdx);
    if (!sceneChanged && state.proofSyncEnabled && state.proofSpec && state.proofSpec.length > 0) {
        syncProofFromSceneStep(stepIdx);
    }

    if (sceneChanged) {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
}

// ----- Auto-play -----

export function updateDockVisibility() {
    const dock = document.getElementById('scene-dock');
    if (state.lessonSpec) {
        dock.classList.add('visible');
    } else {
        dock.classList.remove('visible');
    }
}

function getCurrentStepDuration() {
    const scene = state.lessonSpec && state.lessonSpec.scenes[state.currentSceneIndex];
    if (!scene || !scene.steps) return AUTO_PLAY_DEFAULT_DURATION;
    const step = scene.steps[state.currentStepIndex];
    if (step && step.duration != null) return step.duration;
    if (state.currentStepIndex === -1 && scene.duration != null) return scene.duration;
    return AUTO_PLAY_DEFAULT_DURATION;
}

function scheduleNextAutoPlay() {
    if (!state.autoPlayTimer) return;
    const scene = state.lessonSpec && state.lessonSpec.scenes[state.currentSceneIndex];
    if (!scene) { stopAutoPlay(); return; }
    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    const isLast = state.currentSceneIndex >= state.lessonSpec.scenes.length - 1 && state.currentStepIndex >= maxStep;
    if (isLast) { stopAutoPlay(); return; }

    const step = scene.steps && scene.steps[state.currentStepIndex];
    if (step && Array.isArray(step.sliders) && step.sliders.length > 0 && step.duration == null) {
        stopAutoPlay();
        return;
    }

    const dur = getCurrentStepDuration();
    state.autoPlayTimer = setTimeout(() => {
        stepNext();
        scheduleNextAutoPlay();
    }, dur);
}

function startAutoPlay() {
    if (state.autoPlayTimer) return;
    state.autoPlayTimer = true;
    scheduleNextAutoPlay();
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = '&#9646;&#9646;';
    }
}

export function stopAutoPlay() {
    if (state.autoPlayTimer) {
        clearTimeout(state.autoPlayTimer);
        state.autoPlayTimer = null;
    }
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '&#9654;';
    }
}

function toggleAutoPlay() {
    if (state.autoPlayTimer) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function stepNext() {
    if (!state.lessonSpec || !state.lessonSpec.scenes) return;
    const scene = state.lessonSpec.scenes[state.currentSceneIndex];
    if (!scene) return;

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;

    if (state.currentStepIndex < maxStep) {
        navigateTo(state.currentSceneIndex, state.currentStepIndex + 1);
    } else if (state.currentSceneIndex < state.lessonSpec.scenes.length - 1) {
        navigateTo(state.currentSceneIndex + 1, -1);
    } else {
        stopAutoPlay();
    }
}

function stepPrev() {
    if (!state.lessonSpec || !state.lessonSpec.scenes) return;

    if (state.currentStepIndex > -1) {
        navigateTo(state.currentSceneIndex, state.currentStepIndex - 1);
    } else if (state.currentSceneIndex > 0) {
        const prevScene = state.lessonSpec.scenes[state.currentSceneIndex - 1];
        const prevMaxStep = (prevScene.steps ? prevScene.steps.length : 0) - 1;
        navigateTo(state.currentSceneIndex - 1, prevMaxStep);
    }
}

export function setupSceneDock() {
    const toggle = document.getElementById('scene-dock-toggle');
    const panel = document.getElementById('scene-dock-panel');
    const prevBtn = document.getElementById('nav-prev');
    const playBtn = document.getElementById('nav-play');
    const nextBtn = document.getElementById('nav-next');

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

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (!state.lessonSpec) return;

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
