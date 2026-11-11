// ============================================================
// knowledge-app.ts — wires the Knowledge Graph Explorer into the AlgeBench
// app: the shared knowledge store, the status-bar entry point (global graph),
// the embedded knowledge graph in a lesson's Doc tab, the popup / fullscreen
// layer, and explicit lesson navigation.
//
// State isolation: nothing here writes lesson, scene, camera, expression or
// chat state. The ONLY path from the graph into the lesson is openLesson(),
// reached from an explicit "go to" button in the details panel.
// ============================================================

import { state } from '/state.js';
import { builtinIdFromPath } from '/lesson-picker.js';
import { renderMarkdown, makeAiAskButton } from '/labels.js';
import { navigateTo } from '/scene-loader.js';
import { loadBuiltinScene } from '/ui.js';
import { GraphExplorer } from '/graph-explorer/explorer.js';
import { GraphViewModel, type PresentationMode } from '/graph-explorer/view-model.js';
import { createKnowledgeAdapter } from '/graph-explorer/knowledge-adapter.js';
import { snapshotKnowledgeView, type KnowledgeGraphContext } from '/graph-explorer/agent-context.js';
import {
    applyRuntimeUpdate, conceptAtPlace, conceptForGlossaryKey as lookupGlossaryConcept, createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph, type RuntimeUpdate,
    type ConceptData, type KnowledgeGraph, type ParsedLessonGraph, type RelationData,
} from '/graph-explorer/knowledge-model.js';

type KGExplorer = GraphExplorer<ConceptData, RelationData>;

/** The single, app-wide knowledge store. Every explorer reads it; lessons and
 *  runtime integrations write it. */
export const knowledgeStore: KnowledgeGraph = createKnowledgeGraph();

// Definitions may come from runtime updates (future tutor / personal graph),
// so they render as untrusted markdown: raw HTML is shown as text and links
// keep only safe targets. Glossary auto-linking is off — the active lesson's
// glossary has no say over another lesson's concept.
const adapter = createKnowledgeAdapter({
    renderMarkdown: (md) => renderMarkdown(md, { glossary: false, untrusted: true }),
});

const coverage = { lessonsWithGraph: 0, lessonCount: 0, loaded: false, failed: false };
let globalLoad: Promise<void> | null = null;

interface ExplorerSlot {
    explorer: KGExplorer;
    /** Where it goes when it leaves the overlay (lesson: the embedded slot). */
    home: HTMLElement | null;
    /** The mode before the current one, for Esc / "back". */
    previous: PresentationMode;
}

let globalSlot: ExplorerSlot | null = null;
let lessonSlot: (ExplorerSlot & { lessonId: string; parsed: ParsedLessonGraph }) | null = null;
let layer: HTMLElement | null = null;
let layerPanel: HTMLElement | null = null;
/** Which explorer currently occupies the popup/fullscreen layer. */
let layerOwner: ExplorerSlot | null = null;

// ---------- data loading ----------

interface KnowledgeResponse {
    lessonCount: number;
    lessons: { id: string; title: string; draft: boolean; knowledgeGraph: unknown;
               glossary?: Record<string, { term?: string; markdown?: string }> }[];
}

