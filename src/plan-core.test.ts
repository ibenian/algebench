// node:test unit tests for the pure learning-plan core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    back, breadcrumb, currentStep, enter, exportPlans, forward, jumpTo, markComplete, MAX_PLAN_DEPTH, parsePlanFile,
    plansReferencing, progress, recordView, refToView, reopen, returnUp, startPlan,
    validatePlan, viewMatchesRef,
} from './plan-core.js';
import type { ContentRef, ContentStep, LearningPlan, PlanLookup, PlanStep, SubplanStep } from './plan-core.js';
import type { ViewState } from '/view-state.js';

const L = 'atmospheric-entry-physics';
const ORIGIN = { builtin: L, sc: 'splashdown-dynamics', st: 'terminal-velocity' };
const HERE = { builtin: L, sc: 'splashdown-dynamics', pf: 'terminal_velocity', ps: 'so-the-forces-must-balance', pp: true };

function content(id: string, ref: ContentRef, kind: ContentStep['kind'] = 'step'): ContentStep {
    return { id, kind, title: id, why: `why ${id}`, ref, view: refToView(ref), state: 'todo', source: 'ai' };
}

function plan(id: string, steps: PlanStep[], origin: ViewState = ORIGIN): LearningPlan {
    return {
        schemaVersion: 1, id, title: `plan ${id}`, target: { text: id, origin },
        steps, status: 'active', createdAt: 0, updatedAt: 0,
    };
}

function nested(id: string, p: LearningPlan): SubplanStep {
    return { id, kind: 'subplan', title: p.title, why: 'stuck', state: 'todo', source: 'ai', sub: { nested: p } };
}

function linked(id: string, planId: string): SubplanStep {
    return { id, kind: 'subplan', title: planId, why: 'linked', state: 'todo', source: 'learner', sub: { planId } };
}

/** The proposal's worked example: terminal velocity, with a nested and a referenced sub-plan. */
function fixture() {
    const newton = plan('newton', [
        content('n1', { lesson: L, sc: 'splashdown-dynamics', pf: 'terminal_velocity', ps: 'newton-s-second-law' }, 'proofStep'),
        content('n2', { lesson: L, sc: 'splashdown-dynamics', pf: 'terminal_velocity', ps: 'so-the-forces-must-balance' }, 'proofStep'),
    ], HERE);
    const air = plan('air', [
        content('r1', { lesson: L, sc: 'the-exponential-atmosphere', pf: 'exponential_atmosphere_derivation', ps: 'hydrostatic-equilibrium' }, 'proofStep'),
        content('r2', { lesson: L, sc: 'the-exponential-atmosphere', st: 'the-exponential-profile' }),
    ]);
    const root = plan('tv', [
        content('s1', { lesson: L, sc: 'the-forces-of-reentry', st: 'aerodynamic-drag' }),
        content('s2', { lesson: L, glossary: 'drag coefficient' }, 'glossary'),
        linked('s3', 'air'),
        nested('s4', newton),
        content('s5', { lesson: L, sc: 'splashdown-dynamics', pf: 'terminal_velocity', ps: 'solve-for-terminal-velocity' }, 'proofStep'),
    ]);
    const saved = new Map<string, LearningPlan>([[root.id, root], [air.id, air]]);
    const lookup: PlanLookup = (id) => saved.get(id);
    /** Apply a result's changes to the saved set, as the store would. */
    const save = (r: { changed: LearningPlan[] }) => { for (const p of r.changed) saved.set(p.id, p); return saved.get('tv')!; };
    return { root, air, saved, lookup, save };
}

const step = (p: LearningPlan, id: string) => p.steps.find((s) => s.id === id)!;
const view = (p: LearningPlan, id: string) => (step(p, id) as ContentStep).view;
const nestedPlan = (p: LearningPlan, id: string) => ((step(p, id) as SubplanStep).sub as { nested: LearningPlan }).nested;

// ----- refs -----

test('refToView builds the deep link; a proof step opens the proof panel', () => {
    assert.deepEqual(refToView({ lesson: L, sc: 'a', st: 'b' }), { builtin: L, sc: 'a', st: 'b' });
    assert.deepEqual(refToView({ lesson: L, sc: 'a', pf: 'p', ps: 'q' }), { builtin: L, sc: 'a', pf: 'p', pp: true, ps: 'q' });
    assert.deepEqual(refToView({ lesson: L, glossary: 'g' }), { builtin: L });
});

