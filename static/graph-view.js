// ============================================================
// graph-view.js — Semantic graph mode for the left dock + main viewport.
//
// Adds a "Graph" tab to the scene dock. When active:
//   - Left dock shows a proof/step tree (top) + semantic info panel (bottom).
//   - Main viewport shows the Mermaid rendering of the current step's
//     semantic graph (if any).
//
// Navigation is bilateral:
//   - Clicks on the proof tree fire `navigateTo(scene, step)` (via sceneStep)
//     or `navigateProof(i)` fallback, which drives the existing sync logic.
//   - When the active proof step changes (from any source), the tree
//     highlight + graph viewport update.
//
// The 3D MathBox viewport is hidden, not destroyed, so switching back is
// instant and all camera/state is preserved.
// ============================================================

import { state } from '/state.js';
import { SemanticGraphPanel } from '/graph-panel/graph-panel.js';
import { D3SemanticGraphRenderer, nodeLongLabel } from '/graph-panel/d3-semantic-graph.js';
import { SgChartManager } from '/graph-panel/sg-chart.js';
import { SgProofManager, clearDeriveCache } from '/proof-animation/sg-proof.js';
import { validateProofData } from '/proof-animation/validate-proof.js';
import { buildEnrichContext } from '/proof-animation/derive-payload.js';
import {
    makeAiAskButton, makeDeriveButton, renderKaTeX,
    stripHtmlMacros as _stripHtmlMacros, normLatex as _normLatex,
} from '/labels.js';

let _currentGraphPanel = null;
let _currentSemanticKey = null;
let _activeStepForPanel = null;
let _initDone = false;
let _currentD3Renderer = null;
let _currentChartManager = null;
const _chartManagers = new Map();     // stepKey -> SgChartManager (per-step, persistent)
let _currentProofManager = null;
let _d3NodeAskBtn = null;
let _d3NodeAskHideTimer = null;
let _d3HoveredNodeId = null;
let _d3ActiveGraph = null;
let _d3StepStates = new Map();
let _d3LastStepKey = null;
let _pendingDeeplinkSelection = null;  // node ids awaiting the target step's render

// ----- Deeplink selection bridge (consumed by view-state-bridge.js) -----

/** Current selection as an ordered array, active node last. */
function getGraphSelection() {
    if (!_currentD3Renderer || _currentD3Renderer._destroyed) return [];
    const sel = [..._currentD3Renderer.selectedNodes];
    const active = _currentD3Renderer.activeNode;
    if (active && sel.includes(active)) {
        return [...sel.filter((id) => id !== active), active];
    }
    return sel;
}

/** Stash a deeplink selection; applied on the next/current step render. */
function applyDeeplinkSelection(ids) {
    _pendingDeeplinkSelection = Array.isArray(ids) ? ids.slice() : [];
    if (_currentD3Renderer && !_currentD3Renderer._destroyed && _d3ActiveGraph) {
        _applyPendingDeeplinkSelection(_d3ActiveGraph);
    }
}

function _applyPendingDeeplinkSelection(graph) {
    if (_pendingDeeplinkSelection == null) return;
    const want = _pendingDeeplinkSelection;
    _pendingDeeplinkSelection = null;
    if (!_currentD3Renderer || _currentD3Renderer._destroyed) return;
    const valid = want.filter((id) => (graph.nodes || []).some((n) => n.id === id));
    _currentD3Renderer.setSelection(valid);
    if (valid.length > 1) {
        _showD3MultiInfoPanel(new Set(valid), graph);
    } else if (valid.length === 1) {
        const node = (graph.nodes || []).find((n) => n.id === valid[0]);
        _showD3InfoPanel(valid[0], node, graph);
    } else {
        _hideD3InfoPanel();
    }
}

/** 'math' when the Math tab is active, else 'scene'. (Internal dock id is 'graph'.) */
function getCurrentView() {
    const active = document.querySelector('.dock-tab.active');
    return (active && active.dataset.dockTab === 'graph') ? 'math' : 'scene';
}

/** Switch to the Math (graph) view; resolves when the graph has rendered. */
function showGraphView() {
    return setDockTab('graph');
}

/** Switch to the Scenes (3D) view. */
function showSceneView() {
    return setDockTab('scenes');
}

if (typeof window !== 'undefined') {
    window.__algebenchGraph = {
        getSelection: getGraphSelection,
        applyDeeplinkSelection,
        getCurrentView,
        showGraphView,
        showSceneView,
        dockProofAnimation,
    };
}

// Persisted user preferences. localStorage keys are versioned with an
// `algebench.graph.` prefix so future format changes can be migrated without
// colliding with stored values from unrelated features.
const LS_KEYS = {
    theme: 'algebench.graph.theme',
    mode: 'algebench.graph.mode',
    direction: 'algebench.graph.direction',
    labels: 'algebench.graph.labels',
    zoom: 'algebench.graph.zoom',
    renderer: 'algebench.graph.renderer',
    docked: 'algebench.graph.docked',
    dockRatio: 'algebench.graph.dockRatio',
};
const _lsGet = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const _lsSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
};

let _currentTheme = _lsGet(LS_KEYS.theme, 'linalg-dark');
// Mode is derived from the theme's declared ``mode`` once themes are loaded.
// Until then we bootstrap from localStorage (or 'dark' as the historical default).
let _currentMode = _lsGet(LS_KEYS.mode, 'dark');
// Our direction vocabulary describes the layout from the user's reading
// perspective — "Left-Right" means the root equation sits on the left and
// the graph unfolds rightward into variables. Because our semantic graphs
// point from variables → operators → root, this maps to Mermaid's
// *opposite* edge-flow token: "left-right" → "RL", "top-down" → "BT", etc.
// The mapping is applied at the API boundary (see fetchMermaidFromGraph).
const DIRECTION_TO_MERMAID = {
    'top-down':   'BT',
    'left-right': 'RL',
    'right-left': 'LR',
    'bottom-up':  'TB',
};
// One-shot migration: rewrite any pre-existing Mermaid-token values
// in localStorage (from before the semantic-name refactor) into our
// vocabulary so returning users don't land on a direction the dropdown
// can't reflect.
const LEGACY_DIRECTION_MAP = {
    TB: 'bottom-up', BT: 'top-down', LR: 'right-left', RL: 'left-right',
};
{
    const stored = _lsGet(LS_KEYS.direction, null);
    if (stored && LEGACY_DIRECTION_MAP[stored]) {
        _lsSet(LS_KEYS.direction, LEGACY_DIRECTION_MAP[stored]);
    }
}
let _currentDirection = _lsGet(LS_KEYS.direction, 'left-right');
// Label detail presets — map UI dropdown values to `show` field sets
// passed to scripts/graph_to_mermaid.py via /api/graph/mermaid.
const LABEL_PRESETS = {
    minimal:     null,                                                   // emoji + symbol (legacy emoji mode)
    // + human description. `description` (context-rich) takes priority over `label`
    // (short name) when both are on the node — see graph_to_mermaid._format_label.
    description: ['emoji', 'description', 'label'],
    full:        ['emoji', 'description', 'label', 'unit', 'role', 'quantity', 'dimension'],
};
let _currentLabels = _lsGet(LS_KEYS.labels, 'description');
if (!(_currentLabels in LABEL_PRESETS)) _currentLabels = 'description';
let _currentRenderer = _lsGet(LS_KEYS.renderer, 'd3');
if (_currentRenderer !== 'mermaid' && _currentRenderer !== 'd3') _currentRenderer = 'd3';
let _docked = _lsGet(LS_KEYS.docked, 'false') === 'true';
let _dockRatio = (() => {
    const v = Number(_lsGet(LS_KEYS.dockRatio, '0.5'));
    // Accept any finite ratio in (0,1). The drag handler enforces tighter
    // pixel-based limits (160px min 3D pane, 200px min graph pane) which
    // vary by viewport width, so the persisted value can legitimately fall
    // outside a hardcoded 0.15–0.85 band on wider/narrower screens.
    return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.5;
})();
// Authoritative list of available themes, populated from /api/graph/themes.
// Each entry: { name, mode }. Used to filter the dropdown by current mode.
let _allThemes = [];
let _activeMermaidMode = null;
// `_zoom` is in display-percent space (1.0 = 100%). The actual CSS transform
// scale applied to the SVG is `ZOOM_BASELINE * _zoom` — so "100%" corresponds
// to the comfortable default view rather than an untransformed (unreadably
// large) Mermaid SVG.
const ZOOM_BASELINE = 0.7;
const ZOOM_MIN = 0.4;   // 40%
const ZOOM_MAX = 4.0;   // 400%
const ZOOM_STEP = 0.1;  // 10% per click → 90/100/110/120%
// Clamp+sanitize a stored zoom value — localStorage strings can be anything,
// including NaN or out-of-range numbers from older builds.
function _normalizeZoom(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1.0;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}
let _zoom = _normalizeZoom(_lsGet(LS_KEYS.zoom, '1.0'));

// ---------------------------------------------------------------------
// Mermaid: lazy-load on first Graph tab activation.
//
// index.html intentionally does NOT include mermaid.min.js — the bundle
// is ~700 KB gzipped and only needed once the user opens the Math tab.
// ``loadMermaidLib()`` injects a <script> tag on first call and memoizes
// the resulting promise, so subsequent callers share the same load.
// ---------------------------------------------------------------------
const MERMAID_CDN_URL =
    'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js';

let _mermaidLoadPromise = null;

function loadMermaidLib() {
    if (_mermaidLoadPromise) return _mermaidLoadPromise;
    // If the page was already loaded with mermaid (e.g. a consumer embedded
    // a <script> tag of its own), don't re-inject.
    if (typeof window.mermaid !== 'undefined') {
        _mermaidLoadPromise = Promise.resolve(window.mermaid);
        return _mermaidLoadPromise;
    }
    _mermaidLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = MERMAID_CDN_URL;
        s.async = true;
        s.onload = () => {
            if (typeof window.mermaid === 'undefined') {
                reject(new Error('mermaid script loaded but window.mermaid is undefined'));
                return;
            }
            resolve(window.mermaid);
        };
        s.onerror = () => reject(new Error(`failed to load mermaid from ${MERMAID_CDN_URL}`));
        document.head.appendChild(s);
    });
    // On failure, clear the cached promise so a later tab activation can
    // retry (e.g. user reconnects to the network).
    _mermaidLoadPromise.catch(() => { _mermaidLoadPromise = null; });
    return _mermaidLoadPromise;
}

function initMermaidForMode(mode) {
    if (typeof window.mermaid === 'undefined') return false;
    const isDark = mode === 'dark';
    const cfg = {
        startOnLoad: false,
        theme: isDark ? 'dark' : 'base',
        // 'loose' is required for htmlLabels + the KaTeX post-pass that rewrites
        // node labels. Graphs are server-derived from trusted scenes, not user input.
        securityLevel: 'loose',
        flowchart: { htmlLabels: true, curve: 'basis' },
        themeVariables: isDark ? {
            // Dark viewport — bright arrows/text
            background: 'transparent',
            lineColor: '#a9b3dc',
            textColor: '#e8eeff',
            mainBkg: 'transparent',
            nodeBorder: '#8e9ad8',
            clusterBkg: 'transparent',
        } : {
            // Light paper card — dark arrows/text
            background: '#f7f8fb',
            lineColor: '#555',
            textColor: '#222',
            nodeBorder: '#888',
        },
    };
    window.mermaid.initialize(cfg);
    _activeMermaidMode = mode;
    return true;
}

async function ensureMermaid(mode = 'dark') {
    try {
        await loadMermaidLib();
    } catch (err) {
        console.error('[graph-view]', err);
        return false;
    }
    if (_activeMermaidMode !== mode) initMermaidForMode(mode);
    return true;
}