/** Fetch every lesson's knowledge block once and merge it into the store. */
export function loadGlobalKnowledge(): Promise<void> {
    if (!globalLoad) {
        globalLoad = (async () => {
            try {
                const resp = await fetch('/api/knowledge-graph', { cache: 'no-store' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json() as KnowledgeResponse;
                const issues: string[] = [];
                const parsed = data.lessons.map((l) => ({ l, p: parseLessonKnowledgeGraph(l.knowledgeGraph,
                    { lessonId: l.id, lessonTitle: l.title, draft: l.draft, glossary: l.glossary ?? {} }, () => true) }));
                // Two passes in one batch: every concept first, so a relation may
                // point at a concept another lesson defines.
                knowledgeStore.batch(() => {
                    for (const { p } of parsed) issues.push(...mergeIntoGraph(knowledgeStore, { concepts: p.concepts, relations: [] }).issues);
                    for (const { l, p } of parsed) {
                        issues.push(...p.issues.map((m) => `${l.id}: ${m}`));
                        issues.push(...mergeIntoGraph(knowledgeStore, { concepts: [], relations: p.relations }).issues.map((m) => `${l.id}: ${m}`));
                    }
                });
                if (issues.length) console.warn('[knowledge-graph] data issues:\n  ' + issues.join('\n  '));
                coverage.lessonsWithGraph = data.lessons.length;
                coverage.lessonCount = data.lessonCount;
                coverage.loaded = true;
            } catch (err) {
                coverage.failed = true;
                console.error('[knowledge-graph] failed to load', err);
                globalLoad = null;  // allow a retry on the next open
            }
            updateCoverageText();
        })();
    }
    return globalLoad;
}

/** The lesson on screen, as the global graph sees it. */
const activeLesson: {
    id: string | null; title: string;
    /** The lesson's main concept (its `focus`, else its first concept). */
    focus: string | null;
    /** The concept taught at the current scene/step (follows navigation). */
    placeFocus: string | null;
} = { id: null, title: '', focus: null, placeFocus: null };
/** The lesson the global graph last re-focused for — it follows each newly opened lesson once. */
let globalFollowedLesson: string | null = null;
/** A lesson opened FROM the graph: keep the graph on the concept the learner came from. */
let openedFromGraph: string | null = null;

function coverageText(): string {
    if (coverage.failed) return '<span class="kg-warn">Lesson knowledge failed to load</span>';
    if (!coverage.loaded) return 'loading lesson knowledge…';
    let s = `knowledge graphs from ${coverage.lessonsWithGraph} of ${coverage.lessonCount} lessons`;
    if (activeLesson.id && !activeLesson.focus) {
        const esc = activeLesson.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        s += ` · <span class="kg-warn">the current lesson${esc ? ` (${esc})` : ''} has no knowledge graph yet</span>`;
    }
    return s;
}

/**
 * Re-centre the global graph on the open lesson's main concept — once per
 * newly opened lesson, so it "picks up" the lesson without fighting the
 * learner's own exploration afterwards. The previous view stays on Back.
 */
function followActiveLesson(): void {
    if (!globalSlot) return;
    const vm = globalSlot.explorer.vm;
    // Local scope means "the open lesson": it follows lesson changes. A lesson
    // without a knowledge graph has no local concepts, so Local is then empty
    // (with an explanation) — it never silently shows other lessons.
    if (vm.scopeId === 'local') applyScope(vm, 'local', activeLesson.id, activeLesson.focus);
    // A lesson with no concept of its own: whatever was focused belongs to
    // another lesson, so it is stale context — clear it (Back restores it).
    if (!activeLesson.focus) clearForeignFocus();
    if (activeLesson.focus && activeLesson.id !== globalFollowedLesson && knowledgeStore.hasNode(activeLesson.focus)) {
        globalFollowedLesson = activeLesson.id;
        const target = activeLesson.placeFocus && knowledgeStore.hasNode(activeLesson.placeFocus) ? activeLesson.placeFocus : activeLesson.focus;
        vm.focusOn(target);
    } else if (vm.visibleNodes.size === 0 && vm.scopeId !== 'local') {
        // Nothing on screen: start from an overview. Not in Local — an empty
        // Local is the honest answer for a lesson without concepts, and an
        // overview of nothing would wipe the view kept for Global.
        vm.showOverview(40);
    }
    globalSlot.explorer.setStatusExtra(() => statusText(vm));
}

// ---------- tutor context (CTX) ----------

/**
 * The view the learner most recently worked in — focus, selection, visible
 * concepts. Only user-visible activity counts (not background data patches or
 * the hidden lesson graph's initial focus), and it is kept after the explorer
 * closes: the tutor keeps knowing what was explored, flagged `open: false`.
 */
let lastViewed: GraphViewModel<ConceptData, RelationData> | null = null;

function trackForTutor(vm: GraphViewModel<ConceptData, RelationData>): void {
    vm.events.on('state', ({ reason }) => {
        if (reason !== 'data' && vm.presentation !== 'closed') lastViewed = vm;
        // One focus across the app: a new focus in either graph (lesson panel
        // or popup) carries to the other, so the docked and opened views never
        // disagree. The other view skips it when the concept is outside its
        // scope (Local can't show another lesson's concept).
        if ((reason === 'focus' || reason === 'history') && vm.focus && !syncingFocus) {
            syncingFocus = true;
            try {
                for (const slot of [lessonSlot, globalSlot]) {
                    const other = slot?.explorer.vm;
                    if (other && other !== vm && other.focus !== vm.focus && other.inScope(vm.focus)) other.focusOn(vm.focus);
                }
            } finally { syncingFocus = false; }
        }
    });
}

/** Guards the focus sync above against echoing back and forth. */
let syncingFocus = false;

/** `runtime.knowledgeGraph` for the chat context; null until a graph was opened. */
export function getKnowledgeGraphContext(): KnowledgeGraphContext | null {
    if (!lastViewed) return null;
    try { return snapshotKnowledgeView(lastViewed, lastViewed.presentation !== 'closed'); }
    catch (err) { console.warn('[knowledge-graph] context snapshot failed', err); return null; }
}

// ---------- scopes ----------

const SCOPE_TITLES = {
    local: "Local — only this lesson's concepts",
    global: 'Global — concepts from every lesson',
};
const SCOPES = [
    { id: 'local', label: 'Local', title: SCOPE_TITLES.local },
    { id: 'global', label: 'Global', title: SCOPE_TITLES.global },
];

/**
 * Local scope membership: concepts the lesson references, plus runtime
 * additions linked to one of them (a concept proposed while studying the
 * lesson belongs with it). Read live from the store, so updates are classified
 * as they arrive.
 */
function lessonScope(lessonId: string): (id: string) => boolean {
    const taught = (id: string) => !!knowledgeStore.getNode(id)?.data.lessons.some((l) => l.lessonId === lessonId);
    return (id) => {
        const n = knowledgeStore.getNode(id);
        if (!n) return false;
        if (n.data.lessons.some((l) => l.lessonId === lessonId)) return true;
        return n.data.origin === 'runtime' && knowledgeStore.neighbors(id).some(taught);
    };
}

/** Switch a view's scope; if its focus falls outside (or nothing is left), re-centre on `fallbackFocus`. */
function applyScope(vm: GraphViewModel<ConceptData, RelationData>, scopeId: string,
                    lessonId: string | null, fallbackFocus: string | null): void {
    if (scopeId === 'local') {
        // No open lesson: nothing is local.
        vm.setScope('local', lessonId ? lessonScope(lessonId) : () => false);
        // Keep an overview as an overview; re-centre only when the focus left the
        // scope or nothing in scope is on screen.
        const lost = (vm.focus !== null && !vm.inScope(vm.focus)) || vm.visibleNodes.size === 0;
        if (lost && fallbackFocus && vm.inScope(fallbackFocus)) vm.focusOn(fallbackFocus);
    } else {
        vm.setScope('global', null);
    }
}

/**
 * The status-line context for a view: Local names the open lesson (and says
 * when it has no knowledge graph); Global shows how much of the catalogue the
 * graph covers.
 */
function statusText(vm: GraphViewModel<ConceptData, RelationData>): string {
    if (vm.scopeId !== 'local') return coverageText();
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = activeLesson.title ? esc(activeLesson.title) : 'this lesson';
    return activeLesson.focus ? `local: ${title}`
        : `local: ${title} — <span class="kg-warn">no knowledge graph yet</span>`;
}

function updateCoverageText(): void {
    if (globalSlot) { const vm = globalSlot.explorer.vm; globalSlot.explorer.setStatusExtra(() => statusText(vm)); }
    if (lessonSlot) { const vm = lessonSlot.explorer.vm; lessonSlot.explorer.setStatusExtra(() => statusText(vm)); }
}

// ---------- lesson navigation (explicit only) ----------

function currentLessonId(): string | null {
    return builtinIdFromPath(state.currentSceneSourcePath) ?? (state.currentSceneSourcePath ? `local:${state.currentSceneSourcePath}` : null);
}

async function openLesson(lessonId: string, scene: number, step: number): Promise<void> {
    if (lessonId !== currentLessonId()) {
        if (lessonId.startsWith('local:')) return;  // a dropped file can't be re-opened by id
        openedFromGraph = lessonId;
        if (!await loadBuiltinScene(lessonId)) return;
    }
    navigateTo(scene, step);
    // Show the lesson: a fullscreen graph steps down to its compact form.
    if (layerOwner && layerOwner.explorer.vm.presentation === 'fullscreen') {
        setMode(layerOwner, layerOwner.home ? 'embedded' : 'popup');
    }
}

/**
 * The app's standard sparkle Ask-AI button. The reply lands in the chat tab,
 * which a fullscreen graph covers — so asking steps the graph down to its
 * compact form first, with its exploration intact.
 */
function makeAskButton(title: string, getMessage: () => string): HTMLElement {
    const btn = makeAiAskButton('ai-ask-btn kg-ask-btn', title, getMessage);
    btn.addEventListener('click', () => {
        const owner = layerOwner;
        if (owner && owner.explorer.vm.presentation === 'fullscreen') {
            void setMode(owner, owner.home ? 'embedded' : 'popup');
        }
    }, true);
    return btn;
}

// ---------- the popup / fullscreen layer ----------

// ---------- a movable popup ----------

const POPUP_POS_KEY = 'algebench.kgPopupPos';
const POPUP_SIZE_KEY = 'algebench.kgPopupSize';
const POPUP_MIN = { w: 380, h: 260 };

/**
 * Follow one pointer drag on `el` until it really ends. A release outside the
 * browser window may never deliver pointerup (capture is just lost), so the
 * drag also ends on lostpointercapture, on a move with no button held, and on
 * window blur — otherwise it "sticks" and follows the pointer when it comes
 * back. `end` always runs exactly once, with the last known position.
 */
function trackDrag(el: HTMLElement, start: PointerEvent,
                   move: (x: number, y: number) => void, end: (x: number, y: number) => void): void {
    let x = start.clientX, y = start.clientY, done = false;
    try { el.setPointerCapture(start.pointerId); } catch { /* capture is best-effort */ }
    const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', finish);
        el.removeEventListener('lostpointercapture', finish);
        window.removeEventListener('blur', finish);
        try { if (el.hasPointerCapture(start.pointerId)) el.releasePointerCapture(start.pointerId); } catch { /* already gone */ }
        end(x, y);
    };
    const onMove = (e: PointerEvent) => {
        if (e.pointerId !== start.pointerId) return;
        if (e.buttons === 0) { finish(); return; }            // released somewhere we never heard about
        x = e.clientX; y = e.clientY;
        move(x, y);
    };
    const onUp = (e: PointerEvent) => {
        if (e.pointerId !== start.pointerId) return;
        x = e.clientX; y = e.clientY;
        finish();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
    window.addEventListener('blur', finish);
}

function loadPopupSize(): { w: number; h: number } | null {
    try {
        const p = JSON.parse(localStorage.getItem(POPUP_SIZE_KEY) || 'null') as { w?: unknown; h?: unknown } | null;
        return p && Number.isFinite(p.w) && Number.isFinite(p.h) ? { w: p.w as number, h: p.h as number } : null;
    } catch { return null; }
}

/** Size the popup, within the minimum and what fits right/below its top-left. */
function sizePopup(panel: HTMLElement, w: number, h: number, remember: boolean): void {
    const r = panel.getBoundingClientRect();
    const cw = Math.max(POPUP_MIN.w, Math.min(window.innerWidth - r.left - 4, w));
    const ch = Math.max(POPUP_MIN.h, Math.min(window.innerHeight - r.top - 26, h));
    panel.style.setProperty('--kg-w', `${Math.round(cw)}px`);
    panel.style.setProperty('--kg-h', `${Math.round(ch)}px`);
    panel.classList.add('kg-sized');
    if (remember) { try { localStorage.setItem(POPUP_SIZE_KEY, JSON.stringify({ w: Math.round(cw), h: Math.round(ch) })); } catch { /* not remembered */ } }
}

function loadPopupPos(): { x: number; y: number } | null {
    try {
        const p = JSON.parse(localStorage.getItem(POPUP_POS_KEY) || 'null') as { x?: unknown; y?: unknown } | null;
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x as number, y: p.y as number } : null;
    } catch { return null; }
}

/** Put the popup at (x, y), kept fully on screen; persist unless told not to. */
function placePopup(panel: HTMLElement, x: number, y: number, remember: boolean): void {
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const cx = Math.max(4, Math.min(window.innerWidth - w - 4, x));
    const cy = Math.max(4, Math.min(window.innerHeight - h - 26, y));   // keep clear of the status bar
    panel.style.setProperty('--kg-x', `${Math.round(cx)}px`);
    panel.style.setProperty('--kg-y', `${Math.round(cy)}px`);
    panel.classList.add('kg-moved');
    if (remember) { try { localStorage.setItem(POPUP_POS_KEY, JSON.stringify({ x: Math.round(cx), y: Math.round(cy) })); } catch { /* not remembered */ } }
}

/**
 * The popup moves by dragging an empty part of its toolbar (controls keep
 * working). Position is remembered and clamped on screen; fullscreen ignores
 * it (CSS applies --kg-x/--kg-y in popup mode only).
 */
function makePopupMovable(layerEl: HTMLElement, panel: HTMLElement): void {
    const saved = loadPopupPos();
    const savedSize = loadPopupSize();
    requestAnimationFrame(() => {
        if (savedSize) {
            panel.style.setProperty('--kg-w', `${savedSize.w}px`);
            panel.style.setProperty('--kg-h', `${savedSize.h}px`);
            panel.classList.add('kg-sized');
        }
        if (saved) placePopup(panel, saved.x, saved.y, false);
    });
    // Resize from the bottom-right grip. The popup is pinned by its top-left
    // first (it opens anchored bottom-right), so it grows toward the pointer.
    const grip = panel.querySelector<HTMLElement>('.kg-layer-resize');
    grip?.addEventListener('pointerdown', (ev) => {
        if (layerEl.dataset.mode !== 'popup' || ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const r = panel.getBoundingClientRect();
        placePopup(panel, r.left, r.top, true);
        const ox = ev.clientX - r.width, oy = ev.clientY - r.height;
        panel.classList.add('kg-dragging');
        trackDrag(grip, ev, (x, y) => sizePopup(panel, x - ox, y - oy, false), (x, y) => {
            panel.classList.remove('kg-dragging');
            sizePopup(panel, x - ox, y - oy, true);
        });
    });
    panel.addEventListener('pointerdown', (ev) => {
        const t = ev.target as Element;
        if (layerEl.dataset.mode !== 'popup' || ev.button !== 0) return;
        // The title bar, or an empty part of the toolbar.
        const onHead = !!t.closest('.kg-layer-head') && !t.closest('button');
        if (!onHead && (!t.closest('.kg-toolbar') || t.closest('button, input, select, a, .kg-search, .kg-scope, .kg-zoom-level, .kg-depth-label'))) return;
        ev.preventDefault();
        const r = panel.getBoundingClientRect();
        const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
        panel.classList.add('kg-dragging');
        trackDrag(panel, ev, (x, y) => placePopup(panel, x - dx, y - dy, false), (x, y) => {
            panel.classList.remove('kg-dragging');
            placePopup(panel, x - dx, y - dy, true);
        });
    });
    // A smaller window must not strand the popup off screen.
    window.addEventListener('resize', () => {
        if (!panel.classList.contains('kg-moved')) return;
        const r = panel.getBoundingClientRect();
        if (layerEl.dataset.mode !== 'popup') return;
        placePopup(panel, r.left, r.top, false);
        if (panel.classList.contains('kg-sized')) sizePopup(panel, r.width, r.height, false);
    });
}

function ensureLayer(): HTMLElement {
    if (layer && layerPanel) return layerPanel;
    layer = document.createElement('div');
    layer.id = 'kg-layer';
    layer.className = 'hidden';
    // The panel: a title bar (the drag handle in popup mode) over the body the
    // explorer mounts into.
    layer.innerHTML = '<div class="kg-layer-scrim"></div>'
        + '<div class="kg-layer-panel" role="dialog" aria-modal="false" aria-label="Knowledge Graph">'
        + '<div class="kg-layer-head"><span class="kg-layer-grip" aria-hidden="true">⠿</span>'
        + '<span class="kg-layer-title">Knowledge Graph</span>'
        + '<span class="kg-layer-buttons"></span></div>'
        + '<div class="kg-layer-body"></div>'
        + '<div class="kg-layer-resize" role="separator" aria-label="Resize the Knowledge Graph" title="Drag to resize"></div></div>';
    document.body.appendChild(layer);
    const panelEl = layer.querySelector<HTMLElement>('.kg-layer-panel')!; // ! — created just above
    makePopupMovable(layer, panelEl);
    layerPanel = layer.querySelector<HTMLElement>('.kg-layer-body')!;    // explorers mount here
    layer.querySelector('.kg-layer-scrim')!.addEventListener('click', () => {
        if (layerOwner) setMode(layerOwner, layerOwner.previous === 'fullscreen' ? 'popup' : layerOwner.previous);
    });
    // Esc closes the open graph from anywhere (not only when focus is inside
    // it): the global graph closes, a lesson's graph returns to its panel.
    // Bubble phase on window, so anything that handles Esc first — the
    // explorer's search box clearing its text, another open dialog — wins.
    window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape' || ev.defaultPrevented || !layerOwner) return;
        const target = ev.target as Element | null;
        const dialog = target?.closest?.('[role="dialog"]');
        if (dialog && !layer!.contains(dialog)) return;            // another dialog owns this Esc
        if (document.querySelector('[role="dialog"][aria-modal="true"]:not([hidden]):not(.hidden)')) return;
        ev.preventDefault();
        void setMode(layerOwner, layerOwner.home ? 'embedded' : 'closed');
    });
    return layerPanel;
}

