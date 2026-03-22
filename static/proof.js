// ============================================================
// Proof — step-by-step mathematical proof & derivation system.
// Renders proofs inside the chat tab as a collapsible split panel.
// ============================================================

import { state } from '/state.js';
import { renderKaTeX, renderMarkdown, makeAiAskButton, openChatPanel } from '/labels.js';

// ---- Helpers ----

/** Normalize a proof field (single object or array) into an array. */
function normalizeProofs(proofField) {
    if (proofField == null) return [];
    return Array.isArray(proofField) ? proofField : [proofField];
}

/** Collect all proofs from the entire lesson spec. */
function collectAllProofs(lessonSpec) {
    const all = [];
    if (!lessonSpec) return all;

    // Root-level proofs
    for (const p of normalizeProofs(lessonSpec.proof)) {
        all.push({ level: 'file', proof: p });
    }

    // Scene & step-level proofs
    const scenes = lessonSpec.scenes || (lessonSpec.elements ? [lessonSpec] : []);
    scenes.forEach((scene, si) => {
        for (const p of normalizeProofs(scene.proof)) {
            all.push({ level: 'scene', sceneIndex: si, proof: p });
        }
        if (scene.steps) {
            scene.steps.forEach((step, sti) => {
                for (const p of normalizeProofs(step.proof)) {
                    all.push({ level: 'step', sceneIndex: si, stepIndex: sti, proof: p });
                }
            });
        }
    });
    return all;
}

/** Collect proofs relevant to the current navigation context. */
function collectContextProofs(lessonSpec, sceneIndex, stepIndex) {
    const ctx = [];
    if (!lessonSpec) return ctx;

    // Root-level
    for (const p of normalizeProofs(lessonSpec.proof)) {
        ctx.push({ level: 'file', proof: p });
    }

    // Current scene
    const scenes = lessonSpec.scenes || (lessonSpec.elements ? [lessonSpec] : []);
    const scene = scenes[sceneIndex];
    if (!scene) return ctx;

    for (const p of normalizeProofs(scene.proof)) {
        ctx.push({ level: 'scene', proof: p });
    }

    // Current step
    if (stepIndex >= 0 && scene.steps && scene.steps[stepIndex]) {
        for (const p of normalizeProofs(scene.steps[stepIndex].proof)) {
            ctx.push({ level: 'step', proof: p });
        }
    }
    return ctx;
}

// ---- Pre-rendering ----