async function fetchMermaidFromGraph(graph, theme, direction, show) {
    // Translate our UI direction vocabulary to Mermaid's edge-flow token.
    // Unknown values pass through so explicit Mermaid tokens still work.
    const mermaidDir = DIRECTION_TO_MERMAID[direction] || direction;
    const res = await fetch('/api/graph/mermaid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, theme, direction: mermaidDir, show }),
    });
    if (!res.ok) throw new Error(`mermaid render failed: HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return {
        mermaid: data.mermaid,
        mode: data.mode || 'dark',
        edgeStyles: data.edgeStyles || {},
    };
}

/**
 * Walk every rendered node label and replace ``$...$`` spans with KaTeX
 * HTML. Mermaid's own KaTeX integration runs only on display-math
 * (``$$..$$``) and emits MathML-only, which the browser renders with
 * tight accent placement and without KaTeX's hand-tuned glyph metrics —
 * we avoid that path entirely by emitting inline ``$..$`` everywhere
 * and rendering it here with KaTeX's HTML output. Also keeps the
 * per-line layout of auto-derived graphs.
 */
function renderInlineLatexInNodes(container) {
    const katex = window.katex;
    if (!katex || !container) return;
    // Mermaid with htmlLabels:true places each label inside a foreignObject
    // holding a <span class="nodeLabel"> (or similar). We scan any element
    // whose textContent contains a ``$`` and walk its text-node descendants.
    const INLINE_MATH = /\$([^$\n]+)\$/g;
    const labels = container.querySelectorAll(
        'foreignObject span, foreignObject div, foreignObject p, .nodeLabel'
    );
    labels.forEach((host) => {
        if (!host.textContent || host.textContent.indexOf('$') === -1) return;
        // Collect all text descendants first — we mutate the tree as we go.
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach((tn) => {
            const src = tn.nodeValue;
            if (!src || src.indexOf('$') === -1) return;
            INLINE_MATH.lastIndex = 0;
            if (!INLINE_MATH.test(src)) return;
            INLINE_MATH.lastIndex = 0;
            // Build a fragment of [text, katex-span, text, ...]
            const frag = document.createDocumentFragment();
            let last = 0;
            let m;
            while ((m = INLINE_MATH.exec(src)) !== null) {
                if (m.index > last) {
                    frag.appendChild(document.createTextNode(src.slice(last, m.index)));
                }
                const span = document.createElement('span');
                try {
                    katex.render(m[1], span, { throwOnError: false, displayMode: false });
                } catch (_err) {
                    span.textContent = m[0];
                }
                frag.appendChild(span);
                last = m.index + m[0].length;
            }
            if (last < src.length) {
                frag.appendChild(document.createTextNode(src.slice(last)));
            }
            tn.parentNode.replaceChild(frag, tn);
        });
    });
}

/**
 * Center each node's label content horizontally inside its Mermaid-sized
 * ``foreignObject``.
 *
 * Why this is needed: Mermaid sizes the ``foreignObject`` + parent shape
 * from the *raw* label string (``$\hat{H}$`` measures ~64px as plain
 * text). Our post-Mermaid walker then replaces that string with KaTeX
 * HTML — which is often much narrower. Mermaid's outer ``<div>`` uses
 * ``display: table-cell`` with auto width, so the shrunken content sits
 * flush-left inside the oversized box, leaving a fat right gutter.
 *
 * We fix the visual asymmetry by wrapping the existing label div in a
 * flex-centered box that fills the foreignObject. The shape and the
 * foreignObject itself are left untouched so every Mermaid-computed
 * edge keeps terminating at the correct stroke boundary.
 */
function centerLabelsInNodes(container) {
    const svg = container && container.querySelector('svg');
    if (!svg) return;
    const NS = 'http://www.w3.org/1999/xhtml';
    svg.querySelectorAll('g.node foreignObject').forEach((fo) => {
        const outer = fo.firstElementChild;
        if (!outer || outer.nodeType !== 1) return;
        // Idempotent — a second pass (e.g. on re-render in place) would
        // otherwise nest wrappers indefinitely.
        if (outer.dataset && outer.dataset.gvCentered === 'wrapper') return;
        if (outer.parentElement !== fo) return;

        const wrapper = document.createElementNS(NS, 'div');
        wrapper.setAttribute(
            'style',
            'display:flex;justify-content:center;align-items:center;width:100%;height:100%;',
        );
        // Tag the *wrapper* so we can detect the already-processed state
        // on subsequent passes without relying on structural heuristics.
        wrapper.dataset.gvCentered = 'wrapper';
        fo.insertBefore(wrapper, outer);
        wrapper.appendChild(outer);
    });
}


function isGraphModeActive() {
    const tab = document.querySelector('.dock-tab.active');
    return tab && tab.dataset.dockTab === 'graph';
}

/* ------------------------------------------------------------------ */
/* Tab switching                                                      */
/* ------------------------------------------------------------------ */

function setupDockTabs() {
    const tabs = document.querySelectorAll('.dock-tab');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            setDockTab(btn.dataset.dockTab);
        });
    });
}

function setDockTab(name) {
    document.querySelectorAll('.dock-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.dockTab === name);
    });
    document.querySelectorAll('.dock-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `dock-tab-${name}`);
    });

    const graphVp = document.getElementById('graph-viewport');
    const mathWrap = document.getElementById('mathbox-wrapper');
    if (!graphVp || !mathWrap) return Promise.resolve();

    // Resolves when the graph (and its proof manager) has finished rendering, so
    // callers that switch *in order to* act on the graph can await it.
    let rendered = Promise.resolve();
    if (name === 'graph') {
        graphVp.classList.remove('hidden');
        if (_docked) {
            _applyDockedLayout();
        } else {
            mathWrap.style.visibility = 'hidden';
        }
        loadMermaidLib().catch(() => { /* error surfaced at render time */ });
        rebuildProofTree();
        rendered = renderCurrentStepGraph(true);
    } else {
        graphVp.classList.add('hidden');
        mathWrap.style.visibility = '';
        _removeDockedLayout();
    }
    _syncDockButton();
    // Deeplink sync: which view (Scenes vs Math) is active is shareable.
    try { window.dispatchEvent(new CustomEvent('algebench:viewchange')); } catch (_) { /* ignore */ }
    return rendered;
}

/* ------------------------------------------------------------------ */
/* Docked split view (issue #279)                                     */
/* ------------------------------------------------------------------ */

function _applyDockedLayout() {
    const viewport = document.getElementById('viewport');
    const mathWrap = document.getElementById('mathbox-wrapper');
    if (!viewport) return;
    viewport.classList.add('graph-docked');
    if (mathWrap) mathWrap.style.visibility = '';
    _applyDockRatio();
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomToFit();
        }
    }, 80);
}

function _removeDockedLayout() {
    const viewport = document.getElementById('viewport');
    if (!viewport) return;
    viewport.classList.remove('graph-docked');
    const wrapper = document.getElementById('mathbox-wrapper');
    if (wrapper) wrapper.style.width = '';
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomToFit();
        }
    }, 80);
}

function _applyDockRatio() {
    const wrapper = document.getElementById('mathbox-wrapper');
    if (!wrapper) return;
    wrapper.style.width = (_dockRatio * 100).toFixed(1) + '%';
}

function _syncDockButton() {
    const btn = document.getElementById('graph-dock-toggle');
    if (!btn) return;
    const active = _docked && isGraphModeActive();
    btn.classList.toggle('active', active);
    btn.title = active
        ? 'Undock graph to full viewport (D)'
        : 'Dock graph alongside 3D viewport (D)';
}

function toggleDockMode(forceDocked) {
    const next = typeof forceDocked === 'boolean' ? forceDocked : !_docked;
    if (next === _docked) return;
    _docked = next;
    _lsSet(LS_KEYS.docked, String(_docked));

    if (!isGraphModeActive()) {
        _syncDockButton();
        return;
    }

    const mathWrap = document.getElementById('mathbox-wrapper');
    if (_docked) {
        _applyDockedLayout();
    } else {
        _removeDockedLayout();
        if (mathWrap) mathWrap.style.visibility = 'hidden';
    }
    _syncDockButton();
}

function setupDockToggle() {
    const btn = document.getElementById('graph-dock-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => toggleDockMode());
    _syncDockButton();
}

function setupDockResize() {
    const handle = document.getElementById('graph-dock-resize-handle');
    const viewport = document.getElementById('viewport');
    if (!handle || !viewport) return;
    let dragging = false;
    let startX, startWidth, startRatio;

    handle.addEventListener('mousedown', (e) => {
        if (!viewport.classList.contains('graph-docked')) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startWidth = viewport.offsetWidth;
        startRatio = _dockRatio;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const minPx = 160;
        const raw = (startWidth * startRatio) + dx;
        const clamped = Math.max(minPx, Math.min(startWidth - 200, raw));
        _dockRatio = clamped / startWidth;
        _applyDockRatio();
        window.dispatchEvent(new Event('resize'));
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _lsSet(LS_KEYS.dockRatio, _dockRatio.toFixed(4));
    });
}

/* ------------------------------------------------------------------ */
/* Proof tree                                                         */
/* ------------------------------------------------------------------ */

function getAllProofEntries() {
    // state.proofAllSpecs is [{ level, sceneIndex?, stepIndex?, proof }]
    if (state.proofAllSpecs && state.proofAllSpecs.length) return state.proofAllSpecs;
    // Fallback for single-scene state before loadProof has run
    return [];
}

function sceneTitleForIndex(si) {
    if (state.lessonSpec && state.lessonSpec.scenes && state.lessonSpec.scenes[si]) {
        return state.lessonSpec.scenes[si].title || `Scene ${si + 1}`;
    }
    if (state.currentSpec && state.currentSpec.title) return state.currentSpec.title;
    return `Scene ${si + 1}`;
}

function groupEntriesByScene(entries) {
    // Returns [{ sceneIndex, sceneTitle, entries: [...] }]
    const bySi = new Map();
    for (const e of entries) {
        const si = (e.sceneIndex != null) ? e.sceneIndex : -1;
        if (!bySi.has(si)) bySi.set(si, []);
        bySi.get(si).push(e);
    }
    const out = [];
    for (const [si, group] of bySi) {
        out.push({
            sceneIndex: si,
            sceneTitle: si < 0 ? 'Lesson-level proofs' : sceneTitleForIndex(si),
            entries: group,
        });
    }
    return out;
}

function rebuildProofTree() {
    const root = document.getElementById('graph-proof-tree');
    if (!root) return;
    const entries = getAllProofEntries();
    if (!entries.length) {
        root.innerHTML = '<div class="gp-tree-scene-title" style="padding:12px">No proofs in this lesson.</div>';
        return;
    }
    const groups = groupEntriesByScene(entries);
    root.innerHTML = '';
    const multiScene = groups.length > 1;
    groups.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'gp-tree-scene';
        if (multiScene) {
            const ttl = document.createElement('div');
            ttl.className = 'gp-tree-scene-title';
            ttl.innerHTML = renderKaTeX(group.sceneTitle, false);
            groupEl.appendChild(ttl);
        }
        group.entries.forEach((entry) => {
            const proof = entry.proof;
            if (!proof || !proof.steps) return;
            const specIdx = state.proofSpec ? state.proofSpec.indexOf(entry) : -1;
            entry._entryId = _proofEntryId(entry, specIdx);
            const proofEl = document.createElement('div');
            proofEl.className = 'gp-tree-proof';

            const header = document.createElement('div');
            header.className = 'gp-tree-proof-header';
            const arrow = document.createElement('span');
            arrow.className = 'gp-tree-proof-arrow';
            arrow.textContent = '▶';
            const title = document.createElement('span');
            title.innerHTML = renderKaTeX(proof.title || proof.id || 'Proof', false);
            header.append(arrow, title);
            proofEl.appendChild(header);

            const stepsEl = document.createElement('div');
            stepsEl.className = 'gp-tree-steps';
            (proof.steps || []).forEach((step, sIdx) => {
                const hasGraph = !!(step && step.semanticGraph &&
                    step.semanticGraph.graph);
                const hasError = !!(step && step.semanticGraph &&
                    step.semanticGraph.error);
                let cls = 'gp-tree-step';
                if (!hasGraph) cls += ' no-graph';
                if (hasError) cls += ' has-error';
                const stepEl = document.createElement('div');
                stepEl.className = cls;
                stepEl.dataset.sceneIdx = entry.sceneIndex != null ? entry.sceneIndex : '';
                stepEl.dataset.proofId = entry._entryId;
                stepEl.dataset.stepIdx = sIdx;

                const idxEl = document.createElement('span');
                idxEl.className = 'gp-tree-step-idx';
                idxEl.textContent = String(sIdx + 1);
                const labelEl = document.createElement('span');
                labelEl.className = 'gp-tree-step-label';
                labelEl.innerHTML = renderKaTeX(step.label || step.justification || step.math || `Step ${sIdx + 1}`, false);
                stepEl.append(idxEl, labelEl);
                if (hasGraph) {
                    const dot = document.createElement('span');
                    dot.className = 'gp-tree-step-has-graph';
                    dot.title = 'Has semantic graph';
                    dot.textContent = '●';
                    stepEl.appendChild(dot);
                } else if (hasError) {
                    const warn = document.createElement('span');
                    warn.className = 'gp-tree-step-has-error';
                    warn.title = step.semanticGraph.error.message ||
                        'Graph could not be derived for this step';
                    warn.textContent = '⚠';
                    stepEl.appendChild(warn);
                }

                stepEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleTreeStepClick(entry, sIdx);
                });
                stepsEl.appendChild(stepEl);
            });

            header.addEventListener('click', () => proofEl.classList.toggle('expanded'));
            proofEl.appendChild(stepsEl);

            if (specIdx === state.proofActiveIndex) proofEl.classList.add('expanded');
            groupEl.appendChild(proofEl);
        });
        root.appendChild(groupEl);
    });
    updateTreeHighlight();
}

/** Stable identifier for a proof spec entry — uses the real proof id when
 *  present, otherwise synthesises one from the spec-array position so that
 *  every entry is matchable even when the lesson JSON omits the id field. */
function _proofEntryId(entry, specIdx) {
    return (entry.proof && entry.proof.id) || `__proof_${specIdx}`;
}

function handleTreeStepClick(entry, stepIdx) {
    const proof = entry.proof;
    const step = proof && proof.steps && proof.steps[stepIdx];
    if (!step) return;

    state._graphSyncInProgress = true;
    try {
        const sceneStep = step.sceneStep;
        if (sceneStep != null && typeof window.navigateTo === 'function') {
            if (typeof sceneStep === 'string' && sceneStep.includes(':')) {
                const [si, sti] = sceneStep.split(':').map(Number);
                if (!Number.isNaN(si) && !Number.isNaN(sti)) {
                    window.navigateTo(si, sti);
                    _forceActivateProofStep(entry, stepIdx);
                    return;
                }
            } else if (entry.sceneIndex != null) {
                window.navigateTo(entry.sceneIndex, Number(sceneStep));
                _forceActivateProofStep(entry, stepIdx);
                return;
            }
        }
        // Fallback: scene-level navigation, then activate the proof step directly
        if (entry.sceneIndex != null && typeof window.navigateTo === 'function' &&
            entry.sceneIndex !== state.currentSceneIndex) {
            window.navigateTo(entry.sceneIndex, state.currentStepIndex);
        }
        _forceActivateProofStep(entry, stepIdx);
    } finally {
        state._graphSyncInProgress = false;
        if (isGraphModeActive()) renderCurrentStepGraph();
    }
}

function _forceActivateProofStep(entry, stepIdx) {
    // Ensure the tree-clicked proof becomes the active proof, then navigate the step.
    if (!state.proofSpec) return;
    const targetIdx = state.proofSpec.findIndex((e, idx) =>
        _proofEntryId(e, idx) === entry._entryId &&
        e.sceneIndex === entry.sceneIndex);
    if (targetIdx < 0) return;
    if (targetIdx !== state.proofActiveIndex) {
        // Dispatch via DOM — the existing context tab has handlers for this.
        const header = document.querySelector(
            `.proof-section[data-proof-idx="${targetIdx}"] .proof-section-header`);
        if (header) header.click();
    }
    if (typeof window.navigateProof === 'function') {
        window.navigateProof(stepIdx);
    }
}

function updateTreeHighlight() {
    const activeEntry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
    const activeId = activeEntry ? _proofEntryId(activeEntry, state.proofActiveIndex) : null;
    const activeStep = state.proofStepIndex;
    document.querySelectorAll('#graph-proof-tree .gp-tree-step').forEach(el => {
        const match = el.dataset.proofId === activeId &&
            Number(el.dataset.stepIdx) === activeStep;
        el.classList.toggle('active', match);
        if (match) {
            const parent = el.closest('.gp-tree-proof');
            if (parent) parent.classList.add('expanded');
            try { el.scrollIntoView({ block: 'nearest' }); } catch {}
        }
    });
}

/* ------------------------------------------------------------------ */
/* Graph rendering                                                    */
/* ------------------------------------------------------------------ */

// Tear down the live graph — used both on navigation to a step that has
// no semanticGraph and on explicit "clear" actions. Empties the Mermaid
// container (so the #graph-empty-state sibling reappears via CSS),
// destroys any attached SemanticGraphPanel, and resets the cache key so
// the next real render is a full rebuild.
function clearGraph() {
    const container = document.getElementById('graph-mermaid-container');
    if (container) container.innerHTML = '';
    if (_currentGraphPanel) {
        try { _currentGraphPanel.destroy(); } catch {}
        _currentGraphPanel = null;
    }
    // NOTE: chart managers are per-step and persistent — NOT destroyed here.
    // Their charts re-attach to the card via reattach() on the next graph render
    // (only the active step's manager is shown). Torn down on new-scene load.
    // NOTE: the proof manager is intentionally NOT destroyed here. Derivation
    // boxes persist for the session, scoped to the step they were derived on;
    // setCurrentStep() on the next graph render re-attaches the active step's
    // boxes. It's torn down only when a new scene is loaded.
    if (_currentD3Renderer) {
        try { _currentD3Renderer.destroy(); } catch {}
        _currentD3Renderer = null;
        _d3LastStepKey = null;
    }
    if (_d3NodeAskBtn && _d3NodeAskBtn.parentNode) _d3NodeAskBtn.remove();
    _d3NodeAskBtn = null;
    if (_d3NodeAskHideTimer) { clearTimeout(_d3NodeAskHideTimer); _d3NodeAskHideTimer = null; }
    _d3HoveredNodeId = null;
    _d3ActiveGraph = null;
    const infoHost = document.getElementById('graph-info-panel-host');
    if (infoHost) infoHost.innerHTML = '';
    const legend = document.getElementById('graph-edge-legend');
    if (legend) {
        legend.classList.add('hidden');
        legend.innerHTML = '';
    }
    hideErrorState();
    _currentSemanticKey = null;
}

// Render the parse-failure banner (issue #137) when the current step has
// a ``semanticGraph.error`` record but no graph. The banner replaces the
// neutral empty-state copy so users see *why* a graph is missing.
function showErrorState(err) {
    const host = document.getElementById('graph-error-state');
    if (!host) return;
    const reason = err && err.reason === 'parse_crashed'
        ? 'Parser error'
        : 'Unsupported expression';
    const message = (err && err.message) ||
        'Parser could not derive a semantic graph.';
    host.innerHTML =
        '<div class="gv-err-title">' +
            '<span aria-hidden="true">&#9888;&#65039;</span>' +
            '<span>' + escapeHtml(reason) + '</span>' +
        '</div>' +
        '<div class="gv-err-message">' + escapeHtml(message) + '</div>' +
        (err && err.math
            ? '<code class="gv-err-math">' + escapeHtml(err.math) + '</code>'
            : '');
    host.classList.remove('hidden');
    const empty = document.getElementById('graph-empty-state');
    if (empty) empty.style.display = 'none';
}

function hideErrorState() {
    const host = document.getElementById('graph-error-state');
    if (host) {
        host.classList.add('hidden');
        host.innerHTML = '';
    }
    const empty = document.getElementById('graph-empty-state');
    if (empty) empty.style.display = '';
}

async function _renderWithD3(container, graph, step, key) {
    const viewport = document.getElementById('graph-viewport');
    if (viewport) {
        viewport.classList.toggle('gv-theme-light', false);
        viewport.classList.toggle('gv-theme-dark', true);
    }

    // Destroy previous Mermaid panel if it existed
    if (_currentGraphPanel) {
        try { _currentGraphPanel.destroy(); } catch {}
        _currentGraphPanel = null;
    }
    const infoHost = document.getElementById('graph-info-panel-host');
    if (infoHost) infoHost.innerHTML = '';

    _d3ActiveGraph = graph;

    // Charts belong to their step too: reuse a per-step chart manager so open
    // charts persist across navigation/re-renders (they re-attach to the fresh
    // card via reattach() below). New managers are created lazily per step.
    {
        const ckey = stableStepKey(step);
        let cm = _chartManagers.get(ckey);
        if (!cm || cm._destroyed) {
            cm = new SgChartManager(container, graph, { katex: window.katex });
            _chartManagers.set(ckey, cm);
        } else {
            cm.setGraph(graph);
        }
        _currentChartManager = cm;
    }

    // Reuse the proof manager across re-renders (e.g. background enrichment) so
    // open derivation boxes — and in-flight derivations, which take many
    // seconds — survive instead of being torn down. It is NOT destroyed by
    // clearGraph; only a new lesson tears it down (see _resetGraphSession).
    if (!_currentProofManager || _currentProofManager._destroyed) {
        _currentProofManager = new SgProofManager(container, {
            katex: window.katex,
            // A click on empty space in a proof box deselects everything — clear
            // the graph selection + info panel, then mirror the empty selection
            // back onto the terms.
            onBackgroundDeselect: () => {
                if (_currentD3Renderer && typeof _currentD3Renderer.clearSelection === 'function') {
                    _currentD3Renderer.clearSelection();
                }
                _hideD3InfoPanel();
                if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(new Set());
                try { window.dispatchEvent(new CustomEvent('algebench:selectionchange')); } catch (_) { /* ignore */ }
            },
        });
    }

    // Reuse or create D3 renderer
    if (!_currentD3Renderer || _currentD3Renderer._destroyed) {
        _currentD3Renderer = new D3SemanticGraphRenderer(container, {
            katex: window.katex,
            direction: _currentDirection,
            labels: _currentLabels,
            theme: _currentTheme,
            onNodeClick: (nodeId, nodeData, selectedIds, additive) => {
                if (!selectedIds || selectedIds.size === 0) {
                    _hideD3InfoPanel();
                } else if (selectedIds.size > 1) {
                    _showD3MultiInfoPanel(selectedIds, _d3ActiveGraph);
                } else {
                    _showD3InfoPanel(nodeId, nodeData, _d3ActiveGraph);
                }
                // Reverse sync: mirror the graph selection onto the proof terms (gold).
                // Pass additive so a PLAIN (replacing) selection also clears off-graph terms.
                if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(selectedIds, additive);
                // Deeplink sync: node selection rewrites the current URL.
                try { window.dispatchEvent(new CustomEvent('algebench:selectionchange')); } catch (_) { /* ignore */ }
            },
            onBackgroundClick: () => {
                _hideD3InfoPanel();
                // Clicking empty graph space clears the selection — un-gold the terms.
                if (_currentProofManager) _currentProofManager.syncSelectionFromGraph(new Set());
            },
            onNodeHover: (nodeId, nodeData, nodeEl) => {
                if (nodeId && nodeEl) {
                    _d3HoveredNodeId = nodeId;
                    _showD3NodeAskBtn(nodeEl);
                } else {
                    _hideD3NodeAskBtn();
                }
                // Reverse sync: light up the matching term(s) in every proof box.
                if (_currentProofManager) _currentProofManager.highlightTermsForNode(nodeId || null);
            },
            onZoomChange: (pct) => {
                const label = document.getElementById('graph-zoom-level');
                if (label) label.textContent = `${pct}%`;
            },
            onTransformChange: (t) => {
                if (_currentChartManager) _currentChartManager.setTransform(t);
                if (_currentProofManager) _currentProofManager.setTransform(t);
            },
            onChartClick: (nodeId, nodeData, btnEl) => {
                if (!_currentChartManager) return;
                // Always open — never toggle.  Only the × button closes.
                _currentChartManager.openChart(nodeId, btnEl);
            },
        });
    } else {
        await _currentD3Renderer.update({ direction: _currentDirection, labels: _currentLabels, theme: _currentTheme });
    }

    // Connect chart manager to renderer for transform polling + resize observation
    if (_currentChartManager && _currentD3Renderer) {
        _currentChartManager.setRenderer(_currentD3Renderer);
    }
    if (_currentProofManager && _currentD3Renderer) {
        _currentProofManager.setRenderer(_currentD3Renderer);
    }

    const stepKey = stableStepKey(step);
    if (_currentD3Renderer && _d3LastStepKey && _d3LastStepKey !== stepKey) {
        _d3StepStates.set(_d3LastStepKey, _currentD3Renderer.saveState());
    }

    const saved = _d3StepStates.get(stepKey);
    if (saved) {
        _currentD3Renderer.restoreState(saved);
    } else if (_d3LastStepKey !== stepKey) {
        _currentD3Renderer.resetZoom();
    }

    await _currentD3Renderer.render(graph);
    _d3LastStepKey = stepKey;
    _currentSemanticKey = key;

    // Apply a pending deeplink selection now that this step's graph exists.
    _applyPendingDeeplinkSelection(graph);

    // Re-attach this step's persisted charts to the freshly-recreated card.
    if (_currentChartManager) { try { _currentChartManager.reattach(); } catch {} }

    // Derivation boxes belong to their step: show only the current step's boxes
    // (re-attaching to the freshly-recreated card), detach the rest. This also
    // makes them survive re-renders within the same step.
    if (_currentProofManager) _currentProofManager.setCurrentStep(stepKey);

    // Charts and proof boxes share the docked overlay panel but re-attach from
    // two managers — keep their order stable (creation order) so it doesn't
    // switch after navigation.
    const dock = container.querySelector('.d3-graph-card .sgc-pinned-panel');
    if (dock && dock.children.length > 1) {
        [...dock.children]
            .sort((a, b) => (+a.dataset.dockOrder || 0) - (+b.dataset.dockOrder || 0))
            .forEach(c => dock.appendChild(c));
    }

    // Background enrichment (shared with Mermaid path)
    enrichGraphInBackground(graph, key, step);
}

function _buildD3NodeAskMessage(nodeId, graph, otherSelectedIds) {
    if (!nodeId || !graph) return 'Explain this graph node.';
    const node = (graph.nodes || []).find(n => n.id === nodeId);
    if (!node) return 'Explain this graph node.';
    const lines = ['Explain this semantic graph node:'];
    if (node.label) lines.push(`Label: ${node.label}`);
    if (node.type) lines.push(`Type: ${node.type}`);
    if (node.role) lines.push(`Role: ${node.role}`);
    if (node.quantity) lines.push(`Quantity: ${node.quantity}`);
    if (node.dimension) lines.push(`Dimension: ${node.dimension}`);
    if (node.unit) lines.push(`Unit: ${node.unit}`);
    if (node.value !== undefined) lines.push(`Value: ${node.value}`);
    if (node.op) lines.push(`Operation: ${node.op}`);
    if (node.subexpr) lines.push(`Expression: $${node.subexpr}$`);
    if (node.description) lines.push(`Description: ${node.description}`);
    const incoming = [], outgoing = [];
    for (const e of (graph.edges || [])) {
        if (e.to === nodeId && e.from !== nodeId) incoming.push(e.from);
        if (e.from === nodeId && e.to !== nodeId) outgoing.push(e.to);
    }
    if (incoming.length) lines.push(`Incoming: ${incoming.join(', ')}`);
    if (outgoing.length) lines.push(`Outgoing: ${outgoing.join(', ')}`);
    if (otherSelectedIds && otherSelectedIds.length) {
        const others = (graph.nodes || []).filter(n => otherSelectedIds.includes(n.id));
        lines.push('');
        lines.push('Also selected in the graph:');
        for (const o of others) {
            const parts = [`- ${o.label || o.id}`];
            if (o.type) parts.push(`(${o.type})`);
            if (o.description) parts.push(`— ${o.description}`);
            lines.push(parts.join(' '));
        }
        lines.push('');
        lines.push('Explain this node and how it relates to the other selected nodes.');
    }
    return lines.join('\n');
}

function _getOtherContextNodes(targetNodeId) {
    const selected = _currentD3Renderer?.selectedNodes;
    if (selected && selected.size > 1) {
        return [...selected].filter(id => id !== targetNodeId);
    }
    const active = _currentD3Renderer?.activeNode;
    if (active && active !== targetNodeId) return [active];
    return [];
}

function _ensureD3NodeAskBtn() {
    if (_d3NodeAskBtn) return _d3NodeAskBtn;
    const btn = makeAiAskButton(
        'ai-ask-btn graph-node-ai-btn',
        'Ask AI about this node',
        () => {
            const others = _getOtherContextNodes(_d3HoveredNodeId);
            return _buildD3NodeAskMessage(_d3HoveredNodeId, _d3ActiveGraph, others);
        },
    );
    btn.style.position = 'fixed';
    btn.style.margin = '0';   // .ai-ask-btn carries a 5px inline margin — kill it
                              // so the fixed-position left/top place it exactly.
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
    btn.style.zIndex = '950';
    btn.addEventListener('mouseenter', () => {
        if (_d3NodeAskHideTimer) { clearTimeout(_d3NodeAskHideTimer); _d3NodeAskHideTimer = null; }
    });
    btn.addEventListener('mouseleave', () => _hideD3NodeAskBtn());
    document.body.appendChild(btn);
    _d3NodeAskBtn = btn;
    return btn;
}

function _showD3NodeAskBtn(nodeEl) {
    const btn = _ensureD3NodeAskBtn();
    if (_d3NodeAskHideTimer) { clearTimeout(_d3NodeAskHideTimer); _d3NodeAskHideTimer = null; }
    const shape = nodeEl.querySelector('polygon, circle, rect');
    const r = (shape || nodeEl).getBoundingClientRect();
    // Measure the button's REAL rendered size — offsetWidth rounds and can disagree
    // with the laid-out box, throwing the centring off by a few px.
    const bRect = btn.getBoundingClientRect();
    const btnW = bRect.width || btn.offsetWidth || 24;
    const btnH = bRect.height || btn.offsetHeight || 24;
    const ncx = r.left + r.width / 2, ncy = r.top + r.height / 2;
    // A collapsible node carries a +/- expand chevron on its OUTFLOW edge — which
    // side that is depends on the graph direction (right for left-right, left for
    // right-left, top for bottom-up, bottom for top-down). Keep the chevron exactly
    // where it is and stack the ask button PERPENDICULAR to the flow, snug against
    // it: below it in horizontal layouts, beside it in vertical layouts. Non-
    // collapsible nodes keep the button centred on the right edge, overlapping the
    // node — so a simple rightward move from the node lands on it with no dead gap.
    const chevron = nodeEl.querySelector('.d3sg-chevron');
    if (chevron) {
        // Centre on the chevron's SQUARE (its <rect>) — not the <g>, which also
        // bounds the +/- glyph — so the button lines up exactly with it.
        const cr = (chevron.querySelector('rect') || chevron).getBoundingClientRect();
        const ccx = cr.left + cr.width / 2, ccy = cr.top + cr.height / 2;
        const gap = 3;
        if (Math.abs(ccx - ncx) >= Math.abs(ccy - ncy)) {   // horizontal flow → stack below
            btn.style.left = (ccx - btnW / 2) + 'px';
            btn.style.top = (cr.bottom + gap) + 'px';
        } else {                                             // vertical flow → stack beside
            btn.style.left = (cr.right + gap) + 'px';
            btn.style.top = (ccy - btnH / 2) + 'px';
        }
    } else {
        btn.style.left = (r.right - btnW / 2) + 'px';
        btn.style.top = (ncy - btnH / 2) + 'px';
    }
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
}

// Grace period before the node ask-button hides — long enough to move the
// cursor from the node onto the button (which cancels the timer on hover).
const _D3_NODE_ASK_HIDE_DELAY = 600;

function _hideD3NodeAskBtn() {
    if (!_d3NodeAskBtn) return;
    if (_d3NodeAskHideTimer) { clearTimeout(_d3NodeAskHideTimer); _d3NodeAskHideTimer = null; }
    const btn = _d3NodeAskBtn;
    _d3NodeAskHideTimer = setTimeout(() => {
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
    }, _D3_NODE_ASK_HIDE_DELAY);
}

/** Find a rendered node's SVG <g> element by id (d3 binds the datum to it). */
function _d3NodeElById(nodeId) {
    const layer = document.querySelector('#graph-viewport .d3sg-nodes');
    if (!layer) return null;
    for (const g of layer.querySelectorAll(':scope > g')) {
        const d = g.__data__;
        if (d && d.data && d.data.id === nodeId) return g;
    }
    return null;
}

/** The active proof in scope (graph-view proof tree), or null. */
function _activeProof() {
    const spec = state.proofSpec;
    if (!spec || !spec.length) return null;
    const entry = spec[state.proofActiveIndex] || spec[0];
    return (entry && entry.proof) || null;
}

/** Proof-context portion of a DeriveProofRequest (everything except target):
 *  domain + the active proof's title/goal/givens + lesson/scene/proof context.
 *
 *  NOTE: this path deliberately does NOT pin ``start_latex``. A graph node isn't
 *  tied to a position in the proof's step sequence, so forcing the first given
 *  as the start is arbitrary; instead we send the givens and let the backend
 *  infer the most sensible starting expression for the node's own expression.
 *  (The proof-card per-step Derive button is different — it prefers the previous
 *  step as the start; see buildProofStepDerivePayload.) Shared by the node Derive
 *  button and the agent's derive tool. */
function _proofContextPayload(graph) {
    const payload = {};
    const domain = graph && (graph.domain || (graph.meta && graph.meta.domain));
    if (domain) payload.domain = domain;

    const proof = _activeProof();
    if (proof) {
        if (proof.title) payload.title = _stripHtmlMacros(proof.title);
        if (proof.goal) payload.goal = _stripHtmlMacros(proof.goal);
        const givens = (proof.steps || [])
            .filter(s => s && s.type === 'given' && s.math)
            .map(s => ({ math: _stripHtmlMacros(s.math), label: s.label || null }))
            .filter(g => g.math);
        if (givens.length) payload.givens = givens;
    }

    // Lesson/scene/proof context — the SAME shape we send to enrichment — so the
    // expert derives with awareness of the surrounding lesson (passed through to
    // the expert's lesson_context input).
    const ctx = buildEnrichContext(
        typeof currentProofStep === 'function' ? currentProofStep() : null);
    if (ctx) payload.context = ctx;

    return payload;
}

/** Assemble the DeriveProofRequest payload for a clicked node.
 *  Target = the node's expression; the rest comes from the active proof. */
function _buildDerivePayload(nodeId, fullNode, graph) {
    const target = _stripHtmlMacros(nodeLongLabel(fullNode) || fullNode.subexpr || fullNode.label || '');
    return { ..._proofContextPayload(graph), target_latex: target };
}

// Built-in proof slug: "<domain>/<name>" — mirrors renderproof's SLUG_RE so a
// deeplink's ?pa= can't reach outside proofs/domains/.
const _PROOF_PATH_RE = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

/** Dock a PRE-BAKED proof animation (no LM derivation) — called from a deeplink's
 *  ?pa=<domain>/<name>. Fetches /proofs/domains/<path>.json, validates it with the
 *  same whitelist the standalone /renderproof page uses, and mounts it on the graph
 *  anchored to `nodeId` (the deeplink's selected node). Best-effort: a missing /
 *  malformed proof is a silent no-op so it never breaks the rest of the deeplink. */
async function dockProofAnimation(proofPath, nodeId, step) {
    if (!_currentProofManager || _currentProofManager._destroyed) return;
    if (typeof proofPath !== 'string' || proofPath.includes('..') || !_PROOF_PATH_RE.test(proofPath)) return;
    let data;
    try {
        const resp = await fetch(`/proofs/domains/${proofPath}.json`, { cache: 'no-store' });
        if (!resp.ok) return;
        data = validateProofData(JSON.parse(await resp.text()));
    } catch (e) { return; }   // missing / malformed → no-op
    const anchor = (nodeId && _d3NodeElById(nodeId)) || null;
    // Lesson context so a nested "derive this step" inside the animation still works.
    const payload = _proofContextPayload(_d3ActiveGraph);
    // Open the pre-baked proof at 2× the default cell (8×6 of the 8×8 grid) — it's
    // the thing the deeplink landed on, so give it room to read — and on the step
    // the learner was viewing (?pas=), not step 0.
    _currentProofManager.openProof(nodeId || `prebaked::${proofPath}`, anchor, payload, data,
        { colSpan: 8, rowSpan: 6, step: Number.isFinite(step) ? step : undefined });
}

/** Find a graph node whose displayed expression matches ``target`` (loose
 *  compare), so an agent-initiated derivation can anchor to it like the Derive
 *  button. Returns the node id, or null when nothing matches. */
function _findNodeIdByLatex(graph, target) {
    if (!graph || !Array.isArray(graph.nodes) || !target) return null;
    const t = _normLatex(target);
    for (const n of graph.nodes) {
        const lbl = _stripHtmlMacros(nodeLongLabel(n) || n.subexpr || n.label || '');
        if (lbl && _normLatex(lbl) === t) return n.id;
    }
    return null;
}

/** Anchor + dock an already-built derive payload into the (assumed-visible)
 *  graph proof manager. Anchors beside a matching node when one exists, else
 *  uses a synthetic id keyed on the target so re-deriving the same expression on
 *  the same step re-focuses its box instead of stacking duplicates. */
function _openDerivationBox(payload) {
    const graph = _d3ActiveGraph;
    const target = payload.target_latex;
    const matchedId = _findNodeIdByLatex(graph, target);
    const nodeId = matchedId || ('derive::' + _normLatex(target));
    const anchor = matchedId ? _d3NodeElById(matchedId) : null;
    _currentProofManager.openProof(nodeId, anchor, payload);
}

/** Dock a fully-assembled DeriveProofRequest payload into the semantic-graph
 *  canvas — switching to the Math view and rendering the current step's graph
 *  first. Used by the proof-card per-step Derive button (issue #382), which
 *  builds the payload itself (previous-step start + previous_steps). Returns
 *  false when the current step has no semantic graph to dock onto, so the caller
 *  can fall back. */
window.algebenchDeriveProofPayload = async function (payload) {
    const target = _stripHtmlMacros(((payload && payload.target_latex) || '')).trim();
    if (!target) {
        console.warn('algebenchDeriveProofPayload: target_latex is required');
        return false;
    }
    payload = { ...payload, target_latex: target };
    await window.algebenchEnsureGraphVisible();
    if (!_currentProofManager || _currentProofManager._destroyed) {
        return false;                                // no graph on this step
    }
    _openDerivationBox(payload);
    return true;
};

/** Agent entry point — initiate a proof derivation on the CURRENT step's graph,
 *  exactly as if the user clicked a node's Derive button. Fire-and-forget: the
 *  SgProofManager runs the (verified) derivation and docks it; it persists on
 *  this step across navigation. ``args`` = { target_latex, start_latex?, prompt? }. */
window.algebenchDeriveProof = async function (args) {
    const target = _stripHtmlMacros(((args && args.target_latex) || '')).trim();
    if (!target) {
        console.warn('algebenchDeriveProof: target_latex is required');
        return false;
    }
    // Make the semantic graph visible first — switching to the Math view also
    // renders the graph and wires its proof manager (awaited so the box docks on
    // the right step). No-op if the graph is already showing.
    await window.algebenchEnsureGraphVisible();
    if (!_currentProofManager) {
        console.warn('algebenchDeriveProof: no semantic graph to derive into');
        return false;
    }
    const graph = _d3ActiveGraph;
    const payload = { ..._proofContextPayload(graph), target_latex: target };
    // Agent overrides take precedence over the proof-derived defaults.
    const start = ((args && args.start_latex) || '').trim();
    if (start) payload.start_latex = start;
    const prompt = ((args && args.prompt) || '').trim();
    if (prompt) payload.intent = prompt;

    _openDerivationBox(payload);
    return true;
};

/** After an agent-driven navigation, make sure the 3D scene is actually visible.
 *  If the user is on the full-screen Math (semantic graph) view, switch back to
 *  the Scenes tab so they see the scene they were moved to. In split/docked mode
 *  the scene is already shown alongside the graph, so leave the view untouched.
 *  Returns true if it switched tabs. */
window.algebenchEnsureSceneVisible = function () {
    if (isGraphModeActive() && !_docked) {
        setDockTab('scenes');
        return true;
    }
    return false;
};

/** Counterpart for derivations: make the semantic graph visible. Only relevant
 *  for the agent-initiated path (the Derive button is already on the graph).
 *  Switches to the Math view ONLY when the current step actually has a semantic
 *  graph that's just hidden behind the active 3D viewport — never yanks the user
 *  to an empty Math view. Awaits the render so the proof manager is ready to dock
 *  onto. No-op when the graph is already visible or the step has no graph.
 *  Returns true if it switched. */
window.algebenchEnsureGraphVisible = async function () {
    const step = (typeof currentProofStep === 'function') ? currentProofStep() : null;
    const hasGraph = !!(step && step.semanticGraph && step.semanticGraph.graph);
    if (!hasGraph) return false;                     // nothing to show — don't switch

    // Derivations dock only in the D3 renderer (SgProofManager is D3-only). Force
    // D3 if the user picked Mermaid, else the proof manager is never created and
    // the derivation would silently no-op.
    let forcedD3 = false;
    if (_currentRenderer !== 'd3') {
        _currentRenderer = 'd3';
        _lsSet(LS_KEYS.renderer, 'd3');
        const sel = document.getElementById('graph-renderer-select');
        if (sel) sel.value = 'd3';
        _updateFitControls();
        forcedD3 = true;
    }

    if (!isGraphModeActive()) {
        await setDockTab('graph');                   // switch + render (D3) + wire the proof manager
        return true;
    }
    // Already on the Math tab: re-render if we just forced D3, or if the proof
    // manager isn't ready yet, so the box has something to dock onto.
    if (forcedD3 || !_currentProofManager || _currentProofManager._destroyed) {
        await renderCurrentStepGraph(true);
    }
    return forcedD3;
};

function _showD3InfoPanel(nodeId, nodeData, graph) {
    const infoHost = document.getElementById('graph-info-panel-host');
    if (!infoHost) return;
    if (!nodeId) { _hideD3InfoPanel(); return; }

    // Find the full node from graph model
    const fullNode = (graph.nodes || []).find(n => n.id === nodeId) || nodeData;
    infoHost.innerHTML = '';
    const panel = buildInlineInfoPanel(infoHost);
    if (!panel) return;

    // Inject AI ask button into panel header
    const h3 = panel.querySelector('h3');
    if (h3 && !panel.querySelector('.graph-panel-ai-btn')) {
        const header = document.createElement('div');
        header.className = 'gp-header';
        h3.replaceWith(header);
        header.appendChild(h3);
        const askBtn = makeAiAskButton(
            'ai-ask-btn graph-panel-ai-btn',
            'Ask AI about this node',
            () => {
                const others = _getOtherContextNodes(nodeId);
                return _buildD3NodeAskMessage(nodeId, graph, others);
            },
        );
        header.appendChild(askBtn);

        // Derive button — derives a proof animation for this node's expression
        // and docks it near the node (like the charts).
        const deriveBtn = makeDeriveButton(
            'ai-ask-btn graph-panel-derive-btn',
            'Derive this expression (proof animation)',
            () => {
                if (!_currentProofManager) return;
                const payload = _buildDerivePayload(nodeId, fullNode, graph);
                const anchor = _d3NodeElById(nodeId) || deriveBtn;
                _currentProofManager.openProof(nodeId, anchor, payload);
            });
        header.appendChild(deriveBtn);
    }

    // Populate the inline panel
    const symbolEl = panel.querySelector('.gp-symbol');
    const fieldsEl = panel.querySelector('.gp-fields');
    if (!symbolEl || !fieldsEl) return;

    // Details panel shows the *long label* — full applied form
    // (``\cos(θ/2)``, ``⟨0|ψ⟩``, ``|⟨0|ψ⟩|²``).  ``nodeLongLabel``
    // encapsulates the precedence (``subexpr → latex → short``).
    const latex = nodeLongLabel(fullNode);
    const isOp = fullNode.type === 'operator' || fullNode.type === 'relation' || fullNode.type === 'function';
    const showEmoji = fullNode.emoji && !isOp;
    if (latex && window.katex) {
        try {
            const span = document.createElement('span');
            window.katex.render(latex, span, { displayMode: false, throwOnError: false });
            symbolEl.innerHTML = '';
            if (showEmoji) symbolEl.appendChild(document.createTextNode(fullNode.emoji + ' '));
            symbolEl.appendChild(span);
        } catch (_) {
            symbolEl.textContent = (showEmoji ? fullNode.emoji + ' ' : '') + (fullNode.label || fullNode.id);
        }
    } else {
        symbolEl.textContent = (showEmoji ? fullNode.emoji + ' ' : '') + (fullNode.label || fullNode.id);
    }
    symbolEl.style.opacity = '1';
    symbolEl.style.fontSize = '';

    const FIELDS = [
        ['label', 'Label'], ['type', 'Type'], ['role', 'Role'],
        ['quantity', 'Quantity'], ['dimension', 'Dimension'],
        ['unit', 'Unit'], ['value', 'Value'], ['op', 'Operation'],
    ];
    fieldsEl.innerHTML = '';
    for (const [fkey, flabel] of FIELDS) {
        if (!fullNode[fkey]) continue;
        const row = document.createElement('div');
        row.className = 'gp-field';
        const k = document.createElement('span');
        k.className = 'gp-key';
        k.textContent = flabel;
        const v = document.createElement('span');
        v.className = 'gp-val';
        v.textContent = fullNode[fkey];
        row.append(k, v);
        fieldsEl.appendChild(row);
    }
    if (fullNode.description) {
        const desc = document.createElement('div');
        desc.className = 'gp-description';
        if (typeof window.renderKaTeX === 'function') {
            desc.innerHTML = window.renderKaTeX(fullNode.description, false);
        } else {
            desc.textContent = fullNode.description;
        }
        fieldsEl.appendChild(desc);
    }
}

function _hideD3InfoPanel() {
    const infoHost = document.getElementById('graph-info-panel-host');
    if (!infoHost) return;
    infoHost.innerHTML = '';
}

function _buildD3MultiNodeAskMessage(selectedIds, graph) {
    if (!selectedIds || !selectedIds.size || !graph) return 'Explain these graph nodes.';
    const nodes = (graph.nodes || []).filter(n => selectedIds.has(n.id));
    if (!nodes.length) return 'Explain these graph nodes.';
    const lines = [`Explain the relationship between these ${nodes.length} semantic graph nodes:`];
    for (const node of nodes) {
        const parts = [`- ${node.label || node.id}`];
        if (node.type) parts.push(`(${node.type})`);
        if (node.description) parts.push(`— ${node.description}`);
        lines.push(parts.join(' '));
    }
    const connected = [];
    for (const e of (graph.edges || [])) {
        if (selectedIds.has(e.from) && selectedIds.has(e.to)) {
            connected.push(`${e.from} → ${e.to}`);
        }
    }
    if (connected.length) {
        lines.push('Direct connections: ' + connected.join(', '));
    }
    return lines.join('\n');
}

function _showD3MultiInfoPanel(selectedIds, graph) {
    const infoHost = document.getElementById('graph-info-panel-host');
    if (!infoHost) return;
    if (!selectedIds || !selectedIds.size) { _hideD3InfoPanel(); return; }

    const nodes = (graph.nodes || []).filter(n => selectedIds.has(n.id));
    infoHost.innerHTML = '';
    const panel = buildInlineInfoPanel(infoHost);
    if (!panel) return;

    const h3 = panel.querySelector('h3');
    if (h3 && !panel.querySelector('.graph-panel-ai-btn')) {
        const header = document.createElement('div');
        header.className = 'gp-header';
        h3.replaceWith(header);
        header.appendChild(h3);
        const askBtn = makeAiAskButton(
            'ai-ask-btn graph-panel-ai-btn',
            'Ask AI about selected nodes',
            () => _buildD3MultiNodeAskMessage(selectedIds, graph),
        );
        header.appendChild(askBtn);
    }

    const symbolEl = panel.querySelector('.gp-symbol');
    const fieldsEl = panel.querySelector('.gp-fields');
    if (!symbolEl || !fieldsEl) return;

    symbolEl.textContent = `${nodes.length} nodes selected`;
    symbolEl.style.opacity = '0.8';
    symbolEl.style.fontSize = '0.9em';

    fieldsEl.innerHTML = '';
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (i > 0) {
            const sep = document.createElement('hr');
            sep.className = 'gp-separator';
            fieldsEl.appendChild(sep);
        }
        const symLine = document.createElement('div');
        symLine.className = 'gp-symbol';
        const latex = nodeLongLabel(node);
        if (latex && window.katex) {
            try {
                window.katex.render(latex, symLine, { displayMode: false, throwOnError: false });
            } catch (_) {
                symLine.textContent = node.label || node.id;
            }
        } else {
            symLine.textContent = node.label || node.id;
        }
        fieldsEl.appendChild(symLine);
        const FIELDS = [
            ['label', 'Label'], ['type', 'Type'], ['role', 'Role'],
            ['quantity', 'Quantity'], ['dimension', 'Dimension'],
            ['unit', 'Unit'], ['value', 'Value'], ['op', 'Operation'],
        ];
        for (const [fkey, flabel] of FIELDS) {
            if (!node[fkey]) continue;
            const row = document.createElement('div');
            row.className = 'gp-field';
            const k = document.createElement('span');
            k.className = 'gp-key';
            k.textContent = flabel;
            const v = document.createElement('span');
            v.className = 'gp-val';
            v.textContent = node[fkey];
            row.append(k, v);
            fieldsEl.appendChild(row);
        }
        if (node.description) {
            const desc = document.createElement('div');
            desc.className = 'gp-description';
            if (typeof window.renderKaTeX === 'function') {
                desc.innerHTML = window.renderKaTeX(node.description, false);
            } else {
                desc.textContent = node.description;
            }
            fieldsEl.appendChild(desc);
        }
    }
}

async function renderCurrentStepGraph(force = false) {
    const container = document.getElementById('graph-mermaid-container');
    if (!container) return;
    const step = currentProofStep();
    const sg = step && step.semanticGraph;
    const graph = sg && sg.graph;
    if (!graph) {
        // No graph for this step — wipe whatever is there so the user
        // doesn't see a stale diagram from the previous step and the
        // empty-state message can surface.
        clearGraph();
        // If the server attached a parse-failure record (issue #137),
        // surface it in place of the generic empty state.
        const err = step && step.semanticGraph && step.semanticGraph.error;
        if (err) showErrorState(err);
        return;
    }

    const key = stableStepKey(step) + '|' + _currentTheme + '|' +
                _currentDirection + '|' + _currentLabels + '|' + _currentRenderer;
    if (key === _currentSemanticKey && !force) return;

    // ── D3 renderer path ──────────────────────────────────────────────
    if (_currentRenderer === 'd3') {
        await _renderWithD3(container, graph, step, key);
        return;
    }

    // ── Mermaid renderer path (existing) ──────────────────────────────
    // Live regeneration from graph JSON so theme/direction/labels apply.
    let mermaidCode;
    let mode = 'dark';
    let edgeStyles = {};
    try {
        const showFields = LABEL_PRESETS[_currentLabels] || null;
        const res = await fetchMermaidFromGraph(
            graph, _currentTheme, _currentDirection, showFields,
        );
        mermaidCode = res.mermaid;
        mode = res.mode;
        edgeStyles = res.edgeStyles || {};
    } catch (err) {
        console.error('[graph-view] failed to build mermaid source:', err);
        container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to build graph source.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
        return;
    }

    // Apply paper backdrop + reinit Mermaid so arrow/text colors match mode.
    const viewport = document.getElementById('graph-viewport');
    if (viewport) {
        viewport.classList.toggle('gv-theme-light', mode === 'light');
        viewport.classList.toggle('gv-theme-dark', mode !== 'light');
    }
    // ensureMermaid lazy-loads mermaid.min.js on first call — this is the
    // one place the bundle actually has to be resident, so awaiting it here
    // keeps the critical path lean for users who never open this tab.
    if (!(await ensureMermaid(mode))) {
        container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to load Mermaid.<br><small>Check your network connection and reopen the Math tab.</small></div>`;
        return;
    }

    try {
        const svgId = 'gp-svg-' + Math.random().toString(36).slice(2, 8);
        const { svg } = await window.mermaid.render(svgId, mermaidCode);
        // Wrap the SVG in a ``.gv-card`` host so the card styling (background,
        // rounded corners, shadow in light theme) and the zoom transform live
        // on the same element — that way zoom scales the card *with* the SVG
        // instead of inflating only the SVG inside a fixed-size card.
        const card = document.createElement('div');
        card.className = 'gv-card';
        card.innerHTML = svg;
        container.innerHTML = '';
        container.appendChild(card);
        // Mermaid inlines a fixed max-width/height on the SVG which keeps small
        // graphs tiny. Strip those so CSS (width/height: 100%) takes over and
        // the preserveAspectRatio=xMidYMid meet default scales it to fit.
        const svgEl = card.querySelector('svg');
        if (svgEl) {
            svgEl.style.removeProperty('max-width');
            svgEl.style.removeProperty('max-height');
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            if (!svgEl.getAttribute('preserveAspectRatio')) {
                svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            }
            applyZoom();
        }
        // Mermaid's built-in KaTeX integration only fires for display math
        // (``$$..$$``) and produces MathML-only output, which the browser's
        // native math engine renders with tight accent placement (the hat
        // in ``\hat{H}`` sits right on top of the H) and no stretchy
        // decorations. It also eats the surrounding ``<br/>`` line breaks.
        // We emit inline ``$..$`` for all labels instead and render here
        // with KaTeX's HTML output so TeX-quality typography applies and
        // multi-line node labels keep their separators intact.
        renderInlineLatexInNodes(container);
        // Mermaid sizes each node's box from the *raw* label string
        // (``$\hat{H}$`` measures much wider than its rendered KaTeX).
        // The label div is ``display: table-cell`` with auto width, so
        // it sits flush-left inside the oversized box. Flex-wrap the
        // label so KaTeX content centers horizontally within the shape
        // without mutating any shape geometry (edges stay attached).
        centerLabelsInNodes(container);
    } catch (err) {
        console.error('[graph-view] mermaid render failed:', err);
        container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to render graph.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
        return;
    }

    // Preserve the active node across re-renders of the *same* step so theme
    // /direction/labels changes and async enrichment don't steal the user's
    // selection. ``_activeStepForPanel`` tracks which step the previous panel
    // was attached to; if the user moved on, we drop the selection because
    // node ids can collide across steps (e.g. ``m`` in two different graphs).
    let preservedActiveNode = null;
    if (_currentGraphPanel) {
        if (_activeStepForPanel === step) {
            preservedActiveNode = _currentGraphPanel.activeNode || null;
        }
        try { _currentGraphPanel.destroy(); } catch {}
        _currentGraphPanel = null;
    }
    const infoHost = document.getElementById('graph-info-panel-host');
    if (infoHost) infoHost.innerHTML = '';

    if (graph) {
        _currentGraphPanel = new SemanticGraphPanel(graph, {
            container,
            katex: window.katex,
            panel: buildInlineInfoPanel(infoHost),
        });
        _currentGraphPanel.attach();
        _activeStepForPanel = step;
        if (preservedActiveNode) {
            _currentGraphPanel.selectNode(preservedActiveNode);
        }
    }

    renderEdgeLegend(edgeStyles, graph);
    _currentSemanticKey = key;
    refreshEnrichmentIndicatorVisibility();

    // Background Gemini enrichment: fire-and-forget. Only triggers once per
    // graph (skips when ``__enriched`` is set). Re-renders in place when the
    // response arrives, but only if the user hasn't moved on to another step
    // in the meantime.
    enrichGraphInBackground(graph, key, step);
}