/**
 * Move an explorer to a presentation mode. The explorer (and its Cytoscape
 * instance, while mounted) is moved, never rebuilt — exploration state stays.
 */
async function setMode(slot: ExplorerSlot, mode: PresentationMode): Promise<void> {
    const ex = slot.explorer;
    const from = ex.vm.presentation;
    if (from === mode) return;
    if (from !== 'closed') slot.previous = from;
    if (mode === 'closed' || (mode === 'embedded' && !slot.home)) {
        ex.unmount();
        if (layerOwner === slot) hideLayer();
        updateStatusButton();
        return;
    }
    if (mode === 'embedded') {
        if (layerOwner === slot) hideLayer();
        // Mutually exclusive with the global popup: while it is up, the docked
        // copy waits (placeholder) and is restored when the popup closes.
        if (slot !== globalSlot && layerOwner === globalSlot && globalSlot && slot.home) {
            slot.home.classList.remove('hidden');
            slot.home.dataset.away = '1';
            lessonSuspended = true;
            updateStatusButton();
            return;
        }
        // Docked: the window buttons sit on the lesson panel's Knowledge Graph header.
        ex.setModeButtonsHost(document.getElementById('lesson-kg-buttons'));
        slot.home!.classList.remove('hidden');   // ! — checked above
        await ex.mount(slot.home!, 'embedded');
        updateStatusButton();
        return;
    }
    // popup / fullscreen: one explorer at a time in the layer.
    if (layerOwner && layerOwner !== slot) {
        const other = layerOwner;
        await setMode(other, other.home ? 'embedded' : 'closed');
    }
    const panel = ensureLayer();
    layer!.classList.remove('hidden');
    layer!.dataset.mode = mode;
    layerOwner = slot;
    if (slot.home && from === 'embedded') slot.home.dataset.away = '1';
    // Popped and docked are mutually exclusive: while the global graph is up
    // in the layer, the lesson panel's copy steps aside (focus is shared, so
    // nothing is lost) and comes back when the layer closes.
    if (slot === globalSlot && lessonSlot && lessonSlot.explorer.vm.presentation === 'embedded' && lessonSlot.home) {
        lessonSlot.explorer.unmount();
        lessonSlot.home.dataset.away = '1';
        lessonSuspended = true;
    }
    const title = layer!.querySelector('.kg-layer-title');
    if (title) title.textContent = ex.root.getAttribute('aria-label') ?? 'Knowledge Graph';
    layer!.querySelector('.kg-layer-panel')!.setAttribute('aria-label', title?.textContent ?? 'Knowledge Graph');
    // Window buttons (lesson panel / popup / fullscreen / close) sit on the title bar.
    ex.setModeButtonsHost(layer!.querySelector<HTMLElement>('.kg-layer-buttons'));
    await ex.mount(panel, mode);
    updateStatusButton();
}