test('viewMatchesRef: every id the ref names must match; unnamed ones are free', () => {
    const ref = { lesson: L, sc: 'a', st: 'b' };
    assert.equal(viewMatchesRef({ builtin: L, sc: 'a', st: 'b', cam: { position: [1, 2, 3], target: [0, 0, 0] } }, ref), true);
    assert.equal(viewMatchesRef({ builtin: L, sc: 'a', st: 'c' }, ref), false);
    assert.equal(viewMatchesRef({ builtin: 'other', sc: 'a', st: 'b' }, ref), false);
    assert.equal(viewMatchesRef({ builtin: L, sc: 'a', st: 'z' }, { lesson: L, sc: 'a' }), true);
    assert.equal(viewMatchesRef(null, ref), false);
});

// ----- walking one plan -----

test('startPlan begins at the first unfinished step and remembers where the learner was', () => {
    const { root, lookup } = fixture();
    const r = startPlan(root, lookup, 5, HERE);
    const p = r.changed[0]!;
    assert.deepEqual(p.nav!.frames, [{ planId: 'tv', stepId: 's1', cameFrom: HERE }]);
    assert.equal(step(p, 's1').state, 'visited');
    assert.deepEqual(r.go, view(root, 's1'));
    assert.equal(root.nav, undefined, 'the input is never mutated');
});

test('startPlan on a plan already being walked resumes without changing anything', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(forward(p, lookup, 2));
    const r = startPlan(p, lookup, 3);
    assert.deepEqual(r.changed, []);
    assert.deepEqual(r.go, view(root, 's2'));
});

test('forward marks the step done and moves on; back moves without touching state', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    const f = forward(p, lookup, 2);
    p = save(f);
    assert.equal(step(p, 's1').state, 'done');
    assert.equal(step(p, 's2').state, 'visited');
    assert.equal(p.nav!.frames[0]!.stepId, 's2');
    assert.deepEqual(f.go, view(root, 's2'));

    const b = back(p, lookup, 3);
    p = save(b);
    assert.equal(p.nav!.frames[0]!.stepId, 's1');
    assert.equal(step(p, 's1').state, 'done', 'back does not undo');
    assert.equal(step(p, 's2').state, 'visited');
    assert.match(back(p, lookup, 4).error!, /first step/);
});

test('forward onto a sub-plan step goes nowhere until the learner enters it', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's2', 2));
    const r = forward(p, lookup, 3);
    assert.equal(r.go, null);
    assert.equal(save(r).nav!.frames[0]!.stepId, 's3');
});

test('forward on the outermost last step reports finished; the learner marks it complete', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's5', 2));
    const r = forward(p, lookup, 3);
    assert.equal(r.finished, true);
    assert.equal(r.go, null);
    p = save(r);
    assert.equal(p.status, 'active', 'completing is the learner\'s call');
    const c = markComplete(p, 4);
    assert.equal(c.status, 'complete');
    assert.equal(c.completedAt, 4);
    assert.equal(c.nav, undefined);
    assert.equal(step(c, 's5').state, 'done', 'step states are kept as history');
    assert.equal(reopen(c, 5).status, 'active');
});

// ----- sub-plans -----

test('enter pushes a frame that remembers where the learner came from', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's4', 2));
    const r = enter(p, lookup, HERE, 3);
    p = save(r);
    assert.deepEqual(p.nav!.frames.map((f) => [f.planId, f.stepId]), [['tv', 's4'], ['newton', 'n1']]);
    assert.deepEqual(p.nav!.frames[1]!.cameFrom, HERE);
    assert.equal(step(p, 's4').state, 'visited');
    assert.equal(step(nestedPlan(p, 's4'), 'n1').state, 'visited');
    assert.deepEqual(r.go, view(nestedPlan(root, 's4'), 'n1'));
    assert.deepEqual(r.changed.map((x) => x.id), ['tv'], 'a nested plan is saved as part of its parent');
});

test('return leaves a sub-plan without completing anything and lands where it was entered', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's4', 2));
    p = save(enter(p, lookup, HERE, 3));
    const r = returnUp(p, lookup, 4);
    p = save(r);
    assert.deepEqual(r.go, HERE);
    assert.deepEqual(p.nav!.frames.map((f) => f.stepId), ['s4']);
    assert.equal(nestedPlan(p, 's4').status, 'active');
    assert.equal(step(p, 's4').state, 'visited', 'the sub-plan step is not done');
});

