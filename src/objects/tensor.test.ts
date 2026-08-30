// Covers the pure input parsing in src/objects/tensor.ts — the two places a
// scene author's JSON becomes lattice dimensions and cell values.
//
// tensor.ts imports the label/expr/coords chain, which reads `math` and
// `window` at module-eval time; both are stubbed first, as in
// overlay-pure.test.ts. `THREE` is only touched inside renderTensor's body, so
// the parsers below import cleanly without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

const g = globalThis as unknown as { math: typeof mathjs; window: typeof globalThis };
g.math = mathjs;
g.window ??= globalThis;

const { readShape, readValues } = await import('/objects/tensor.js');

test('readShape reads [rows, cols]', () => {
    assert.deepEqual(readShape([6, 4]), { rows: 6, cols: 4 });
});

test('readShape takes the LAST two dimensions', () => {
    // The forward-compatibility promise: a leading dimension (heads, batch)
    // must not break a 2D lattice before the slice selector exists.
    assert.deepEqual(readShape([2, 6, 4]), { rows: 6, cols: 4 });
    assert.deepEqual(readShape([8, 2, 6, 4]), { rows: 6, cols: 4 });
});

test('readShape rejects what cannot be a lattice', () => {
    for (const bad of [null, undefined, [], [5], '6x6', {}, [0, 5], [5, 0], [-1, 3], [2.5, 3]]) {
        assert.equal(readShape(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
});

test('readValues flattens nested rows in row-major order', () => {
    assert.deepEqual(readValues([[1, 2, 3], [4, 5, 6]], 2, 3), [1, 2, 3, 4, 5, 6]);
});

test('readValues accepts an already-flat list', () => {
    assert.deepEqual(readValues([1, 2, 3, 4, 5, 6], 2, 3), [1, 2, 3, 4, 5, 6]);
});

test('readValues pads a short input with zeros rather than leaving holes', () => {
    // A hole would reach the colour ramp as NaN and paint nothing; 0 is a
    // deliberate cold cell, which is the honest rendering of "no value given".
    assert.deepEqual(readValues([[1, 2]], 2, 2), [1, 2, 0, 0]);
    assert.deepEqual(readValues([1, 2], 2, 2), [1, 2, 0, 0]);
});

test('readValues ignores entries beyond the declared shape', () => {
    assert.deepEqual(readValues([[1, 2, 99], [3, 4, 99]], 2, 2), [1, 2, 3, 4]);
});

test('readValues coerces non-numeric cells to 0', () => {
    assert.deepEqual(readValues([['a', null], [undefined, 4]], 2, 2), [0, 0, 0, 4]);
});

test('readValues returns null when there is no array to read', () => {
    for (const bad of [null, undefined, 42, 'values', {}]) {
        assert.equal(readValues(bad, 2, 2), null);
    }
});