/** Pre-render all steps for a proof, returning an array of DOM nodes. */
function preRenderProofSteps(proof) {
    if (!proof || !proof.steps) return [];
    return proof.steps.map((step, i) => {
        const div = document.createElement('div');
        div.className = 'proof-step';
        div.dataset.proofStepIndex = i;

        const type = step.type || 'step';
        const typeClass = `type-${type}`;

        let html = `<div class="proof-step-header">
            <span class="proof-step-number">${i + 1}</span>
            <span class="proof-step-type ${typeClass}">${type}</span>
            <span class="proof-step-label">${escapeHtml(step.label)}</span>
            <span class="proof-step-status"></span>
        </div>`;

        // Math (KaTeX)
        if (step.math) {
            html += `<div class="proof-step-math">${renderKaTeX('$$' + step.math + '$$', true)}</div>`;
        }

        // Justification with AI "Why?" button placeholder
        if (step.justification) {
            html += `<div class="proof-step-justification">
                <span class="proof-justification-text">${renderKaTeX(step.justification, false)}</span>
            </div>`;
        }

        // Explanation
        if (step.explanation) {
            html += `<div class="proof-step-explanation">${renderMarkdown(step.explanation)}</div>`;
        }

        // Tags
        if (step.tags && step.tags.length) {
            html += `<div class="proof-step-tags">${step.tags.map(t => `<span class="proof-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        }

        div.innerHTML = html;

        // Inject AI ask buttons
        _injectProofAskButtons(div, step, proof);

        // Click handler — navigate directly to this step
        div.addEventListener('click', () => navigateProof(i));

        return div;
    });
}

/** Inject AI ask buttons into a pre-rendered proof step. */
function _injectProofAskButtons(stepEl, step, proof) {
    // "Why?" button next to justification
    const justEl = stepEl.querySelector('.proof-step-justification');
    if (justEl) {
        const btn = makeAiAskButton('proof-ask-btn', 'Ask why this step works',
            () => `Why does this step work? Step: "${step.label}". Justification: "${step.justification}"`);
        justEl.appendChild(btn);
    }

    // "Explain" button next to math
    const mathEl = stepEl.querySelector('.proof-step-math');
    if (mathEl) {
        const btn = makeAiAskButton('proof-ask-btn', 'Explain this step',
            () => `Explain this proof step: "${step.label}"`);
        mathEl.appendChild(btn);
    }
}

/** Render the goal block for a proof. */
function renderGoalHTML(proof) {
    if (!proof || !proof.goal) return '';
    return `<div class="proof-goal">
        <div class="proof-goal-label">Goal</div>
        ${renderKaTeX(proof.goal, false)}
    </div>`;
}

/** Simple HTML escaper. */
function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Highlight activation ----

/** Activate highlights for a proof step, deactivate all others. */
function activateHighlights(stepEl, step) {
    // Remove all active highlights in the proof panel
    const panel = document.getElementById('proof-panel');
    if (panel) {
        panel.querySelectorAll('.hl-active').forEach(el => el.classList.remove('hl-active'));
    }

    if (!stepEl || !step || !step.highlights) return;

    // Clear any previous highlight annotations
    stepEl.querySelectorAll('.proof-hl-annotation').forEach(el => el.remove());

    const highlights = step.highlights;
    for (const [name, spec] of Object.entries(highlights)) {
        const els = stepEl.querySelectorAll(`.hl-${name}`);
        els.forEach(el => {
            // Apply color as CSS custom property
            if (spec.color) {
                const cssColor = _highlightColorToRGBA(spec.color);
                el.style.backgroundColor = cssColor;
            }
            // Add tooltip
            if (spec.label) {
                el.title = spec.label;
            }
            // Make clickable — toggle annotation label below the math
            if (spec.label) {
                el.style.cursor = 'pointer';
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    _toggleHighlightAnnotation(stepEl, name, spec);
                });
            }
            // Trigger animation
            el.classList.add('hl-active');
        });
    }
}

/** Toggle a highlight annotation label below the math block. */
function _toggleHighlightAnnotation(stepEl, name, spec) {
    const existing = stepEl.querySelector(`.proof-hl-annotation[data-hl="${name}"]`);
    if (existing) {
        existing.remove();
        return;
    }

    const annotation = document.createElement('div');
    annotation.className = 'proof-hl-annotation';
    annotation.dataset.hl = name;

    const color = _highlightColorToRGBA(spec.color || 'cyan');
    annotation.style.borderLeftColor = color.replace('0.15)', '0.6)');
    annotation.innerHTML = `<span class="proof-hl-annotation-dot" style="background:${color.replace('0.15)', '0.7)')}"></span>${escapeHtml(spec.label)}`;

    // Click annotation to dismiss it
    annotation.addEventListener('click', (e) => {
        e.stopPropagation();
        annotation.remove();
    });

    // Insert after the math block
    const mathEl = stepEl.querySelector('.proof-step-math');
    if (mathEl && mathEl.nextSibling) {
        mathEl.parentNode.insertBefore(annotation, mathEl.nextSibling);
    } else if (mathEl) {
        mathEl.parentNode.appendChild(annotation);
    } else {
        stepEl.appendChild(annotation);
    }
}

/** Convert a highlight color name to an rgba background string. */
function _highlightColorToRGBA(color) {
    const colors = {
        cyan:    'rgba(0, 200, 255, 0.15)',
        yellow:  'rgba(255, 220, 50, 0.15)',
        green:   'rgba(80, 220, 120, 0.15)',
        orange:  'rgba(255, 160, 50, 0.15)',
        magenta: 'rgba(220, 80, 255, 0.15)',
        red:     'rgba(255, 80, 80, 0.15)',
        blue:    'rgba(80, 120, 255, 0.15)',
        pink:    'rgba(255, 120, 180, 0.15)',
        white:   'rgba(255, 255, 255, 0.12)',
    };
    return colors[color] || colors.cyan;
}

// ---- Navigation ----

