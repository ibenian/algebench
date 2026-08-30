// Grid extent resolution: the part of renderGrid that turns an element's
// `range`/`divisions`/`plane` into MathBox `area` parameters, with no MathBox
// or DOM involved.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveGridArea } from '/objects/grid.js';
import type { Element } from '/types/lesson.js';

const SCENE = [[-6, 6], [-8, 12], [-4, 4]];

/** resolveGridArea only reads plane/range/divisions off the element. */
const grid = (el: Record<string, unknown>) => ({ type: 'grid', ...el }) as unknown as Element;

test('a scalar range still applies to both axes', () => {
    const a = resolveGridArea(grid({ range: [-2, 2], divisions: 8 }), SCENE);
    assert.deepEqual(a.rangeX, [-2, 2]);
    assert.deepEqual(a.rangeY, [-2, 2]);
    assert.equal(a.width, 9);
    assert.equal(a.height, 9);
});

test('a per-axis range is read in plane order', () => {
    const a = resolveGridArea(grid({ plane: 'xz', range: [[-1, 11], [-6, 6]] }), SCENE);
    assert.deepEqual(a.rangeX, [-1, 11]);
    assert.deepEqual(a.rangeY, [-6, 6]);
});

test('a full 3D range is indexed by the plane, not by position', () => {
    // 'xz' takes the x and z entries — the y entry in the middle is skipped.
    const a = resolveGridArea(grid({ plane: 'xz', range: SCENE }), SCENE);
    assert.deepEqual(a.rangeX, [-6, 6]);
    assert.deepEqual(a.rangeY, [-4, 4]);
});

test('an omitted range inherits the scene range for the plane axes', () => {
    assert.deepEqual(resolveGridArea(grid({}), SCENE).rangeX, [-6, 6]);
    assert.deepEqual(resolveGridArea(grid({}), SCENE).rangeY, [-8, 12]);

    const xz = resolveGridArea(grid({ plane: 'xz' }), SCENE);
    assert.deepEqual(xz.rangeX, [-6, 6]);
    assert.deepEqual(xz.rangeY, [-4, 4]);

    const yz = resolveGridArea(grid({ plane: 'yz' }), SCENE);
    assert.deepEqual(yz.rangeX, [-8, 12]);
    assert.deepEqual(yz.rangeY, [-4, 4]);
});

test('an omitted range falls back to [-5,5] with no scene range', () => {
    const a = resolveGridArea(grid({}), null);
    assert.deepEqual(a.rangeX, [-5, 5]);
    assert.deepEqual(a.rangeY, [-5, 5]);
});

test('divisions may differ per axis', () => {
    const a = resolveGridArea(grid({ divisions: [12, 20] }), SCENE);
    assert.equal(a.width, 13);
    assert.equal(a.height, 21);
});

test('divisions default to 10 per axis when absent or unusable', () => {
    // `true` and `''` are here because Number() reads them as 1 and 0 — a bare
    // Number() guard would let `divisions: true` through as a single division.
    for (const divisions of [undefined, 0, -3, 'many', true, '', null, 3.9, NaN]) {
        const a = resolveGridArea(grid({ divisions }), SCENE);
        assert.equal(a.width, 11, `divisions=${String(divisions)}`);
        assert.equal(a.height, 11, `divisions=${String(divisions)}`);
    }
});

test('a non-integer division count falls back rather than truncating', () => {
    // 3.9 must not become 3: the schema declares divisions an integer, so a
    // fractional one is malformed input and takes the same route as 'many'.
    assert.equal(resolveGridArea(grid({ divisions: 3.9 }), SCENE).width, 11);
    // A whole number written as a string is still a whole number.
    assert.equal(resolveGridArea(grid({ divisions: '4' }), SCENE).width, 5);
});

test('each plane maps to its own MathBox axis pair', () => {
    assert.deepEqual(resolveGridArea(grid({ plane: 'xy' }), SCENE).axes, [1, 2]);
    assert.deepEqual(resolveGridArea(grid({ plane: 'xz' }), SCENE).axes, [1, 3]);
    assert.deepEqual(resolveGridArea(grid({ plane: 'yz' }), SCENE).axes, [2, 3]);
    // An unknown plane keeps the historical xy fallback.
    assert.deepEqual(resolveGridArea(grid({ plane: 'zx' }), SCENE).axes, [1, 2]);
});

test('blank and non-numeric components fall back, never coercing to 0', () => {
    // Number('') === Number('  ') === Number(null) === Number(false) === 0,
    // so each of these would otherwise resolve to the [0,0] grid that draws
    // nothing — the same silent failure the NaN guard exists to prevent.
    for (const bad of [['', ''], ['  ', '  '], [null, null], [false, false], [[], []]]) {
        const a = resolveGridArea(grid({ range: bad }), SCENE);
        assert.deepEqual(a.rangeX, [-6, 6], `range=${JSON.stringify(bad)}`);
        assert.deepEqual(a.rangeY, [-8, 12], `range=${JSON.stringify(bad)}`);
    }
    // A number written as a string is still a number.
    assert.deepEqual(resolveGridArea(grid({ range: ['-2', '2'] }), SCENE).rangeX, [-2, 2]);
});

test('a zero-width range falls back rather than collapsing to a line', () => {
    // [3,3] gives every consumer a step of 0; the scene range is more useful
    // than a grid drawn as a single line.
    const a = resolveGridArea(grid({ range: [3, 3] }), SCENE);
    assert.deepEqual(a.rangeX, [-6, 6]);
    assert.deepEqual(a.rangeY, [-8, 12]);
    // Only one axis of a per-axis pair being degenerate keeps the other.
    const half = resolveGridArea(grid({ plane: 'xz', range: [[-1, 11], [2, 2]] }), SCENE);
    assert.deepEqual(half.rangeX, [-1, 11]);
    assert.deepEqual(half.rangeY, [-4, 4]);
});

test('a non-numeric range falls back to the scene range instead of NaN geometry', () => {
    const a = resolveGridArea(grid({ range: ['-a', 'b'] }), SCENE);
    assert.deepEqual(a.rangeX, [-6, 6]);
    assert.deepEqual(a.rangeY, [-8, 12]);

    // One bad axis of a per-axis pair does not take the good one down with it.
    const half = resolveGridArea(grid({ plane: 'xz', range: [[-1, 11], ['x', 2]] }), SCENE);
    assert.deepEqual(half.rangeX, [-1, 11]);
    assert.deepEqual(half.rangeY, [-4, 4]);
});
