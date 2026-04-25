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

let _currentGraphPanel = null;
let _currentSemanticKey = null;
let _activeStepForPanel = null;
let _initDone = false;

// Persisted user preferences. localStorage keys are versioned with an
// `algebench.graph.` prefix so future format changes can be migrated without
// colliding with stored values from unrelated features.
const LS_KEYS = {
    theme: 'algebench.graph.theme',
    mode: 'algebench.graph.mode',
    direction: 'algebench.graph.direction',
    labels: 'algebench.graph.labels',
    zoom: 'algebench.graph.zoom',
};
const _lsGet = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const _lsSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
};

// Migrate legacy theme names — every theme now ends in ``-light`` or
// ``-dark`` so the alternative variant is easy to spot in listings. A user
// with a stored preference from before the rename would otherwise get
// bounced to a fallback by refreshThemeDropdown — this table preserves
// their choice instead.
const LEGACY_THEME_RENAME = {
    'default': 'default-light',
    'minimal-flat': 'minimal-flat-light',
    'power-direction': 'power-direction-light',
    'power-flow': 'power-flow-light',
    'role-colored': 'role-colored-light',
};
let _currentTheme = _lsGet(LS_KEYS.theme, 'linalg-dark');
if (_currentTheme in LEGACY_THEME_RENAME) {
    _currentTheme = LEGACY_THEME_RENAME[_currentTheme];
    _lsSet(LS_KEYS.theme, _currentTheme);
}
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
    const mathVp = document.getElementById('mathbox-container');
    if (!graphVp || !mathVp) return;

    if (name === 'graph') {
        graphVp.classList.remove('hidden');
        // Keep mathbox mounted — just hide it.
        mathVp.style.visibility = 'hidden';
        // Kick off the Mermaid bundle download now so it can run in parallel
        // with the /api/graph/mermaid fetch that renderCurrentStepGraph
        // triggers below. ensureMermaid() will await the same promise.
        loadMermaidLib().catch(() => { /* error surfaced at render time */ });
        rebuildProofTree();
        renderCurrentStepGraph(true);
    } else {
        graphVp.classList.add('hidden');
        mathVp.style.visibility = '';
    }
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
            ttl.textContent = group.sceneTitle;
            groupEl.appendChild(ttl);
        }
        group.entries.forEach((entry) => {
            const proof = entry.proof;
            if (!proof || !proof.steps) return;
            const proofEl = document.createElement('div');
            proofEl.className = 'gp-tree-proof';

            const header = document.createElement('div');
            header.className = 'gp-tree-proof-header';
            const arrow = document.createElement('span');
            arrow.className = 'gp-tree-proof-arrow';
            arrow.textContent = '▶';
            const title = document.createElement('span');
            title.textContent = proof.title || proof.id || 'Proof';
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
                stepEl.dataset.proofId = proof.id || '';
                stepEl.dataset.stepIdx = sIdx;

                const idxEl = document.createElement('span');
                idxEl.className = 'gp-tree-step-idx';
                idxEl.textContent = String(sIdx + 1);
                const labelEl = document.createElement('span');
                labelEl.className = 'gp-tree-step-label';
                labelEl.textContent = stripLatex(step.label || step.justification || step.math || `Step ${sIdx + 1}`);
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

            if (isActiveProofEntry(entry)) proofEl.classList.add('expanded');
            groupEl.appendChild(proofEl);
        });
        root.appendChild(groupEl);
    });
    updateTreeHighlight();
}

function isActiveProofEntry(entry) {
    const active = state.proofSpec && state.proofSpec[state.proofActiveIndex];
    if (!active || !active.proof) return false;
    return entry.proof && entry.proof.id &&
        entry.proof.id === active.proof.id &&
        entry.sceneIndex === active.sceneIndex;
}

