// derive-payload — the payload both Derive buttons must build identically.
//
// The semantic-graph node button and the proof-card per-step button share this
// module precisely so the two paths cannot drift. The rules worth pinning are
// the ones a caller cannot see: the start-expression preference order (issue
// #382 — previous step, else a given, else the goal, never the target itself)
// and that the tooltip wording (describeDeriveStart) reports the SAME choice the
// payload actually makes.
//
// Both specifiers below are SERVER-ROOT-ABSOLUTE, and `/labels.js` is backed by
// src/labels.ts, so this also exercises the phase-4.0 resolve hook.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEnrichContext, buildProofStepDerivePayload, describeDeriveStart,
} from '/proof-animation/derive-payload.js';
import { state } from '/state.js';

/** A proof whose steps are given/step pairs, in the shape lessons use. */
const proof = () => ({
    title: 'Kinetic energy',
    goal: 'E = \\tfrac12 m v^2',
    technique: 'derivation',
    domain: 'physics',
    steps: [
        { type: 'given', label: 'Newton II', math: 'F = m a' },
        { type: 'step', label: 'Work done', math: 'W = F d', justification: 'definition of work' },
        { type: 'step', label: 'Substitute', math: 'W = m a d' },
    ],
});

/** Clear the lesson/proof context this module reads off `state`. */
function clearContext() {
    state.lessonSpec = null;
    state.proofSpec = null;
    state.proofActiveIndex = 0;
}

test('the payload anchors on the step math and carries the proof framing', () => {
    clearContext();
    const p = buildProofStepDerivePayload(proof(), 2);
    assert.equal(p.target_latex, 'W = m a d');
    assert.equal(p.domain, 'physics');
    assert.equal(p.title, 'Kinetic energy');
    assert.equal(p.goal, 'E = \\tfrac12 m v^2');
    assert.equal(p.intent, 'Substitute');
});

test('an explicit opts.domain wins, then proof.domain, then proof.meta.domain', () => {
    clearContext();
    assert.equal(buildProofStepDerivePayload(proof(), 1, { domain: 'calculus' }).domain, 'calculus');
    const noDomain = proof();
    delete noDomain.domain;
    noDomain.meta = { domain: 'mechanics' };
    assert.equal(buildProofStepDerivePayload(noDomain, 1).domain, 'mechanics');
});

test('givens are the `given` steps only, and previous steps are numbered from 1', () => {
    clearContext();
    const p = buildProofStepDerivePayload(proof(), 2);
    assert.deepEqual(p.givens, [{ math: 'F = m a', label: 'Newton II' }]);
    assert.deepEqual(p.previous_steps, [
        { step: 1, label: 'Newton II', math: 'F = m a' },
        { step: 2, label: 'Work done', math: 'W = F d' },
    ]);
});

test('the start is the previous step, and the tooltip says so', () => {
    clearContext();
    assert.equal(buildProofStepDerivePayload(proof(), 2).start_latex, 'W = F d');
    assert.equal(describeDeriveStart(proof(), 2), 'previous step');
});

test('a previous step equal to the target falls through to a given', () => {
    clearContext();
    const p = proof();
    p.steps[1].math = p.steps[2].math;          // previous step == target
    assert.equal(buildProofStepDerivePayload(p, 2).start_latex, 'F = m a');
    assert.equal(describeDeriveStart(p, 2), 'givens');
});

test('with no usable previous step or given, the goal is the start', () => {
    clearContext();
    const p = { goal: 'E = \\tfrac12 m v^2', steps: [{ type: 'step', label: 'only', math: 'W = m a d' }] };
    assert.equal(buildProofStepDerivePayload(p, 0).start_latex, 'E = \\tfrac12 m v^2');
    assert.equal(describeDeriveStart(p, 0), 'goal');
});

test('with nothing usable at all the expert is left to infer the start', () => {
    clearContext();
    const p = { steps: [{ type: 'step', label: 'only', math: 'W = m a d' }] };
    const payload = buildProofStepDerivePayload(p, 0);
    assert.equal('start_latex' in payload, false);
    assert.equal(describeDeriveStart(p, 0), 'inferred');
});

test('a start equal to the target is never chosen, even from the goal', () => {
    clearContext();
    const p = { goal: 'W = m a d', steps: [{ type: 'step', label: 'only', math: 'W = m a d' }] };
    assert.equal('start_latex' in buildProofStepDerivePayload(p, 0), false);
});

test('KaTeX html macros are stripped everywhere the payload carries LaTeX', () => {
    clearContext();
    const p = {
        title: '\\htmlClass{hl-a}{Kinetic energy}',
        steps: [
            { type: 'given', label: 'g', math: '\\htmlClass{hl-a}{F = m a}' },
            { type: 'step', label: 's', math: '\\htmlClass{hl-b}{W = F d}' },
        ],
    };
    const payload = buildProofStepDerivePayload(p, 1);
    assert.equal(payload.title, 'Kinetic energy');
    assert.equal(payload.target_latex, 'W = F d');
    assert.deepEqual(payload.givens, [{ math: 'F = m a', label: 'g' }]);
    assert.equal(payload.start_latex, 'F = m a');
});

test('a missing proof, a missing step or an empty step yields null', () => {
    clearContext();
    assert.equal(buildProofStepDerivePayload(null, 0), null);
    assert.equal(buildProofStepDerivePayload({}, 0), null);
    assert.equal(buildProofStepDerivePayload(proof(), 99), null);
    assert.equal(buildProofStepDerivePayload({ steps: [{ type: 'step', label: 'x' }] }, 0), null);
    assert.equal(describeDeriveStart(null, 0), null);
    assert.equal(describeDeriveStart(proof(), 99), null);
});

test('no lesson and no proof context means no context block at all', () => {
    clearContext();
    assert.equal(buildEnrichContext(null), null);
    assert.equal('context' in buildProofStepDerivePayload(proof(), 1), false);
});

test('lesson, scene, proof and step metadata all reach the context block', () => {
    clearContext();
    state.lessonSpec = {
        title: 'Energy', description: 'A lesson',
        scenes: [{ title: 'Intro', description: 'first' }, { title: 'Work', description: 'second' }],
    };
    state.proofSpec = [{ sceneIndex: 1, proof: proof() }];
    state.proofActiveIndex = 0;
    const ctx = buildProofStepDerivePayload(proof(), 1).context;
    assert.deepEqual(ctx, {
        lessonTitle: 'Energy',
        lessonDescription: 'A lesson',
        sceneTitle: 'Work',
        sceneDescription: 'second',
        proofTitle: 'Kinetic energy',
        proofGoal: 'E = \\tfrac12 m v^2',
        proofTechnique: 'derivation',
        stepLabel: 'Work done',
        stepMath: 'W = F d',
        stepJustification: 'definition of work',
    });
    clearContext();
});

test('the intent falls back to the justification when a step has no label', () => {
    clearContext();
    const p = { steps: [{ type: 'step', math: 'a = b', justification: 'because' }] };
    assert.equal(buildProofStepDerivePayload(p, 0).intent, 'because');
});
