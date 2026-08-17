// ============================================================
// Proof — step-by-step mathematical proof & derivation system.
// Renders proofs inside the chat tab as a collapsible split panel.
// ============================================================

import { state } from '/state.js';
import { FIRST_ICON, PREV_ICON, NEXT_ICON, LAST_ICON } from '/icons.js';
import { renderKaTeX, renderMarkdown, makeAiAskButton, makeDeriveButton, openChatPanel, stripHtmlMacros } from '/labels.js';
import { SgProofManager } from '/proof-animation/sg-proof.js';
import { buildProofStepDerivePayload, describeDeriveStart } from '/proof-animation/derive-payload.js';

/**
 * A highlight region on a proof step's math.
 *
 * Deliberately looser than schemas/lesson.schema.json's ProofHighlight: `color`
 * is a plain string, because _highlightColorRGB() falls back to cyan for any
 * unknown name and proofs also arrive from the expert (unvalidated), not only
 * from schema-checked lesson JSON. The same reasoning applies to Proof and
 * ProofStep below — every field the renderer guards on stays optional here, so
 * the guards keep compiling instead of being deleted as "unreachable".
 */
export interface ProofHighlight {
    color?: string;
    label?: string;
}

/** One line of a proof, as the panel renders it. */
export interface ProofStep {
    id?: string;
    type?: string;
    label?: string;
    math?: string;
    justification?: string;
    explanation?: string;
    tags?: string[];
    highlights?: Record<string, ProofHighlight>;
    sceneStep?: number | string;
    prompt?: string;
}

/** A proof, as the panel renders it. */
export interface Proof {
    id?: string;
    title?: string;
    goal?: string;
    technique?: string;
    techniqueHint?: string;
    sceneStep?: number | string;
    prompt?: string;
    steps?: ProofStep[];
}

/**
 * What getProofContext() hands the chat tutor. The three step lists are added
 * conditionally — absent rather than empty when there is nothing to say — so
 * the system prompt stays compact.
 */
export interface ProofContext {
    title: string | null;
    technique: string | null;
    techniqueHint: string | null;
    goal: string | null;
    stepCount: number;
    currentStepIndex: number;
    proofPrompt: string | null;
    expanded: boolean;
    previousSteps?: { step: number; label: string | undefined; math: string | null }[];
    currentStep?: {
        step: number;
        id: string | undefined;
        label: string | undefined;
        math: string | null;
        justification: string | null;
        explanation: string | null;
        stepPrompt: string | null;
    };
    upcomingSteps?: { step: number; label: string | undefined }[];
}

/** A proof plus where in the lesson hierarchy it was found. */
export interface ProofEntry {
    level: 'file' | 'scene' | 'step';
    sceneIndex?: number;
    stepIndex?: number;
    proof: Proof;
}

/**
 * The lesson shape this module reads. Only the proof-bearing fields matter;
 * a bare scene (no `scenes`, but `elements`) is treated as a one-scene lesson,
 * which is why both spellings appear.
 */
