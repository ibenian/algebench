// ============================================================
// Proof — step-by-step mathematical proof & derivation system.
// Renders proofs inside the chat tab as a collapsible split panel.
// ============================================================

import { state } from '/state.js';
import { renderKaTeX, renderMarkdown, makeAiAskButton, openChatPanel } from '/labels.js';

// ---- Technique metadata ----

const proofTechniques = {
    // Core logical strategies
    direct: 'Direct Proof',
    contradiction: 'Proof by Contradiction',
    contrapositive: 'Proof by Contrapositive',
    cases: 'Proof by Cases',

    // Inductive / structural
    induction: 'Mathematical Induction',
    strongInduction: 'Strong Induction',
    wellOrdering: 'Well-Ordering Principle',

    // Constructive vs non-constructive
    construction: 'Proof by Construction',
    nonConstructive: 'Non-constructive Proof',
    counterexample: 'Counterexample (Disproof)',

    // Exhaustive / brute-force
    exhaustion: 'Proof by Exhaustion',

    // Logical relationships
    equivalence: 'Proof by Equivalence (↔)',

    // Advanced / specialized
    invariant: 'Proof by Invariant',
    probabilistic: 'Probabilistic Method',

    // Structural proof patterns
    existence: 'Existence Proof',
    uniqueness: 'Uniqueness Proof',
};

/** Sanitize a string for use as a CSS class name token. */
function sanitizeClassName(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Return an HTML badge string for a proof technique, or '' if none. */
function techniqueBadgeHTML(proof) {
    const t = proof && proof.technique;
    if (typeof t !== 'string' || !t || t === 'derivation') return '';
    const safeClass = sanitizeClassName(t);
    const label = proofTechniques[t] || escapeHtml(t.charAt(0).toUpperCase() + t.slice(1));
    const hint = proof.techniqueHint;
    const titleAttr = hint ? ` title="${escapeHtml(hint)}"` : '';
    return `<span class="proof-technique-badge technique-${safeClass}"${titleAttr}>${label}</span>`;
}

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

/** Check if a proof entry is visible in the current context. */
function _isProofInContext(entry, sceneIndex, stepIndex) {
    if (entry.level === 'file') return true;
    if (entry.level === 'scene') return entry.sceneIndex === sceneIndex;
    if (entry.level === 'step') return entry.sceneIndex === sceneIndex && entry.stepIndex <= stepIndex;
    return false;
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

        let contentHtml = `<div class="proof-step-header">
            <span class="proof-step-number">${i + 1}</span>
            <span class="proof-step-type ${typeClass}">${type}</span>
            <span class="proof-step-label">${renderKaTeX(step.label, false)}</span>
            <span class="proof-step-status"></span>
        </div>`;

        // Math (KaTeX) — wrapped in a row with AI action button on the right
        if (step.math) {
            contentHtml += `<div class="proof-step-math-row">
                <div class="proof-step-math">${renderKaTeX('$$' + step.math + '$$', true)}</div>
                <div class="proof-step-actions"></div>
            </div>`;
        }

        // Justification
        if (step.justification) {
            contentHtml += `<div class="proof-step-justification">
                <span class="proof-justification-text">${renderKaTeX(step.justification, false)}</span>
            </div>`;
        }

        // Explanation
        if (step.explanation) {
            contentHtml += `<div class="proof-step-explanation">${renderMarkdown(step.explanation)}</div>`;
        }

        // Tags
        if (step.tags && step.tags.length) {
            contentHtml += `<div class="proof-step-tags">${step.tags.map(t => `<span class="proof-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
        }

        div.innerHTML = contentHtml;

        // Inject AI ask buttons into the actions strip next to math
        _injectProofAskButtons(div, step, proof);


        // Click handler — navigate directly to this step
        div.addEventListener('click', () => navigateProof(i));

        return div;
    });
}