// Returns true only when EVERY node already has a non-empty description.
// We skip the Gemini call in that case (authored scene already covered);
// otherwise we enrich so missing descriptions get filled in.
function allNodesHaveDescriptions(graph) {
    const nodes = graph && graph.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) return false;
    for (const n of nodes) {
        if (!n || typeof n.description !== 'string' || !n.description.trim()) return false;
    }
    return true;
}

// How long the user must dwell on a step before we actually fire the
// enrichment fetch. Quick scrubs through a proof would otherwise queue up a
// burst of parallel requests, each producing an indicator pill, only one of
// which matches the step the user finally lands on.
const ENRICH_DWELL_MS = 400;

// Pending dwell timer keyed by graph identity. Multiple ``renderCurrentStep
// Graph`` calls during the dwell window just keep resetting the timer rather
// than queuing up extra fetches.
const _enrichDwellTimers = new WeakMap();

// Graphs with an enrichment fetch currently in flight. Prevents duplicate
// requests while still letting a future render retry if the fetch fails
// (failed graphs are removed from this set, but ``__enriched`` is only set
// on success — so the next render can try again).
const _enrichInFlight = new WeakSet();

function enrichGraphInBackground(graph, keyAtFetch, stepAtFetch) {
    if (!graph || graph.__enriched) return;
    if (_enrichInFlight.has(graph)) return;
    // Server-stamped marker: the persisted graph already went through Gemini
    // (either earlier this session or in a previous one whose result got
    // saved into the scene file). Treat it as enriched and skip the call.
    // Presence of the ``enrichment`` block is the marker; ``reasoning``
    // inside it is the agent's domain rationale (logged server-side).
    // Require a non-array plain object — arrays / null shouldn't trip the
    // gate on malformed data.
    if (graph.enrichment
        && typeof graph.enrichment === 'object'
        && !Array.isArray(graph.enrichment)) {
        try {
            Object.defineProperty(graph, '__enriched', {
                value: true, writable: true, configurable: true, enumerable: false,
            });
        } catch { graph.__enriched = true; }
        return;
    }
    if (allNodesHaveDescriptions(graph)) {
        // Every node already has a description — skip enrichment.
        try {
            Object.defineProperty(graph, '__enriched', {
                value: true, writable: true, configurable: true, enumerable: false,
            });
        } catch { graph.__enriched = true; }
        return;
    }

    // Dwell-gate: cancel any in-flight timer for this graph and start a fresh
    // one. The fetch only runs if the user stays on this step long enough.
    const prev = _enrichDwellTimers.get(graph);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
        _enrichDwellTimers.delete(graph);
        // Bail if the user has moved on — the next render's enrich call will
        // own the new step's graph.
        if (currentProofStep() !== stepAtFetch) return;
        _runEnrichmentFetch(graph, keyAtFetch, stepAtFetch);
    }, ENRICH_DWELL_MS);
    _enrichDwellTimers.set(graph, handle);
}