function hideLayer(): void {
    layer?.classList.add('hidden');
    if (layerOwner?.home) delete layerOwner.home.dataset.away;
    const wasGlobal = layerOwner === globalSlot;
    layerOwner = null;
    if (wasGlobal) restoreDocked();
    syncLessonSection();
}

/** The lesson panel's graph stepped aside for the global popup. */
let lessonSuspended = false;

/** Bring the docked lesson graph back once the global graph leaves the layer
 *  (unless the learner folded the section meanwhile). */
function restoreDocked(): void {
    if (!lessonSuspended) return;
    lessonSuspended = false;
    const slot = lessonSlot;
    if (!slot?.home) return;
    delete slot.home.dataset.away;
    const folded = lessonSectionEls().head?.classList.contains('side-section-folded');
    if (!folded && slot.explorer.vm.presentation === 'closed') void setMode(slot, 'embedded');
}

// ---------- global explorer ----------

function getGlobalSlot(): ExplorerSlot {
    if (globalSlot) return globalSlot;
    const vm = new GraphViewModel<ConceptData, RelationData>(knowledgeStore, {
        graphType: 'knowledge', contextId: 'global', searchText: adapter.searchText,
    });
    const slot: ExplorerSlot = { explorer: null as unknown as KGExplorer, home: null, previous: 'popup' };
    slot.explorer = new GraphExplorer({
        vm, adapter, label: 'Knowledge Graph — all lessons',
        modes: ['popup', 'fullscreen', 'closed'],
        onRequestMode: (m) => { void setMode(slot, m); },
        actions: { openLesson: (id, s, t) => { void openLesson(id, s, t); } },
        overview: () => vm.showOverview(40),
        makeAskButton,
        detailsContext: () => ({ currentLessonId: currentLessonId() }),
        scopes: SCOPES,
        onScope: (id) => {
            applyScope(vm, id, activeLesson.id, activeLesson.focus);
            if (id === 'global' && vm.visibleNodes.size === 0) vm.showOverview(40);   // never an empty Global
        },
        emptyText: () => vm.scopeId === 'local'
            ? (activeLesson.focus
                ? "None of this lesson's concepts are in view. Search, or switch to Global."
                : 'This lesson has no knowledge graph yet. Switch to Global to explore concepts from other lessons.')
            : 'No lesson knowledge graphs yet. Lessons add one with a "knowledgeGraph" block.',
    });
    slot.explorer.setStatusExtra(() => statusText(slot.explorer.vm));
    trackForTutor(vm);
    globalSlot = slot;
    return slot;
}

