// Context assembly is deterministic, so it is tested without an LM.
//
// That separation is the point: selection can be improved later — richer
// summaries, retrieval, token budgeting — and these tests say what a given
// lesson yields TODAY, so a change to selection is visible rather than inferred
// from whether builds got better.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { LessonFormat, Scene } from '/types/lesson.js';
const { assembleBuilderContext, collectSliderIds, deriveConventions, MAX_SCENES_SUMMARISED } =
    await import('/builder-context.js');

const lesson = JSON.parse(readFileSync('scenes/vector-operations.json', 'utf8')) as LessonFormat;

// ---- placement -----------------------------------------------------------

test('insert without an index appends', () => {
    const ctx = assembleBuilderContext({ lesson, intent: 'add a scene', op: 'insert' });
    assert.equal(ctx.sceneIndex, lesson.scenes.length);
});

test('replace requires a scene that exists', () => {
    // "Replace something" is not an instruction — refuse rather than guess.
    assert.throws(() => assembleBuilderContext({ lesson, intent: 'redo', op: 'replace' }));
    assert.throws(() => assembleBuilderContext({ lesson, intent: 'redo', op: 'replace', sceneIndex: 99 }));
});

test('only a replace carries the full scene', () => {
    // This is what makes regenerate-WITH-context work instead of from scratch.
    const ins = assembleBuilderContext({ lesson, intent: 'x', op: 'insert' });
    const rep = assembleBuilderContext({ lesson, intent: 'x', op: 'replace', sceneIndex: 2 });
    assert.equal(ins.current, null);
    assert.equal(rep.current, lesson.scenes[2]);
});

test('neighbours are the scenes either side', () => {
    const ctx = assembleBuilderContext({ lesson, intent: 'x', op: 'insert', sceneIndex: 2 });
    assert.deepEqual(ctx.neighbours.map((n) => n.title), [lesson.scenes[1]!.title, lesson.scenes[3]!.title]);
});

test('appending has only a left neighbour', () => {
    const ctx = assembleBuilderContext({ lesson, intent: 'x', op: 'insert' });
    assert.equal(ctx.neighbours.length, 1);
    assert.equal(ctx.neighbours[0]!.title, lesson.scenes.at(-1)!.title);
});

// ---- derived, not asked --------------------------------------------------

test('conventions come from the elements actually present', () => {
    // A model told "match the style" invents one; handed the real palette it reuses it.
    const conv = deriveConventions(lesson.scenes as never);
    assert.ok(conv.colors.includes('#ff6644'), 'the vector-a colour used throughout');
    assert.ok(conv.labelsAreLatex, 'this lesson labels in LaTeX');
    assert.ok(conv.elementsCarryPrompts);
});

test('a lesson with plain labels is not reported as LaTeX', () => {
    // One stray `$a$` must not make the builder wrap every word in dollars.
    const scenes = [{ elements: [
        { type: 'vector', label: 'velocity' },
        { type: 'vector', label: 'position' },
        { type: 'vector', label: '$a$' },
    ] }];
    assert.equal(deriveConventions(scenes as never).labelsAreLatex, false);
});

test('slider vocabulary is collected so the model cannot collide', () => {
    const ids = collectSliderIds(lesson.scenes as never);
    for (const id of ['ax', 'ay', 'az', 'bx', 'by', 'bz']) assert.ok(ids.includes(id), id);
    assert.equal(ids.length, new Set(ids).size, 'ids must be de-duplicated');
});

// ---- bounds --------------------------------------------------------------

test('summaries are bounded and the omission is reported', () => {
    // A silently truncated context reads as "the model saw everything".
    const big = { title: 'L', scenes: Array.from({ length: MAX_SCENES_SUMMARISED + 5 },
        (_, i) => ({ title: `s${i}` })) } as unknown as LessonFormat;
    const ctx = assembleBuilderContext({ lesson: big, intent: 'x', op: 'insert' });
    assert.equal(ctx.sceneSummaries.length, MAX_SCENES_SUMMARISED);
    assert.ok(ctx.omitted.some((o) => o.includes('scene summaries')), 'truncation must be visible');
});

test('the context is a fraction of the lesson it came from', () => {
    // The reason assembly lives here at all: shipping the lesson so the backend
    // could slice it was ~6x waste (549KB -> 87KB on the largest lesson).
    const full = JSON.stringify(lesson).length;
    const ctx = JSON.stringify(assembleBuilderContext({ lesson, intent: 'x', op: 'insert' })).length;
    assert.ok(ctx < full / 2, `context ${ctx} should be well under half of ${full}`);
});

// ---- shapes it must tolerate --------------------------------------------

test('a single-scene lesson is understood as one scene', () => {
    const solo = { title: 'solo', elements: [{ type: 'vector' }] } as unknown as Scene;
    assert.equal(assembleBuilderContext({ lesson: solo, intent: 'x', op: 'insert' }).sceneIndex, 1);
});

test('an empty app yields a usable context', () => {
    const ctx = assembleBuilderContext({ lesson: null, intent: 'build me a scene', op: 'insert' });
    assert.equal(ctx.sceneIndex, 0);
    assert.deepEqual(ctx.neighbours, []);
    assert.equal(ctx.current, null);
});

test('assembly never mutates the lesson', () => {
    const before = JSON.stringify(lesson);
    assembleBuilderContext({ lesson, intent: 'x', op: 'replace', sceneIndex: 0 });
    assert.equal(JSON.stringify(lesson), before);
});
