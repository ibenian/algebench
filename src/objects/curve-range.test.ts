// Which interval a parametric curve is sampled over — the precedence between
// `rangeExpr` and `range`. `curve-range.ts` imports nothing that runs, so this
// needs no MathBox, no DOM, no math.js and no stubs.
//
// The bug this pins is silent by construction: reading only `range` left a
// curve asking for `0` to `4*pi` drawn to 2π, with no error, because the
// fallback subtracts to a perfectly good number. Only the picture was wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCurveRange } from '/objects/curve-range.js';

type El = Parameters<typeof resolveCurveRange>[0];
const curve = (el: Record<string, unknown>) => ({ type: 'parametric_curve', ...el }) as unknown as El;

/** Just enough math.js to read the intervals a scene actually writes. */
const evaluate = (expr: string): number => {
    const m = expr.match(/^\s*(-?\d*\.?\d*)\s*\*?\s*pi\s*(?:\/\s*(\d+))?\s*$/);
    if (m) return (m[1] === '' || m[1] === undefined ? 1 : Number(m[1]))
        * Math.PI / (m[2] ? Number(m[2]) : 1);
    if (expr.trim() === 'h') return 7;
    const n = Number(expr);
    if (Number.isFinite(n)) return n;
    throw new Error(`no: ${expr}`);
};

test('rangeExpr wins over the default — the bug, exactly', () => {
    // The DNA strands. Read as `range` only, this curve stopped at 2π while the
    // ladder beside it ran to 4π.
    const r = resolveCurveRange(curve({ rangeExpr: ['0', '4*pi'] }), evaluate);
    assert.deepEqual(r, [0, 4 * Math.PI]);
});

test('rangeExpr wins over range when a scene carries both', () => {
    const r = resolveCurveRange(
        curve({ rangeExpr: ['0', '4*pi'], range: [0, 1] }), evaluate);
    assert.deepEqual(r, [0, 4 * Math.PI]);
});

test('a plain numeric range still works', () => {
    assert.deepEqual(resolveCurveRange(curve({ range: [-2, 5] }), evaluate), [-2, 5]);
});

test('no interval at all is a full turn', () => {
    assert.deepEqual(resolveCurveRange(curve({}), evaluate), [0, 2 * Math.PI]);
});

test('an end naming a slider is read, not skipped', () => {
    // This is why `evaluate` is called per build rather than once: the interval
    // itself can move when the reader drags something.
    assert.deepEqual(resolveCurveRange(curve({ rangeExpr: ['0', 'h'] }), evaluate), [0, 7]);
});

test('one end may be a number and the other an expression', () => {
    assert.deepEqual(resolveCurveRange(curve({ rangeExpr: [0, '2*pi'] }), evaluate),
        [0, 2 * Math.PI]);
});

test('an unevaluable end falls back instead of poisoning every sample', () => {
    // `dt` is `(hi - lo) / samples`. A NaN end makes every t NaN, and the whole
    // curve collapses onto the origin — a worse failure than a short curve.
    const r = resolveCurveRange(curve({ rangeExpr: ['0', 'wat('] }), evaluate);
    assert.deepEqual(r, [0, 2 * Math.PI]);
    assert.ok(Number.isFinite(r[1]));
});