/** Status-bar entry point: open the global explorer (or close it). */
export async function toggleGlobalExplorer(): Promise<void> {
    const slot = getGlobalSlot();
    if (slot.explorer.vm.presentation !== 'closed') { await setMode(slot, 'closed'); return; }
    await loadGlobalKnowledge();
    // Start from (or move to) the lesson the learner is in, else an overview.
    followActiveLesson();
    await setMode(slot, 'popup');
    slot.explorer.focusSearch();
}

/** Open the global explorer focused on a concept (for future callers: glossary, tutor). */
export async function openConcept(conceptId: string, mode: PresentationMode = 'popup'): Promise<boolean> {
    await loadGlobalKnowledge();
    if (!knowledgeStore.hasNode(conceptId)) return false;
    const slot = getGlobalSlot();
    const vm = slot.explorer.vm;
    // Opened for a specific concept: don't let the "follow the lesson" jump
    // replace it, but do refresh scope availability and the status line.
    globalFollowedLesson = activeLesson.id;
    followActiveLesson();
    if (!vm.inScope(conceptId)) applyScope(vm, 'global', null, null);
    if (vm.focus !== conceptId) vm.focusOn(conceptId);
    else vm.select({ kind: 'node', id: conceptId });
    await setMode(slot, mode === 'embedded' ? 'popup' : mode);
    return true;
}

