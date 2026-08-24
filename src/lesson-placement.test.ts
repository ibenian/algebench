// Covers src/lesson-placement.ts — applying builder ops to the lesson model and
// the inverse ops that come back. Pure: no DOM, no render stack, no globals.
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Scene, Step } from '/types/lesson.js';
import type { BuildOp } from '/placement.js';
const { applyBuildOps, ensureLessonFormat, PlacementError } = await import('/lesson-placement.js');
type MutableLesson = Awaited<ReturnType<typeof ensureLessonFormat>>['lesson'];

const scene = (title: string, id?: string): Scene =>
    ({ title, ...(id ? { id } : {}) }) as Scene;
const step = (title: string): Step => ({ title }) as Step;

const lessonOf = (...titles: string[]): MutableLesson =>
    ({ title: 'L', scenes: titles.map((t) => scene(t)) }) as MutableLesson;

const titles = (l: MutableLesson) => l.scenes.map((s) => s.title);

const insertScene = (index: number, title: string): BuildOp =>
    ({ op: 'insert', kind: 'scene', at: { index }, node: scene(title) });

// ---- insert / delete / replace round-trips -------------------------------

test('insert appends and its inverse is a delete at the same placement', () => {
    const l = lessonOf('a', 'b');
    const inv = applyBuildOps(l, [insertScene(2, 'c')]);
    assert.deepEqual(titles(l), ['a', 'b', 'c']);
    assert.equal(inv.length, 1);
    assert.equal(inv[0]!.op, 'delete');

    applyBuildOps(l, inv);
    assert.deepEqual(titles(l), ['a', 'b']);
});

test('replace captures the old node so undo restores it exactly', () => {
    const l = lessonOf('a', 'b');
    const op: BuildOp = { op: 'replace', kind: 'scene', at: { index: 1 }, node: scene('B!') };
    const inv = applyBuildOps(l, [op]);
    assert.deepEqual(titles(l), ['a', 'B!']);

    applyBuildOps(l, inv);
    assert.deepEqual(titles(l), ['a', 'b']);
});

test('delete captures the node so its inverse re-inserts it', () => {
    const l = lessonOf('a', 'b', 'c');
    const inv = applyBuildOps(l, [{ op: 'delete', kind: 'scene', at: { index: 1 } }]);
    assert.deepEqual(titles(l), ['a', 'c']);

    applyBuildOps(l, inv);
    assert.deepEqual(titles(l), ['a', 'b', 'c']);
});

// ---- the ordering property the reverse() exists for ----------------------

test('multi-op results undo to the exact original, not to shifted positions', () => {
    const l = lessonOf('a', 'b');
    const inv = applyBuildOps(l, [insertScene(0, 'x'), insertScene(2, 'y')]);
    assert.deepEqual(titles(l), ['x', 'a', 'y', 'b']);

    applyBuildOps(l, inv);
    assert.deepEqual(titles(l), ['a', 'b'], 'inverse must unwind in reverse order');
});

test('redo is the inverse of the inverse, via the same function', () => {
    const l = lessonOf('a');
    const undo = applyBuildOps(l, [insertScene(1, 'b')]);
    const redo = applyBuildOps(l, undo);          // undo
    assert.deepEqual(titles(l), ['a']);
    applyBuildOps(l, redo);                        // redo
    assert.deepEqual(titles(l), ['a', 'b']);
});

// ---- identity verification ----------------------------------------------

test('a stale placement is refused rather than overwriting the wrong node', () => {
    const l = { title: 'L', scenes: [scene('a', 's1'), scene('b', 's2')] } as MutableLesson;
    const op: BuildOp = {
        op: 'replace', kind: 'scene',
        at: { index: 1, id: 's-gone' }, node: scene('new'),
    };
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    assert.deepEqual(titles(l), ['a', 'b'], 'lesson must be untouched after a refusal');
});

test('insert past the end is refused', () => {
    const l = lessonOf('a');
    assert.throws(() => applyBuildOps(l, [insertScene(5, 'x')]), PlacementError);
});

// ---- steps, and the proof bare-object/array duality ---------------------

test('steps are placed inside the named scene', () => {
    const l = { title: 'L', scenes: [{ title: 'a', steps: [step('s0'), step('s1')] }] } as unknown as MutableLesson;
    applyBuildOps(l, [{ op: 'insert', kind: 'step', at: { scene: 0, index: 1 }, node: step('mid') }]);
    assert.deepEqual(l.scenes[0]!.steps!.map((s) => s.title), ['s0', 'mid', 's1']);
});

