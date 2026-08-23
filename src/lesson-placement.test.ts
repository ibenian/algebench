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
    ({ op: 'insert', kind: 'scene', at: { field: 'scenes', index }, node: scene(title) });

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
    const op: BuildOp = { op: 'replace', kind: 'scene', at: { field: 'scenes', index: 1 }, node: scene('B!') };
    const inv = applyBuildOps(l, [op]);
    assert.deepEqual(titles(l), ['a', 'B!']);

    applyBuildOps(l, inv);
    assert.deepEqual(titles(l), ['a', 'b']);
});

test('delete captures the node so its inverse re-inserts it', () => {
    const l = lessonOf('a', 'b', 'c');
    const inv = applyBuildOps(l, [{ op: 'delete', kind: 'scene', at: { field: 'scenes', index: 1 } }]);
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
        at: { field: 'scenes', index: 1, id: 's-gone' }, node: scene('new'),
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
    applyBuildOps(l, [{ op: 'insert', kind: 'step', at: { scene: 0, field: 'steps', index: 1 }, node: step('mid') }]);
    assert.deepEqual(l.scenes[0]!.steps!.map((s) => s.title), ['s0', 'mid', 's1']);
});

test('a bare-object proof stays a bare object after a replace', () => {
    const l = { title: 'L', scenes: [{ title: 'a', proof: { title: 'p0' } }] } as unknown as MutableLesson;
    const op = {
        op: 'replace', kind: 'proof',
        at: { scene: 0, field: 'proof', index: 0 }, node: { title: 'p1' },
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
    assert.equal(bootstrap.promotedScene, displayed);
    assert.equal(bootstrap.bootstrapped, true);
});

test('an existing lesson is passed through untouched', () => {
    const existing = lessonOf('a');
    const { lesson, bootstrap } = ensureLessonFormat(existing, null);
    assert.equal(lesson, existing);
    assert.equal(bootstrap.bootstrapped, false);
});
