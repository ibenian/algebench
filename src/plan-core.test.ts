// node:test unit tests for the pure learning-plan core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    back, breadcrumb, currentStep, enter, exportPlans, forward, jumpTo, markComplete, MAX_PLAN_DEPTH, parsePlanFile,
    plansReferencing, progress, recordView, refToView, reopen, returnUp, startPlan,
    navigableView, validatePlan, viewMatchesRef, VIEW_DIRECTIVES,
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

test('a finished sub-plan step follows its plan: reopened shows its fraction, deleted counts 0', () => {
    const half = { ...plan('half', [{ ...content('h1', { lesson: L, sc: 'a' }, 'scene'), state: 'done' as const },
        content('h2', { lesson: L, sc: 'b' }, 'scene')]) };
    const holder = (state: 'done' | 'skipped') => plan('p', [{ ...linked('l', 'half'), state }]);
    const lookup: PlanLookup = (id) => (id === 'half' ? half : undefined);
    assert.equal(progress(holder('done'), lookup).fraction, 0.5, 'a reopened plan is half done, not whole');
    assert.equal(progress(holder('done'), () => undefined).fraction, 0, 'a deleted plan counts 0');
    assert.equal(progress(holder('skipped'), lookup).fraction, 1, 'skipped still counts as dealt with');
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
    const extra = plan('extra', [content('e1', { lesson: L, sc: 'the-forces-of-reentry', st: 'aerodynamic-drag' })]);
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

// ----- malformed and stale positions -----

test('validatePlan rejects a malformed saved position and non-object views', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    bad.nav = { frames: [{ planId: 'someone-else', stepId: 's1', cameFrom: ORIGIN }, { planId: 'x' }] };
    bad.steps[0].view = 'not a view';
    bad.steps[4].lastView = 42;
    const errs = validatePlan(bad);
    assert.ok(errs.includes('plan.steps[0]: missing view'));
    assert.ok(errs.includes('plan.steps[4]: bad lastView'));
    assert.ok(errs.includes('plan.nav.frames[1]: needs planId, stepId and a cameFrom view'));
    assert.ok(errs.includes('plan.nav.frames[0]: must be this plan, on one of its steps'));
    assert.deepEqual(validatePlan({ ...root, nav: { frames: [] } }), ['plan.nav: frames is not a non-empty list']);
});

test('validatePlan reports, not throws, a primitive sub-plan', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    bad.steps[2].sub = 'bad';
    assert.deepEqual(validatePlan(bad), ['plan.steps[2]: sub-plan has neither nested plan nor planId']);
    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [bad] }));
    assert.deepEqual(r.plans, []);
    assert.deepEqual(r.errors, ['plans[0].steps[2]: sub-plan has neither nested plan nor planId']);
});

test('validatePlan rejects a saved position that is too deep or revisits a plan', () => {
    const { root } = fixture();
    const frame = (planId: string) => ({ planId, stepId: 's1', cameFrom: ORIGIN });
    const deep = { ...root, nav: { frames: [frame('tv'), frame('a'), frame('b'), frame('c'), frame('d')] } };
    assert.deepEqual(validatePlan(deep), [`plan.nav: deeper than ${MAX_PLAN_DEPTH} frames`]);
    const cyclic = { ...root, nav: { frames: [frame('tv'), frame('air'), frame('tv')] } };
    assert.deepEqual(validatePlan(cyclic), ['plan.nav.frames[2]: plan "tv" is already on the stack']);
});

test('parsePlanFile rejects a nested plan whose id another plan in the file already has', () => {
    const { root } = fixture();
    const n = root.steps.find((st): st is SubplanStep => st.kind === 'subplan' && 'nested' in st.sub)!;
    const nestedId = (n.sub as { nested: LearningPlan }).nested.id;
    const other = plan(nestedId === 'x' ? 'y' : 'other', [nested('k', plan(nestedId, [content('c', { lesson: L, sc: 'a' }, 'scene')]))]);
    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [root, other] }));
    assert.deepEqual(r.plans.map((p) => p.id), [root.id]);
    assert.deepEqual(r.errors, [`plans[1]: nested plan id "${nestedId}" already used in this file`]);
});

test('parsePlanFile keeps the first of two plans with the same id', () => {
    const { root } = fixture();
    const twin = { ...root, title: 'imposter' };
    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [root, twin] }));
    assert.deepEqual(r.plans.map((p) => p.title), [root.title]);
    assert.deepEqual(r.errors, ['plans[1]: duplicate id "tv"']);
});