function _runEnrichmentFetch(graph, keyAtFetch, stepAtFetch) {
    if (graph.__enriched || _enrichInFlight.has(graph)) return;
    // Mark in-flight so concurrent renders don't fire a duplicate fetch.
    // ``__enriched`` itself is set only after a successful response — a
    // failed fetch leaves the graph unmarked so a later render can retry.
    _enrichInFlight.add(graph);

    const context = buildEnrichContext(stepAtFetch);
    // Each enrichment owns its own indicator. When several fire — say the user
    // pages through steps quickly — they stack independently and each removes
    // itself when its own fetch resolves, regardless of order.
    const indicator = showEnrichmentIndicator(stepAtFetch);
    const cleanup = () => {
        _enrichInFlight.delete(graph);
        if (indicator && indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
        }
    };
    const markEnriched = (g) => {
        try {
            Object.defineProperty(g, '__enriched', {
                value: true, writable: true, configurable: true, enumerable: false,
            });
        } catch { g.__enriched = true; }
    };
    fetch('/api/graph/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(context ? { graph, context } : { graph }),
    }).then(async (res) => {
        if (!res.ok) {
            console.warn('[graph-view] enrich failed:', res.status);
            return;
        }
        const data = await res.json();
        const enriched = data && data.enriched;
        if (!enriched || !Array.isArray(enriched.nodes)) return;

        // Persist the enriched graph onto the step regardless of current focus
        // — otherwise navigating away mid-fetch silently drops the response.
        markEnriched(enriched);
        if (stepAtFetch && stepAtFetch.semanticGraph) {
            stepAtFetch.semanticGraph.graph = enriched;
        }
        markEnriched(graph);

        if (currentProofStep() !== stepAtFetch) return;
        // Force re-render so the enriched fields propagate through Mermaid
        // and the side panel.
        _currentSemanticKey = null;
        renderCurrentStepGraph(true);
    }).catch((err) => {
        console.warn('[graph-view] enrich error:', err);
    }).finally(cleanup);
}

