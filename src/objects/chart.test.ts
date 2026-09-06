// Covers the pure layer of src/objects/chart.ts: tick placement, automatic
// domains and tick formatting. The renderer itself needs a scene; these are
// the decisions it makes before drawing anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

const g = globalThis as unknown as { math: typeof mathjs; window: typeof globalThis };
g.math = mathjs;
g.window ??= globalThis;

const { niceTicks, autoDomain, formatTick } = await import('/objects/chart.js');

test('niceTicks lands on multiples of 1, 2 or 5 times a power of ten', () => {
    assert.deepEqual(niceTicks(0, 1).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(niceTicks(0, 10).ticks, [0, 2, 4, 6, 8, 10]);
    assert.deepEqual(niceTicks(-3, 3).ticks, [-2, 0, 2]);
    assert.deepEqual(niceTicks(-3, 3, 8).ticks, [-3, -2, -1, 0, 1, 2, 3]);
    assert.deepEqual(niceTicks(0, 64, 5).ticks, [0, 20, 40, 60]);
});

test('niceTicks snaps floating-point dust and copes with a flat or reversed range', () => {
    assert.ok(niceTicks(0, 0.3).ticks.every(v => String(v).length <= 4));
    assert.deepEqual(niceTicks(5, 5).ticks.length > 0, true);
    assert.deepEqual(niceTicks(3, -3).ticks, niceTicks(-3, 3).ticks);
    assert.deepEqual(niceTicks(NaN, 1).ticks, []);
});

test('autoDomain pads the extent and ends on round numbers', () => {
    const [lo, hi] = autoDomain([0.1, 0.9, 0.4]);
    assert.ok(lo <= 0.1 && hi >= 0.9);
    const { step } = niceTicks(lo, hi);
    assert.ok(Math.abs(lo / step - Math.round(lo / step)) < 1e-9, 'lo is a tick multiple');
    assert.ok(Math.abs(hi / step - Math.round(hi / step)) < 1e-9, 'hi is a tick multiple');
});

test('autoDomain gives a flat set some room and ignores non-finite samples', () => {
    const [lo, hi] = autoDomain([2, 2, 2]);
    assert.ok(lo < 2 && hi > 2);
    assert.deepEqual(autoDomain([NaN, Infinity]), [0, 1]);
    const d = autoDomain([1, NaN, 3]);
    assert.ok(d[0] <= 1 && d[1] >= 3);
});

test('formatTick prints to the decimals the step needs, and never "-0"', () => {
    assert.equal(formatTick(0.2, 0.2), '0.2');
    assert.equal(formatTick(20, 20), '20');
    assert.equal(formatTick(0.25, 0.05), '0.25');
    assert.equal(formatTick(-0.0000001, 0.2), '0.0');
});
