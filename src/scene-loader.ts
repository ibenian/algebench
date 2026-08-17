// ============================================================
// Scene Loader — loadScene, lesson navigation, step rendering,
// fade in/out, and auto-play.
// ============================================================

import { state } from '/state.js';
import { PREV_ICON, NEXT_ICON, PLAY_ICON, PAUSE_ICON } from '/icons.js';
import { renderElement } from '/objects/index.js';
import { buildSliderOverlay, registerSliders, stopAllSliderLoops, stopSliderLoop,
         removeSliderIds, recompileActiveExprs, unregisterAnimExpr, unregisterAnimUpdater,
         syncSliderState } from '/sliders.js';
import { buildCameraButtons, animateCamera, resolveEffectiveStepCamera, DEFAULT_CAMERA } from '/camera.js';
import type { CameraView, StepCamera } from '/camera.js';
import { dataCameraToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
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
import { validateProofData } from '/proof-animation/validate-proof.js';
import type { Material, Mesh, Scene } from 'three';
import type { Label3D } from '/labels.js';
import type { SceneSlider, SliderDef, AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import type { Proof } from '/proof.js';

/**
 * The per-element registry/tracker entry shapes. Each src/objects/ renderer
 * declares its own narrow view of these and pushes into the shared arrays; the
 * scene loader is the consumer that slices them back out, so the fields it
 * actually reads are what is declared here.
 */
/** A mesh the loader can hide or dispose. `_hiddenByRemove` is the codebase's
 *  own flag (see src/objects/), and the single-Material parameter reflects that
 *  nothing here ever builds a multi-material mesh. */
type RemovableMesh = Mesh<import('three').BufferGeometry, Material> & { _hiddenByRemove?: boolean };

interface ArrowMeshEntry {
    mesh: RemovableMesh;
    isShaft?: boolean;
    owner?: object;
}
interface NodeEntry {
    node: MathBoxNode | null;
    baseOpacity?: number;
}

/** Counts of every global registry, taken before a render so the entries a
 *  single element or step added can be sliced back out afterwards. */
interface RegistrySnapshot {
    arrows: number;
    labels: number;
    planes: number;
    lines: number;
    vecLines: number;
    axisLines: number;
    points: number;
}

/** Everything one element (or one step) put into the shared registries. */
interface SubTracker {
    group: MathBoxNode;
    arrowMeshes: ArrowMeshEntry[];
    labels: Label3D[];
    planeMeshes: RemovableMesh[];
    lineNodes: NodeEntry[];
    vectorLineNodes: NodeEntry[];
    axisLineNodes: NodeEntry[];
    pointNodes: NodeEntry[];
}

/** What a renderElement() call hands back for later teardown. Every field is
 *  optional: the renderers publish different subsets. */
interface RenderResult {
    _animState?: { stopped: boolean };
    _animExprEntry?: AnimExprEntry;
    _arrowOwner?: object;
}

/** An element's entry in the shared id → element registry. */
interface ElementRegistryEntry {
    tracker: SubTracker;
    hidden: boolean;
    type?: string;
    prompt?: string | null;
    label?: string | null;
}

/** An info-overlay definition, as a step declares it. */
interface InfoOverlayDef {
    id: string;
    content: string;
    position?: string;
    keep?: boolean;
}

/** A SubTracker plus the undo bookkeeping a *step* needs for backward nav. */
interface StepTracker extends SubTracker {
    removedIds: string[];
    removedSliders: Record<string, SceneSlider | undefined>;
    replacedElements: Record<string, ElementRegistryEntry> | null;
    sliderIds: string[];
    prevSliderStates: Record<string, SceneSlider>;
    elementIds: string[];
    renderResults: RenderResult[];
    infoIds?: string[];
    infoDefs?: InfoOverlayDef[];
}

/**
 * The lesson/scene/step shapes this module reads. Deliberately looser than
 * schemas/lesson.schema.json: scenes also arrive from the AI and from
 * proofFileToLesson() below, so every field the loader guards on stays
 * optional here rather than being asserted present.
 */
interface SceneStep {
    // Rendered by the scene tree (src/context-browser.ts) and the step caption;
    // the loader itself never reads it, which is why phase 4g missed it.
    title?: string;
    add?: Element[];
    remove?: { id?: string; type?: string }[];
    sliders?: SliderDef[];
    info?: InfoOverlayDef[];
    duration?: number | null;
    proof?: Proof | Proof[] | null;
    /** Per-step camera override, resolved by camera.ts. */
    camera?: StepCamera;
}
interface SceneSpec {
    title?: string;
    description?: string;
    markdown?: string;
    range?: number[][];
    scale?: number[];
    camera?: StepCamera;
    views?: CameraView[];
    functions?: unknown;
    elements?: Element[];
    starfield?: unknown;
    steps?: SceneStep[];
    duration?: number | null;
    data?: Record<string, unknown>;
    proof?: Proof | Proof[] | null;
}
/** The grid/axis renderers the empty state pulls in lazily (see
 *  _importDefaultRenderers — objects/index.js exports only the dispatcher). */
interface DefaultRenderers {
    renderGrid(el: Record<string, unknown>, view: MathBoxNode): unknown;
    renderAxis(el: Record<string, unknown>, view: MathBoxNode): unknown;
}

/** A pre-baked proof-animation file, as validateProofData() returns it. */
interface ProofFile {
    title?: string;
    goal?: string;
    steps?: {
        id?: string;
        type?: string;
        operation?: string;
        label?: string;
        plain?: string;
        input_latex?: string;
        math?: string;
        justification?: string;
    }[];
}

interface LessonSpec extends SceneSpec {
    scenes?: SceneSpec[];
    import?: string[];
    unsafe?: boolean;
    unsafeExplanation?: string;
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface SceneLoaderState {
    mathbox: MathBoxNode;
    three: { scene: Scene };
    sceneView: MathBoxNode;
    camera: { up: { set(x: number, y: number, z: number): void };
              position: { set(x: number, y: number, z: number): void } } | null;
    controls: { target: { set(x: number, y: number, z: number): void };
                update(): void;
                enableDamping?: boolean;
                dampingFactor?: number } | null;
    arrowMeshes: ArrowMeshEntry[];
    labels: Label3D[];
    planeMeshes: RemovableMesh[];
    lineNodes: NodeEntry[];
    vectorLineNodes: NodeEntry[];
    axisLineNodes: NodeEntry[];
    pointNodes: NodeEntry[];
    _planeMeshSerial: number;
    currentRange: number[][];
    currentScale: number[];
    // `| undefined` on purpose: loadScene(undefined) stores undefined here, and
    // widening rather than coercing to null keeps that observable difference.
    currentSpec: SceneSpec | null | undefined;
    lessonSpec: LessonSpec | null | undefined;
    currentSceneIndex: number;
    currentStepIndex: number;
    visitedSteps: Set<string>;
    stepTrackers: StepTracker[];
    elementRegistry: Record<string, ElementRegistryEntry | undefined>;
    legendToggledOff: Set<string>;
    sceneSliders: Record<string, SceneSlider | undefined>;
    sceneData: Record<string, unknown>;
    // Only the four opacities this module reads; the panel owns the rest.
    displayParams: { vectorOpacity: number; arrowOpacity: number;
                     planeOpacity: number; labelOpacity: number; lineOpacity: number };
    animatedElementPos: Record<string, number[]>;
    activeAnimExprs: AnimExprEntry[];
    activeAnimUpdaters: unknown[];
    sceneStartTime: number;
    followCamState: unknown;
    followCamSavedControls: { enableDamping?: boolean; dampingFactor?: number } | null;
    cameraExprState: unknown;
    cameraExprStartTime: number;
    CAMERA_VIEWS: Record<string, { position: number[]; target: number[]; up: number[] }>;
    // `true` while auto-play is starting up, before the first timer id lands —
    // startAutoPlay() sets the flag so a re-entrant call bails, then
    // scheduleNextAutoPlay() overwrites it with the real handle.
    autoPlayTimer: ReturnType<typeof setTimeout> | boolean | null;
    proofSyncEnabled: boolean;
    proofSpec: unknown[] | null;
    _sceneJsTrustState: string | null;
    _sceneJsIssues: unknown[];
    _sceneIsUnsafe: boolean;
    _sceneUnsafeExplanation: string;
    _activeDomainFunctions: Record<string, unknown>;
}
const sceneState = state as unknown as SceneLoaderState;

const AUTO_PLAY_DEFAULT_DURATION = 3000;

// Wire up the navigation function into context-browser so tree clicks work.
setNavigateFn((si: number, sti: number) => navigateTo(si, sti));

// ----- Incremental Step Rendering -----

function snapshotBefore(): RegistrySnapshot {
    return {
        arrows:    sceneState.arrowMeshes.length,
        labels:    sceneState.labels.length,
        planes:    sceneState.planeMeshes.length,
        lines:     sceneState.lineNodes.length,
        vecLines:  sceneState.vectorLineNodes.length,
        axisLines: sceneState.axisLineNodes.length,
        points:    sceneState.pointNodes.length,
    };
}

function buildSubTracker(group: MathBoxNode, before: RegistrySnapshot): SubTracker {
    return {
        group,
        arrowMeshes:     sceneState.arrowMeshes.slice(before.arrows),
        labels:          sceneState.labels.slice(before.labels),
        planeMeshes:     sceneState.planeMeshes.slice(before.planes),
        lineNodes:       sceneState.lineNodes.slice(before.lines),
        vectorLineNodes: sceneState.vectorLineNodes.slice(before.vecLines),
        axisLineNodes:   sceneState.axisLineNodes.slice(before.axisLines),
        pointNodes:      sceneState.pointNodes.slice(before.points),
    };
}

// Static display name for the per-object Ask-AI affordance: the author `label`,
// or a `text` element's own text content (text objects carry no `label`). Null
// for elements whose label is dynamic (labelExpr/textExpr) — those are named from
// the live rendered label at click time instead.
function elementDisplayName(el: Element): string | null {
    // A dynamic label (labelExpr/textExpr) is named from the live rendered label
    // at click time, so return null here even when a static label also exists —
    // otherwise the stale static value would win.
    if (el.labelExpr || el.textExpr) return null;
    return el.label || (el.type === 'text' ? (el.text || el.value) : null) || null;
}

// Does the element render a label at all — static (`label`/`text`) or dynamic
// (`labelExpr`/`textExpr`, e.g. an animated point's live "6.3 km/s")? Such objects
// are eligible for the Ask-AI button and so must be registered.
function elementHasLabelSource(el: Element): boolean {
    return !!(elementDisplayName(el) || el.labelExpr || el.textExpr);
}

export function renderStepAdd(elements: Element[], sliderDefs: SliderDef[] | undefined): StepTracker {
    // Register sliders first (so expressions can reference them during render)
    const { ids: sliderIds, prevStates: prevSliderStates } = registerSliders(sliderDefs);
    if (sliderIds.length > 0) {
        buildSliderOverlay();
        recompileActiveExprs();
    }

    const before = snapshotBefore();

    // Create a MathBox group for this step's elements
    const group = sceneState.sceneView.group();

    // Auto-assign IDs to labeled elements so they're toggleable via legend
    let autoIdCounter = 0;
    const renderResults: RenderResult[] = [];
    const addedElementIds: string[] = [];
    let replacedElements: Record<string, ElementRegistryEntry> | null = null;
    for (const el of elements) {
        if (!el.id && (el.prompt || (elementHasLabelSource(el) && el.type !== 'axis' && el.type !== 'grid'))) {
            el.id = '__auto_' + (autoIdCounter++) + '_' + Date.now();
        }
        // If this step reuses an element id, hide any previously visible instance first.
        // Save the old registry entry so removeStepTracker can restore it on backward nav.
        // Non-null throughout: the branch is gated on the entry existing.
        if (el.id && sceneState.elementRegistry[el.id]) {
            if (!replacedElements) replacedElements = {};
            replacedElements[el.id] = sceneState.elementRegistry[el.id]!;
            if (!sceneState.elementRegistry[el.id]!.hidden) hideElementById(el.id);
        }
        const elBefore = el.id ? snapshotBefore() : null;
        const elGroup = el.id ? group.group() : group;
        let result = null;
        try { result = renderElement(el, elGroup); } catch (e) {
            console.error('Error rendering step element:', el, e);
        }
        // renderElement()'s return type is the union of every renderer's result;
        // only the teardown fields in RenderResult are ever read off it here.
        if (result) renderResults.push(result as RenderResult);
        if (el.id) {
            addedElementIds.push(el.id);
            // Non-null: elBefore was snapshotted under the same `el.id` guard.
            const subTracker = buildSubTracker(elGroup, elBefore!);
            sceneState.elementRegistry[el.id] = { tracker: subTracker, hidden: false, type: el.type, prompt: el.prompt || null, label: elementDisplayName(el) };
        }
    }

    // buildSubTracker returns the registry slice; a step tracker is that plus
    // the undo bookkeeping assigned immediately below. Asserted rather than
    // built in one literal so the field order stays exactly as it was.
    const tracker = buildSubTracker(group, before) as StepTracker;
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
function applyTrackerInfoOverlays(tracker: StepTracker, step: SceneStep): void {
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
function undoTrackerInfoOverlays(tracker: StepTracker): void {
    if (!tracker.infoIds) return;
    for (const id of tracker.infoIds) {
        removeInfoOverlay(id);
    }
}

export function hideElementById(id: string): void {
    const reg = sceneState.elementRegistry[id];
    if (!reg || reg.hidden) return;
    reg.hidden = true;
    const t = reg.tracker;

    fadeOutTracker(t, 200, () => {
        for (const entry of t.arrowMeshes) { entry.mesh.visible = false; entry.mesh._hiddenByRemove = true; }
        for (const m of t.planeMeshes) { m.visible = false; m._hiddenByRemove = true; }
        for (const lbl of t.labels) lbl.el.style.display = 'none';
        for (const entry of t.pointNodes) { try { entry.node!.set('visible', false); } catch(e) {} }
        if (t.group) { try { t.group.set('visible', false); } catch(e) {} }
    });
    // Hide arrow cones immediately to prevent animated orphans
    for (const entry of t.arrowMeshes) { entry.mesh.visible = false; entry.mesh._hiddenByRemove = true; }
    for (const m of t.planeMeshes) { m.visible = false; m._hiddenByRemove = true; }
    for (const entry of (t.pointNodes || [])) { try { entry.node!.set('visible', false); } catch(e) {} }
}

export function showElementById(id: string): void {
    const reg = sceneState.elementRegistry[id];
    if (!reg || !reg.hidden) return;
    reg.hidden = false;
    const t = reg.tracker;
    for (const entry of t.arrowMeshes) { entry.mesh._hiddenByRemove = false; }
    for (const m of t.planeMeshes) { m._hiddenByRemove = false; }

    for (const entry of t.arrowMeshes) entry.mesh.visible = true;
    for (const m of t.planeMeshes) m.visible = true;
    for (const lbl of t.labels) lbl.el.style.display = '';
    for (const entry of (t.pointNodes || [])) { try { entry.node!.set('visible', true); } catch(e) {} }
    if (t.group) { try { t.group.set('visible', true); } catch(e) {} }

    fadeInTracker(t);
}

// Register shims so overlay.js can call these without circular imports
window._algebenchHideElementById = hideElementById;
window._algebenchShowElementById = showElementById;

function removeTrackSliders(tracker: StepTracker): void {
    const ownIds = new Set(tracker.sliderIds || []);
    let changed = false;
    for (const id of Object.keys(sceneState.sceneSliders)) {
        if (ownIds.has(id)) continue;
        if (!tracker.removedSliders[id]) {
            stopSliderLoop(id);
            tracker.removedSliders[id] = { ...sceneState.sceneSliders[id]! };
            delete sceneState.sceneSliders[id];
            changed = true;
        }
    }
    if (changed) {
        buildSliderOverlay();
        recompileActiveExprs();
    }
}

function removeTrackSliderById(id: string, tracker: StepTracker): boolean {
    if (tracker.sliderIds && tracker.sliderIds.includes(id)) return false;
    if (sceneState.sceneSliders[id] && !tracker.removedSliders[id]) {
        stopSliderLoop(id);
        tracker.removedSliders[id] = { ...sceneState.sceneSliders[id]! };
        delete sceneState.sceneSliders[id];
        return true;
    }
    return false;
}

function processStepRemoves(removeList: SceneStep['remove'], tracker: StepTracker): void {
    if (!removeList || !Array.isArray(removeList)) return;
    const ownIds = new Set(tracker.elementIds || []);
    let slidersChanged = false;
    for (const item of removeList) {
        if (item.id === '*' || item.type === '*') {
            for (const id of Object.keys(sceneState.elementRegistry)) {
                if (ownIds.has(id)) continue;
                if (!sceneState.elementRegistry[id]!.hidden) {
                    hideElementById(id);
                    tracker.removedIds.push(id);
                }
            }
            removeTrackSliders(tracker);
            continue;
        }
        if (item.type === 'info') {
            if (item.id) removeInfoOverlay(item.id);
            else removeAllInfoOverlays();
            continue;
        }
        if (item.id) {
            if (!ownIds.has(item.id) && sceneState.elementRegistry[item.id] && !sceneState.elementRegistry[item.id]!.hidden) {
                hideElementById(item.id);
                tracker.removedIds.push(item.id);
            }
            if (removeTrackSliderById(item.id, tracker)) slidersChanged = true;
            removeInfoOverlay(item.id);
            continue;
        }
        if (item.type === 'slider') {
            removeTrackSliders(tracker);
            continue;
        }
        if (item.type) {
            for (const [id, reg] of Object.entries(sceneState.elementRegistry)) {
                if (ownIds.has(id)) continue;
                if (reg!.type === item.type && !reg!.hidden) {
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

function undoStepRemoves(tracker: StepTracker): void {
    if (!tracker.removedIds) return;
    const stillRemoved = new Set();
    const stillRemovedSliders = new Set();
    for (const t of sceneState.stepTrackers) {
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
            if (!stillRemovedSliders.has(id) && !sceneState.sceneSliders[id]) {
                sceneState.sceneSliders[id] = def;
                slidersChanged = true;
            }
        }
        if (slidersChanged) {
            buildSliderOverlay();
            recompileActiveExprs();
        }
    }
}

function removeStepTracker(tracker: StepTracker): void {
    if (tracker.sliderIds && tracker.sliderIds.length > 0) {
        const stillNeeded = new Set(sceneState.stepTrackers.flatMap(t => t.sliderIds || []));
        const toRemove = tracker.sliderIds.filter(id => !stillNeeded.has(id));
        // Restore previous slider states for sliders that aren't being removed
        // (i.e., sliders that existed before this step overrode their defaults).
        if (tracker.prevSliderStates) {
            for (const [id, prev] of Object.entries(tracker.prevSliderStates)) {
                if (!toRemove.includes(id) && sceneState.sceneSliders[id]) {
                    Object.assign(sceneState.sceneSliders[id], prev);
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
        for (const t of sceneState.stepTrackers) {
            if (t.removedIds) for (const id of t.removedIds) stillRemoved.add(id);
        }
        for (const [id, savedReg] of Object.entries(tracker.replacedElements)) {
            sceneState.elementRegistry[id] = savedReg;
            if (!stillRemoved.has(id)) showElementById(id);
        }
    }

    // Deregister the elements this step ADDED so nothing can reference them after
    // backward navigation — otherwise a popped element's registry entry lingers
    // (hidden:false, with a stale label/mesh anchor) and the per-object Ask-AI
    // picker still finds it. Ids this step REPLACED are restored just above and
    // must be kept.
    if (tracker.elementIds) {
        for (const id of tracker.elementIds) {
            if (tracker.replacedElements && tracker.replacedElements[id]) continue;
            delete sceneState.elementRegistry[id];
            sceneState.legendToggledOff.delete(id);
        }
    }

    fadeOutTracker(tracker, 200, () => {
        if (tracker.group) {
            try { tracker.group.remove(); } catch(e) {}
        }

        for (const entry of tracker.arrowMeshes) {
            sceneState.three.scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.mesh.material.dispose();
            const idx = sceneState.arrowMeshes.indexOf(entry);
            if (idx >= 0) sceneState.arrowMeshes.splice(idx, 1);
        }

        // Animated vectors create arrow meshes LAZILY (a vector that starts at
        // zero length has none at render time), so the creation-time snapshot
        // above can miss them and leave frozen ghost arrows behind on backward
        // navigation. Sweep the global registry by owner token to catch every
        // mesh the element ever created. (Double-dispose of snapshot-captured
        // meshes is harmless: scene.remove and dispose are idempotent.)
        for (const r of tracker.renderResults || []) {
            if (!r || !r._arrowOwner) continue;
            for (let i = sceneState.arrowMeshes.length - 1; i >= 0; i--) {
                const entry = sceneState.arrowMeshes[i]!;
                if (entry.owner === r._arrowOwner) {
                    sceneState.three.scene.remove(entry.mesh);
                    entry.mesh.geometry.dispose();
                    entry.mesh.material.dispose();
                    sceneState.arrowMeshes.splice(i, 1);
                }
            }
        }

        for (const lbl of tracker.labels) {
            if (lbl.el.parentNode) lbl.el.parentNode.removeChild(lbl.el);
            const idx = sceneState.labels.indexOf(lbl);
            if (idx >= 0) sceneState.labels.splice(idx, 1);
        }

        for (const m of tracker.planeMeshes) {
            sceneState.three.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
            const idx = sceneState.planeMeshes.indexOf(m);
            if (idx >= 0) sceneState.planeMeshes.splice(idx, 1);
        }

        for (const entry of tracker.lineNodes) {
            const idx = sceneState.lineNodes.indexOf(entry);
            if (idx >= 0) sceneState.lineNodes.splice(idx, 1);
        }
        for (const entry of tracker.vectorLineNodes) {
            const idx = sceneState.vectorLineNodes.indexOf(entry);
            if (idx >= 0) sceneState.vectorLineNodes.splice(idx, 1);
        }
        for (const entry of tracker.axisLineNodes) {
            const idx = sceneState.axisLineNodes.indexOf(entry);
            if (idx >= 0) sceneState.axisLineNodes.splice(idx, 1);
        }
        for (const entry of (tracker.pointNodes || [])) {
            const idx = sceneState.pointNodes.indexOf(entry);
            if (idx >= 0) sceneState.pointNodes.splice(idx, 1);
        }
    });
}

function fadeInTracker(tracker: SubTracker, duration?: number): void {
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
        try { entry.node!.set('opacity', 0); } catch(e) {}
    }
    for (const entry of tracker.vectorLineNodes) {
        try { entry.node!.set('opacity', 0); } catch(e) {}
    }
    for (const entry of (tracker.pointNodes || [])) {
        try { entry.node!.set('opacity', 0); } catch(e) {}
    }

    function step(now: number): void {
        // Non-null: `duration` was defaulted above; the narrowing just does not
        // survive into this hoisted declaration.
        const t = Math.min((now - startTime) / duration!, 1);
        const ease = t * t * (3 - 2 * t); // smoothstep

        for (const entry of tracker.arrowMeshes) {
            const baseOp = (entry.mesh && entry.mesh.userData && typeof entry.mesh.userData.baseOpacity === 'number')
                ? entry.mesh.userData.baseOpacity : 1;
            const globalOp = entry.isShaft ? sceneState.displayParams.vectorOpacity : sceneState.displayParams.arrowOpacity;
            entry.mesh.material.opacity = ease * Math.max(0, Math.min(1, baseOp * globalOp));
        }
        for (const m of tracker.planeMeshes) {
            const targetOp = m.userData.targetOpacity !== undefined ? m.userData.targetOpacity : sceneState.displayParams.planeOpacity;
            m.material.opacity = ease * targetOp;
        }
        for (const lbl of tracker.labels) {
            lbl.el.style.opacity = String(ease * sceneState.displayParams.labelOpacity);
        }
        for (const entry of tracker.lineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node!.set('opacity', ease * baseOp * sceneState.displayParams.lineOpacity); } catch(e) {}
        }
        for (const entry of tracker.vectorLineNodes) {
            const baseOp = (entry && typeof entry.baseOpacity === 'number') ? entry.baseOpacity : 1;
            try { entry.node!.set('opacity', ease * baseOp * sceneState.displayParams.vectorOpacity); } catch(e) {}
        }
        for (const entry of (tracker.pointNodes || [])) {
            try { entry.node!.set('opacity', ease); } catch(e) {}
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

function fadeOutTracker(tracker: SubTracker, duration?: number, onComplete?: () => void): void {
    duration = duration || 200;
    const startTime = performance.now();

    const arrowOps = tracker.arrowMeshes.map(e => e.mesh.material.opacity);
    const planeOps = tracker.planeMeshes.map(m => m.material.opacity);

    function step(now: number): void {
        // Non-null for the same reason as fadeInTracker's step().
        const t = Math.min((now - startTime) / duration!, 1);
        const ease = 1 - t * t; // inverse quadratic

        for (let i = 0; i < tracker.arrowMeshes.length; i++) {
            tracker.arrowMeshes[i]!.mesh.material.opacity = arrowOps[i]! * ease;
        }
        for (let i = 0; i < tracker.planeMeshes.length; i++) {
            tracker.planeMeshes[i]!.material.opacity = planeOps[i]! * ease;
        }
        for (const lbl of tracker.labels) {
            // `|| 1` fed a number to parseFloat, which stringifies it; String()
            // makes that same coercion explicit.
            lbl.el.style.opacity = String(parseFloat(lbl.el.style.opacity || String(1)) * ease);
        }
        for (const entry of tracker.lineNodes) {
            try { entry.node!.set('opacity', ((entry.node!.get('opacity') as number) || 1) * ease); } catch(e) {}
        }
        for (const entry of tracker.vectorLineNodes) {
            try { entry.node!.set('opacity', ((entry.node!.get('opacity') as number) || 1) * ease); } catch(e) {}
        }
        for (const entry of (tracker.pointNodes || [])) {
            try { entry.node!.set('opacity', ((entry.node!.get('opacity') as number) || 1) * ease); } catch(e) {}
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

export async function loadScene(spec: SceneSpec | null | undefined): Promise<void> {
    // Clear MathBox elements
    const root = sceneState.mathbox.select('*');
    if (root) root.remove();

    // Clear 3D arrow meshes
    for (const entry of sceneState.arrowMeshes) {
        sceneState.three.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
    }
    sceneState.arrowMeshes = [];
    sceneState.axisLineNodes = [];
    sceneState.vectorLineNodes = [];
    sceneState.lineNodes = [];
    for (const m of sceneState.planeMeshes) { sceneState.three.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    sceneState.planeMeshes = [];
    sceneState.pointNodes = [];
    sceneState._planeMeshSerial = 0;

    clearLabels();
    sceneState.followCamState = null;
    sceneState.cameraExprState = null;
    sceneState.cameraExprStartTime = 0;
    if (sceneState.controls && sceneState.followCamSavedControls) {
        if (Object.prototype.hasOwnProperty.call(sceneState.controls, 'enableDamping')) {
            sceneState.controls.enableDamping = sceneState.followCamSavedControls.enableDamping;
            if (Number.isFinite(sceneState.followCamSavedControls.dampingFactor)) {
                sceneState.controls.dampingFactor = sceneState.followCamSavedControls.dampingFactor;
            }
        }
    }
    sceneState.followCamSavedControls = null;
    updateFollowAngleLockButtonState();
    for (const k in sceneState.animatedElementPos) delete sceneState.animatedElementPos[k];
    sceneState.activeAnimExprs = [];
    sceneState.activeAnimUpdaters = [];
    sceneState.sceneStartTime = performance.now();
    clearWorldStarfield();
    clearWorldSkybox();
    sceneState.currentSpec = spec;
    // Merge data tables: lesson-level first, scene-level overrides
    const lessonData = (sceneState.lessonSpec && sceneState.lessonSpec.data) || {};
    const sceneData = (spec && spec.data) || {};
    sceneState.sceneData = { ...lessonData, ...sceneData };
    setActiveSceneFunctions(spec);
    setActiveVirtualTimeExpr(spec, -1);
    updateTitle(spec);
    updateExplanationPanel(spec);
    loadProof(sceneState.lessonSpec || spec, sceneState.currentSceneIndex, -1);

    // Show/hide empty state
    // Non-null: #empty-state is part of index.html's static markup. A missing
    // one threw in the JS and must keep throwing.
    const emptyState = document.getElementById('empty-state')!;
    if (!spec || !spec.elements || spec.elements.length === 0) {
        sceneState.currentRange = [[-5, 5], [-5, 5], [-5, 5]];
        sceneState.currentScale = [1, 1, 1];
        buildCameraButtons(spec);
        emptyState.style.display = 'block';
        const view = sceneState.mathbox.cartesian({
            range: sceneState.currentRange,
            scale: sceneState.currentScale,
        });
        sceneState.sceneView = view;
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

    sceneState.currentRange = spec.range || [[-5, 5], [-5, 5], [-5, 5]];
    sceneState.currentScale = spec.scale || [1, 1, 1];
    configureWorldStarfield(spec as Parameters<typeof configureWorldStarfield>[0]);
    buildCameraButtons(spec);

    const view = sceneState.mathbox.cartesian({
        range: sceneState.currentRange,
        scale: sceneState.currentScale,
    });
    sceneState.sceneView = view;

    let baseAutoIdCounter = 0;
    for (const el of spec.elements) {
        // Objects eligible for the per-object Ask-AI button — those with an author
        // `prompt`, or any labeled/text content object (auto-generated prompt;
        // axes/grid excluded as scaffolding) — must be registered, so id them.
        const dn = elementDisplayName(el);
        if (!el.id && (el.prompt || (elementHasLabelSource(el) && el.type !== 'axis' && el.type !== 'grid'))) {
            el.id = '__auto_' + (baseAutoIdCounter++) + '_' + Date.now();
        }
        const elBefore = el.id ? snapshotBefore() : null;
        const elGroup = el.id ? view.group() : view;
        try {
            renderElement(el, elGroup);
            if (el.id) {
                const subTracker = buildSubTracker(elGroup, elBefore!);
                sceneState.elementRegistry[el.id] = { tracker: subTracker, hidden: false, type: el.type, prompt: el.prompt || null, label: dn };
            }
        } catch (e) {
            console.error('Error rendering element:', el, e);
        }
    }

    buildLegend(spec.elements);

    if (spec.camera) {
        const up = (spec.camera && Array.isArray(spec.camera.up) && spec.camera.up.length === 3)
            ? spec.camera.up
            : [0, 1, 0];
        // Non-null throughout: initMathBox() creates the camera before any scene
        // loads, and the JS dereferenced it unguarded. The index assertions are
        // the `length === 3` / DEFAULT_CAMERA fallbacks above, restated.
        sceneState.camera!.up.set(up[0]!, up[1]!, up[2]!);
        const pos = dataCameraToWorld(spec.camera.position as Vec3 || DEFAULT_CAMERA.position);
        const tgt = dataCameraToWorld(spec.camera.target as Vec3 || DEFAULT_CAMERA.target);
        sceneState.camera!.position.set(pos[0]!, pos[1]!, pos[2]!);
        if (sceneState.controls) {
            sceneState.controls.target.set(tgt[0]!, tgt[1]!, tgt[2]!);
            sceneState.controls.update();
        }
    }
}

// Helper to dynamically import axis/grid renderers for the empty state.
// These are already imported in objects/index.js but we need them synchronously-ish here.
let _defaultRenderersCache: DefaultRenderers | null = null;
async function _importDefaultRenderers(): Promise<DefaultRenderers> {
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

export function isLessonFormat(spec: unknown) {
    // Return type deliberately left to inference rather than pinned to boolean:
    // `s &&` yields the falsy value itself, and every caller uses the result as
    // a condition. Narrowing it to `boolean` would need a `!!` that changes what
    // this returns.
    const s = spec as { scenes?: unknown[] } | null | undefined;
    return s && Array.isArray(s.scenes) && s.scenes.length > 0;
}

export async function loadLesson(spec: LessonSpec | null | undefined): Promise<void> {
    // --- Trust check ---
    sceneState._sceneJsTrustState = null;
    sceneState._sceneJsIssues = [];
    sceneState._sceneIsUnsafe = false;
    sceneState._sceneUnsafeExplanation = '';
    if (spec) {
        sceneState._sceneIsUnsafe = spec.unsafe === true;
        sceneState._sceneUnsafeExplanation = spec.unsafeExplanation || '';
        const scanned = scanSpecForUnsafeJs(spec);
        const needsDialog = sceneState._sceneIsUnsafe || scanned;
        if (needsDialog) {
            const explanation = spec.unsafeExplanation ||
                'This scene contains native JavaScript expressions that execute in your browser.\nAllow execution only if you trust the source of this file.';
            const imports = Array.isArray(spec.import) ? spec.import : [];
            const trusted = await showTrustDialog(explanation, imports);
            sceneState._sceneJsTrustState = trusted ? 'trusted' : 'untrusted';
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
        sceneState.lessonSpec = null;
        sceneState.currentSceneIndex = -1;
        sceneState.currentStepIndex = -1;
        sceneState.visitedSteps = new Set();
        stopAutoPlay();
        sceneState._activeDomainFunctions = {};
        await importDomains(spec && spec.import);
        updateDockVisibility();
        loadScene(spec);
        return;
    }
    sceneState.lessonSpec = spec;
    sceneState.currentSceneIndex = -1;
    sceneState.currentStepIndex = -1;
    sceneState.visitedSteps = new Set();
    stopAutoPlay();
    await importDomains(spec!.import);
    buildSceneTree(spec);
    updateDockVisibility();
    navigateTo(0, -1);
}

// Path guard mirrors the one in graph-view.js dockProofAnimation.
const _PROOF_ID_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const _PROOF_MAX_BYTES = 512 * 1024;

/** Convert a pre-baked proof-animation file (proofs/domains/<id>.json) into a
 *  minimal in-memory LESSON: one empty scene (no 3D elements) whose `proof` is the
 *  reconstructed derivation. Feeding this through the normal lesson loader gives a
 *  scene-less /prove proof the full app experience — real proof panel, per-step
 *  semantic-graph derivation, and proof↔scene step sync — instead of a bespoke
 *  standalone dock. The proof-file step shape (operation / input_latex /
 *  justification) maps onto the lesson proofStep shape (label / math /
 *  justification); per-step graphs are derived on demand from `math`. */
export function proofFileToLesson(proof: ProofFile, id: string): LessonSpec {
    const rawSteps = Array.isArray(proof.steps) ? proof.steps : [];
    const steps = rawSteps.map((s, i) => ({
        id: s.id || `step-${i}`,
        type: i === 0 ? 'given' : (s.type || 'step'),
        // operation carries the step title (may contain inline $…$ — renderKaTeX
        // handles that); fall back to a generic label.
        label: s.operation || s.label || `Step ${i + 1}`,
        // `plain` is the CAS-normalized (un-annotated) form the proof animation
        // renders from its `latex` field — use it so the panel matches the embedded
        // animation exactly (e.g. e^{-z^2} shown as a fraction, not a raw negative
        // exponent). `input_latex` (the raw expert form) is only a fallback.
        math: s.plain || s.input_latex || s.math || '',
        justification: s.justification || '',
        sceneStep: 0,
    }));
    const title = proof.title || (id ? id.split('/')[1] : 'Proof');
    return {
        title,
        scenes: [{
            title,
            // An empty scene: no 3D elements. The proof is the whole content.
            markdown: typeof proof.goal === 'string' ? proof.goal : '',
            proof: {
                id: id || 'proof',
                title,
                goal: proof.goal || '',
                technique: 'derivation',
                steps,
            },
        }],
    };
}

/** Fetch a pre-baked proof by id (<domain>/<name>), reconstruct an in-memory
 *  lesson from it (see proofFileToLesson), and load it through the normal lesson
 *  pipeline. Returns true on success. Best-effort/validated: a bad id or malformed
 *  proof is a no-op returning false, so a deeplink never breaks. */
export async function loadProofAsLesson(id: string): Promise<boolean> {
    if (typeof id !== 'string' || id.includes('..') || !_PROOF_ID_RE.test(id)) return false;
    let proof;
    try {
        const resp = await fetch(`/proofs/domains/${id}.json`, { cache: 'no-store' });
        if (!resp.ok) return false;
        const len = Number(resp.headers.get('content-length') || 0);
        if (len && len > _PROOF_MAX_BYTES) return false;
        const text = await resp.text();
        if (text.length > _PROOF_MAX_BYTES) return false;
        proof = validateProofData(JSON.parse(text));
    } catch (e) { return false; }
    if (!proof || !Array.isArray(proof.steps) || !proof.steps.length) return false;
    await loadLesson(proofFileToLesson(proof, id));
    return true;
}

export function navigateTo(sceneIdx: number, stepIdx: number): void {
    if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) { return; }
    const scene = sceneState.lessonSpec.scenes[sceneIdx];
    if (!scene) { return; }

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    stepIdx = Math.max(-1, Math.min(stepIdx, maxStep));

    // Same position — no-op
    if (sceneIdx === sceneState.currentSceneIndex && stepIdx === sceneState.currentStepIndex) { return; }

    const sceneChanged = sceneIdx !== sceneState.currentSceneIndex;

    if (sceneChanged) {
        sceneState.stepTrackers = [];
        sceneState.elementRegistry = {};
        sceneState.legendToggledOff = new Set();
        stopAllSliderLoops();
        sceneState.sceneSliders = {};
        removeAllInfoOverlays();
        buildSliderOverlay();

        // Full re-render: load base scene elements
        const baseSpec = {
            title: scene.title,
            description: scene.description,
            markdown: scene.markdown,
            range: scene.range,
            scale: scene.scale,
            camera: scene.camera,
            views: scene.views,
            functions: scene.functions,
            elements: scene.elements || [],
            starfield: scene.starfield,
        };
        loadScene(baseSpec);

        for (let i = 0; i <= stepIdx; i++) {
            if (scene.steps && scene.steps[i]) {
                // Non-null: guarded on the same index one line up.
                const step = scene.steps[i]!;
                const tracker = renderStepAdd(step.add || [], step.sliders);
                processStepRemoves(step.remove, tracker);
                applyTrackerInfoOverlays(tracker, step);
                sceneState.stepTrackers.push(tracker);
                sceneState.visitedSteps.add(sceneIdx + ':' + i);
            }
        }

        buildLegend(getAllElements(scene, stepIdx));

    } else {
        if (stepIdx > sceneState.currentStepIndex) {
            for (let i = sceneState.currentStepIndex + 1; i <= stepIdx; i++) {
                if (scene.steps && scene.steps[i]) {
                    // Non-null: guarded on the same index one line up.
                    const step = scene.steps[i]!;
                    const tracker = renderStepAdd(step.add || [], step.sliders);
                    processStepRemoves(step.remove, tracker);
                    applyTrackerInfoOverlays(tracker, step);
                    sceneState.stepTrackers.push(tracker);
                    sceneState.visitedSteps.add(sceneIdx + ':' + i);
                }
            }
        } else {
            while (sceneState.stepTrackers.length > stepIdx + 1) {
                // Non-null: the while condition proves the stack is non-empty.
                const tracker = sceneState.stepTrackers.pop()!;
                undoStepRemoves(tracker);
                undoTrackerInfoOverlays(tracker);
                removeStepTracker(tracker);
            }
            // Re-apply info overlays from the step we landed on, since they
            // were removed when a later step called removeStepInfoOverlays().
            const landingTracker = sceneState.stepTrackers[sceneState.stepTrackers.length - 1];
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
    if (!sceneState.followCamState && !sceneState.cameraExprState && stepIdx >= 0 && scene.steps) {
        const cam = resolveEffectiveStepCamera(scene, stepIdx);
        if (cam) {
            const pos = dataCameraToWorld((cam.position || DEFAULT_CAMERA.position) as Vec3);
            const tgt = dataCameraToWorld((cam.target || DEFAULT_CAMERA.target) as Vec3);
            sceneState.CAMERA_VIEWS['_step'] = {
                position: pos,
                target: tgt,
                up: Array.isArray(cam.up) ? cam.up.slice(0, 3) : [0, 1, 0],
            };
            animateCamera('_step', 600);
        }
    }

    sceneState.currentSceneIndex = sceneIdx;
    sceneState.currentStepIndex = stepIdx;
    setActiveVirtualTimeExpr(scene, stepIdx);

    const activeStep = scene.steps && scene.steps[stepIdx];

    updateTreeHighlight();
    updateStepCaption(scene, stepIdx);
    updateStatusBar();

    // Update proof panel (always update — visibility depends on current step)
    loadProof(sceneState.lessonSpec || scene, sceneIdx, stepIdx);
    if (!sceneChanged && sceneState.proofSyncEnabled && sceneState.proofSpec && sceneState.proofSpec.length > 0) {
        syncProofFromSceneStep(stepIdx);
    }

    if (sceneChanged) {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }

    // Notify deeplink sync: a discrete scene/step transition happened.
    try { window.dispatchEvent(new CustomEvent('algebench:navchange')); } catch (_) { /* ignore */ }
}

// ----- Auto-play -----

export function updateDockVisibility(): void {
    // Non-null: #scene-dock is static markup in index.html; a missing one threw
    // in the JS. #scene-dock-toggle is genuinely optional and stays guarded.
    const dock = document.getElementById('scene-dock')!;
    const toggle = document.getElementById('scene-dock-toggle');
    if (sceneState.lessonSpec) {
        dock.classList.add('visible');
        if (toggle) toggle.style.display = '';
    } else {
        dock.classList.remove('visible');
        if (toggle) toggle.style.display = 'none';
    }
}

// Open the left dock and show its Scenes tab. Called when the user explicitly
// loads a scene (Load button / Built-in Scenes) so they land on the scene tree.
// The right panel is intentionally left untouched. No-op when there is no scene
// tree to show (single non-lesson scene -> dock stays hidden).
export function showSceneDockScenesTab(): void {
    const dock = document.getElementById('scene-dock');
    const panel = document.getElementById('scene-dock-panel');
    const toggle = document.getElementById('scene-dock-toggle');
    if (!dock || !panel || !dock.classList.contains('visible')) return;
    panel.classList.add('open');
    if (toggle) toggle.classList.add('active');
    localStorage.setItem('algebench-dock-open', 'true');
    window.dispatchEvent(new Event('resize'));
    const graph = window.__algebenchGraph;
    if (graph && typeof graph.showSceneView === 'function') {
        graph.showSceneView();
    } else {
        document.querySelectorAll<HTMLElement>('.dock-tab').forEach((b) =>
            b.classList.toggle('active', b.dataset.dockTab === 'scenes'));
        document.querySelectorAll('.dock-tab-content').forEach((c) =>
            c.classList.toggle('active', c.id === 'dock-tab-scenes'));
    }
}

function getCurrentStepDuration(): number {
    // Non-null: matches the JS, which indexed `.scenes` after only a truthiness
    // check on lessonSpec — a lesson without scenes threw here and still does.
    const scene = sceneState.lessonSpec && sceneState.lessonSpec.scenes![sceneState.currentSceneIndex];
    if (!scene || !scene.steps) return AUTO_PLAY_DEFAULT_DURATION;
    const step = scene.steps[sceneState.currentStepIndex];
    if (step && step.duration != null) return step.duration;
    if (sceneState.currentStepIndex === -1 && scene.duration != null) return scene.duration;
    return AUTO_PLAY_DEFAULT_DURATION;
}

function scheduleNextAutoPlay(): void {
    if (!sceneState.autoPlayTimer) return;
    const scene = sceneState.lessonSpec && sceneState.lessonSpec.scenes![sceneState.currentSceneIndex];
    if (!scene) { stopAutoPlay(); return; }
    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;
    const isLast = sceneState.currentSceneIndex >= sceneState.lessonSpec!.scenes!.length - 1 && sceneState.currentStepIndex >= maxStep;
    if (isLast) { stopAutoPlay(); return; }

    const step = scene.steps && scene.steps[sceneState.currentStepIndex];
    if (step && Array.isArray(step.sliders) && step.sliders.length > 0 && step.duration == null) {
        stopAutoPlay();
        return;
    }

    const dur = getCurrentStepDuration();
    sceneState.autoPlayTimer = setTimeout(() => {
        stepNext();
        scheduleNextAutoPlay();
    }, dur);
}

function startAutoPlay(): void {
    if (sceneState.autoPlayTimer) return;
    // A sentinel, not a handle: scheduleNextAutoPlay() checks the flag on entry
    // and then overwrites it with the real setTimeout id.
    sceneState.autoPlayTimer = true;
    scheduleNextAutoPlay();
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = PAUSE_ICON;
    }
}

export function stopAutoPlay(): void {
    if (sceneState.autoPlayTimer) {
        // The `true` sentinel above never reaches clearTimeout in practice —
        // scheduleNextAutoPlay() replaces it synchronously — but clearTimeout
        // tolerated it in the JS either way.
        clearTimeout(sceneState.autoPlayTimer as ReturnType<typeof setTimeout>);
        sceneState.autoPlayTimer = null;
    }
    const playBtn = document.getElementById('nav-play');
    if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = PLAY_ICON;
    }
}

function toggleAutoPlay(): void {
    if (sceneState.autoPlayTimer) {
        stopAutoPlay();
    } else {
        startAutoPlay();
    }
}

function stepNext(): void {
    if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) return;
    const scene = sceneState.lessonSpec.scenes[sceneState.currentSceneIndex];
    if (!scene) return;

    const maxStep = (scene.steps ? scene.steps.length : 0) - 1;

    if (sceneState.currentStepIndex < maxStep) {
        navigateTo(sceneState.currentSceneIndex, sceneState.currentStepIndex + 1);
    } else if (sceneState.currentSceneIndex < sceneState.lessonSpec.scenes.length - 1) {
        navigateTo(sceneState.currentSceneIndex + 1, -1);
    } else {
        stopAutoPlay();
    }
}

function stepPrev(): void {
    if (!sceneState.lessonSpec || !sceneState.lessonSpec.scenes) return;

    if (sceneState.currentStepIndex > -1) {
        navigateTo(sceneState.currentSceneIndex, sceneState.currentStepIndex - 1);
    } else if (sceneState.currentSceneIndex > 0) {
        // Non-null: the branch is gated on currentSceneIndex > 0.
        const prevScene = sceneState.lessonSpec.scenes![sceneState.currentSceneIndex - 1]!;
        const prevMaxStep = (prevScene.steps ? prevScene.steps.length : 0) - 1;
        navigateTo(sceneState.currentSceneIndex - 1, prevMaxStep);
    }
}

export function setupSceneDock(): void {
    // Non-null: all five are static markup in index.html. The JS dereferenced
    // them unguarded (except the innerHTML writes just below, which it did
    // guard) and must keep throwing when one is missing.
    const toggle = document.getElementById('scene-dock-toggle')!;
    const panel = document.getElementById('scene-dock-panel')!;
    const prevBtn = document.getElementById('nav-prev')!;
    const playBtn = document.getElementById('nav-play')!;
    const nextBtn = document.getElementById('nav-next')!;
    if (prevBtn) prevBtn.innerHTML = PREV_ICON;
    if (playBtn) playBtn.innerHTML = PLAY_ICON;
    if (nextBtn) nextBtn.innerHTML = NEXT_ICON;

    // Default to expanded: open unless the user has explicitly collapsed it.
    const savedOpen = localStorage.getItem('algebench-dock-open');
    if (savedOpen !== 'false') {
        panel.classList.add('open');
        toggle.classList.add('active');
    }

    toggle.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('open');
        toggle.classList.toggle('active', isOpen);
        // setItem stringifies its value; String() is that same coercion.
        localStorage.setItem('algebench-dock-open', String(isOpen));
        setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
    });

    prevBtn.addEventListener('click', () => stepPrev());
    playBtn.addEventListener('click', () => toggleAutoPlay());
    nextBtn.addEventListener('click', () => stepNext());

    document.addEventListener('keydown', (e) => {
        // Cast, not optional chaining: a null target threw in the JS.
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (!sceneState.lessonSpec) return;

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