test('return from the outermost plan ends the walk; the plan stays resumable', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1, HERE));
    const r = returnUp(p, lookup, 2);
    p = save(r);
    assert.deepEqual(r.go, HERE);
    assert.equal(p.nav, undefined);
    assert.equal(p.status, 'active');
    assert.equal(step(p, 's1').state, 'visited');
});

test('finishing a sub-plan completes it, marks its step done, and lands where it was entered', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's4', 2));
    p = save(enter(p, lookup, HERE, 3));
    p = save(forward(p, lookup, 4));             // n1 -> n2
    const r = forward(p, lookup, 5);             // n2 is last
    p = save(r);
    assert.deepEqual(r.go, HERE);
    assert.deepEqual(p.nav!.frames.map((f) => f.stepId), ['s4'], 'parked on the sub-plan step');
    assert.equal(step(p, 's4').state, 'done');
    assert.equal(nestedPlan(p, 's4').status, 'complete');
    assert.equal(nestedPlan(p, 's4').completedAt, 5);
});

test('a referenced plan keeps its own progress, shared with every plan that links it', () => {
    const { root, lookup, save, saved } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's3', 2));
    const e = enter(p, lookup, ORIGIN, 3);
    assert.deepEqual(e.changed.map((x) => x.id).sort(), ['air', 'tv']);
    p = save(e);
    p = save(forward(p, lookup, 4));             // r1 done, lands on r2
    assert.equal(step(saved.get('air')!, 'r1').state, 'done', 'written to the referenced record');
    assert.equal(step(p, 's3').kind, 'subplan');
    assert.equal(progress(saved.get('air')!, lookup).fraction, 0.5);
    // Another plan linking the same one sees the same progress.
    const other = plan('other', [linked('o1', 'air')]);
    assert.equal(progress(other, lookup).fraction, 0.5);
});

test('entering a plan already open further up is refused (no cycles)', () => {
    const { root, lookup, save, saved } = fixture();
    saved.set('air', { ...saved.get('air')!, steps: [...saved.get('air')!.steps, linked('r3', 'tv')] });
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's3', 2));
    p = save(enter(p, lookup, ORIGIN, 3));
    p = save(jumpTo(p, lookup, 'r3', 4));
    const r = enter(p, lookup, ORIGIN, 5);
    assert.match(r.error!, /already open/);
    assert.deepEqual(r.changed, []);
});

test('nesting deeper than MAX_PLAN_DEPTH is refused', () => {
    let inner = plan('d0', [content('x', { lesson: L, sc: 'a' })]);
    for (let d = 1; d <= MAX_PLAN_DEPTH; d++) inner = plan(`d${d}`, [nested(`k${d}`, inner)]);
    const lookup: PlanLookup = () => undefined;
    let p = startPlan(inner, lookup, 1).changed[0]!;
    for (let d = 1; d < MAX_PLAN_DEPTH; d++) p = enter(p, lookup, ORIGIN, 2).changed[0]!;
    assert.equal(p.nav!.frames.length, MAX_PLAN_DEPTH);
    assert.match(enter(p, lookup, ORIGIN, 3).error!, /at most/);
});

test('a deleted referenced plan cannot be entered', () => {
    const { root, lookup, save, saved } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's3', 2));
    saved.delete('air');
    assert.match(enter(p, lookup, ORIGIN, 3).error!, /deleted/);
});

test('changes two levels down are saved on the outermost record', () => {
    const deep = plan('deep', [content('z', { lesson: L, sc: 'q' })]);
    const mid = plan('mid', [nested('m1', deep)]);
    const top = plan('top', [nested('t1', mid)]);
    const lookup: PlanLookup = () => undefined;
    let p = startPlan(top, lookup, 1).changed[0]!;
    p = enter(p, lookup, ORIGIN, 2).changed[0]!;
    const r = enter(p, lookup, ORIGIN, 3);
    assert.deepEqual(r.changed.map((x) => x.id), ['top']);
    assert.deepEqual(breadcrumb(r.changed[0]!, lookup).map((c) => c.planId), ['top', 'mid', 'deep']);
});

// ----- where the learner is -----

test('recordView remembers where the learner is on the current step; resuming lands there', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    const there = { ...view(root, 's1'), cam: { position: [4, 5, 6] as [number, number, number], target: [0, 0, 0] as [number, number, number] } };
    const r = recordView(p, lookup, there, 2);
    assert.equal(r.onStep, true);
    p = save(r);
    assert.deepEqual((step(p, 's1') as ContentStep).lastView, there);
    p = save(forward(p, lookup, 3));
    assert.deepEqual(back(p, lookup, 4).go, there);
});