test('a bare-object proof stays a bare object after a replace', () => {
    const l = { title: 'L', scenes: [{ title: 'a', proof: { title: 'p0' } }] } as unknown as MutableLesson;
    const op = {
        op: 'replace', kind: 'proof',
        at: { scene: 0, index: 0 }, node: { title: 'p1' },
    } as unknown as BuildOp;
    applyBuildOps(l, [op]);
    const proof = (l.scenes[0] as unknown as { proof: unknown }).proof;
    assert.ok(!Array.isArray(proof), 'one-element proof must collapse back to a bare object');
    assert.equal((proof as { title: string }).title, 'p1');
});

// ---- bootstrap ----------------------------------------------------------

test('an empty app gets a lesson wrapper, flagged as bootstrapped', () => {
    const { lesson, bootstrap } = ensureLessonFormat(null, null);
    assert.deepEqual(lesson.scenes, []);
    assert.equal(bootstrap.bootstrapped, true);
    assert.equal(bootstrap.previousLesson, null);
});

test('a displayed single scene is promoted into scenes[0]', () => {
    const displayed = scene('solo');
    const { lesson, bootstrap } = ensureLessonFormat(null, displayed);
    assert.deepEqual(lesson.scenes.map((s) => s.title), ['solo']);
    // The record keeps the ORIGINAL, so undo restores the spec the user had —
    // including any root-only fields stripped out of scenes[0].
    assert.equal(bootstrap.promotedScene, displayed);
    assert.equal(bootstrap.bootstrapped, true);
});

test('an existing lesson is passed through untouched', () => {
    const existing = lessonOf('a');
    const { lesson, bootstrap } = ensureLessonFormat(existing, null);
    assert.equal(lesson, existing);
    assert.equal(bootstrap.bootstrapped, false);
});

// ---- the container is derived from `kind`, not named ---------------------

test('a lesson-level proof is reachable when no scene is given', () => {
    // LessonFormat.proof is valid per the schema. An earlier resolver keyed off a
    // `field` and threw whenever `scene` was absent, so this address type-checked
    // but could never be applied.
    const l = { title: 'L', scenes: [scene('a')] } as MutableLesson;
    const op = { op: 'insert', kind: 'proof', at: { index: 0 }, node: { title: 'p' } } as unknown as BuildOp;
    applyBuildOps(l, [op]);
    const proof = (l as unknown as { proof: unknown }).proof;
    assert.ok(!Array.isArray(proof), 'a single proof collapses back to a bare object');
    assert.equal((proof as { title: string }).title, 'p');
});

test('a scene op and a step op reach different containers from the same index', () => {
    // The mismatch this rules out: with a `field` on the placement, a scene op
    // could name `steps` and splice a Scene into a step array.
    const l = { title: 'L', scenes: [{ title: 'a', steps: [step('s0')] }] } as unknown as MutableLesson;
    applyBuildOps(l, [{ op: 'insert', kind: 'step', at: { scene: 0, index: 0 }, node: step('new') }]);
    applyBuildOps(l, [insertScene(0, 'front')]);
    assert.deepEqual(titles(l), ['front', 'a']);
    assert.deepEqual(l.scenes[1]!.steps!.map((s) => s.title), ['new', 's0']);
});

// ---- review round 2: apply/undo correctness ------------------------------

test('undoing a replace works when the replacement has a different id', () => {
    // The inverse used to reuse the forward placement verbatim, carrying the OLD
    // node's id — so verifyIdentity ran against a node that was no longer there
    // and threw `stale placement` for the ordinary case.
    const l = { title: 'L', scenes: [scene('a', 'old-id')] } as MutableLesson;
    const op: BuildOp = {
        op: 'replace', kind: 'scene',
        at: { index: 0, id: 'old-id' }, node: scene('b', 'new-id'),
    };
    const inv = applyBuildOps(l, [op]);
    assert.deepEqual(titles(l), ['b']);
    applyBuildOps(l, inv);                       // must not throw
    assert.deepEqual(titles(l), ['a']);
});

test('a failure part-way through a batch leaves the lesson untouched', () => {
    // Previously a valid insert followed by a stale replace left the insert
    // applied while the caller, seeing a throw, believed nothing had happened.
    const l = { title: 'L', scenes: [scene('a', 's1')] } as MutableLesson;
    const good = insertScene(0, 'front');
    const stale: BuildOp = {
        op: 'replace', kind: 'scene',
        at: { index: 1, id: 'not-there' }, node: scene('x'),
    };
    assert.throws(() => applyBuildOps(l, [good, stale]), PlacementError);
    assert.deepEqual(titles(l), ['a'], 'the successful insert must be rolled back too');
});

