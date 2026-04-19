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

let _mermaidInitialized = false;
let _currentGraphPanel = null;
let _currentSemanticKey = null;
let _initDone = false;

function ensureMermaid() {
    if (_mermaidInitialized) return true;
    if (typeof window.mermaid === 'undefined') return false;
    window.mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
        flowchart: { htmlLabels: true, curve: 'basis' },
        themeVariables: {
            background: '#0b0d1d',
            primaryColor: '#1f2446',
            primaryBorderColor: '#6c7aca',
            primaryTextColor: '#e8eeff',
            lineColor: '#8e9ad8',
        },
    });
    _mermaidInitialized = true;
    return true;
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
                    (step.semanticGraph.mermaid || step.semanticGraph.graph));
                const stepEl = document.createElement('div');
                stepEl.className = 'gp-tree-step' + (hasGraph ? '' : ' no-graph');
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

async function renderCurrentStepGraph(force = false) {
    if (!ensureMermaid()) return;
    const container = document.getElementById('graph-mermaid-container');
    if (!container) return;
    const step = currentProofStep();
    if (!step || !step.semanticGraph) return; // leave intact per spec
    const sg = step.semanticGraph;
    const mermaidCode = sg.mermaid;
    const graph = sg.graph;
    if (!mermaidCode) return;

    const key = stableStepKey(step);
    if (key === _currentSemanticKey && !force) return;

    try {
        const svgId = 'gp-svg-' + Math.random().toString(36).slice(2, 8);
        const { svg } = await window.mermaid.render(svgId, mermaidCode);
        container.innerHTML = svg;
    } catch (err) {
        console.error('[graph-view] mermaid render failed:', err);
        container.innerHTML = `<div style="color:#f88; padding:2rem;">Failed to render graph.<br><small>${escapeHtml(err.message || String(err))}</small></div>`;
        return;
    }

    if (_currentGraphPanel) {
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
    }
    _currentSemanticKey = key;
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
    if (isGraphModeActive()) renderCurrentStepGraph();
}

function onProofLoad() {
    rebuildProofTree();
    onStepChange();
}

function init() {
    if (_initDone) return;
    _initDone = true;
    setupDockTabs();
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