/** Navigate to a specific proof step. -1 = goal overview. */
export function navigateProof(index) {
    const proof = _activeProof();
    if (!proof) return;

    const steps = proof.steps || [];
    index = Math.max(-1, Math.min(index, steps.length - 1));
    state.proofStepIndex = index;

    // Render based on view mode
    if (state.proofViewMode === 'list') {
        _renderList();
    } else {
        _renderSlide();
    }

    // Update counter
    _updateCounter();

    // Activate highlights
    if (index >= 0 && state._proofPreRendered && state._proofPreRendered[index]) {
        activateHighlights(state._proofPreRendered[index], steps[index]);
    }

    // Bidirectional sync: proof → scene
    if (state.proofSyncEnabled && !state._proofSyncInProgress && index >= 0) {
        const step = steps[index];
        if (step && step.scene_step != null) {
            state._proofSyncInProgress = true;
            try {
                if (typeof step.scene_step === 'string' && step.scene_step.includes(':')) {
                    // Root-level proof: "sceneIdx:stepIdx"
                    const [si, sti] = step.scene_step.split(':').map(Number);
                    if (typeof window.navigateTo === 'function') window.navigateTo(si, sti);
                } else {
                    // Scene-level: just step index
                    if (typeof window.navigateTo === 'function') {
                        window.navigateTo(state.currentSceneIndex, Number(step.scene_step));
                    }
                }
            } finally {
                // Clear guard after a tick to allow the scene nav to complete
                setTimeout(() => { state._proofSyncInProgress = false; }, 50);
            }
        }
    }
}

/** Reverse sync: scene step changed, update proof to match. */
export function syncProofFromSceneStep(stepIdx) {
    if (!state.proofSyncEnabled || state._proofSyncInProgress) return;
    const proof = _activeProof();
    if (!proof || !proof.steps) return;

    const matchIdx = proof.steps.findIndex(s =>
        s.scene_step != null && Number(s.scene_step) === stepIdx
    );
    if (matchIdx >= 0 && matchIdx !== state.proofStepIndex) {
        state._proofSyncInProgress = true;
        try {
            navigateProof(matchIdx);
        } finally {
            setTimeout(() => { state._proofSyncInProgress = false; }, 50);
        }
    }
}

// ---- Render modes ----

function _renderSlide() {
    const container = _activeContainer();
    if (!container) return;

    const proof = _activeProof();
    if (!proof) return;
    const nodes = state._proofPreRendered || [];
    const idx = state.proofStepIndex;

    container.innerHTML = '';

    // Show previous steps collapsed, current step full
    nodes.forEach((node, i) => {
        const clone = node.cloneNode(true);
        // Re-attach event handlers lost during cloneNode
        clone.addEventListener('click', () => navigateProof(i));
        // Remove dead button clones (no listeners), re-inject live ones
        clone.querySelectorAll('.proof-ask-btn').forEach(b => b.remove());
        _injectProofAskButtons(clone, proof.steps[i], proof);

        if (i < idx) {
            clone.classList.add('collapsed', 'visited');
            clone.classList.remove('active', 'dimmed');
        } else if (i === idx) {
            clone.classList.add('active');
            clone.classList.remove('collapsed', 'dimmed');
        } else {
            clone.classList.add('dimmed');
            clone.classList.remove('collapsed', 'active');
            clone.style.display = 'none';
        }
        container.appendChild(clone);
    });

    // Activate highlights on the active step DOM in the container
    if (idx >= 0) {
        const activeEl = container.querySelector('.proof-step.active');
        if (activeEl) activateHighlights(activeEl, proof.steps[idx]);
    }
}

function _renderList() {
    const container = _activeContainer();
    if (!container) return;

    const proof = _activeProof();
    if (!proof) return;
    const nodes = state._proofPreRendered || [];
    const idx = state.proofStepIndex;

    container.innerHTML = '';

    nodes.forEach((node, i) => {
        const clone = node.cloneNode(true);
        clone.addEventListener('click', () => navigateProof(i));
        clone.querySelectorAll('.proof-ask-btn').forEach(b => b.remove());
        _injectProofAskButtons(clone, proof.steps[i], proof);

        clone.classList.remove('collapsed');
        if (i <= idx) {
            clone.classList.add('visited');
            clone.classList.remove('dimmed');
        }
        if (i === idx) {
            clone.classList.add('active');
        } else {
            clone.classList.remove('active');
        }
        if (i > idx) {
            clone.classList.add('dimmed');
            clone.classList.remove('visited');
        }
        container.appendChild(clone);
    });

    // Scroll active into view
    const activeEl = container.querySelector('.proof-step.active');
    if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        activateHighlights(activeEl, proof.steps[idx]);
    }
}