// Floating "thinking" pill, one per in-flight enrichment fetch. Lives in
// ``#graph-viewport`` so it shares the same coordinate system as the graph
// surface but doesn't get wiped by ``clearGraph()`` (which only touches the
// mermaid container and the info panel host).
//
// We tag each indicator with the step's stable key. If the user navigates
// to a different step, ``refreshEnrichmentIndicatorVisibility()`` hides the
// ones that don't belong to the currently visible step — they stay in the
// DOM so the same indicator reappears if the user navigates back before
// the fetch resolves.
function showEnrichmentIndicator(step) {
    const viewport = document.getElementById('graph-viewport');
    if (!viewport) return null;
    let stack = viewport.querySelector('.graph-enrich-indicator-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.className = 'graph-enrich-indicator-stack';
        viewport.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'graph-enrich-indicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.dataset.stepKey = stableStepKey(step);
    const dots = document.createElement('span');
    dots.className = 'gei-dots';
    dots.append(
        document.createElement('span'),
        document.createElement('span'),
        document.createElement('span'),
    );
    const text = document.createElement('span');
    text.className = 'gei-text';
    text.textContent = 'Enriching graph…';
    el.append(dots, text);
    stack.appendChild(el);
    positionEnrichmentStack();
    refreshEnrichmentIndicatorVisibility();
    return el;
}

// Raise the enrichment-indicator stack so it sits directly above whatever
// legends are docked in the bottom-right of the viewport (the edge-semantics
// legend and/or the chart legend, which live inside .d3-graph-card). They
// share the viewport corner, so without this the pills would overlap them.
function positionEnrichmentStack() {
    const viewport = document.getElementById('graph-viewport');
    if (!viewport) return;
    const stack = viewport.querySelector('.graph-enrich-indicator-stack');
    if (!stack) return;
    const vpRect = viewport.getBoundingClientRect();
    let reach = 0;        // px the tallest docked legend rises from the viewport bottom
    let rightGap = null;  // smallest gap from viewport right edge to a legend's right edge
    for (const sel of ['.d3sg-edge-legend', '.sgc-legend-panel']) {
        const el = viewport.querySelector(sel);
        if (!el || el.classList.contains('hidden') || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        reach = Math.max(reach, vpRect.bottom - r.top);
        const gap = vpRect.right - r.right;
        rightGap = rightGap === null ? gap : Math.min(rightGap, gap);
    }
    // Pad above the legend strip and right-align the pills with the legends'
    // right edge (falling back to the 8px corner when no legend is docked).
    const TOP_PAD = 14;
    stack.style.bottom = reach > 0 ? `${Math.round(reach) + TOP_PAD}px` : '8px';
    stack.style.right = rightGap !== null ? `${Math.round(rightGap)}px` : '8px';
}

// The chart legend (managed by SgChartManager) appears, grows and disappears
// independently of enrichment. It fires this event whenever it re-lays-out so
// we can re-stack the enrichment pills above the new legend height.
document.addEventListener('sgc:legend-change', positionEnrichmentStack);

function refreshEnrichmentIndicatorVisibility() {
    const viewport = document.getElementById('graph-viewport');
    if (!viewport) return;
    const step = currentProofStep();
    const currentKey = step ? stableStepKey(step) : null;
    const stack = viewport.querySelector('.graph-enrich-indicator-stack');
    if (!stack) return;
    stack.querySelectorAll('.graph-enrich-indicator').forEach((el) => {
        el.classList.toggle('hidden', el.dataset.stepKey !== currentKey);
    });
}

// Map from ``edge.semantic`` values to user-facing legend copy. Order here
// is also the display order in the legend so that the proportionality axis
// (direct → inverse) reads naturally before the structural ``neutral`` row.
const EDGE_SEMANTIC_LABELS = [
    ['direct',  'Proportional'],
    ['inverse', 'Inversely proportional'],
    ['neutral', 'Structural'],
];

// Default arrow glyph if the theme doesn't declare a per-semantic one.
// Matches ``edgeStyle.arrow`` default in graph_to_mermaid.
const LEGEND_DEFAULT_ARROW = '-->';

/**
 * Paint the edge-semantics legend from the theme's ``edgeStyles`` map.
 *
 * Only renders rows for semantics that (a) the theme actually styles and
 * (b) appear in the current graph — no point telling the user about
 * "inversely proportional" when nothing in the diagram is tagged that way.
 * If neither condition holds for any semantic, the legend is hidden. This
 * keeps the viewport uncluttered on themes that don't differentiate
 * edge semantics visually.
 */
function renderEdgeLegend(edgeStyles, graph) {
    const host = document.getElementById('graph-edge-legend');
    if (!host) return;
    const styled = edgeStyles && typeof edgeStyles === 'object' ? edgeStyles : {};

    // Collect the semantics actually present on graph edges so we don't
    // advertise a distinction that isn't visible in the diagram. The
    // server-side renderer mirrors this logic (see
    // ``scripts/graph_to_mermaid.semantic_graph_to_mermaid``): any edge
    // without an explicit semantic is painted as ``neutral``, edges
    // *into* a ``multiply`` operator are auto-tagged ``direct``, and
    // edges *out of* a ``power`` operator inherit ``direct``/``inverse``
    // from the literal exponent. We replicate both rules here so the
    // legend honestly advertises every color the diagram actually paints.
    const nodeById = Object.create(null);
    for (const n of (graph && graph.nodes) || []) {
        if (n && n.id) nodeById[n.id] = n;
    }
    const present = new Set();
    let hasUntagged = false;
    for (const e of (graph && graph.edges) || []) {
        if (!e) continue;
        if (e.semantic) {
            present.add(e.semantic);
            continue;
        }
        const src = nodeById[e.from];
        const dst = nodeById[e.to];
        if (src && src.op === 'power') {
            const raw = src.exponent;
            const n = parseFloat(raw);
            if (Number.isFinite(n)) {
                if (n < 0) { present.add('inverse'); continue; }
                if (Math.abs(n) > 1) { present.add('direct'); continue; }
            } else if (typeof raw === 'string' && raw.trimStart().startsWith('-')) {
                present.add('inverse');
                continue;
            }
        }
        if (dst && dst.op === 'multiply') {
            present.add('direct');
            continue;
        }
        hasUntagged = true;
    }
    if (hasUntagged) present.add('neutral');
    // If nothing at all (no edges), show every semantic the theme styles
    // so users still get to learn the vocabulary on a "legend-only"
    // graph — rare in practice but nicer than an empty panel.
    const noneTagged = present.size === 0;

    const rows = [];
    for (const [semantic, label] of EDGE_SEMANTIC_LABELS) {
        const s = styled[semantic];
        if (!s) continue;
        if (!noneTagged && !present.has(semantic)) continue;
        rows.push({ semantic, label, style: s });
    }

    if (!rows.length) {
        host.classList.add('hidden');
        host.innerHTML = '';
        return;
    }

    host.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'graph-edge-legend-title';
    title.textContent = 'Edges';
    host.appendChild(title);

    for (const row of rows) {
        const item = document.createElement('div');
        item.className = 'graph-edge-legend-item';
        item.dataset.semantic = row.semantic;

        const swatch = document.createElement('span');
        swatch.className = 'graph-edge-legend-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        // The swatch is a one-line "arrow": a left-side stem (colored) and
        // a right-side arrowhead. The theme drives stroke color and width;
        // we fall back to currentColor so the item stays visible even when
        // the theme declares only an ``arrow`` kind.
        const stroke = row.style.stroke || 'currentColor';
        const width = Number(row.style.strokeWidth || 2);
        const arrow = row.style.arrow || LEGEND_DEFAULT_ARROW;
        swatch.style.setProperty('--legend-stroke', stroke);
        swatch.style.setProperty('--legend-stroke-width', `${width}px`);
        // Map mermaid arrow kinds to a CSS dash pattern so the dotted
        // ``-.->`` reads as dotted in the legend too.
        swatch.dataset.arrow = arrow;
        swatch.textContent = '';
        item.appendChild(swatch);

        const lbl = document.createElement('span');
        lbl.className = 'graph-edge-legend-label';
        lbl.textContent = row.label;
        item.appendChild(lbl);

        host.appendChild(item);
    }
    host.classList.remove('hidden');
}

function buildInlineInfoPanel(host) {
    if (!host) return null;
    const el = document.createElement('div');
    el.className = 'graph-panel-info open'; // always "open" in inline mode
    el.innerHTML =
        '<h3>Node Details</h3>' +
        '<div class="gp-symbol" style="opacity:.55;font-size:.85rem">Click a node</div>' +
        '<div class="gp-fields"></div>' +
        '<button class="gp-close" style="display:none">&times;</button>';
    host.appendChild(el);
    return el;
}

function currentProofStep() {
    const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
    if (!entry || !entry.proof || !entry.proof.steps) return null;
    const i = state.proofStepIndex;
    if (i < 0 || i >= entry.proof.steps.length) return null;
    return entry.proof.steps[i];
}

// Build the dotted JSON path from ``state.lessonSpec`` root to the
// ``semanticGraph`` of the currently displayed proof step, or ``null`` when
// the path cannot be determined. Handles single-scene-as-root lessons (no
// ``scenes`` wrapper) and single-vs-array ``proof`` fields at every level.
function currentSemanticGraphJsonPath() {
    const lesson = state.lessonSpec;
    const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
    const stepIdx = state.proofStepIndex;
    if (!lesson || !entry || stepIdx < 0) return null;

    const singleSceneRoot = !lesson.scenes && !!lesson.elements;

    function containerToPath(container, basePath, needle) {
        if (!container) return null;
        if (Array.isArray(container)) {
            const i = container.indexOf(needle);
            return i === -1 ? null : `${basePath}[${i}]`;
        }
        return container === needle ? basePath : null;
    }

    let proofPath = null;
    if (entry.level === 'file') {
        proofPath = containerToPath(lesson.proof, 'proof', entry.proof);
    } else if (entry.level === 'scene') {
        if (singleSceneRoot) {
            proofPath = containerToPath(lesson.proof, 'proof', entry.proof);
        } else {
            const scene = lesson.scenes && lesson.scenes[entry.sceneIndex];
            proofPath = containerToPath(
                scene && scene.proof,
                `scenes[${entry.sceneIndex}].proof`,
                entry.proof,
            );
        }
    } else if (entry.level === 'step') {
        if (singleSceneRoot) {
            const step = lesson.steps && lesson.steps[entry.stepIndex];
            proofPath = containerToPath(
                step && step.proof,
                `steps[${entry.stepIndex}].proof`,
                entry.proof,
            );
        } else {
            const step = lesson.scenes &&
                lesson.scenes[entry.sceneIndex] &&
                lesson.scenes[entry.sceneIndex].steps &&
                lesson.scenes[entry.sceneIndex].steps[entry.stepIndex];
            proofPath = containerToPath(
                step && step.proof,
                `scenes[${entry.sceneIndex}].steps[${entry.stepIndex}].proof`,
                entry.proof,
            );
        }
    }

    if (!proofPath) return null;
    return `${proofPath}.steps[${stepIdx}].semanticGraph`;
}

function updateShowJsonButtonState() {
    const btn = document.getElementById('graph-show-json');
    if (!btn) return;
    const step = currentProofStep();
    const hasGraph = !!(step && step.semanticGraph && step.semanticGraph.graph);
    btn.disabled = !hasGraph;
}

function setupShowJsonButton() {
    const btn = document.getElementById('graph-show-json');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const path = currentSemanticGraphJsonPath();
        if (!path || typeof window.algebenchOpenJsonBrowserAtPath !== 'function') {
            return;
        }
        window.algebenchOpenJsonBrowserAtPath(path);
    });
    updateShowJsonButtonState();
}

