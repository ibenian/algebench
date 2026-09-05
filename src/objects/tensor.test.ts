// Covers the logical layer of src/objects/tensor.ts — the part that turns a
// scene author's JSON into a shape and a flat row-major value array, before
// any layout decision is made.
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

const { parseShape, normalizeValues, shapeSize, compileAxisLabelExpr } = await import('/objects/tensor.js');

/** normalizeValues returns a union; assert the success arm and hand back values. */
function ok(result: ReturnType<typeof normalizeValues>): number[] {
    assert.equal('error' in result, false, `expected success, got ${JSON.stringify(result)}`);
    return (result as { values: number[] }).values;
}

/** Assert the failure arm and hand back the message. */
function err(result: ReturnType<typeof normalizeValues>): string {
    assert.equal('error' in result, true, 'expected an error');
    return (result as { error: string }).error;
}

// ── shape ──

test('parseShape accepts any rank, including 1D', () => {
    assert.deepEqual(parseShape([6]), [6]);
    assert.deepEqual(parseShape([6, 4]), [6, 4]);
    assert.deepEqual(parseShape([2, 6, 4]), [2, 6, 4]);
});

test('parseShape rejects what cannot be a shape', () => {
    for (const bad of [null, undefined, [], '6x6', {}, [0], [5, 0], [-1, 3], [2.5, 3]]) {
        assert.equal(parseShape(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
});

test('shapeSize multiplies the dimensions', () => {
    assert.equal(shapeSize([6]), 6);
    assert.equal(shapeSize([6, 4]), 24);
    assert.equal(shapeSize([2, 3, 4]), 24);
});

// ── flat values ──

test('normalizeValues accepts a flat list matching the shape', () => {
    assert.deepEqual(ok(normalizeValues([1, 2, 3, 4], [2, 2])), [1, 2, 3, 4]);
    assert.deepEqual(ok(normalizeValues([1, 2, 3, 4], [4])), [1, 2, 3, 4]);
});

test('the same flat list can be viewed under different shapes', () => {
    // The point of normalizing to flat + shape: the data is independent of the
    // view taken of it.
    const flat = [1, 2, 3, 4, 5, 6];
    assert.deepEqual(ok(normalizeValues(flat, [6])), flat);
    assert.deepEqual(ok(normalizeValues(flat, [2, 3])), flat);
    assert.deepEqual(ok(normalizeValues(flat, [3, 2])), flat);
    assert.deepEqual(ok(normalizeValues(flat, [1, 2, 3])), flat);
});

test('a flat list of the wrong length is an error, not padding', () => {
    // Padding turned a typo into a plausible-looking half-empty grid.
    const message = err(normalizeValues([1, 2], [2, 2]));
    assert.match(message, /2 entries/);
    assert.match(message, /\[2, 2\]/);
    assert.match(message, /needs 4/);
});

test('a flat list that is too long is an error too', () => {
    assert.match(err(normalizeValues([1, 2, 3, 4, 5], [2, 2])), /5 entries/);
});

// ── nested values ──

test('normalizeValues flattens nested rows in row-major order', () => {
    assert.deepEqual(ok(normalizeValues([[1, 2, 3], [4, 5, 6]], [2, 3])), [1, 2, 3, 4, 5, 6]);
});

test('nested and flat spellings of the same data agree', () => {
    assert.deepEqual(
        ok(normalizeValues([[1, 2], [3, 4]], [2, 2])),
        ok(normalizeValues([1, 2, 3, 4], [2, 2])),
    );
});

test('nested values normalize at rank 3', () => {
    const nested = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];
    assert.deepEqual(ok(normalizeValues(nested, [2, 2, 2])), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a nested row of the wrong length reports where it disagrees', () => {
    const message = err(normalizeValues([[1, 2, 3], [4, 5]], [2, 3]));
    assert.match(message, /values\[1\]/);
    assert.match(message, /2 entries/);
    assert.match(message, /needs 3/);
});

test('nesting shallower than the shape is reported', () => {
    const message = err(normalizeValues([1, [2]], [2, 2]));
    assert.match(message, /shallower/);
});

test('nesting deeper than the shape is reported', () => {
    const message = err(normalizeValues([[[1], [2]], [[3], [4]]], [2, 2]));
    assert.match(message, /deeper/);
});

test('the outermost nested length is checked against dimension 0', () => {
    const message = err(normalizeValues([[1, 2]], [2, 2]));
    assert.match(message, /1 entries/);
    assert.match(message, /dimension 0/);
});

// ── coercion and rejection ──

test('non-numeric cells coerce to 0 rather than failing the whole tensor', () => {
    // A bad *cell* is a data problem worth rendering cold; a bad *shape* is an
    // authoring mistake worth refusing. They are deliberately different.
    assert.deepEqual(ok(normalizeValues([['a', null], [undefined, 4]], [2, 2])), [0, 0, 0, 4]);
    assert.deepEqual(ok(normalizeValues([1, NaN, 3, 4], [2, 2])), [1, 0, 3, 4]);
});

test('normalizeValues rejects a non-array', () => {
    for (const bad of [null, undefined, 42, 'values', {}]) {
        assert.match(err(normalizeValues(bad, [2, 2])), /must be an array/);
    }
});

// ── axis labelExpr ──
// The key exists so a lattice whose rows are permuted by a slider can relabel
// itself. A static `labels` array beside live `valueExpr` cells does not merely
// look stale — with a `+` and an `=` drawn between two such lattices it asserts
// an equation the data no longer satisfies.

test('compileAxisLabelExpr ignores an axis without one', () => {
    for (const axis of [undefined, {}, { labels: ['a', 'b'] }, { labelExpr: '' },
                        { labelExpr: '   ' }, { labelExpr: 42 }]) {
        assert.equal(compileAxisLabelExpr(axis as never), null);
    }
});

test('compileAxisLabelExpr returns a node that binds the axis index', () => {
    const fn = compileAxisLabelExpr({ labelExpr: 'row * 2' } as never);
    assert.notEqual(fn, null);
    assert.equal((fn as { evaluate(s: object): unknown }).evaluate({ row: 3 }), 6);
});

test('an axis label may evaluate to a string, which is the point of the key', () => {
    // Numbers alone would only ever restate the index. Text is what lets a row
    // keep saying which token occupies it.
    const fn = compileAxisLabelExpr({ labelExpr: "concat('slot ', idx)" } as never);
    assert.notEqual(fn, null);
    const out = (fn as { evaluate(s: object): unknown }).evaluate({ idx: 2 });
    assert.equal(typeof out, 'string');
    assert.equal(out, 'slot 2');
});

test('a malformed labelExpr degrades to the constant 0, silently', () => {
    // compileExpr does not throw HERE: on a math.js parse failure in an
    // UNTRUSTED scene it returns compile('0'). (It can throw for a trusted
    // scene, where a malformed body reaches `Function(...)` unguarded -- a
    // different path, and not the one this pins.) So a typo does not blank the axis or take the
    // lattice down — every label along it just reads "0". Pinned here because
    // it is the same silent-zero trap valueExpr has, and the failure gives an
    // author no signal beyond the wrong thing being on screen.
    const fn = compileAxisLabelExpr({ labelExpr: 'concat(((' } as never);
    assert.notEqual(fn, null);
    assert.equal((fn as { evaluate(s: object): unknown }).evaluate({ row: 3 }), 0);
});