/**
 * The concept the CURRENT lesson links to a glossary key — only through an
 * explicit `"glossary": "<key>"` on the concept (never by label or alias), and
 * only within this lesson: another lesson may use the same key for something
 * else. Null when there is none (the tooltip then shows no graph button).
 */
export function conceptForGlossaryKey(key: string): string | null {
    const lessonId = currentLessonId();
    return lessonId ? lookupGlossaryConcept(knowledgeStore, lessonId, key) : null;
}

/** Refresh the chrome outside the explorers after any mode change. */
function updateStatusButton(): void {
    syncLessonSection();
    const btn = document.getElementById('kg-status');
    if (!btn) return;
    const open = !!globalSlot && globalSlot.explorer.vm.presentation !== 'closed';
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
}

/**
 * Either docked or popped out — never both: the Doc tab's Knowledge Graph
 * section exists only while no graph is up in the popup / fullscreen layer
 * (the lesson's own, or the global one). It comes back when the layer closes.
 */
function syncLessonSection(): void {
    const { section } = lessonSectionEls();
    if (!section) return;
    const hasGraph = !!lessonSlot && lessonSlot.parsed.concepts.length > 0;
    const poppedOut = layerOwner !== null;
    section.classList.toggle('hidden', !hasGraph || poppedOut);
}

// ---------- lesson (embedded) explorer ----------

function lessonSectionEls() {
    return {
        section: document.getElementById('lesson-kg-section'),
        slot: document.getElementById('lesson-kg-slot'),
        toggle: document.getElementById('lesson-kg-toggle'),
        head: document.getElementById('lesson-kg-head'),
        count: document.getElementById('lesson-kg-count'),
    };
}

function disposeLessonSlot(): void {
    if (!lessonSlot) return;
    if (layerOwner === lessonSlot) hideLayer();
    lessonSlot.explorer.dispose();
    lessonSlot.explorer.vm.dispose();
    lessonSlot = null;
}

