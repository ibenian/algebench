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
    applyRuntimeUpdate, conceptAtPlace, createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph, type RuntimeUpdate,
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
    // Local scope means "the open lesson": it follows lesson changes, and falls
    // back to Global when the new lesson has no knowledge graph.
    globalSlot.explorer.setScopeAvailable('local', !!activeLesson.focus,
        activeLesson.focus ? SCOPE_TITLES.local : 'The current lesson has no knowledge graph');
    if (vm.scopeId === 'local') applyScope(vm, activeLesson.focus ? 'local' : 'global', activeLesson.id, activeLesson.focus);
    if (activeLesson.focus && activeLesson.id !== globalFollowedLesson && knowledgeStore.hasNode(activeLesson.focus)) {
        globalFollowedLesson = activeLesson.id;
        const target = activeLesson.placeFocus && knowledgeStore.hasNode(activeLesson.placeFocus) ? activeLesson.placeFocus : activeLesson.focus;
        vm.focusOn(target);
    } else if (vm.visibleNodes.size === 0) {
        vm.showOverview(40);
    }
    globalSlot.explorer.setStatusExtra(coverageText());
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
    });
}

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
    if (scopeId === 'local' && lessonId) {
        vm.setScope('local', lessonScope(lessonId));
        // Keep an overview as an overview; re-centre only when the focus left the
        // scope or nothing in scope is on screen.
        const lost = (vm.focus !== null && !vm.inScope(vm.focus)) || vm.visibleNodes.size === 0;
        if (lost && fallbackFocus && vm.inScope(fallbackFocus)) vm.focusOn(fallbackFocus);
    } else {
        vm.setScope('global', null);
    }
}

function updateCoverageText(): void {
    globalSlot?.explorer.setStatusExtra(coverageText());
    lessonSlot?.explorer.setStatusExtra(coverageText());
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

function ensureLayer(): HTMLElement {
    if (layer && layerPanel) return layerPanel;
    layer = document.createElement('div');
    layer.id = 'kg-layer';
    layer.className = 'hidden';
    layer.innerHTML = '<div class="kg-layer-scrim"></div><div class="kg-layer-panel" role="dialog" aria-modal="false" aria-label="Knowledge Graph"></div>';
    document.body.appendChild(layer);
    layerPanel = layer.querySelector('.kg-layer-panel')!; // ! — created just above
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
    await ex.mount(panel, mode);
    updateStatusButton();
}

function hideLayer(): void {
    layer?.classList.add('hidden');
    if (layerOwner?.home) delete layerOwner.home.dataset.away;
    layerOwner = null;
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
        scopes: SCOPES,
        onScope: (id) => applyScope(vm, id, activeLesson.id, activeLesson.focus),
        emptyText: 'No lesson knowledge graphs yet. Lessons add one with a "knowledgeGraph" block.',
    });
    slot.explorer.setStatusExtra(coverageText());
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
    slot.explorer.vm.focusOn(conceptId);
    await setMode(slot, mode === 'embedded' ? 'popup' : mode);
    return true;
}

function updateStatusButton(): void {
    const btn = document.getElementById('kg-status');
    if (!btn) return;
    const open = !!globalSlot && globalSlot.explorer.vm.presentation !== 'closed';
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
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
        scopes: SCOPES,
        onScope: (id) => applyScope(vm, id, lessonId, focus),
    });
    lessonSlot = slot;
    const focus = parsed.focus ?? parsed.concepts[0]!.id;  // ! — concepts non-empty (checked above)
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
    if (els.count) els.count.textContent = `${parsed.concepts.length} concepts`;
    slot.explorer.setStatusExtra(coverageText());
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

/** Scene/step changed: focus the concept the lesson teaches there (if any). */
function followLessonPosition(): void {
    if (!lessonSlot || lessonSlot.lessonId !== currentLessonId()) return;
    const id = conceptAtPlace(lessonSlot.parsed.concepts, lessonSlot.lessonId,
                              state.currentSceneIndex, state.currentStepIndex, activeLesson.focus ?? undefined);
    if (!id || id === activeLesson.placeFocus) return;     // same concept as the last step: leave the view alone
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
        explorers: () => ({ global: globalSlot?.explorer ?? null, lesson: lessonSlot?.explorer ?? null }),
    };
}