test('validatePlan requires numeric timestamps', () => {
    const { root } = fixture();
    const { updatedAt: _u, ...noUpdated } = root;
    assert.deepEqual(validatePlan(noUpdated), ['plan: createdAt and updatedAt must be numbers']);
    assert.deepEqual(validatePlan({ ...root, createdAt: 'yesterday' }), ['plan: createdAt and updatedAt must be numbers']);
    assert.deepEqual(validatePlan({ ...root, completedAt: null }), ['plan: bad completedAt']);
    assert.deepEqual(validatePlan({ ...root, completedAt: 5 }), []);
});

test('validatePlan rejects a stored view that is not at its step\'s ref', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    const i = bad.steps.findIndex((st: PlanStep) => st.kind !== 'subplan');
    bad.steps[i].view = { builtin: 'some-other-lesson' };
    bad.steps[i].lastView = { ...bad.steps[i].view };
    assert.deepEqual(validatePlan(bad), [
        `plan.steps[${i}]: view is not at its ref`,
        `plan.steps[${i}]: lastView is not at its ref`,
    ]);
});

test('export drops walks from nested plans too, and import checks the file version', () => {
    const { root, lookup } = fixture();
    const withWalks = JSON.parse(JSON.stringify(root));
    const n = withWalks.steps.find((st: PlanStep) => st.kind === 'subplan' && 'nested' in st.sub);
    n.sub.nested.nav = { frames: [{ planId: n.sub.nested.id, stepId: n.sub.nested.steps[0].id, cameFrom: ORIGIN }] };
    const file = exportPlans([withWalks], lookup, 1);
    assert.ok(!JSON.stringify(file).includes('"nav"'), 'no walk anywhere in the export');
    assert.deepEqual(parsePlanFile(JSON.stringify({ ...file, version: 2 })),
        { plans: [], errors: ['unsupported file version 2'] });
});

test('validatePlan requires the ref ids each step kind navigates to', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    const i = bad.steps.findIndex((st: PlanStep) => st.kind === 'glossary');
    const ps = bad.steps.findIndex((st: PlanStep) => st.kind === 'proofStep');
    delete bad.steps[i].ref.glossary;
    bad.steps[ps].ref = { lesson: L };
    bad.steps[ps].view = { builtin: L };
    assert.deepEqual(validatePlan(bad), [
        `plan.steps[${Math.min(i, ps)}]: a ${i < ps ? 'glossary ref needs glossary' : 'proofStep ref needs pf and ps'}`,
        `plan.steps[${Math.max(i, ps)}]: a ${i < ps ? 'proofStep ref needs pf and ps' : 'glossary ref needs glossary'}`,
    ]);
});

test('side-effecting deep-link directives never leave the navigator, and are stripped on import', () => {
    const { root, lookup } = fixture();
    const armed = JSON.parse(JSON.stringify(root));
    const directives = { aa: 'explain everything', fax: 'x^2', pa: 'd/anim', pas: 2, scene: '/tmp/x.json' };
    for (const st of armed.steps) if (st.kind !== 'subplan') { Object.assign(st.view, directives); }
    Object.assign(armed.target.origin, directives);
    const first = startPlan(armed, lookup, 1);
    assert.ok(first.go, 'the plan starts');
    for (const k of VIEW_DIRECTIVES) assert.equal(k in first.go!, false, `go has no ${k}`);
    const back = returnUp(first.changed[0]!, lookup, 2);   // lands on the (armed) origin
    for (const k of VIEW_DIRECTIVES) assert.equal(k in back.go!, false, `return has no ${k}`);

    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [armed] }));
    assert.deepEqual(r.errors, []);
    const text = JSON.stringify(r.plans);
    for (const k of VIEW_DIRECTIVES) assert.ok(!text.includes(`"${k}":`), `imported plan has no ${k}`);
});

test('every navigator move stamps the root, even inside a linked plan', () => {
    const { root, lookup, save } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's3', 2));
    const r = enter(p, lookup, ORIGIN, 3);   // into the linked 'air' plan
    p = save(r);
    const moved = forward(p, lookup, 7);
    const saved = moved.changed.find((q) => q.id === root.id)!;
    assert.equal(saved.updatedAt, 7, 'the root, which holds the frame stack, is stamped');
});

test('validatePlan requires step titles, reasons, a known source, and non-empty ids', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    delete bad.steps[0].why;
    bad.steps[1].source = 'someone';
    const li = bad.steps.findIndex((st: PlanStep) => st.kind === 'subplan' && 'planId' in st.sub);
    bad.steps[li].sub.planId = '';
    const errs = validatePlan(bad);
    assert.ok(errs.includes('plan.steps[0]: needs a title and a why'));
    assert.ok(errs.includes('plan.steps[1]: bad source'));
    assert.ok(errs.includes(`plan.steps[${li}]: sub-plan has neither nested plan nor planId`));
    const frames = [{ planId: 'tv', stepId: 's1', cameFrom: ORIGIN }, { planId: '', stepId: 'x', cameFrom: ORIGIN }];
    assert.ok(validatePlan({ ...root, nav: { frames } }).includes('plan.nav.frames[1]: needs planId, stepId and a cameFrom view'));
});