/** A lesson finished loading: show (or hide) its knowledge graph. */
export function onLessonLoaded(spec: unknown): void {
    const els = lessonSectionEls();
    const lessonId = currentLessonId();
    const raw = spec && typeof spec === 'object' ? (spec as { knowledgeGraph?: unknown }).knowledgeGraph : undefined;
    const title = spec && typeof spec === 'object' && typeof (spec as { title?: unknown }).title === 'string'
        ? (spec as { title: string }).title : '';
    if (lessonSlot && lessonSlot.lessonId === lessonId && raw !== undefined) return;  // same lesson: keep its exploration
    disposeLessonSlot();
    if (activeLesson.id !== lessonId) globalFollowedLesson = null;
    if (openedFromGraph === lessonId) globalFollowedLesson = lessonId;
    openedFromGraph = null;
    activeLesson.id = lessonId;
    activeLesson.title = title;
    activeLesson.focus = null;
    activeLesson.placeFocus = null;
    if (raw === undefined || !lessonId || !els.section || !els.slot) {
        els.section?.classList.add('hidden');
        followActiveLesson();
        return;
    }
    const s = spec as { title?: string; glossary?: Record<string, { term?: string; markdown?: string }> };
    const parsed = parseLessonKnowledgeGraph(raw, {
        lessonId, lessonTitle: typeof s.title === 'string' ? s.title : lessonId,
        draft: lessonId.startsWith('draft/'), glossary: s.glossary ?? {},
    }, (id) => knowledgeStore.hasNode(id));
    if (parsed.issues.length) console.warn(`[knowledge-graph] ${lessonId}:\n  ` + parsed.issues.join('\n  '));
    // The lesson's own block goes into the shared store too (a dropped local
    // file is otherwise unknown to the server); merging by id is idempotent.
    mergeIntoGraph(knowledgeStore, parsed);
    if (!parsed.concepts.length) { els.section.classList.add('hidden'); followActiveLesson(); return; }

    const vm = new GraphViewModel<ConceptData, RelationData>(knowledgeStore, {
        graphType: 'knowledge', contextId: `lesson:${lessonId}`, searchText: adapter.searchText,
    });
    const slot = {
        explorer: null as unknown as KGExplorer, home: els.slot, previous: 'embedded' as PresentationMode,
        lessonId, parsed,
    };
    slot.explorer = new GraphExplorer({
        vm, adapter, label: `Knowledge Graph — ${typeof s.title === 'string' ? s.title : lessonId}`,
        modes: ['embedded', 'popup', 'fullscreen'],
        onRequestMode: (m) => { void setMode(slot, m); },
        actions: { openLesson: (id, sc, st) => { void openLesson(id, sc, st); } },
        makeAskButton,
        detailsContext: () => ({ currentLessonId: currentLessonId() }),
        scopes: SCOPES,
        onScope: (id) => applyScope(vm, id, lessonId, focus),
    });
    lessonSlot = slot;
    const focus = parsed.mainConcept ?? parsed.concepts[0]!.id;  // ! — concepts non-empty (checked above)
    trackForTutor(vm);
    // A lesson's own graph opens Local; Global is one click away.
    vm.setScope('local', lessonScope(lessonId));
    activeLesson.focus = focus;
    // Start where the learner is: the concept taught at the current scene/step
    // (loadLesson has already navigated), else the lesson's main concept.
    activeLesson.placeFocus = conceptAtPlace(parsed.concepts, lessonId, state.currentSceneIndex, state.currentStepIndex, focus);
    vm.focusOn(activeLesson.placeFocus ?? focus, 1);
    followActiveLesson();
    els.section.classList.remove('hidden');
    syncLessonSection();                     // hidden again if a graph is popped out
    if (els.count) els.count.textContent = `${parsed.concepts.length} concepts`;
    slot.explorer.setStatusExtra(() => statusText(slot.explorer.vm));
    // The learner's last fold choice (folded by default, so Cytoscape only
    // loads once someone opens a graph).
    void setEmbeddedFolded(loadFolded(), false);
}

// ---------- the Doc-tab section folds like the chat panel's Proof / Chat ----------

const FOLD_KEY = 'algebench.foldKnowledgeGraph';
const chevron = (d: string): string =>
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" '
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON_FOLD = chevron('M6 9l6 6 6-6');      // same glyphs as src/side-sections.ts
const ICON_UNFOLD = chevron('M6 15l6-6 6 6');

function loadFolded(): boolean {
    try { return localStorage.getItem(FOLD_KEY) !== '0'; } catch { return true; }
}

function saveFolded(folded: boolean): void {
    try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0'); } catch { /* not remembered */ }
}

/** Fold the section to its header (closing the graph) or open it (mounting it). */
async function setEmbeddedFolded(folded: boolean, remember = true): Promise<void> {
    const els = lessonSectionEls();
    if (!els.slot || !els.head || !els.toggle) return;
    els.head.classList.toggle('side-section-folded', folded);
    els.toggle.innerHTML = folded ? ICON_UNFOLD : ICON_FOLD;
    els.toggle.title = folded ? 'Show the knowledge graph' : 'Fold the knowledge graph down to its header';
    els.toggle.setAttribute('aria-label', els.toggle.title);
    els.toggle.setAttribute('aria-expanded', String(!folded));
    els.slot.classList.toggle('hidden', folded);
    if (remember) saveFolded(folded);
    if (!lessonSlot) return;
    const mode = lessonSlot.explorer.vm.presentation;
    if (folded) {
        if (mode === 'closed') return;
        lessonSlot.home = null;            // close fully, not "back to embedded"
        await setMode(lessonSlot, 'closed');
        lessonSlot.home = els.slot;
    } else if (mode !== 'embedded') {
        void loadGlobalKnowledge();         // neighbours taught by other lessons join in when it lands
        await setMode(lessonSlot, 'embedded');
    }
}