function stableStepKey(step) {
    return `${state.proofActiveIndex}:${state.proofStepIndex}:${step.id || ''}`;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                       */
/* ------------------------------------------------------------------ */

function onStepChange() {
    updateTreeHighlight();
    updateShowJsonButtonState();
    if (state._graphSyncInProgress) return;
    if (isGraphModeActive()) renderCurrentStepGraph();
}

function onGraphSelectionChange(e) {
    if (state._graphSyncInProgress) return;
    if (!e.detail || !e.detail.activeNode) return;
    // The graph is rendered for the current proof step, so selection
    // doesn't require navigation. Guard is checked above to prevent
    // loops when renderCurrentStepGraph preserves a prior selection.
}

let _lastLessonSpec = null;

function onProofLoad() {
    // Charts and derivation boxes persist per-step across navigation (incl. proof
    // switches). Only a *new lesson* invalidates them — step keys collide across
    // lessons — so reset the per-step managers when the lesson actually changes.
    if (state.lessonSpec !== _lastLessonSpec) {
        _resetGraphSession();
        _lastLessonSpec = state.lessonSpec;
    }
    _d3StepStates.clear();
    _d3LastStepKey = null;
    rebuildProofTree();
    onStepChange();
}

// New lesson — tear down all per-step chart managers + derivation boxes (their
// step context no longer applies).
function _resetGraphSession() {
    for (const cm of _chartManagers.values()) { try { cm.destroy(); } catch {} }
    _chartManagers.clear();
    _currentChartManager = null;
    if (_currentProofManager) { try { _currentProofManager.destroy(); } catch {} _currentProofManager = null; }
    clearDeriveCache();   // derivation results are lesson-specific
}

// Monochrome unicode glyphs (LAST QUARTER MOON / BLACK SUN WITH RAYS).
// The ``\uFE0E`` variation selector forces text-style rendering so platforms
// don't substitute in a full-color emoji for the sun.
const MODE_ICON = { dark: '\u263E\uFE0E', light: '\u2600\uFE0E' };

// Try to find the ``targetMode`` counterpart of a theme by suffix-swap.
// E.g. ``power-direction-light`` ↔ ``power-direction-dark``. Returns null
// when the stem has no alternative in the target mode (e.g. ``linalg-dark``
// has no ``linalg-light``), so the caller can fall back to its default
// picking strategy.
function counterpartTheme(name, targetMode) {
    const otherMode = targetMode === 'dark' ? 'light' : 'dark';
    const suffix = `-${otherMode}`;
    if (!name.endsWith(suffix)) return null;
    const stem = name.slice(0, -suffix.length);
    const candidate = `${stem}-${targetMode}`;
    return _allThemes.some(t => t.name === candidate && t.mode === targetMode)
        ? candidate
        : null;
}

// Re-fill the theme dropdown with only themes matching `_currentMode`.
// If the active theme doesn't fit the new mode, fall back to the first
// available theme in that mode (or the first theme overall as last resort).
function refreshThemeDropdown() {
    const themeSel = document.getElementById('graph-theme-select');
    if (!themeSel) return;
    const matching = _allThemes.filter(t => t.mode === _currentMode);
    const pool = matching.length ? matching : _allThemes;
    if (!pool.some(t => t.name === _currentTheme)) {
        _currentTheme = pool.length ? pool[0].name : 'default';
        _lsSet(LS_KEYS.theme, _currentTheme);
    }
    themeSel.innerHTML = '';
    pool.forEach(({ name }) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = prettyThemeName(name);
        if (name === _currentTheme) opt.selected = true;
        themeSel.appendChild(opt);
    });
}