test('finishing a sub-plan clears its own walk, and a complete plan with a walk is invalid', () => {
    const { root, lookup, save, saved } = fixture();
    // 'air' was once walked on its own, so it carries a saved position.
    const airWalked = startPlan(saved.get('air')!, lookup, 1).changed.find((q) => q.id === 'air')!;
    saved.set('air', airWalked);
    assert.ok(airWalked.nav);
    let p = save(startPlan(root, lookup, 2));
    p = save(jumpTo(p, lookup, 's3', 3));
    p = save(enter(p, lookup, ORIGIN, 4));    // into 'air'
    let r = forward(p, lookup, 5);
    while (!r.changed.some((q) => q.id === 'air' && q.status === 'complete')) {
        assert.ok(!r.error, r.error);
        p = save(r);
        r = forward(p, lookup, 6);
    }
    const air = r.changed.find((q) => q.id === 'air')!;
    assert.equal(air.nav, undefined, 'a complete plan is not being walked');
    assert.deepEqual(validatePlan(air), []);
    assert.ok(validatePlan({ ...airWalked, status: 'complete', completedAt: 1 })
        .includes('plan: a complete plan is not being walked, but has a saved position'));
});

test('validatePlan reports a cyclic or absurdly deep plan instead of overflowing', () => {
    const { root } = fixture();
    const cyclic = JSON.parse(JSON.stringify(root));
    const n = cyclic.steps.findIndex((st: PlanStep) => st.kind === 'subplan' && 'nested' in st.sub);
    cyclic.steps[n].sub.nested = cyclic;   // what a structured-clone record can hold
    assert.ok(validatePlan(cyclic).includes(`plan.steps[${n}].sub.nested: a plan that contains itself`));

    // A cycle outside the nested plans: a view that refers to itself.
    const viewCycle = JSON.parse(JSON.stringify(root));
    const i = viewCycle.steps.findIndex((st: PlanStep) => st.kind !== 'subplan');
    viewCycle.steps[i].view.self = viewCycle.steps[i].view;
    assert.deepEqual(validatePlan(viewCycle), ['plan: not a JSON document (it contains a cycle)']);
    const origin = JSON.parse(JSON.stringify(root));
    origin.target.origin.loop = origin.target;
    assert.deepEqual(validatePlan(origin), ['plan: not a JSON document (it contains a cycle)']);

    let deep = plan('d0', [content('x', { lesson: L, sc: 'a' }, 'scene')]);
    for (let d = 1; d <= 40; d++) deep = plan(`d${d}`, [nested(`k${d}`, deep)]);
    const errs = validatePlan(deep);
    assert.equal(errs.length, 1);
    assert.match(errs[0]!, /nested more than 32 deep$/);
});

test('ref location ids must be plain ids, so an accepted import is one the store accepts', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    const i = bad.steps.findIndex((st: PlanStep) => st.kind === 'step');
    bad.steps[i].ref.sc = 'my scene';
    bad.steps[i].view = refToView(bad.steps[i].ref);
    assert.ok(validatePlan(bad).includes(`plan.steps[${i}]: ref sc not a plain id`));
    const r = parsePlanFile(JSON.stringify({ format: 'algebench-learning-plans', version: 1, exportedAt: 0, plans: [bad] }));
    assert.deepEqual(r.plans, []);
    // Everything parsePlanFile does accept validates again as the store will see it.
    const ok = parsePlanFile(JSON.stringify(exportPlans([root], fixture().lookup, 1)));
    for (const p of ok.plans) assert.deepEqual(validatePlan(p), []);
});

test('an empty sub-plan counts by its step; finishing a sub-plan keeps a skip a skip', () => {
    const empty = plan('empty', []);
    const p = plan('p', [{ ...nested('e', empty), state: 'done' }]);
    assert.equal(progress(p, () => undefined).fraction, 1, 'forwarded past an empty sub-plan: done');

    const { root, lookup, save, saved } = fixture();
    let q = save(startPlan(root, lookup, 1));
    q = save(jumpTo(q, lookup, 's3', 2));
    const s3 = q.steps.find((st) => st.id === 's3')!;
    s3.state = 'skipped';
    q = save(enter(q, lookup, ORIGIN, 3));
    let r = forward(q, lookup, 4);
    while (!r.changed.some((x) => x.id === 'air' && x.status === 'complete')) { q = save(r); r = forward(q, lookup, 5); }
    const holder = save(r).steps.find((st) => st.id === 's3')!;
    assert.equal(holder.state, 'skipped');
    assert.ok(saved.get('air')!.status === 'complete');
});