test('a fractional index is refused rather than addressing a phantom slot', () => {
    // 1.5 passes a `>= 0` check, then `replace` writes arr[1.5] — a plain
    // property no splice can see — while insert/delete coerce it differently.
    const l = lessonOf('a', 'b');
    const op = { op: 'replace', kind: 'scene', at: { index: 1.5 }, node: scene('x') } as unknown as BuildOp;
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    assert.deepEqual(titles(l), ['a', 'b']);
});

test('promoting a single scene keeps root-only fields at the root', () => {
    // `import` / `unsafe` / `unsafeExplanation` are singleSceneFormat fields, not
    // scene fields, and `$defs.scene` is additionalProperties:false. Burying them
    // in scenes[0] failed schema AND silently stopped domain imports loading,
    // since loadLesson reads them at the root.
    const single = {
        title: 'solo', import: ['orbital'], unsafe: true, unsafeExplanation: 'why',
    } as unknown as Scene;
    const { lesson } = ensureLessonFormat(null, single);
    const root = lesson as unknown as Record<string, unknown>;
    assert.deepEqual(root.import, ['orbital']);
    assert.equal(root.unsafe, true);
    assert.equal(root.unsafeExplanation, 'why');
    const s0 = lesson.scenes[0] as unknown as Record<string, unknown>;
    assert.equal(s0.import, undefined, 'root-only fields must not land in the scene');
    assert.equal(s0.unsafe, undefined);
    assert.equal(s0.title, 'solo', 'the scene keeps its own fields');
});

test('an empty-string id is verified, not treated as "no id given"', () => {
    // Ids have no minLength in the schema, so `id: ""` is valid. A truthiness
    // check let it skip stale-op verification and mutate whatever sat at that
    // index; only `undefined` may mean "do not verify".
    const l = { title: 'L', scenes: [scene('a', 'real-id')] } as MutableLesson;
    const op: BuildOp = { op: 'replace', kind: 'scene', at: { index: 0, id: '' }, node: scene('x') };
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    assert.deepEqual(titles(l), ['a']);
});

// ---- review round 3: nothing is left behind by a refused op ---------------

test('a refused op does not convert a bare proof into an array', () => {
    // resolveContainer normalizes `proof` as a side effect. Resolving before
    // validating meant a rejected op still reshaped the lesson, with no inverse
    // to put it back — all-or-nothing was false even for a single op.
    const l = { title: 'L', scenes: [{ title: 'a', proof: { title: 'p0' } }] } as unknown as MutableLesson;
    const op = { op: 'replace', kind: 'proof', at: { scene: 0, index: 7 }, node: { title: 'x' } } as unknown as BuildOp;
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    const proof = (l.scenes[0] as unknown as { proof: unknown }).proof;
    assert.ok(!Array.isArray(proof), 'the bare-object representation must survive a refusal');
});

test('a refused op does not materialize a missing steps array', () => {
    const l = { title: 'L', scenes: [{ title: 'a' }] } as unknown as MutableLesson;
    const op = { op: 'insert', kind: 'step', at: { scene: 0, index: 9 }, node: step('x') } as BuildOp;
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    assert.equal((l.scenes[0] as unknown as { steps?: unknown }).steps, undefined);
});

test('deleting the only proof restores its absence, so the op is invertible', () => {
    // Leaving `proof: []` behind made the inverse incomplete: it re-inserted the
    // node but could not remove the array normalization had created.
    const l = { title: 'L', scenes: [{ title: 'a', proof: { title: 'p0' } }] } as unknown as MutableLesson;
    const inv = applyBuildOps(l, [{ op: 'delete', kind: 'proof', at: { scene: 0, index: 0 } } as BuildOp]);
    assert.equal((l.scenes[0] as unknown as { proof?: unknown }).proof, undefined, 'no empty array left behind');
    applyBuildOps(l, inv);
    const back = (l.scenes[0] as unknown as { proof: unknown }).proof;
    assert.equal((back as { title: string }).title, 'p0', 'the inverse restores the original');
});

test('a step-level proof without a scene is refused, not routed to the lesson root', () => {
    const l = { title: 'L', scenes: [scene('a')] } as MutableLesson;
    const op = { op: 'insert', kind: 'proof', at: { step: 0, index: 0 }, node: { title: 'p' } } as unknown as BuildOp;
    assert.throws(() => applyBuildOps(l, [op]), PlacementError);
    assert.equal((l as unknown as { proof?: unknown }).proof, undefined);
});