function _updateCounter() {
    const counter = document.getElementById('proof-counter');
    if (!counter) return;
    const proof = _activeProof();
    if (!proof || !proof.steps) { counter.textContent = ''; return; }
    const idx = state.proofStepIndex;
    if (idx < 0) {
        counter.textContent = `Goal · ${proof.steps.length} steps`;
    } else {
        counter.textContent = `Step ${idx + 1} of ${proof.steps.length}`;
    }
}

// ---- Active proof helpers ----

function _activeProof() {
    if (!state.proofSpec || state.proofSpec.length === 0) return null;
    const idx = Math.max(0, Math.min(state.proofActiveIndex, state.proofSpec.length - 1));
    return state.proofSpec[idx]?.proof || null;
}

function _activeContainer() {
    // Return the dedicated steps container inside the active proof section
    const stepsContainer = document.getElementById('proof-steps-container');
    if (stepsContainer) return stepsContainer;
    // Fallback to the context tab content
    return document.getElementById('proof-context-content');
}

// ---- Load / update proofs ----

/** Load proofs for the current context. Called on scene/step change. */
export function loadProof(lessonSpec, sceneIndex, stepIndex) {
    // Collect context proofs and all proofs
    const contextProofs = collectContextProofs(lessonSpec, sceneIndex, stepIndex);
    const allProofs = collectAllProofs(lessonSpec);

    // Check if the active proof is the same — if so, don't reset navigation state
    const prevProofId = state.proofSpec?.[state.proofActiveIndex]?.proof?.id;
    const newProofId = contextProofs[0]?.proof?.id;
    const sameProof = prevProofId && newProofId && prevProofId === newProofId;

    state.proofSpec = contextProofs;
    state.proofAllSpecs = allProofs;
    if (!sameProof) {
        state.proofActiveIndex = 0;
        state.proofStepIndex = -1;
    }

    // Show/hide the proof toggle button
    const toggleBtn = document.getElementById('proof-toggle-btn');
    if (toggleBtn) {
        toggleBtn.style.display = contextProofs.length > 0 ? '' : 'none';
    }

    // Pre-render steps for the active proof
    const proof = _activeProof();
    state._proofPreRendered = proof ? preRenderProofSteps(proof) : [];

    // Render context tab
    _renderContextTab(contextProofs);

    // Render all tab
    _renderAllTab(allProofs);

    // Update counter
    _updateCounter();

    // Apply current view mode to render steps into the container
    if (_activeProof()) {
        navigateProof(state.proofStepIndex);
    }

    // If expanded and no proofs, collapse
    if (contextProofs.length === 0 && state.proofExpanded) {
        _toggleProofPanel(false);
    }

    // Auto-expand if proofs exist and user had it expanded
    const savedExpanded = localStorage.getItem('algebench-proof-expanded');
    if (contextProofs.length > 0 && savedExpanded === 'true' && !state.proofExpanded) {
        _toggleProofPanel(true);
    }
}