function refreshModeToggle() {
    const btn = document.getElementById('graph-mode-toggle');
    if (!btn) return;
    btn.textContent = MODE_ICON[_currentMode] || MODE_ICON.dark;
    const other = _currentMode === 'dark' ? 'light' : 'dark';
    btn.title = `Switch to ${other} theme`;
    btn.setAttribute('aria-label', `Theme mode: ${_currentMode} (click to switch)`);
}

async function setupGraphControls() {
    try {
        const res = await fetch('/api/graph/themes');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const raw = (data && data.themes) || [];
        if (!raw.length) throw new Error('empty themes list');
        // `raw` may be a list of strings (legacy) or {name, mode} objects.
        _allThemes = raw.map(item => (typeof item === 'string')
            ? { name: item, mode: 'light' }
            : { name: item.name, mode: item.mode || 'light' });
    } catch (e) {
        // No meaningful fallback: if /api/graph/themes is unreachable then
        // /api/graph/mermaid is almost certainly unreachable too, so any
        // theme we'd preload here can't be applied to an actual graph.
        // Leave _allThemes empty — the dropdown will render blank, which
        // honestly reflects the broken state.
        console.warn('[graph-view] could not load themes:', e);
        _allThemes = [];
    }
    // Align mode with the stored theme's declared mode. Stored mode only
    // matters as a fallback when the stored theme is unknown to the server.
    const active = _allThemes.find(t => t.name === _currentTheme);
    if (active) _currentMode = active.mode;
    _lsSet(LS_KEYS.mode, _currentMode);

    refreshModeToggle();
    refreshThemeDropdown();

    const modeBtn = document.getElementById('graph-mode-toggle');
    if (modeBtn) {
        modeBtn.addEventListener('click', () => {
            _currentMode = _currentMode === 'dark' ? 'light' : 'dark';
            _lsSet(LS_KEYS.mode, _currentMode);
            refreshModeToggle();
            // Prefer the stem-matching counterpart of the active theme when
            // one exists (e.g. power-direction-light → power-direction-dark),
            // otherwise leave it to refreshThemeDropdown's fallback.
            const twin = counterpartTheme(_currentTheme, _currentMode);
            if (twin) _currentTheme = twin;
            refreshThemeDropdown();
            _lsSet(LS_KEYS.theme, _currentTheme);
            renderCurrentStepGraph(true);
        });
    }

    const themeSel = document.getElementById('graph-theme-select');
    if (themeSel) {
        themeSel.addEventListener('change', () => {
            _currentTheme = themeSel.value || 'default';
            _lsSet(LS_KEYS.theme, _currentTheme);
            renderCurrentStepGraph(true);
        });
    }
    const dirSel = document.getElementById('graph-direction-select');
    if (dirSel) {
        dirSel.value = _currentDirection;
        dirSel.addEventListener('change', () => {
            _currentDirection = dirSel.value || 'left-right';
            _lsSet(LS_KEYS.direction, _currentDirection);
            renderCurrentStepGraph(true);
        });
    }
    const labelsSel = document.getElementById('graph-labels-select');
    if (labelsSel) {
        labelsSel.value = _currentLabels;
        labelsSel.addEventListener('change', () => {
            _currentLabels = labelsSel.value in LABEL_PRESETS
                ? labelsSel.value : 'description';
            _lsSet(LS_KEYS.labels, _currentLabels);
            renderCurrentStepGraph(true);
        });
    }
    const rendererSel = document.getElementById('graph-renderer-select');
    if (rendererSel) {
        rendererSel.value = _currentRenderer;
        rendererSel.addEventListener('change', () => {
            _currentRenderer = rendererSel.value === 'd3' ? 'd3' : 'mermaid';
            _lsSet(LS_KEYS.renderer, _currentRenderer);
            _updateFitControls();
            clearGraph();
            renderCurrentStepGraph(true);
        });
    }
}