test('navigableView keeps draft lesson ids and drops prototype-named sliders', () => {
    assert.equal(navigableView({ builtin: 'draft/chart-demo', sc: 'a' }).builtin, 'draft/chart-demo');
    for (const bad of ['../etc', 'draft//x', '/abs', 'a/.hidden', 'a b']) {
        assert.equal(navigableView({ builtin: bad }).builtin, undefined, bad);
    }
    const sliders = JSON.parse('{"__proto__": 1, "constructor": 2, "toString": 3, "k": 4}');
    assert.deepEqual(navigableView({ builtin: L, sliders }).sliders, { k: 4 });
    // A draft lesson's step validates like any other.
    const draft = plan('d', [content('x', { lesson: 'draft/chart-demo', sc: 'a' }, 'scene')]);
    assert.deepEqual(validatePlan(draft), []);
});

test('holes in sparse arrays are reported or dropped, not skipped', () => {
    const { root } = fixture();
    const sparse = { ...root, steps: [...root.steps] };
    delete (sparse.steps as unknown[])[1];   // a hole, as structured clone can store
    assert.ok(validatePlan(sparse).includes('plan.steps[1]: missing id'));

    const hole = [1, 2, 3] as [number, number, number];
    delete (hole as unknown[])[1];
    const v = navigableView({ builtin: L, cam: { position: hole, target: [0, 0, 0] } });
    assert.equal(v.cam, undefined, 'a camera vector with a hole is not finite');
});

test('a sub-plan is nested or linked, never both; an orthographic scale must be positive', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    const n = bad.steps.findIndex((st: PlanStep) => st.kind === 'subplan' && 'nested' in st.sub);
    bad.steps[n].sub.planId = 'air';
    assert.ok(validatePlan(bad).includes(`plan.steps[${n}]: sub-plan has both a nested plan and a planId`));

    for (const oz of [0, -2]) assert.equal(navigableView({ builtin: L, proj: 'orthographic', oz }).oz, undefined, String(oz));
    assert.equal(navigableView({ builtin: L, proj: 'orthographic', oz: 3 }).oz, 3);
});

test('a nested plan may not reuse an id already in its plan', () => {
    const { root } = fixture();
    const bad = JSON.parse(JSON.stringify(root));
    const n = bad.steps.findIndex((st: PlanStep) => st.kind === 'subplan' && 'nested' in st.sub);
    bad.steps[n].sub.nested.id = root.id;
    assert.ok(validatePlan(bad).includes(`plan.steps[${n}].sub.nested: plan id "${root.id}" is used twice in this plan`));
});

test('navigableView keeps a clean location and drops anything malformed or active', () => {
    const cam = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const clean = { builtin: L, sc: 'a-b', st: 'c', pp: true, panel: 'chat', cv: 'front', oz: 1.5, nodes: ['n1'], sliders: { k: 2 }, cam };
    assert.deepEqual(navigableView(clean), clean);
    const dirty = {
        ...clean, cv: 'x"]', aa: 'ask', fax: 'x', pa: 'a/b', pas: 1, scene: '/etc/x.json', evil: 1,
        oz: Infinity, nodes: ['ok', 7, 'bad node'], sliders: { k: 'NaN', j: 3 }, cam: { position: [1, 2], target: [0, 0, 0] },
    } as unknown as ViewState;
    assert.deepEqual(navigableView(dirty),
        { builtin: L, sc: 'a-b', st: 'c', pp: true, panel: 'chat', nodes: ['ok'], sliders: { j: 3 } });
});

test('a saved position that no longer resolves is refused, not thrown', () => {
    const { root, lookup, save, saved } = fixture();
    let p = save(startPlan(root, lookup, 1));
    p = save(jumpTo(p, lookup, 's3', 2));
    p = save(enter(p, lookup, ORIGIN, 3));   // into the linked 'air' plan
    saved.set('air', { ...saved.get('air')!, steps: [saved.get('air')!.steps[1]!] });   // its current step removed
    for (const act of [
        () => forward(p, lookup, 4), () => back(p, lookup, 4), () => jumpTo(p, lookup, 'r2', 4),
        () => enter(p, lookup, ORIGIN, 4),
    ]) {
        const r = act();
        assert.match(r.error!, /no longer matches/);
        assert.deepEqual(r.changed, []);
    }
    assert.deepEqual(breadcrumb(p, lookup), []);
    assert.equal(currentStep(p, lookup), null);
    assert.equal(recordView(p, lookup, ORIGIN, 4).onStep, false);
    // Starting it again recovers: the stale position is dropped and the walk
    // restarts at the first unfinished step (s1 was only visited).
    const r = startPlan(p, lookup, 5);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.changed[0]!.nav!.frames.map((f) => f.stepId), ['s1']);
});