/** Render the "In Context" tab with sections by level. */
function _renderContextTab(contextProofs) {
    const container = document.getElementById('proof-context-content');
    if (!container) return;
    container.innerHTML = '';

    if (contextProofs.length === 0) {
        container.innerHTML = '<p style="color: rgba(150,150,200,0.5); font-style: italic; font-size: 0.8em; padding: 8px;">No proofs in current context.</p>';
        return;
    }

    // Group by level
    const groups = { file: [], scene: [], step: [] };
    contextProofs.forEach((entry, i) => {
        groups[entry.level].push({ ...entry, globalIndex: i });
    });

    const levelLabels = { file: 'Lesson', scene: 'Scene', step: 'Step' };

    for (const [level, entries] of Object.entries(groups)) {
        if (entries.length === 0) continue;

        entries.forEach(entry => {
            const section = document.createElement('div');
            section.className = 'proof-section';

            const proof = entry.proof;
            const title = proof.title || proof.goal || 'Untitled proof';

            section.innerHTML = `<div class="proof-section-header" data-proof-index="${entry.globalIndex}">
                <span class="proof-section-arrow">&#9660;</span>
                <span>${levelLabels[level]}: ${escapeHtml(title)}</span>
            </div>`;

            const body = document.createElement('div');
            body.className = 'proof-section-body';

            // Goal
            body.innerHTML = renderGoalHTML(proof);

            // If this is the active proof, add a container for step rendering
            if (entry.globalIndex === state.proofActiveIndex) {
                const stepsContainer = document.createElement('div');
                stepsContainer.id = 'proof-steps-container';
                body.appendChild(stepsContainer);
            }

            section.appendChild(body);

            // Toggle collapse on header click
            const header = section.querySelector('.proof-section-header');
            header.addEventListener('click', () => {
                section.classList.toggle('collapsed');
                // Switch active proof
                const newIdx = entry.globalIndex;
                if (newIdx !== state.proofActiveIndex) {
                    state.proofActiveIndex = newIdx;
                    state.proofStepIndex = -1;
                    const newProof = _activeProof();
                    state._proofPreRendered = newProof ? preRenderProofSteps(newProof) : [];
                    _renderContextTab(state.proofSpec);
                    _updateCounter();
                }
            });

            container.appendChild(section);
        });
    }
}

/** Render the "All" tab with all proofs in the lesson. */
function _renderAllTab(allProofs) {
    const container = document.getElementById('proof-all-content');
    if (!container) return;
    container.innerHTML = '';

    if (allProofs.length === 0) {
        container.innerHTML = '<p style="color: rgba(150,150,200,0.5); font-style: italic; font-size: 0.8em; padding: 8px;">No proofs in this lesson.</p>';
        return;
    }

    const levelLabels = { file: 'Lesson', scene: 'Scene', step: 'Step' };

    allProofs.forEach((entry, i) => {
        const proof = entry.proof;
        const title = proof.title || proof.goal || 'Untitled proof';
        const level = levelLabels[entry.level] || entry.level;

        const section = document.createElement('div');
        section.className = 'proof-section collapsed';
        section.innerHTML = `<div class="proof-section-header">
            <span class="proof-section-arrow">&#9660;</span>
            <span>${level}: ${escapeHtml(title)}</span>
        </div>`;

        const body = document.createElement('div');
        body.className = 'proof-section-body';
        body.innerHTML = renderGoalHTML(proof);

        // Steps as labels only (lightweight for browse)
        if (proof.steps) {
            proof.steps.forEach((step, si) => {
                const stepDiv = document.createElement('div');
                stepDiv.className = 'proof-step';
                stepDiv.style.cursor = 'default';
                const type = step.type || 'step';
                stepDiv.innerHTML = `<div class="proof-step-header">
                    <span class="proof-step-number">${si + 1}</span>
                    <span class="proof-step-type type-${type}">${type}</span>
                    <span class="proof-step-label">${escapeHtml(step.label)}</span>
                </div>`;
                if (step.math) {
                    stepDiv.innerHTML += `<div class="proof-step-math">${renderKaTeX('$$' + step.math + '$$', true)}</div>`;
                }
                body.appendChild(stepDiv);
            });
        }

        section.appendChild(body);

        const header = section.querySelector('.proof-section-header');
        header.addEventListener('click', () => section.classList.toggle('collapsed'));

        container.appendChild(section);
    });
}

// ---- Panel toggle ----

function _toggleProofPanel(show) {
    const panel = document.getElementById('proof-panel');
    const handle = document.getElementById('proof-resize-handle');
    const btn = document.getElementById('proof-toggle-btn');
    if (!panel) return;

    state.proofExpanded = show;
    if (show) {
        panel.classList.remove('hidden');
        if (handle) handle.classList.remove('hidden');
        if (btn) btn.classList.add('active');

        // Restore saved height
        const savedHeight = localStorage.getItem('algebench-proof-split');
        if (savedHeight) {
            const h = parseInt(savedHeight);
            if (h >= 100 && h <= 600) panel.style.height = h + 'px';
        } else {
            panel.style.height = '250px';
        }
    } else {
        panel.classList.add('hidden');
        if (handle) handle.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    }

    localStorage.setItem('algebench-proof-expanded', show ? 'true' : 'false');
}