function handleTreeStepClick(entry, stepIdx) {
    const proof = entry.proof;
    const step = proof && proof.steps && proof.steps[stepIdx];
    if (!step) return;

    const sceneStep = step.sceneStep;
    if (sceneStep != null && typeof window.navigateTo === 'function') {
        if (typeof sceneStep === 'string' && sceneStep.includes(':')) {
            const [si, sti] = sceneStep.split(':').map(Number);
            if (!Number.isNaN(si) && !Number.isNaN(sti)) {
                window.navigateTo(si, sti);
                // after navigate, ensure the right proof/step is active
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
}

function _forceActivateProofStep(entry, stepIdx) {
    // Ensure the tree-clicked proof becomes the active proof, then navigate the step.
    if (!state.proofSpec) return;
    const targetIdx = state.proofSpec.findIndex(e =>
        e.proof && e.proof.id && entry.proof && entry.proof.id === e.proof.id &&
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
    const activeId = activeEntry && activeEntry.proof && activeEntry.proof.id;
    const activeSceneIdx = activeEntry && activeEntry.sceneIndex;
    const activeStep = state.proofStepIndex;
    document.querySelectorAll('#graph-proof-tree .gp-tree-step').forEach(el => {
        const elScene = el.dataset.sceneIdx === '' ? null : Number(el.dataset.sceneIdx);
        const match = el.dataset.proofId === (activeId || '') &&
            elScene === activeSceneIdx &&
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
                _currentDirection + '|' + _currentLabels;
    if (key === _currentSemanticKey && !force) return;

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

// Build context payload for the enrichment agent — lesson/scene/proof/step
// metadata that disambiguates symbols (e.g. T = thrust vs temperature).
// Returns null when no useful context is available.
function buildEnrichContext(step) {
    const lesson = state.lessonSpec || null;
    const entry = state.proofSpec && state.proofSpec[state.proofActiveIndex];
    if (!lesson && !entry) return null;
    const scene = lesson && lesson.scenes && entry
        ? lesson.scenes[entry.sceneIndex] : null;
    const proof = entry && entry.proof || null;
    const ctx = {};
    if (lesson) {
        if (lesson.title) ctx.lessonTitle = lesson.title;
        if (lesson.description) ctx.lessonDescription = lesson.description;
    }
    if (scene) {
        if (scene.title) ctx.sceneTitle = scene.title;
        if (scene.description) ctx.sceneDescription = scene.description;
    }
    if (proof) {
        if (proof.title) ctx.proofTitle = proof.title;
        if (proof.goal) ctx.proofGoal = proof.goal;
        if (proof.technique) ctx.proofTechnique = proof.technique;
    }
    if (step) {
        if (step.label) ctx.stepLabel = step.label;
        if (step.math) ctx.stepMath = step.math;
        if (step.justification) ctx.stepJustification = step.justification;
        if (step.explanation) ctx.stepExplanation = step.explanation;
    }
    return Object.keys(ctx).length ? ctx : null;
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

        // Mark the original graph too, so if the user navigates away and back
        // we don't refetch — the response is cached server-side anyway, but
        // skipping the round trip is cheaper.
        markEnriched(graph);

        const nowStep = currentProofStep();
        if (nowStep !== stepAtFetch) return;
        if (!nowStep || !nowStep.semanticGraph) return;
        markEnriched(enriched);
        nowStep.semanticGraph.graph = enriched;
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
    refreshEnrichmentIndicatorVisibility();
    return el;
}

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
 * keeps the viewport uncluttered on the majority of themes
 * (``default-*``, ``role-colored-*``, ``minimal-flat-*``) that don't
 * differentiate edge semantics visually.
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

function stripLatex(s) {
    return String(s || '')
        .replace(/\$/g, '')
        .replace(/\\htmlClass\{[^}]*\}\{([^}]*)\}/g, '$1')
        .replace(/\\[a-zA-Z]+\*?/g, '')
        .replace(/[{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

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
    if (isGraphModeActive()) renderCurrentStepGraph();
}

function onProofLoad() {
    rebuildProofTree();
    onStepChange();
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
}

function prettyThemeName(name) {
    return String(name).split(/[-_]/).map(p =>
        p.length ? p[0].toUpperCase() + p.slice(1) : p).join(' ');
}

function applyZoom() {
    // Scale the ``.gv-card`` wrapper so the card (bg/rounded/shadow) zooms
    // together with the SVG. Fall back to the SVG itself if the wrapper is
    // not present yet (first render / legacy path).
    const card = document.querySelector('#graph-mermaid-container .gv-card');
    const target = card || document.querySelector('#graph-mermaid-container svg');
    if (target) target.style.transform = `scale(${(ZOOM_BASELINE * _zoom).toFixed(3)})`;
    const label = document.getElementById('graph-zoom-level');
    if (label) label.textContent = `${Math.round(_zoom * 100)}%`;
}

function setupZoomControls() {
    const inBtn = document.getElementById('graph-zoom-in');
    const outBtn = document.getElementById('graph-zoom-out');
    if (inBtn) inBtn.addEventListener('click', () => {
        _zoom = Math.min(ZOOM_MAX, +(_zoom + ZOOM_STEP).toFixed(2));
        _lsSet(LS_KEYS.zoom, String(_zoom));
        applyZoom();
    });
    if (outBtn) outBtn.addEventListener('click', () => {
        _zoom = Math.max(ZOOM_MIN, +(_zoom - ZOOM_STEP).toFixed(2));
        _lsSet(LS_KEYS.zoom, String(_zoom));
        applyZoom();
    });
    applyZoom();
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
    setupControlsOverflowWatcher();
    window.addEventListener('algebench:stepchange', onStepChange);
    window.addEventListener('algebench:proofload', onProofLoad);
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
};

/**
 * Read-only snapshot of the semantic-graph dock state, for chat context
 * (issue #124). Returns null when no graph is loaded for the current step.
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
        hasGraph: !!graph,
        source: graph ? 'step-embedded' : null,
        stepNumber: (state && typeof state.proofStepIndex === 'number')
            ? state.proofStepIndex + 1 : null,
        theme: _currentTheme,
        labelMode: _currentLabels,
        direction: _currentDirection,
        zoom: Math.round(_zoom * 100),
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

    if (_currentGraphPanel && _currentGraphPanel.activeNode) {
        const id = _currentGraphPanel.activeNode;
        const payload = typeof _currentGraphPanel.getNodePayload === 'function'
            ? _currentGraphPanel.getNodePayload(id) : null;
        if (payload) out.selectedNode = payload;
    }

    return out;
}

window.algebenchGetGraphPanelState = getGraphPanelState;
