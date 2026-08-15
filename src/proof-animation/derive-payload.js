// derive-payload — shared helpers for assembling a `proof_animation` derive
// request. Used by BOTH the semantic-graph node Derive button (graph-view.js)
// and the proof-card per-step Derive button (proof.js) so the two paths build an
// equivalent payload (target/start/givens/goal/context) and stay in sync.

import { state } from '/state.js';
import { stripHtmlMacros, normLatex } from '/labels.js';

// Build context payload for the enrichment/derivation agents — lesson/scene/
// proof/step metadata that disambiguates symbols (e.g. T = thrust vs temperature).
// Returns null when no useful context is available.
export function buildEnrichContext(step) {
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

/** Givens for a proof — its `type: 'given'` steps as `{math, label}`. */
function _proofGivens(proof) {
    return (proof.steps || [])
        .filter(s => s && s.type === 'given' && s.math)
        .map(s => ({ math: stripHtmlMacros(s.math), label: s.label || null }))
        .filter(g => g.math);
}

/**
 * Choose the START expression for deriving proof step `index`, preferring the
 * previous step whenever possible (issue #382):
 *   1. the previous step's `math` (index-1) — the common case,
 *   2. else a proof given that isn't equal to the target,
 *   3. else the proof goal (if usable),
 * always avoiding a start equal to the target. Returns the START LaTeX, or
 * null to let the expert infer one.
 */
function _chooseStartLatex(proof, index, target, givens) {
    const steps = proof.steps || [];
    const tnorm = normLatex(target);
    const usable = (m) => {
        const s = stripHtmlMacros(m);
        return s && s.trim() && normLatex(s) !== tnorm ? s : null;
    };
    // 1. Previous step.
    if (index > 0 && steps[index - 1]) {
        const prev = usable(steps[index - 1].math);
        if (prev) return prev;
    }
    // 2. A proof given that differs from the target.
    const given = givens.find(g => normLatex(g.math) !== tnorm);
    if (given) return given.math;
    // 3. The proof goal.
    if (proof.goal) {
        const goal = usable(proof.goal);
        if (goal) return goal;
    }
    return null;
}

/**
 * Describe WHERE deriving proof step `index` starts from — `'previous step'`,
 * `'givens'`, `'goal'`, or `'inferred'` (no usable start; the expert infers one).
 * Returns null when the step has no derivable expression. Used to word the
 * proof-card Derive button's tooltip so the learner knows what it will do.
 */
export function describeDeriveStart(proof, index) {
    if (!proof || !Array.isArray(proof.steps)) return null;
    const step = proof.steps[index];
    if (!step) return null;
    const target = stripHtmlMacros(step.math || '').trim();
    if (!target) return null;
    const givens = _proofGivens(proof);
    const start = _chooseStartLatex(proof, index, target, givens);
    if (!start) return 'inferred';
    const sn = normLatex(start);
    if (index > 0 && proof.steps[index - 1]
        && normLatex(stripHtmlMacros(proof.steps[index - 1].math || '')) === sn) {
        return 'previous step';
    }
    if (givens.some(g => normLatex(g.math) === sn)) return 'givens';
    if (proof.goal && normLatex(stripHtmlMacros(proof.goal)) === sn) return 'goal';
    return 'previous step';
}

/**
 * Build the full `proof_animation` derive payload for proof step `index`.
 * Mirrors the graph-node payload but anchors on a proof step: target = the
 * step's `math`, start preferring the previous step, plus givens, goal, title,
 * domain, ALL previous steps, lesson/scene/proof context, and an intent hint.
 * Returns null when the step has no derivable expression.
 */
export function buildProofStepDerivePayload(proof, index, opts = {}) {
    if (!proof || !Array.isArray(proof.steps)) return null;
    const step = proof.steps[index];
    if (!step) return null;
    const target = stripHtmlMacros(step.math || '').trim();
    if (!target) return null;

    const payload = { target_latex: target };

    const domain = opts.domain
        || proof.domain
        || (proof.meta && proof.meta.domain);
    if (domain) payload.domain = domain;
    if (proof.title) payload.title = stripHtmlMacros(proof.title);
    if (proof.goal) payload.goal = stripHtmlMacros(proof.goal);

    const givens = _proofGivens(proof);
    if (givens.length) payload.givens = givens;

    const start = _chooseStartLatex(proof, index, target, givens);
    if (start) payload.start_latex = start;

    // All previous steps (compact) so the deriver sees the full lead-up.
    const prior = proof.steps.slice(0, index)
        .map((s, i) => ({ step: i + 1, label: s.label || null, math: stripHtmlMacros(s.math || '') }))
        .filter(s => s.math && s.math.trim());
    if (prior.length) payload.previous_steps = prior;

    const ctx = buildEnrichContext(step);
    if (ctx) payload.context = ctx;

    // Natural-language hint — the step's label/justification.
    const intent = (step.label || step.justification || '').trim();
    if (intent) payload.intent = intent;

    return payload;
}