/** Inject AI ask button into the actions strip of a proof step. */
function _injectProofAskButtons(stepEl, step, proof) {
    const actionsEl = stepEl.querySelector('.proof-step-actions');
    if (!actionsEl) return;

    // Single "Explain" button for the step
    const btn = makeAiAskButton('proof-ask-btn', 'Explain this step',
        () => {
            let msg = `Explain this proof step: "${step.label}"`;
            if (step.justification) msg += `. Justification: "${step.justification}"`;
            return msg;
        });
    actionsEl.appendChild(btn);
}


/** Render the goal block for a proof. */
function renderGoalHTML(proof) {
    if (!proof || !proof.goal) return '';
    return `<div class="proof-goal">
        <div class="proof-goal-label">Goal</div>
        <div class="proof-goal-row">
            <div class="proof-goal-math">${renderKaTeX(proof.goal, false)}</div>
            <div class="proof-goal-actions"></div>
        </div>
    </div>`;
}

/** Inject AI ask button into the goal block. */
function _injectGoalAskButton(container, proof) {
    if (!proof || !proof.goal) return;
    const actionsEl = container.querySelector('.proof-goal-actions');
    if (!actionsEl) return;
    const btn = makeAiAskButton('proof-ask-btn', 'Explain this proof goal',
        () => `Explain the goal of this proof: "${proof.title || ''}". Goal: ${proof.goal}`);
    actionsEl.appendChild(btn);
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
            const colorName = spec.color || 'cyan';
            const [r, g, b] = _highlightColorRGB(colorName);
            el.style.backgroundColor = _hlRGBA(colorName, 0.22);
            el.style.setProperty('--hl-r', r);
            el.style.setProperty('--hl-g', g);
            el.style.setProperty('--hl-b', b);
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

    const colorName = spec.color || 'cyan';
    annotation.style.borderLeftColor = _hlRGBA(colorName, 0.6);
    annotation.style.color = _hlRGBA(colorName, 0.9);
    const labelHtml = renderKaTeX(spec.label);
    annotation.innerHTML = `<span class="proof-hl-annotation-dot" style="background:${_hlRGBA(colorName, 0.7)}"></span>${labelHtml}`;

    // Click annotation to dismiss it
    annotation.addEventListener('click', (e) => {
        e.stopPropagation();
        annotation.remove();
    });

    // Insert after the math row (so it appears below math + AI button)
    const mathRow = stepEl.querySelector('.proof-step-math-row');
    if (mathRow && mathRow.nextSibling) {
        mathRow.parentNode.insertBefore(annotation, mathRow.nextSibling);
    } else if (mathRow) {
        mathRow.parentNode.appendChild(annotation);
    } else {
        stepEl.appendChild(annotation);
    }
}

/** Convert a highlight color name to RGB components (r, g, b). */
function _highlightColorRGB(color) {
    const colors = {
        cyan:    [0, 200, 255],
        yellow:  [255, 220, 50],
        green:   [80, 220, 120],
        orange:  [255, 160, 50],
        magenta: [220, 80, 255],
        red:     [255, 80, 80],
        blue:    [80, 120, 255],
        pink:    [255, 120, 180],
        white:   [255, 255, 255],
        gray:    [160, 170, 185],
        gold:    [255, 200, 50],
    };
    return colors[color] || colors.cyan;
}