interface ProofLessonSpec {
    proof?: Proof | Proof[] | null;
    elements?: unknown;
    scenes?: { proof?: Proof | Proof[] | null; steps?: { proof?: Proof | Proof[] | null }[] }[];
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface ProofState {
    proofSpec: ProofEntry[] | null;
    proofAllSpecs: ProofEntry[] | null;
    proofActiveIndex: number;
    proofStepIndex: number;
    proofExpanded: boolean;
    proofSyncEnabled: boolean;
    proofViewMode: 'slide' | 'list';
    proofStepMemory: Record<string, number | undefined>;
    currentSceneIndex: number;
    _proofPreRendered: HTMLElement[] | null;
    _proofPreRenderedAll: Record<string, HTMLElement[] | undefined>;
    _proofLastScene: number | null;
    _proofLastStep: number | null;
    _proofSyncInProgress: boolean;
    _proofTabMode: string;
}
const proofState = state as unknown as ProofState;

// ---- Technique metadata ----

const proofTechniques: Record<string, string | undefined> = {
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
function sanitizeClassName(s: unknown): string {
    if (typeof s !== 'string') return '';
    return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Return an HTML badge string for a proof technique, or '' if none. */
function techniqueBadgeHTML(proof: Proof | null | undefined): string {
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
function normalizeProofs(proofField: Proof | Proof[] | null | undefined): Proof[] {
    if (proofField == null) return [];
    return Array.isArray(proofField) ? proofField : [proofField];
}

/** Collect all proofs from the entire lesson spec. */
function collectAllProofs(lessonSpec: ProofLessonSpec | null | undefined): ProofEntry[] {
    const all: ProofEntry[] = [];
    if (!lessonSpec) return all;

    // Root-level proofs
    for (const p of normalizeProofs(lessonSpec.proof)) {
        all.push({ level: 'file', proof: p });
    }

    // Scene & step-level proofs
    // A bare scene (no `scenes`, but `elements`) is treated as a one-scene lesson,
    // so `lessonSpec` itself stands in for the scene. The cast reconciles the two
    // shapes; only `proof` and `steps` are read off the result either way.
    const scenes = (lessonSpec.scenes
        || (lessonSpec.elements ? [lessonSpec] : [])) as ProofLessonSpec['scenes'] & object[];
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
function _isProofInContext(entry: ProofEntry, sceneIndex: number, stepIndex: number): boolean {
    if (entry.level === 'file') return true;
    if (entry.level === 'scene') return entry.sceneIndex === sceneIndex;
    if (entry.level === 'step') return entry.sceneIndex === sceneIndex && entry.stepIndex! <= stepIndex;
    return false;
}

// ---- Pre-rendering ----

/** Pre-render all steps for a proof, returning an array of DOM nodes. */
function preRenderProofSteps(proof: Proof | null | undefined): HTMLElement[] {
    if (!proof || !proof.steps) return [];
    return proof.steps.map((step, i) => {
        const div = document.createElement('div');
        div.className = 'proof-step';
        div.dataset.proofStepIndex = String(i);

        const type = step.type || 'step';
        const typeClass = `type-${sanitizeClassName(type)}`;

        let contentHtml = `<div class="proof-step-header">
            <span class="proof-step-number">${i + 1}</span>
            <span class="proof-step-type ${typeClass}">${escapeHtml(type)}</span>
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

/** Inject AI ask + Derive buttons into the actions strip of a proof step. */
function _injectProofAskButtons(stepEl: HTMLElement, step: ProofStep, proof: Proof): void {
    const actionsEl = stepEl.querySelector<HTMLElement>('.proof-step-actions');
    if (!actionsEl) return;

    // "Explain" button — prose explanation in the chat.
    const btn = makeAiAskButton('proof-ask-btn', 'Explain this step',
        () => {
            let msg = `Explain this proof step: "${step.label}"`;
            if (step.justification) msg += `. Justification: "${step.justification}"`;
            return msg;
        });
    actionsEl.appendChild(btn);

    // "Derive" button — animate the micro-steps leading up to this step. Skip
    // premises (`given` steps): they're assumptions, with nothing to derive.
    if (step.math && step.type !== 'given') {
        const idx = Number(stepEl.dataset.proofStepIndex);
        const deriveBtn = makeDeriveButton(
            'proof-ask-btn proof-step-derive-btn',
            _deriveTooltip(proof, idx),
            () => _onDeriveStep(idx));
        actionsEl.appendChild(deriveBtn);
    }
}

// ---- Per-step proof derivation (issue #382) ----
//
// A lazily-created SgProofManager docks derivation boxes over the proof panel,
// reusing the same engine the semantic-graph node Derive button uses. Boxes are
// keyed to the proof step they were launched on; navigating steps shows/hides
// them. The manager runs without a graph renderer (no pan/zoom), so boxes stay
// statically positioned over the panel.
let _proofDeriveManager: SgProofManager | null = null;

/** Stable key for the active proof + step, scoping derivation boxes per step. */
function _proofStepKey(): string | null {
    if (!proofState.proofSpec || proofState.proofActiveIndex < 0) return null;
    const entry = proofState.proofSpec[proofState.proofActiveIndex];
    return `${_proofKey(entry, proofState.proofActiveIndex)}#${proofState.proofStepIndex}`;
}

/** Get (or lazily create) the proof-panel derivation manager + its host. */
function _ensureProofDeriveManager(): SgProofManager | null {
    if (_proofDeriveManager && !_proofDeriveManager._destroyed) return _proofDeriveManager;
    const panel = document.getElementById('proof-panel');
    if (!panel) return null;
    let host = panel.querySelector<HTMLElement>('#proof-derive-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'proof-derive-host';
        panel.appendChild(host);
    }
    _proofDeriveManager = new SgProofManager(host);
    _proofDeriveManager.setCurrentStep(_proofStepKey());
    return _proofDeriveManager;
}

/** Tear down the derivation manager (called on scene change — boxes are scene-scoped). */
function _destroyProofDeriveManager(): void {
    if (_proofDeriveManager) {
        try { _proofDeriveManager.destroy(); } catch (_e) { /* ignore */ }
        _proofDeriveManager = null;
    }
    const host = document.getElementById('proof-derive-host');
    if (host && host.parentNode) host.parentNode.removeChild(host);
}

/** Keep the manager's visible boxes in sync with the active proof step. */
function _syncProofDeriveStep(): void {
    if (_proofDeriveManager && !_proofDeriveManager._destroyed) {
        _proofDeriveManager.setCurrentStep(_proofStepKey());
    }
}

/** Word the Derive button's tooltip by where the derivation starts, so the
 *  learner knows it fills the gap from the previous line (the common case). */
function _deriveTooltip(proof: Proof, index: number): string {
    switch (describeDeriveStart(proof, index)) {
        case 'previous step': return 'Derive: fill in the steps from the previous line to here';
        case 'givens':        return 'Derive: fill in the steps from the givens to here';
        case 'goal':          return 'Derive: fill in the steps from the goal to here';
        default:              return 'Derive: fill in the intermediate steps to here';
    }
}

/** Launch a derivation for proof step `index`: animate the micro-steps from a
 *  sensible start (preferring step index-1) to this step's expression.
 *
 *  Docks in the roomy semantic-graph canvas (switching to the Math view) when
 *  the step has a graph; falls back to an in-panel box for the rare graph-less
 *  step so the button always does something. */
async function _onDeriveStep(index: number): Promise<void> {
    const proof = _activeProof();
    if (!proof) return;
    // Make the step active (clicking a step navigates anyway) so the derivation
    // anchors to the right step's graph / panel box.
    if (proofState.proofStepIndex !== index) navigateProof(index);

    const payload = buildProofStepDerivePayload(proof, index);
    if (!payload) return;   // step has no derivable expression

    // Primary: dock into the semantic-graph canvas (more room, reuses the graph's
    // proof manager). Returns false when this step has no graph to dock onto.
    if (typeof window.algebenchDeriveProofPayload === 'function') {
        try {
            if (await window.algebenchDeriveProofPayload(payload)) return;
        } catch (e) { console.warn('proof derive → graph view failed:', e); }
    }

    // Fallback: dock an in-panel box over the proof panel.
    const mgr = _ensureProofDeriveManager();
    if (!mgr) return;
    mgr.setCurrentStep(_proofStepKey());
    const container = _activeContainer();
    const anchor = (container && container.querySelector('.proof-step.active .proof-step-derive-btn')) || null;
    mgr.openProof(`step:${index}`, anchor, payload);
}


/** Render the goal block for a proof. */
function renderGoalHTML(proof: Proof | null | undefined): string {
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
function _injectGoalAskButton(container: HTMLElement, proof: Proof | null | undefined): void {
    if (!proof || !proof.goal) return;
    const actionsEl = container.querySelector<HTMLElement>('.proof-goal-actions');
    if (!actionsEl) return;
    const btn = makeAiAskButton('proof-ask-btn', 'Explain this proof goal',
        () => `Explain the goal of this proof: "${proof.title || ''}". Goal: ${proof.goal}`);
    actionsEl.appendChild(btn);
}

/** Simple HTML escaper. */
function escapeHtml(s: string | null | undefined): string {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Highlight activation ----

/** Activate highlights for a proof step, deactivate all others. */
function activateHighlights(stepEl: HTMLElement | null | undefined, step: ProofStep | null | undefined): void {
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
        const els = stepEl.querySelectorAll<HTMLElement>(`.hl-${name}`);
        els.forEach(el => {
            const colorName = spec.color || 'cyan';
            const [r, g, b] = _highlightColorRGB(colorName);
            el.style.backgroundColor = _hlRGBA(colorName, 0.22);
            // setProperty takes a string; the JS passed numbers and let the DOM
            // coerce, so String() here is that same conversion made explicit.
            el.style.setProperty('--hl-r', String(r));
            el.style.setProperty('--hl-g', String(g));
            el.style.setProperty('--hl-b', String(b));
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
function _toggleHighlightAnnotation(stepEl: HTMLElement, name: string, spec: ProofHighlight): void {
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
    // Non-null: the row was found by querying inside stepEl, so it has a parent.
    // A detached row threw in the JS and must keep doing so.
    if (mathRow && mathRow.nextSibling) {
        mathRow.parentNode!.insertBefore(annotation, mathRow.nextSibling);
    } else if (mathRow) {
        mathRow.parentNode!.appendChild(annotation);
    } else {
        stepEl.appendChild(annotation);
    }
}

/** Convert a highlight color name to RGB components (r, g, b). */
type Rgb = [number, number, number];

function _highlightColorRGB(color: string): Rgb {
    const colors: Record<string, Rgb | undefined> = {
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
        silver:  [200, 210, 220],
        purple:  [170, 100, 220],
        teal:    [60, 200, 200],
        lime:    [180, 230, 80],
    };
    return colors[color] || colors.cyan!;
}

/** Build rgba string from color name at a given opacity. */
function _hlRGBA(color: string, opacity: number): string {
    const [r, g, b] = _highlightColorRGB(color);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ---- Navigation ----

/** Navigate to a specific proof step. -1 = goal overview. */
export function navigateProof(index: number): void {
    const proof = _activeProof();
    if (!proof) return;

    const steps = proof.steps || [];
    index = Math.max(-1, Math.min(index, steps.length - 1));
    proofState.proofStepIndex = index;

    // Ensure proof panel is expanded and active section is visible
    if (!proofState.proofExpanded) _toggleProofPanel(true);
    const activeSection = document.querySelector<HTMLElement>(`.proof-section[data-proof-idx="${proofState.proofActiveIndex}"]`);
    if (activeSection && activeSection.classList.contains('collapsed')) {
        activeSection.classList.remove('collapsed');
    }

    // Save to per-proof memory so switching away and back preserves position
    _saveProofStepToMemory();

    // Render based on view mode
    if (proofState.proofViewMode === 'list') {
        _renderList();
    } else {
        _renderSlide();
    }

    // Update counter and nav buttons
    _updateCounter();
    _updateNavButtons();

    // Activate highlights
    if (index >= 0 && proofState._proofPreRendered && proofState._proofPreRendered[index]) {
        activateHighlights(proofState._proofPreRendered[index], steps[index]);
        // (both indexes re-checked by the guard above)
    }

    // Keep any docked per-step derivation boxes scoped to the active step.
    _syncProofDeriveStep();

    // Notify subscribers (e.g. semantic graph view) about the step change.
    try {
        window.dispatchEvent(new CustomEvent('algebench:stepchange', {
            detail: {
                proof,
                proofActiveIndex: proofState.proofActiveIndex,
                stepIndex: index,
                sceneIndex: proofState.currentSceneIndex,
            },
        }));
    } catch (_) { /* ignore event errors */ }

    // Notify deeplink sync: proof-step change is a discrete navigation.
    try { window.dispatchEvent(new CustomEvent('algebench:proofchange')); } catch (_) { /* ignore */ }

    // Bidirectional sync: proof → scene
    if (proofState.proofSyncEnabled && !proofState._proofSyncInProgress) {
        // At goal (index -1), use proof-level sceneStep; otherwise use step-level
        const sceneStep = index >= 0
            ? (steps[index] && steps[index]!.sceneStep)
            : (proof.sceneStep);
        if (sceneStep != null) {
            proofState._proofSyncInProgress = true;
            try {
                if (typeof sceneStep === 'string' && sceneStep.includes(':')) {
                    // Non-null: the branch is gated on the string containing ':',
                    // so split() yields at least two parts. A malformed value
                    // produced NaN in the JS, and still does.
                    const [si, sti] = sceneStep.split(':').map(Number);
                    if (typeof window.navigateTo === 'function') window.navigateTo(si!, sti!);
                } else {
                    if (typeof window.navigateTo === 'function') {
                        window.navigateTo(proofState.currentSceneIndex, Number(sceneStep));
                    }
                }
            } finally {
                proofState._proofSyncInProgress = false;
            }
        }
    }
}

/** Reverse sync: scene step changed, update proof to match. */
export function syncProofFromSceneStep(stepIdx: number): void {
    if (!proofState.proofSyncEnabled || proofState._proofSyncInProgress) return;
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
            return si === proofState.currentSceneIndex && sti === stepIdx;
        }

        const n = Number(sceneStep);
        if (Number.isNaN(n)) return false;
        return n === stepIdx;
    });
    if (matchIdx >= 0 && matchIdx !== proofState.proofStepIndex) {
        proofState._proofSyncInProgress = true;
        try {
            navigateProof(matchIdx);
        } finally {
            proofState._proofSyncInProgress = false;
        }
    }
}

// ---- Scroll helper ----

/**
 * Scroll the active proof step into full visibility within its scrollable
 * ancestor (.proof-tab-content).  Priority: show the entire step; if the
 * step is taller than the viewport, show its top edge instead.
 */
function _scrollActiveIntoView(container: HTMLElement | null | undefined): void {
    const activeEl = container && container.querySelector<HTMLElement>('.proof-step.active');
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

function _renderSlide(): void {
    const container = _activeContainer();
    if (!container) return;

    const proof = _activeProof();
    if (!proof) return;
    const nodes = proofState._proofPreRendered || [];
    const idx = proofState.proofStepIndex;

    container.innerHTML = '';

    // Show previous steps collapsed, current step full
    nodes.forEach((node, i) => {
        // cloneNode() is declared as returning Node; these are the HTMLElements
        // preRenderProofSteps() built, so the cast just restores what was lost.
        const clone = node.cloneNode(true) as HTMLElement;
        // Re-attach event handlers lost during cloneNode
        clone.addEventListener('click', () => navigateProof(i));
        // Remove dead button clones (no listeners), re-inject live ones
        clone.querySelectorAll('.proof-ask-btn').forEach(b => b.remove());
        _injectProofAskButtons(clone, proof.steps![i]!, proof);

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
        const activeEl = container.querySelector<HTMLElement>('.proof-step.active');
        if (activeEl) activateHighlights(activeEl, proof.steps![idx]);
    }

    _scrollActiveIntoView(container);
}

function _renderList(): void {
    const container = _activeContainer();
    if (!container) return;

    const proof = _activeProof();
    if (!proof) return;
    const nodes = proofState._proofPreRendered || [];
    const idx = proofState.proofStepIndex;

    container.innerHTML = '';

    nodes.forEach((node, i) => {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.addEventListener('click', () => navigateProof(i));
        clone.querySelectorAll('.proof-ask-btn').forEach(b => b.remove());
        _injectProofAskButtons(clone, proof.steps![i]!, proof);

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
    const activeEl = container.querySelector<HTMLElement>('.proof-step.active');
    if (activeEl) {
        activateHighlights(activeEl, proof.steps![idx]);
    }
    _scrollActiveIntoView(container);
}

function _updateCounter(): void {
    const counter = document.getElementById('proof-counter');
    if (!counter) return;
    const proof = _activeProof();
    if (!proof || !proof.steps) { counter.textContent = ''; return; }
    const idx = proofState.proofStepIndex;
    if (idx < 0) {
        counter.textContent = `Goal · ${proof.steps.length} steps`;
    } else {
        counter.textContent = `Step ${idx + 1} of ${proof.steps.length}`;
    }
}

function _updateNavButtons(): void {
    const proof = _activeProof();
    const idx = proofState.proofStepIndex;
    const maxIdx = proof && proof.steps ? proof.steps.length - 1 : -1;
    const hasProof = !!proof;

    const firstBtn = document.getElementById('proof-first') as HTMLButtonElement | null;
    const prevBtn = document.getElementById('proof-prev') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('proof-next') as HTMLButtonElement | null;
    const lastBtn = document.getElementById('proof-last') as HTMLButtonElement | null;

    if (firstBtn) firstBtn.disabled = !hasProof || idx <= -1;
    if (prevBtn) prevBtn.disabled = !hasProof || idx <= -1;
    if (nextBtn) nextBtn.disabled = !hasProof || idx >= maxIdx;
    if (lastBtn) lastBtn.disabled = !hasProof || idx >= maxIdx;
}

// ---- Active proof helpers ----

function _activeProof(): Proof | null {
    if (!proofState.proofSpec || proofState.proofSpec.length === 0) return null;
    if (proofState.proofActiveIndex < 0) return null;
    const idx = Math.min(proofState.proofActiveIndex, proofState.proofSpec.length - 1);
    return proofState.proofSpec[idx]?.proof || null;
}

function _activeContainer(): HTMLElement | null {
    // Return the dedicated steps container inside the active proof section
    const stepsContainer = document.getElementById('proof-steps-container');
    if (stepsContainer) return stepsContainer;
    // Fallback to the context tab content
    return document.getElementById('proof-context-content');
}

// ---- Load / update proofs ----

/** Get a stable key for a proof entry (uses proof.id or falls back to index). */
function _proofKey(entry: ProofEntry | null | undefined, index: number): string {
    return entry?.proof?.id || `_idx_${index}`;
}

/** Save current proof step index to memory before switching away. */
function _saveProofStepToMemory(): void {
    const proof = _activeProof();
    if (proof) {
            // Non-null: _activeProof() returned a proof, so proofSpec is populated.
        const key = _proofKey(proofState.proofSpec![proofState.proofActiveIndex], proofState.proofActiveIndex);
        proofState.proofStepMemory[key] = proofState.proofStepIndex;
    }
}

/** Restore proof step index from memory when switching to a proof. */
function _restoreProofStepFromMemory(entry: ProofEntry | null | undefined, index: number): number {
    const key = _proofKey(entry, index);
    return proofState.proofStepMemory[key] != null ? proofState.proofStepMemory[key]! : -1;
}

/** Switch the active proof, preserving step state for both old and new. */
function switchActiveProof(newIndex: number): void {
    if (newIndex === proofState.proofActiveIndex) return;
    // Save current proof's step position
    _saveProofStepToMemory();

    const oldIndex = proofState.proofActiveIndex;
    proofState.proofActiveIndex = newIndex;

    // Restore new proof's step position
    // Non-null: switchActiveProof is only reached with a populated proofSpec.
    const entry = proofState.proofSpec![newIndex];
    proofState.proofStepIndex = _restoreProofStepFromMemory(entry, newIndex);
    const proof = _activeProof();
    proofState._proofPreRendered = proof ? _getOrPreRender(entry, newIndex) : [];

    // Update DOM without full rebuild: move steps container, toggle active/collapsed classes
    const container = document.getElementById('proof-context-content');
    if (container) {
        const sections = container.querySelectorAll<HTMLElement>('.proof-section[data-proof-idx]');
        sections.forEach(section => {
            // Non-null: the selector matched on [data-proof-idx], so it is set.
            const idx = parseInt(section.dataset.proofIdx!);
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
                    const oldEntry = proofState.proofSpec![oldIndex];
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
    if (proof) navigateProof(proofState.proofStepIndex);
}

/**
 * Public: activate a proof by index (deeplink / AI jump). Clamps to range and
 * reuses switchActiveProof so step memory + DOM stay consistent. No-op if the
 * proof is already active.
 */
export function setActiveProof(index: number): void {
    if (!proofState.proofSpec || !proofState.proofSpec.length) return;
    const clamped = Math.max(0, Math.min(index | 0, proofState.proofSpec.length - 1));
    switchActiveProof(clamped);
}

/** Get cached pre-rendered steps or create them. */
function _getOrPreRender(entry: ProofEntry | null | undefined, index: number): HTMLElement[] {
    const key = _proofKey(entry, index);
    if (!proofState._proofPreRenderedAll[key]) {
        const proof = entry?.proof;
        proofState._proofPreRenderedAll[key] = proof ? preRenderProofSteps(proof) : [];
    }
    return proofState._proofPreRenderedAll[key];
}

/** Load proofs for the current context. Called on scene/step change. */
export function loadProof(lessonSpec: ProofLessonSpec | null | undefined, sceneIndex: number, stepIndex: number): void {
    const allProofs = collectAllProofs(lessonSpec);
    const sceneChanged = proofState._proofLastScene !== sceneIndex ||
        !proofState.proofAllSpecs ||
        proofState.proofAllSpecs.length !== allProofs.length;

    if (sceneChanged) {
        // Save step memory for outgoing proof
        _saveProofStepToMemory();

        // Derivation boxes are scene-scoped — drop them when the scene changes.
        _destroyProofDeriveManager();

        // Capture previous active proof id before overwriting state
        const prevProofId = proofState.proofSpec?.[proofState.proofActiveIndex]?.proof?.id;

        proofState.proofAllSpecs = allProofs;
        proofState.proofSpec = allProofs;
        proofState._proofLastScene = sceneIndex;
        proofState._proofLastStep = stepIndex;

        // Pre-render steps for all proofs (cache by id)
        proofState._proofPreRenderedAll = {};
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
        proofState.proofActiveIndex = newActiveIndex;

        // Restore step index for the active proof
        const activeEntry = allProofs[newActiveIndex];
        proofState.proofStepIndex = activeEntry ? _restoreProofStepFromMemory(activeEntry, newActiveIndex) : -1;
        proofState._proofPreRendered = activeEntry ? _getOrPreRender(activeEntry, newActiveIndex) : [];

        // Full rebuild
        _buildContextTab(allProofs);
    }

    // Track last step for tab switching
    proofState._proofLastStep = stepIndex;

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
    if (_activeProof() && !proofState._proofSyncInProgress) {
        proofState._proofSyncInProgress = true;
        try {
            navigateProof(proofState.proofStepIndex);
        } finally {
            proofState._proofSyncInProgress = false;
        }
    }

    // If expanded and no visible proofs, collapse
    if (!hasVisible && proofState.proofExpanded) {
        _toggleProofPanel(false);
    }

    // Auto-expand if proofs exist and user had it expanded
    const savedExpanded = localStorage.getItem('algebench-proof-expanded');
    if (hasVisible && savedExpanded === 'true' && !proofState.proofExpanded) {
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
function _buildContextTab(allProofs: ProofEntry[]): void {
    const container = document.getElementById('proof-context-content');
    if (!container) return;
    container.innerHTML = '';

    if (allProofs.length === 0) {
        container.innerHTML = '<p style="color: rgba(150,150,200,0.5); font-style: italic; font-size: 0.8em; padding: 8px;">No proofs in this lesson.</p>';
        return;
    }

    allProofs.forEach((entry, i) => {
        const section = document.createElement('div');
        const isActive = i === proofState.proofActiveIndex;
        section.className = 'proof-section' + (isActive ? '' : ' collapsed');
        section.dataset.proofIdx = String(i);
        section.dataset.proofLevel = entry.level;
        if (entry.sceneIndex != null) section.dataset.proofScene = String(entry.sceneIndex);
        if (entry.stepIndex != null) section.dataset.proofStep = String(entry.stepIndex);

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
        // Non-null: the header was just written into section.innerHTML above.
        // A missing one threw in the JS and must keep throwing.
        const header = section.querySelector('.proof-section-header')!;
        header.addEventListener('click', () => {
            if (i !== proofState.proofActiveIndex) {
                switchActiveProof(i);
            } else {
                section.classList.toggle('collapsed');
            }
        });

        container.appendChild(section);
    });
}

/** Update visibility of context proof sections based on current scene/step. No DOM rebuild. */
function _updateContextVisibility(sceneIndex: number, stepIndex: number): void {
    const container = document.getElementById('proof-context-content');
    if (!container) return;

    const showAll = proofState._proofTabMode === 'all';
    const sections = container.querySelectorAll<HTMLElement>('.proof-section[data-proof-idx]');
    sections.forEach(section => {
        const idx = parseInt(section.dataset.proofIdx!);
        const entry = proofState.proofSpec![idx];
        if (!entry) { section.style.display = 'none'; return; }

        const isActive = idx === proofState.proofActiveIndex;
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

function _toggleProofPanel(show: boolean): void {
    const panel = document.getElementById('proof-panel');
    const handle = document.getElementById('proof-resize-handle');
    const btn = document.getElementById('proof-toggle-btn');
    if (!panel) return;

    proofState.proofExpanded = show;
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
    // Deeplink sync: proof-panel open/closed is shareable.
    try { window.dispatchEvent(new CustomEvent('algebench:panelchange')); } catch (_) { /* ignore */ }
}

/**
 * Public: open/close the proof panel (deeplink / AI jump). Opening is a no-op
 * when there's no active proof in context (nothing to show).
 */
export function setProofPanelOpen(show: boolean): void {
    if (show && !_activeProof()) return;
    if (!!show === !!proofState.proofExpanded) return;
    _toggleProofPanel(!!show);
}

// ---- Resize handle ----

function _setupProofResize(): void {
    const handle = document.getElementById('proof-resize-handle');
    const panel = document.getElementById('proof-panel');
    if (!handle || !panel) return;

    let startY: number, startHeight: number;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startHeight = panel.offsetHeight;

        const onMove = (e2: MouseEvent) => {
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

function _setupProofTabs(): void {
    document.querySelectorAll<HTMLElement>('.proof-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.proof-tab').forEach(t => t.classList.toggle('active', t === tab));
            proofState._proofTabMode = tab.dataset.proofTab || 'context'; // 'context' or 'all'
            _updateContextVisibility(proofState._proofLastScene ?? 0, proofState._proofLastStep ?? 0);
        });
    });
}

// ---- Refresh (re-render current step without changing state) ----

export function refreshProofPanel(): void {
    if (!_activeProof() || !proofState.proofExpanded) return;
    if (proofState.proofViewMode === 'list') {
        _renderList();
    } else {
        _renderSlide();
    }
    _updateCounter();
    _updateNavButtons();
}

// ---- Setup (called once on DOMContentLoaded) ----

export function setupProofPanel(): void {
    // Toggle button
    const toggleBtn = document.getElementById('proof-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            _toggleProofPanel(!proofState.proofExpanded);
        });
    }

    // Nav buttons
    const firstBtn = document.getElementById('proof-first');
    const prevBtn = document.getElementById('proof-prev');
    const nextBtn = document.getElementById('proof-next');
    const lastBtn = document.getElementById('proof-last');
    if (firstBtn) { firstBtn.innerHTML = FIRST_ICON; firstBtn.addEventListener('click', () => navigateProof(-1)); }
    if (prevBtn) { prevBtn.innerHTML = PREV_ICON; prevBtn.addEventListener('click', () => navigateProof(proofState.proofStepIndex - 1)); }
    if (nextBtn) { nextBtn.innerHTML = NEXT_ICON; nextBtn.addEventListener('click', () => navigateProof(proofState.proofStepIndex + 1)); }
    if (lastBtn) {
        lastBtn.innerHTML = LAST_ICON;
        lastBtn.addEventListener('click', () => {
            const proof = _activeProof();
            if (proof && proof.steps) navigateProof(proof.steps.length - 1);
        });
    }

    // Mode toggle (slide / list) — restore saved preference
    const savedViewMode = localStorage.getItem('algebench-proof-view-mode');
    if (savedViewMode === 'list' || savedViewMode === 'slide') {
        proofState.proofViewMode = savedViewMode;
    }
    const modeBtn = document.getElementById('proof-mode-toggle');
    if (modeBtn) {
        modeBtn.textContent = proofState.proofViewMode === 'slide' ? 'Progressive' : 'Verbose';
        modeBtn.addEventListener('click', () => {
            proofState.proofViewMode = proofState.proofViewMode === 'slide' ? 'list' : 'slide';
            modeBtn.textContent = proofState.proofViewMode === 'slide' ? 'Progressive' : 'Verbose';
            localStorage.setItem('algebench-proof-view-mode', proofState.proofViewMode);
            // Re-render current view
            navigateProof(proofState.proofStepIndex);
        });
    }

    // Sync toggle
    const syncBtn = document.getElementById('proof-sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            proofState.proofSyncEnabled = !proofState.proofSyncEnabled;
            syncBtn.classList.toggle('active', proofState.proofSyncEnabled);
            // Sync immediately when enabled
            if (proofState.proofSyncEnabled) {
                navigateProof(proofState.proofStepIndex);
            }
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!proofState.proofExpanded || !_activeProof()) return;
        // Don't capture if user is typing in an input
        // Cast, not optional chaining: a null target threw in the JS.
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateProof(proofState.proofStepIndex - 1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            navigateProof(proofState.proofStepIndex + 1);
        }
    });

    // Proof tab switching
    _setupProofTabs();

    // Resize handle
    _setupProofResize();
}

// ---- Public API for agent context ----

/** Get proof context for the chat system prompt. */
export function getProofContext(): ProofContext | null {
    const proof = _activeProof();
    if (!proof) return null;

    // Unwrap \htmlClass/\htmlData highlight wrappers from step math; null for
    // missing math (kept distinct from "" so callers can omit absent fields).
    const stripHlClass = (m: string | null | undefined) => (m ? stripHtmlMacros(m) : null);
    const steps = proof.steps || [];
    const idx = proofState.proofStepIndex;

    const ctx: ProofContext = {
        title: proof.title || null,
        technique: proof.technique || null,
        techniqueHint: proof.techniqueHint || null,
        goal: proof.goal || null,
        stepCount: steps.length,
        currentStepIndex: idx,
        proofPrompt: proof.prompt || null,
        expanded: proofState.proofExpanded,
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
