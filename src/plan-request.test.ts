// node:test unit tests for the learning_plan request and reply handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFromReply, planRequest, readPlanReply, whereFromView } from './plan-request.js';
import type { ContentStep } from './plan-core.js';

const REF = { lesson: 'atmospheric-entry-physics', sc: 'splashdown-dynamics', st: 'terminal-velocity' };

test('where keeps only ids the server accepts', () => {
    assert.deepEqual(whereFromView({ builtin: 'eigenvalues', sc: 'finding-eigenvalues', st: 'a b', pf: 'p1' }),
        { lesson: 'eigenvalues', sc: 'finding-eigenvalues', pf: 'p1' });
    assert.deepEqual(whereFromView({ builtin: '../etc', sc: 'x' }), {});
    assert.deepEqual(whereFromView(null), {});
});

test('the request is trimmed and bounded', () => {
    const r = planRequest(`  ${'x'.repeat(600)} `, { builtin: 'eigenvalues' });
    assert.equal(r.target.length, 500);
    assert.equal(r.clarifications, undefined);
    const q = planRequest('it', null, [{ question: 'Which?', answer: 'drag' }]);
    assert.deepEqual(q.clarifications, [{ question: 'Which?', answer: 'drag' }]);
});

test('a plan reply becomes steps, and bad steps are dropped', () => {
    const reply = readPlanReply({
        result: {
            title: 'Terminal velocity',
            steps: [
                { kind: 'step', title: 'Terminal Velocity', why: 'the target', ref: REF },
                { kind: 'subplan', title: 'x', why: 'y', ref: REF },                           // not a content kind
                { kind: 'step', title: 'No step id', why: 'y', ref: { lesson: REF.lesson, sc: REF.sc } },
                { kind: 'scene', title: 'Bad lesson', why: 'y', ref: { lesson: '../x', sc: 'a' } },
                { kind: 'glossary', title: 'drag', why: 'term', ref: { lesson: REF.lesson, glossary: 'drag' } },
            ],
        },
        caveat: 'No fluids lesson.',
    });
    assert.equal(reply.kind, 'result');
    if (reply.kind !== 'result') return;
    assert.deepEqual(reply.steps.map((s) => s.title), ['Terminal Velocity', 'drag']);
    assert.equal(reply.caveat, 'No fluids lesson.');
});

test('a result with no usable step is a reason', () => {
    assert.equal(readPlanReply({ result: { title: 't', steps: [{ kind: 'nope' }] } }).kind, 'reason');
});

test('the other outcomes', () => {
    assert.deepEqual(readPlanReply({ question: 'Which object?' }), { kind: 'question', question: 'Which object?' });
    assert.deepEqual(readPlanReply({ fallback_to_chat: true }), { kind: 'chat' });
    assert.deepEqual(readPlanReply({ reason: 'Not covered.' }), { kind: 'reason', reason: 'Not covered.' });
    assert.equal(readPlanReply(null).kind, 'reason');
    assert.equal(readPlanReply('<b>hi</b>').kind, 'reason');
});

test('a plan is built from refs, with views derived in code', () => {
    let n = 0;
    const reply = readPlanReply({ result: { title: '', steps: [
        { kind: 'proof', title: 'Terminal Velocity', why: 'w', ref: { lesson: REF.lesson, sc: REF.sc, pf: 'terminal_velocity' } },
    ] } });
    assert.equal(reply.kind, 'result');
    if (reply.kind !== 'result') return;
    const plan = planFromReply(reply, 'terminal velocity', { builtin: 'eigenvalues' }, 5, () => `id${++n}`);
    assert.equal(plan.title, 'terminal velocity');   // the target when the reply has no title
    assert.equal(plan.target.text, 'terminal velocity');
    const step = plan.steps[0] as ContentStep;
    assert.equal(step.kind, 'proof');
    assert.equal(step.source, 'ai');
    assert.equal(step.state, 'todo');
    assert.deepEqual(step.view, { builtin: REF.lesson, sc: REF.sc, pf: 'terminal_velocity', pp: true, panel: 'chat' });
});