test('wandering off the current step changes nothing', () => {
    const { root, lookup, save } = fixture();
    const p = save(startPlan(root, lookup, 1));
    const r = recordView(p, lookup, { builtin: 'eigenvalues', sc: 'x' }, 2);
    assert.equal(r.onStep, false);
    assert.deepEqual(r.changed, []);
});

test('breadcrumb and currentStep follow the frame stack', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's4', 2));
    p = save(enter(p, lookup, HERE, 3));
    assert.deepEqual(breadcrumb(p, lookup).map((c) => [c.title, c.stepNumber, c.stepCount]),
        [['plan tv', 4, 5], ['plan newton', 1, 2]]);
    assert.equal(currentStep(p, lookup)!.id, 'n1');
    assert.equal(currentStep(root, lookup), null);
});

// ----- progress -----

test('progress rolls sub-plans up by their own fraction', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(forward(p, lookup, 2));             // s1 done
    p = save(jumpTo(p, lookup, 's4', 3));
    p = save(enter(p, lookup, HERE, 4));
    p = save(forward(p, lookup, 5));             // n1 done: newton 1/2
    const pr = progress(p, lookup);
    assert.equal(pr.total, 5);
    assert.equal(pr.done, 1.5);
    assert.equal(progress(markComplete(p, 6), lookup).fraction, 1);
});

test('progress survives a cycle between referenced plans', () => {
    const a = plan('a', [linked('a1', 'b')]);
    const b = plan('b', [linked('b1', 'a'), { ...content('b2', { lesson: L }), state: 'done' }]);
    const lookup: PlanLookup = (id) => ({ a, b } as Record<string, LearningPlan>)[id];
    assert.equal(progress(a, lookup).fraction, 0.5);
});

// ----- lifecycle and validation -----

test('plansReferencing finds plans that link a plan, including inside nested ones', () => {
    const a = plan('a', [linked('x', 'target')]);
    const b = plan('b', [nested('y', plan('inner', [linked('z', 'target')]))]);
    const c = plan('c', [content('w', { lesson: L })]);
    assert.deepEqual(plansReferencing([a, b, c], 'target').map((p) => p.id), ['a', 'b']);
});

test('validatePlan accepts the fixture and reports broken plans', () => {
    const { root } = fixture();
    assert.deepEqual(validatePlan(root), []);
    const bad = JSON.parse(JSON.stringify(root));
    bad.steps[1].id = 's1';
    bad.steps[0].kind = 'mystery';
    bad.steps[3].sub.nested.schemaVersion = 9;
    delete bad.steps[2].sub.planId;
    assert.deepEqual(validatePlan(bad), [
        'plan.steps[0]: unknown kind "mystery"',
        'plan.steps[1]: duplicate id "s1"',
        'plan.steps[2]: sub-plan has neither nested plan nor planId',
        'plan.steps[3].sub.nested: unsupported schemaVersion 9',
    ]);
    assert.deepEqual(validatePlan(null), ['plan: not an object']);
});

// ----- export / import -----

test('export carries referenced plans (transitively) and drops walks; import round-trips', () => {
    const { root, lookup, save, saved } = fixture();
    const extra = plan('extra', [content('e1', { lesson: L })]);
    saved.set('extra', extra);
    saved.set('air', { ...saved.get('air')!, steps: [...saved.get('air')!.steps, linked('r3', 'extra')] });
    const walked = save(startPlan(root, lookup, 1));
    const file = exportPlans([walked], lookup, 99);
    assert.deepEqual(file.plans.map((p) => p.id), ['tv', 'air', 'extra']);
    assert.equal(file.plans[0]!.nav, undefined);
    assert.ok(walked.nav, 'the saved plan keeps its walk');
    const back = parsePlanFile(JSON.stringify(file));
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.plans, file.plans);
});

test('parsePlanFile rejects foreign files and reports invalid plans', () => {
    assert.deepEqual(parsePlanFile('nope').errors, ['not a JSON file']);
    assert.deepEqual(parsePlanFile('{"plans": []}').errors, ['not an AlgeBench learning-plans file']);
    const { root } = fixture();
    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [root, { id: 'x' }] }));
    assert.deepEqual(r.plans.map((p) => p.id), ['tv']);
    assert.ok(r.errors.length > 0 && r.errors.every((e) => e.startsWith('plans[1]')));
});