function prettyThemeName(name) {
    return String(name).split(/[-_]/).map(p =>
        p.length ? p[0].toUpperCase() + p.slice(1) : p).join(' ');
}

function applyZoom() {
    if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
        // D3 renderer manages its own zoom — just sync the label
        const label = document.getElementById('graph-zoom-level');
        if (label) label.textContent = `${_currentD3Renderer.zoomLevel}%`;
        return;
    }
    // Mermaid fallback: CSS scale on the card wrapper
    const card = document.querySelector('#graph-mermaid-container .gv-card');
    const target = card || document.querySelector('#graph-mermaid-container svg');
    if (target) target.style.transform = `scale(${(ZOOM_BASELINE * _zoom).toFixed(3)})`;
    const label = document.getElementById('graph-zoom-level');
    if (label) label.textContent = `${Math.round(_zoom * 100)}%`;
}

function _updateFitControls() {
    const isD3 = _currentRenderer === 'd3';
    const fitBtn = document.getElementById('graph-zoom-fit');
    const zoomLabel = document.getElementById('graph-zoom-level');
    if (fitBtn) {
        fitBtn.disabled = !isD3;
        fitBtn.title = isD3 ? 'Zoom to fit' : 'Zoom to fit (D3 only)';
    }
    if (zoomLabel) {
        zoomLabel.style.cursor = isD3 ? 'pointer' : 'default';
        zoomLabel.title = isD3 ? 'Double-click to fit' : '';
    }
}

function setupZoomControls() {
    const inBtn = document.getElementById('graph-zoom-in');
    const outBtn = document.getElementById('graph-zoom-out');
    const fitBtn = document.getElementById('graph-zoom-fit');
    if (inBtn) inBtn.addEventListener('click', () => {
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomBy(1.2);
            return;
        }
        _zoom = Math.min(ZOOM_MAX, +(_zoom + ZOOM_STEP).toFixed(2));
        _lsSet(LS_KEYS.zoom, String(_zoom));
        applyZoom();
    });
    if (outBtn) outBtn.addEventListener('click', () => {
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomBy(1 / 1.2);
            return;
        }
        _zoom = Math.max(ZOOM_MIN, +(_zoom - ZOOM_STEP).toFixed(2));
        _lsSet(LS_KEYS.zoom, String(_zoom));
        applyZoom();
    });
    if (fitBtn) fitBtn.addEventListener('click', () => {
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomToFit();
        }
    });
    const zoomLabel = document.getElementById('graph-zoom-level');
    if (zoomLabel) zoomLabel.addEventListener('dblclick', () => {
        if (_currentD3Renderer && !_currentD3Renderer._destroyed) {
            _currentD3Renderer.zoomToFit();
        }
    });
    applyZoom();
    _updateFitControls();
}

/**
 * Watch the graph viewport + its two floating control clusters and toggle
 * ``gv-controls-stacked`` on the viewport whenever the left/right groups
 * would collide at the current width. Only ``top`` changes between the
 * two modes, so horizontal bounds stay valid either way and we can just
 * compare ``left.right`` against ``right.left`` directly.
 */
function setupControlsOverflowWatcher() {
    const viewport = document.getElementById('graph-viewport');
    const left = document.getElementById('graph-controls-left');
    const right = document.getElementById('graph-controls-right');
    if (!viewport || !left || !right) return;
    const GAP = 12;
    const update = () => {
        const l = left.getBoundingClientRect();
        const r = right.getBoundingClientRect();
        if (!l.width || !r.width) return;  // hidden / not laid out yet
        const overlap = (l.right + GAP) > r.left;
        viewport.classList.toggle('gv-controls-stacked', overlap);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    ro.observe(left);
    ro.observe(right);
    window.addEventListener('resize', update);
}

function init() {
    if (_initDone) return;
    _initDone = true;
    setupDockTabs();
    setupGraphControls();
    setupZoomControls();
    setupShowJsonButton();
    setupDockToggle();
    setupDockResize();
    setupControlsOverflowWatcher();
    window.addEventListener('algebench:stepchange', onStepChange);
    window.addEventListener('algebench:proofload', onProofLoad);
    window.addEventListener('algebench:graphselectionchange', onGraphSelectionChange);

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (isGraphModeActive()) {
                toggleDockMode();
            }
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Expose for debugging
window.graphView = {
    setDockTab,
    rebuildProofTree,
    renderCurrentStepGraph,
    toggleDockMode,
};

/**
 * Read-only snapshot of the semantic-graph dock state, for chat context
 * (issue #124). Returns null only when the graph dock is inactive AND the
 * current step has no graph. When the dock is active, returns a state
 * object even if `hasGraph` is false — so callers can tell the user is
 * looking at the (empty) Math view.
 */
function getGraphPanelState() {
    const dockActive = isGraphModeActive();
    const step = (typeof currentProofStep === 'function') ? currentProofStep() : null;
    const sg = step && step.semanticGraph;
    const graph = sg && sg.graph;

    // Skip the section entirely only when the user isn't on the graph dock
    // *and* the current step has no graph to describe — there's nothing to
    // tell the agent. If the dock is active, always emit a state object
    // (even with no graph) so the agent knows the user is *looking at the
    // graph view*, just an empty one.
    if (!graph && !dockActive) return null;

    const nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
    const edges = (graph && Array.isArray(graph.edges)) ? graph.edges : [];

    const out = {
        open: dockActive,
        docked: _docked && dockActive,
        hasGraph: !!graph,
        source: graph ? 'step-embedded' : null,
        stepNumber: (state && typeof state.proofStepIndex === 'number')
            ? state.proofStepIndex + 1 : null,
        theme: _currentTheme,
        labelMode: _currentLabels,
        direction: _currentDirection,
        zoom: (_currentD3Renderer && !_currentD3Renderer._destroyed)
            ? _currentD3Renderer.zoomLevel
            : Math.round(_zoom * 100),
        nodeCount: nodes.length,
        edgeCount: edges.length,
    };

    if (sg && sg.error) {
        out.parseError = sg.error.message || String(sg.error);
    }

    // Compact nodes / edges so the agent can reason about graph structure
    // without having to ask the user to click each node. Capped to keep
    // prompt size sane — most graphs are well under these limits.
    if (graph) {
        const NODE_CAP = 60, EDGE_CAP = 80, DESC_CAP = 120;
        out.nodes = nodes.slice(0, NODE_CAP).map(n => {
            const e = { id: n.id };
            if (n.type) e.type = n.type;
            if (n.op) e.op = n.op;
            if (n.label) e.label = n.label;
            if (n.role) e.role = n.role;
            if (n.description) {
                e.description = n.description.length > DESC_CAP
                    ? n.description.slice(0, DESC_CAP - 1) + '…'
                    : n.description;
            }
            return e;
        });
        if (nodes.length > NODE_CAP) out.nodesTruncated = nodes.length - NODE_CAP;
        out.edges = edges.slice(0, EDGE_CAP).map(e => {
            const o = { from: e.from, to: e.to };
            if (e.semantic) o.semantic = e.semantic;
            return o;
        });
        if (edges.length > EDGE_CAP) out.edgesTruncated = edges.length - EDGE_CAP;
    }

    // Selected node(s) — fed to the AI so it can reason about exactly what the
    // user has highlighted. Supports the D3 renderer's multi-select (Cmd+Click)
    // as well as the legacy single-select Mermaid panel. Ordered with the
    // active node last, matching ``getGraphSelection`` / Cmd+Click semantics.
    if (graph) {
        const ids = _selectedNodeIdsForContext();
        const payloads = ids
            .map(id => _buildGraphNodePayload(graph, id))
            .filter(Boolean);
        if (payloads.length) {
            // ``selectedNode`` = the active (last) node, kept for back-compat
            // and the header summary; ``selectedNodes`` = the full ordered set.
            out.selectedNode = payloads[payloads.length - 1];
            out.selectedNodes = payloads;
        }
    }

    return out;
}

/**
 * Ordered list of currently selected node ids (active node last), read from
 * whichever renderer is live. Empty when nothing is selected.
 */
function _selectedNodeIdsForContext() {
    // Gate on the *active* renderer (``_currentRenderer``), not merely on which
    // renderer object happens to exist — switching renderers destroys the old
    // one via clearGraph(), but keying off _currentRenderer keeps intent
    // explicit and immune to any stale instance lingering.
    if (_currentRenderer === 'd3' && _currentD3Renderer && !_currentD3Renderer._destroyed) {
        return getGraphSelection();
    }
    if (_currentGraphPanel && _currentGraphPanel.activeNode) {
        return [_currentGraphPanel.activeNode];
    }
    return [];
}

/**
 * Build a serializable payload for a node id straight from the graph JSON,
 * including immediate edge neighbors. Renderer-agnostic — both the D3 and
 * Mermaid paths share the same graph structure.
 */
function _buildGraphNodePayload(graph, nodeId) {
    if (!graph || !nodeId) return null;
    const node = (graph.nodes || []).find(n => n.id === nodeId);
    if (!node) return null;
    const incoming = [], outgoing = [];
    for (const e of (graph.edges || [])) {
        if (e.to === nodeId && e.from !== nodeId) incoming.push(e.from);
        if (e.from === nodeId && e.to !== nodeId) outgoing.push(e.to);
    }
    return {
        ...node,
        subexpr: node.subexpr || null,
        neighbors: { incoming, outgoing },
    };
}

window.algebenchGetGraphPanelState = getGraphPanelState;