// ---- Resize handle ----

function _setupProofResize() {
    const handle = document.getElementById('proof-resize-handle');
    const panel = document.getElementById('proof-panel');
    if (!handle || !panel) return;

    let startY, startHeight;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startHeight = panel.offsetHeight;

        const onMove = (e2) => {
            const delta = e2.clientY - startY;
            const newH = Math.max(100, Math.min(600, startHeight + delta));
            panel.style.height = newH + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            localStorage.setItem('algebench-proof-split', panel.offsetHeight.toString());
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ---- Proof tab switching (In Context / All) ----

function _setupProofTabs() {
    document.querySelectorAll('.proof-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.proof-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.querySelectorAll('.proof-tab-content').forEach(el => {
                el.classList.toggle('active', el.id === 'proof-tab-' + tab.dataset.proofTab);
            });
        });
    });
}

// ---- Setup (called once on DOMContentLoaded) ----

export function setupProofPanel() {
    // Toggle button
    const toggleBtn = document.getElementById('proof-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            _toggleProofPanel(!state.proofExpanded);
        });
    }

    // Nav buttons
    const prevBtn = document.getElementById('proof-prev');
    const nextBtn = document.getElementById('proof-next');
    if (prevBtn) prevBtn.addEventListener('click', () => navigateProof(state.proofStepIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateProof(state.proofStepIndex + 1));

    // Mode toggle (slide / list)
    const modeBtn = document.getElementById('proof-mode-toggle');
    if (modeBtn) {
        modeBtn.addEventListener('click', () => {
            state.proofViewMode = state.proofViewMode === 'slide' ? 'list' : 'slide';
            modeBtn.textContent = state.proofViewMode === 'slide' ? 'Slide' : 'List';
            // Re-render current view
            navigateProof(state.proofStepIndex);
        });
    }

    // Sync toggle
    const syncBtn = document.getElementById('proof-sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            state.proofSyncEnabled = !state.proofSyncEnabled;
            syncBtn.classList.toggle('active', state.proofSyncEnabled);
        });
    }

    // Speak button
    const speakBtn = document.getElementById('proof-speak-btn');
    if (speakBtn) {
        speakBtn.addEventListener('click', () => {
            const proof = _activeProof();
            if (!proof) return;
            const idx = state.proofStepIndex;
            let text = '';
            if (idx < 0) {
                text = `Proof goal: ${proof.goal || ''}`;
            } else {
                const step = proof.steps[idx];
                text = `Step ${idx + 1}: ${step.label || ''}. ${step.explanation || ''}`;
                if (step.justification) text += ` Justification: ${step.justification}.`;
            }
            if (typeof window.algebenchSpeakText === 'function') {
                window.algebenchSpeakText(text);
            }
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!state.proofExpanded || !_activeProof()) return;
        // Don't capture if user is typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateProof(state.proofStepIndex - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateProof(state.proofStepIndex + 1);
        }
    });

    // Proof tab switching
    _setupProofTabs();

    // Resize handle
    _setupProofResize();
}

// ---- Public API for agent context ----

/** Get proof context for the chat system prompt. */
export function getProofContext() {
    const proof = _activeProof();
    if (!proof) return null;

    const ctx = {
        title: proof.title || null,
        goal: proof.goal || null,
        stepCount: proof.steps ? proof.steps.length : 0,
        currentStepIndex: state.proofStepIndex,
        proofPrompt: proof.prompt || null,
    };

    if (state.proofStepIndex >= 0 && proof.steps && proof.steps[state.proofStepIndex]) {
        const step = proof.steps[state.proofStepIndex];
        ctx.currentStep = {
            id: step.id,
            label: step.label,
            math: step.math ? step.math.replace(/\\htmlClass\{[^}]+\}\{/g, '').replace(/\}$/g, '') : null,
            justification: step.justification || null,
            explanation: step.explanation || null,
            stepPrompt: step.prompt || null,
        };
    }

    return ctx;
}