function toggleEmbedded(): void {
    const head = lessonSectionEls().head;
    if (head) void setEmbeddedFolded(!head.classList.contains('side-section-folded'));
}

// ---------- setting the focus (the one standard way) ----------

export type FocusSource = 'navigation' | 'user' | 'tutor' | 'app';

/**
 * THE standard way to set the Knowledge Graph's current focus from outside the
 * explorer — lesson navigation uses it, and a tutor tool or another feature
 * should too. Focuses every open-or-closed explorer that can show the concept
 * (the lesson graph when it is in its scope, the global graph), each keeping
 * its own history so Back returns to what the learner had. A no-op for
 * explorers already focused there. Returns whether any view changed.
 */
export function focusKnowledgeConcept(conceptId: string, _opts: { source?: FocusSource } = {}): boolean {
    if (!knowledgeStore.hasNode(conceptId)) return false;
    let changed = false;
    for (const slot of [lessonSlot, globalSlot]) {
        if (!slot) continue;
        const vm = slot.explorer.vm;
        if (vm.focus === conceptId || !vm.inScope(conceptId)) continue;
        vm.focusOn(conceptId);
        changed = true;
    }
    return changed;
}

/**
 * Clear a focus / selection that doesn't belong to the open lesson — it is
 * stale context (for the learner and for the tutor's CTX). The view itself
 * stays; Back restores the old focus. A focus that is in the lesson but with a
 * foreign concept selected only loses the selection.
 */
function clearForeignFocus(): void {
    const lessonId = currentLessonId();
    const inLesson = lessonId ? lessonScope(lessonId) : () => false;
    for (const slot of [lessonSlot, globalSlot]) {
        if (!slot) continue;
        const vm = slot.explorer.vm;
        const sel = vm.selection;
        const selForeign = sel?.kind === 'node' ? !inLesson(sel.id)
            : sel?.kind === 'edge' ? (() => { const e = knowledgeStore.getEdge(sel.id); return !e || (!inLesson(e.source) && !inLesson(e.target)); })()
            : false;
        if (vm.focus !== null && !inLesson(vm.focus)) vm.clearFocus();
        else if (selForeign) vm.select(null);
    }
}

/** Scene/step changed: focus the concept the lesson teaches there (if any). */
function followLessonPosition(): void {
    if (!lessonSlot || lessonSlot.lessonId !== currentLessonId()) return;
    const id = conceptAtPlace(lessonSlot.parsed.concepts, lessonSlot.lessonId,
                              state.currentSceneIndex, state.currentStepIndex, activeLesson.focus ?? undefined);
    if (!id) {                                              // nothing taught here: drop a focus from elsewhere,
        activeLesson.placeFocus = null;                     // and let the next mapped place focus again
        clearForeignFocus();
        return;
    }
    if (id === activeLesson.placeFocus) return;             // same concept as the last step: leave the view alone
    activeLesson.placeFocus = id;
    focusKnowledgeConcept(id, { source: 'navigation' });
}

// ---------- runtime updates (future AI tutor / personal graph entry point) ----------

/**
 * Add concepts/relations at runtime. Accepts the same authored shape as a
 * lesson's knowledgeGraph block, validates it, and merges it in one batch —
 * every open explorer updates incrementally. Runtime records carry no lesson
 * reference and are marked as live updates.
 */
export function applyKnowledgeUpdate(update: RuntimeUpdate): { issues: string[] } {
    const res = applyRuntimeUpdate(knowledgeStore, update);
    return { issues: [...res.parseIssues, ...res.issues] };
}

// ---------- setup ----------

export function setupKnowledgeGraph(): void {
    const btn = document.getElementById('kg-status');
    btn?.addEventListener('click', () => { void toggleGlobalExplorer(); });
    btn?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void toggleGlobalExplorer(); }
    });
    // Header or chevron folds/unfolds, as the chat panel's Proof and Chat do.
    const { head, toggle } = lessonSectionEls();
    toggle?.addEventListener('click', (e) => { e.stopPropagation(); toggleEmbedded(); });
    head?.addEventListener('click', (e) => { if (!(e.target as Element).closest('button')) toggleEmbedded(); });
    window.addEventListener('algebench:lessonload', (ev) => {
        onLessonLoaded(ev.detail?.spec);
    });
    // Scene/step navigation moves the graph's focus to what is taught there.
    window.addEventListener('algebench:navchange', followLessonPosition);
    // Debug / integration handle (console demos, future tutor tools).
    // The tutor reads the last-viewed graph through the chat context (CTX).
    window.algebenchGetKnowledgeGraphState = getKnowledgeGraphContext;
    window.algebenchKnowledgeGraph = {
        store: knowledgeStore,
        applyUpdate: applyKnowledgeUpdate,
        openConcept,
        focusConcept: focusKnowledgeConcept,
        conceptForGlossaryKey,
        explorers: () => ({ global: globalSlot?.explorer ?? null, lesson: lessonSlot?.explorer ?? null }),
    };
}