/** Build rgba string from color name at a given opacity. */
function _hlRGBA(color, opacity) {
    const [r, g, b] = _highlightColorRGB(color);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ---- Navigation ----

/** Navigate to a specific proof step. -1 = goal overview. */
export function navigateProof(index) {
    const proof = _activeProof();
    if (!proof) return;

    const steps = proof.steps || [];
    index = Math.max(-1, Math.min(index, steps.length - 1));
    state.proofStepIndex = index;

    // Ensure proof panel is expanded and active section is visible
    if (!state.proofExpanded) _toggleProofPanel(true);
    const activeSection = document.querySelector(`.proof-section[data-proof-idx="${state.proofActiveIndex}"]`);
    if (activeSection && activeSection.classList.contains('collapsed')) {
        activeSection.classList.remove('collapsed');
    }

    // Save to per-proof memory so switching away and back preserves position
    _saveProofStepToMemory();

    // Render based on view mode
    if (state.proofViewMode === 'list') {
        _renderList();
    } else {
        _renderSlide();
    }

    // Update counter and nav buttons
    _updateCounter();
    _updateNavButtons();

    // Activate highlights
    if (index >= 0 && state._proofPreRendered && state._proofPreRendered[index]) {
        activateHighlights(state._proofPreRendered[index], steps[index]);
    }

    // Notify subscribers (e.g. semantic graph view) about the step change.
    try {
        window.dispatchEvent(new CustomEvent('algebench:stepchange', {
            detail: {
                proof,
                proofActiveIndex: state.proofActiveIndex,
                stepIndex: index,
                sceneIndex: state.currentSceneIndex,
            },
        }));
    } catch (_) { /* ignore event errors */ }

    // Bidirectional sync: proof → scene
    if (state.proofSyncEnabled && !state._proofSyncInProgress) {
        // At goal (index -1), use proof-level sceneStep; otherwise use step-level
        const sceneStep = index >= 0
            ? (steps[index] && steps[index].sceneStep)
            : (proof.sceneStep);
        if (sceneStep != null) {
            state._proofSyncInProgress = true;
            try {
                if (typeof sceneStep === 'string' && sceneStep.includes(':')) {
                    const [si, sti] = sceneStep.split(':').map(Number);
                    if (typeof window.navigateTo === 'function') window.navigateTo(si, sti);
                } else {
                    if (typeof window.navigateTo === 'function') {
                        window.navigateTo(state.currentSceneIndex, Number(sceneStep));
                    }
                }
            } finally {
                state._proofSyncInProgress = false;
            }
        }
    }
}

/** Reverse sync: scene step changed, update proof to match. */
export function syncProofFromSceneStep(stepIdx) {
    if (!state.proofSyncEnabled || state._proofSyncInProgress) return;
    const proof = _activeProof();
    if (!proof || !proof.steps) return;

    const matchIdx = proof.steps.findIndex(s => {
        if (s.sceneStep == null) return false;
        const sceneStep = s.sceneStep;

        // Support "sceneIdx:stepIdx" string format as well as plain numeric indices
        if (typeof sceneStep === 'string' && sceneStep.includes(':')) {
            const [siStr, stiStr] = sceneStep.split(':');
            const si = Number(siStr);
            const sti = Number(stiStr);
            if (Number.isNaN(si) || Number.isNaN(sti)) return false;
            return si === state.currentSceneIndex && sti === stepIdx;
        }

        const n = Number(sceneStep);
        if (Number.isNaN(n)) return false;
        return n === stepIdx;
    });
    if (matchIdx >= 0 && matchIdx !== state.proofStepIndex) {
        state._proofSyncInProgress = true;
        try {
            navigateProof(matchIdx);
        } finally {
            state._proofSyncInProgress = false;
        }
    }
}

// ---- Scroll helper ----

/**
 * Scroll the active proof step into full visibility within its scrollable
 * ancestor (.proof-tab-content).  Priority: show the entire step; if the
 * step is taller than the viewport, show its top edge instead.
 */
function _scrollActiveIntoView(container) {
    const activeEl = container && container.querySelector('.proof-step.active');
    if (!activeEl) return;

    // Find the scrollable ancestor (.proof-tab-content)
    let scrollParent = activeEl.parentElement;
    while (scrollParent && !scrollParent.classList.contains('proof-tab-content')) {
        scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;

    const sRect = scrollParent.getBoundingClientRect();
    const eRect = activeEl.getBoundingClientRect();

    if (eRect.height > sRect.height) {
        // Step taller than viewport — align top
        scrollParent.scrollTop += eRect.top - sRect.top;
    } else if (eRect.bottom > sRect.bottom) {
        // Bottom cut off — scroll down so bottom is visible
        scrollParent.scrollTop += eRect.bottom - sRect.bottom;
    } else if (eRect.top < sRect.top) {
        // Top cut off — scroll up so top is visible
        scrollParent.scrollTop += eRect.top - sRect.top;
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

    _scrollActiveIntoView(container);
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

    // Activate highlights and scroll active step into view
    const activeEl = container.querySelector('.proof-step.active');
    if (activeEl) {
        activateHighlights(activeEl, proof.steps[idx]);
    }
    _scrollActiveIntoView(container);
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

function _updateNavButtons() {
    const proof = _activeProof();
    const idx = state.proofStepIndex;
    const maxIdx = proof && proof.steps ? proof.steps.length - 1 : -1;
    const hasProof = !!proof;

    const firstBtn = document.getElementById('proof-first');
    const prevBtn = document.getElementById('proof-prev');
    const nextBtn = document.getElementById('proof-next');
    const lastBtn = document.getElementById('proof-last');

    if (firstBtn) firstBtn.disabled = !hasProof || idx <= -1;
    if (prevBtn) prevBtn.disabled = !hasProof || idx <= -1;
    if (nextBtn) nextBtn.disabled = !hasProof || idx >= maxIdx;
    if (lastBtn) lastBtn.disabled = !hasProof || idx >= maxIdx;
}

// ---- Active proof helpers ----

function _activeProof() {
    if (!state.proofSpec || state.proofSpec.length === 0) return null;
    if (state.proofActiveIndex < 0) return null;
    const idx = Math.min(state.proofActiveIndex, state.proofSpec.length - 1);
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

/** Get a stable key for a proof entry (uses proof.id or falls back to index). */
function _proofKey(entry, index) {
    return entry?.proof?.id || `_idx_${index}`;
}

/** Save current proof step index to memory before switching away. */
function _saveProofStepToMemory() {
    const proof = _activeProof();
    if (proof) {
        const key = _proofKey(state.proofSpec[state.proofActiveIndex], state.proofActiveIndex);
        state.proofStepMemory[key] = state.proofStepIndex;
    }
}

/** Restore proof step index from memory when switching to a proof. */
function _restoreProofStepFromMemory(entry, index) {
    const key = _proofKey(entry, index);
    return state.proofStepMemory[key] != null ? state.proofStepMemory[key] : -1;
}

/** Switch the active proof, preserving step state for both old and new. */
function switchActiveProof(newIndex) {
    if (newIndex === state.proofActiveIndex) return;
    // Save current proof's step position
    _saveProofStepToMemory();

    const oldIndex = state.proofActiveIndex;
    state.proofActiveIndex = newIndex;

    // Restore new proof's step position
    const entry = state.proofSpec[newIndex];
    state.proofStepIndex = _restoreProofStepFromMemory(entry, newIndex);
    const proof = _activeProof();
    state._proofPreRendered = proof ? _getOrPreRender(entry, newIndex) : [];

    // Update DOM without full rebuild: move steps container, toggle active/collapsed classes
    const container = document.getElementById('proof-context-content');
    if (container) {
        const sections = container.querySelectorAll('.proof-section[data-proof-idx]');
        sections.forEach(section => {
            const idx = parseInt(section.dataset.proofIdx);
            const header = section.querySelector('.proof-section-header');

            if (idx === oldIndex) {
                // Collapse old active, remove steps container
                section.classList.add('collapsed');
                if (header) header.classList.remove('active');
                const oldSteps = section.querySelector('#proof-steps-container');
                if (oldSteps) oldSteps.remove();
                // Update step hint
                const hintEl = section.querySelector('.proof-section-step-hint');
                if (hintEl) {
                    const oldEntry = state.proofSpec[oldIndex];
                    const memStep = _restoreProofStepFromMemory(oldEntry, oldIndex);
                    const oldProof = oldEntry?.proof;
                    hintEl.textContent = memStep >= 0 && oldProof?.steps
                        ? `(step ${memStep + 1}/${oldProof.steps.length})` : '';
                }
            }

            if (idx === newIndex) {
                // Expand new active, add steps container
                section.classList.remove('collapsed');
                if (header) header.classList.add('active');
                const body = section.querySelector('.proof-section-body');
                if (body && !body.querySelector('#proof-steps-container')) {
                    const stepsContainer = document.createElement('div');
                    stepsContainer.id = 'proof-steps-container';
                    body.appendChild(stepsContainer);
                }
                // Clear step hint
                const hintEl = section.querySelector('.proof-section-step-hint');
                if (hintEl) hintEl.textContent = '';
            }
        });
    }

    _updateCounter();
    _updateNavButtons();
    if (proof) navigateProof(state.proofStepIndex);
}

/** Get cached pre-rendered steps or create them. */
function _getOrPreRender(entry, index) {
    const key = _proofKey(entry, index);
    if (!state._proofPreRenderedAll[key]) {
        const proof = entry?.proof;
        state._proofPreRenderedAll[key] = proof ? preRenderProofSteps(proof) : [];
    }
    return state._proofPreRenderedAll[key];
}

/** Load proofs for the current context. Called on scene/step change. */
export function loadProof(lessonSpec, sceneIndex, stepIndex) {
    const allProofs = collectAllProofs(lessonSpec);
    const sceneChanged = state._proofLastScene !== sceneIndex ||
        !state.proofAllSpecs ||
        state.proofAllSpecs.length !== allProofs.length;

    if (sceneChanged) {
        // Save step memory for outgoing proof
        _saveProofStepToMemory();

        // Capture previous active proof id before overwriting state
        const prevProofId = state.proofSpec?.[state.proofActiveIndex]?.proof?.id;

        state.proofAllSpecs = allProofs;
        state.proofSpec = allProofs;
        state._proofLastScene = sceneIndex;
        state._proofLastStep = stepIndex;

        // Pre-render steps for all proofs (cache by id)
        state._proofPreRenderedAll = {};
        allProofs.forEach((entry, i) => _getOrPreRender(entry, i));

        // Try to keep the same active proof if it's still in context
        let newActiveIndex = -1;
        if (prevProofId) {
            const match = allProofs.findIndex(e =>
                e.proof?.id === prevProofId && _isProofInContext(e, sceneIndex, stepIndex));
            if (match >= 0) newActiveIndex = match;
        }
        // Fall back to first visible proof
        if (newActiveIndex < 0) {
            newActiveIndex = allProofs.findIndex(e => _isProofInContext(e, sceneIndex, stepIndex));
        }
        state.proofActiveIndex = newActiveIndex;

        // Restore step index for the active proof
        const activeEntry = allProofs[newActiveIndex];
        state.proofStepIndex = activeEntry ? _restoreProofStepFromMemory(activeEntry, newActiveIndex) : -1;
        state._proofPreRendered = activeEntry ? _getOrPreRender(activeEntry, newActiveIndex) : [];

        // Full rebuild
        _buildContextTab(allProofs);
    }

    // Track last step for tab switching
    state._proofLastStep = stepIndex;

    // Update visibility based on current step (no DOM rebuild)
    _updateContextVisibility(sceneIndex, stepIndex);

    // Show/hide the proof toggle button based on visible proofs
    const hasVisible = allProofs.some(e => _isProofInContext(e, sceneIndex, stepIndex));
    const toggleBtn = document.getElementById('proof-toggle-btn');
    if (toggleBtn) {
        toggleBtn.style.display = hasVisible ? '' : 'none';
    }

    // Update counter and nav buttons
    _updateCounter();
    _updateNavButtons();

    // Render active proof steps — but skip if we're already inside a proof→scene sync
    // (re-entrant call from navigateProof → navigateTo → loadProof)
    if (_activeProof() && !state._proofSyncInProgress) {
        state._proofSyncInProgress = true;
        try {
            navigateProof(state.proofStepIndex);
        } finally {
            state._proofSyncInProgress = false;
        }
    }

    // If expanded and no visible proofs, collapse
    if (!hasVisible && state.proofExpanded) {
        _toggleProofPanel(false);
    }

    // Auto-expand if proofs exist and user had it expanded
    const savedExpanded = localStorage.getItem('algebench-proof-expanded');
    if (hasVisible && savedExpanded === 'true' && !state.proofExpanded) {
        _toggleProofPanel(true);
    }

    // Notify subscribers (semantic graph view) that the proof tree changed.
    try {
        window.dispatchEvent(new CustomEvent('algebench:proofload', {
            detail: {
                sceneIndex,
                stepIndex,
                proofCount: allProofs.length,
            },
        }));
    } catch (_) { /* ignore */ }
}

/** Build the "In Context" tab DOM once with all proofs. Visibility is toggled by _updateContextVisibility. */
function _buildContextTab(allProofs) {
    const container = document.getElementById('proof-context-content');
    if (!container) return;
    container.innerHTML = '';

    if (allProofs.length === 0) {
        container.innerHTML = '<p style="color: rgba(150,150,200,0.5); font-style: italic; font-size: 0.8em; padding: 8px;">No proofs in this lesson.</p>';
        return;
    }

    allProofs.forEach((entry, i) => {
        const section = document.createElement('div');
        const isActive = i === state.proofActiveIndex;
        section.className = 'proof-section' + (isActive ? '' : ' collapsed');
        section.dataset.proofIdx = i;
        section.dataset.proofLevel = entry.level;
        if (entry.sceneIndex != null) section.dataset.proofScene = entry.sceneIndex;
        if (entry.stepIndex != null) section.dataset.proofStep = entry.stepIndex;

        const proof = entry.proof;
        const title = proof.title || proof.goal || 'Untitled proof';

        const badge = techniqueBadgeHTML(proof);
        section.innerHTML = `<div class="proof-section-header${isActive ? ' active' : ''}" data-proof-index="${i}">
            <span class="proof-section-arrow">&#9660;</span>
            <span class="proof-section-title">Proof: ${renderKaTeX(title)}</span>
            ${badge}
            <span class="proof-section-step-hint"></span>
        </div>`;

        const body = document.createElement('div');
        body.className = 'proof-section-body';

        // Goal with AI + speak buttons
        body.innerHTML = renderGoalHTML(proof);
        _injectGoalAskButton(body, proof);

        // Add steps container for the active proof
        if (isActive) {
            const stepsContainer = document.createElement('div');
            stepsContainer.id = 'proof-steps-container';
            body.appendChild(stepsContainer);
        }

        section.appendChild(body);

        // Click header to switch active proof (with state preservation)
        const header = section.querySelector('.proof-section-header');
        header.addEventListener('click', () => {
            if (i !== state.proofActiveIndex) {
                switchActiveProof(i);
            } else {
                section.classList.toggle('collapsed');
            }
        });

        container.appendChild(section);
    });
}

/** Update visibility of context proof sections based on current scene/step. No DOM rebuild. */
function _updateContextVisibility(sceneIndex, stepIndex) {
    const container = document.getElementById('proof-context-content');
    if (!container) return;

    const showAll = state._proofTabMode === 'all';
    const sections = container.querySelectorAll('.proof-section[data-proof-idx]');
    sections.forEach(section => {
        const idx = parseInt(section.dataset.proofIdx);
        const entry = state.proofSpec[idx];
        if (!entry) { section.style.display = 'none'; return; }

        const isActive = idx === state.proofActiveIndex;
        // In "all" mode show everything; in "context" mode filter by hierarchy
        const inContext = _isProofInContext(entry, sceneIndex, stepIndex);
        const visible = showAll || inContext;
        section.style.display = visible ? '' : 'none';
        const hintEl = section.querySelector('.proof-section-step-hint');
        if (hintEl) {
            if (!isActive) {
                const memStep = _restoreProofStepFromMemory(entry, idx);
                const proof = entry.proof;
                if (memStep >= 0 && proof && proof.steps) {
                    hintEl.textContent = `(step ${memStep + 1}/${proof.steps.length})`;
                } else {
                    hintEl.textContent = '';
                }
            } else {
                hintEl.textContent = '';
            }
        }

        // Note: active proof is never hidden, so no need to switch away.
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

// ---- Proof tab switching (Proofs in Context / All Proofs) ----

function _setupProofTabs() {
    document.querySelectorAll('.proof-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.proof-tab').forEach(t => t.classList.toggle('active', t === tab));
            state._proofTabMode = tab.dataset.proofTab || 'context'; // 'context' or 'all'
            _updateContextVisibility(state._proofLastScene ?? 0, state._proofLastStep ?? 0);
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
    const firstBtn = document.getElementById('proof-first');
    const prevBtn = document.getElementById('proof-prev');
    const nextBtn = document.getElementById('proof-next');
    const lastBtn = document.getElementById('proof-last');
    if (firstBtn) firstBtn.addEventListener('click', () => navigateProof(-1));
    if (prevBtn) prevBtn.addEventListener('click', () => navigateProof(state.proofStepIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateProof(state.proofStepIndex + 1));
    if (lastBtn) lastBtn.addEventListener('click', () => {
        const proof = _activeProof();
        if (proof && proof.steps) navigateProof(proof.steps.length - 1);
    });

    // Mode toggle (slide / list) — restore saved preference
    const savedViewMode = localStorage.getItem('algebench-proof-view-mode');
    if (savedViewMode === 'list' || savedViewMode === 'slide') {
        state.proofViewMode = savedViewMode;
    }
    const modeBtn = document.getElementById('proof-mode-toggle');
    if (modeBtn) {
        modeBtn.textContent = state.proofViewMode === 'slide' ? 'Progressive' : 'Verbose';
        modeBtn.addEventListener('click', () => {
            state.proofViewMode = state.proofViewMode === 'slide' ? 'list' : 'slide';
            modeBtn.textContent = state.proofViewMode === 'slide' ? 'Progressive' : 'Verbose';
            localStorage.setItem('algebench-proof-view-mode', state.proofViewMode);
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
            // Sync immediately when enabled
            if (state.proofSyncEnabled) {
                navigateProof(state.proofStepIndex);
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

    const stripHlClass = (m) => {
        if (!m) return null;
        // Remove all \htmlClass{name}{...} wrappers, keeping inner content
        let s = m;
        while (s.includes('\\htmlClass{')) {
            const start = s.indexOf('\\htmlClass{');
            // Find the end of the class name: \htmlClass{name}
            const nameEnd = s.indexOf('}', start + 11);
            if (nameEnd < 0) break;
            // Next char should be {, find matching }
            if (s[nameEnd + 1] !== '{') break;
            let depth = 1, i = nameEnd + 2;
            while (i < s.length && depth > 0) {
                if (s[i] === '{') depth++;
                else if (s[i] === '}') depth--;
                i++;
            }
            // Replace \htmlClass{name}{content} with content
            const content = s.slice(nameEnd + 2, i - 1);
            s = s.slice(0, start) + content + s.slice(i);
        }
        return s;
    };
    const steps = proof.steps || [];
    const idx = state.proofStepIndex;

    const ctx = {
        title: proof.title || null,
        technique: proof.technique || null,
        techniqueHint: proof.techniqueHint || null,
        goal: proof.goal || null,
        stepCount: steps.length,
        currentStepIndex: idx,
        proofPrompt: proof.prompt || null,
        expanded: state.proofExpanded,
    };

    // Previous steps — compact (label + math only)
    if (idx > 0) {
        ctx.previousSteps = steps.slice(0, idx).map((s, i) => ({
            step: i + 1,
            label: s.label,
            math: stripHlClass(s.math),
        }));
    }

    // Current step — full details
    if (idx >= 0 && steps[idx]) {
        const step = steps[idx];
        ctx.currentStep = {
            step: idx + 1,
            id: step.id,
            label: step.label,
            math: stripHlClass(step.math),
            justification: step.justification || null,
            explanation: step.explanation || null,
            stepPrompt: step.prompt || null,
        };
    }

    // Upcoming steps — labels only (roadmap without spoilers)
    if (idx + 1 < steps.length) {
        ctx.upcomingSteps = steps.slice(idx + 1).map((s, i) => ({
            step: idx + 2 + i,
            label: s.label,
        }));
    }

    return ctx;
}
