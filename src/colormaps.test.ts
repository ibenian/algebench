// Covers src/colormaps.ts — the scalar→colour ramp behind `tensor`'s cell
// colours and, after this change, behind `polygon`'s `gradient.stops` as well.
//
// colormaps imports parseColor from labels.ts, whose import chain reads `math`
// and `window` at module-eval time. Both are stubbed before the import, as in
// overlay-pure.test.ts; nothing below touches the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

const g = globalThis as unknown as { math: typeof mathjs; window: typeof globalThis };
g.math = mathjs;
g.window ??= globalThis;

const { buildColorMap, buildStopsFn, normalizeColorValue } = await import('/colormaps.js');

const RED = [1, 0, 0];
const BLUE = [0, 0, 1];

/** Compare channel-wise; the interpolator works in floats. */
function assertRgb(actual: number[], expected: number[], msg?: string) {
    assert.equal(actual.length >= 3, true, 'expected an rgb triple');
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(actual[i]! - expected[i]!) < 1e-9, msg || `channel ${i}: ${actual} vs ${expected}`);
    }
}

test('buildStopsFn hits its terminal stops exactly', () => {
    const f = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }]);
    assertRgb(f(0), RED);
    assertRgb(f(1), BLUE);
});

test('buildStopsFn interpolates linearly between two stops', () => {
    const f = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }]);
    assertRgb(f(0.25), [0.75, 0, 0.25]);
    assertRgb(f(0.5), [0.5, 0, 0.5]);
});

test('buildStopsFn clamps rather than extrapolating', () => {
    // Extrapolating an RGB ramp yields out-of-gamut values that three.js
    // saturates silently, which reads as a flat top on a heatmap.
    const f = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }]);
    assertRgb(f(-5), RED);
    assertRgb(f(5), BLUE);
});

test('buildStopsFn sorts unsorted stops', () => {
    const sorted = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }]);
    const unsorted = buildStopsFn([{ t: 1, color: '#0000ff' }, { t: 0, color: '#ff0000' }]);
    assertRgb(unsorted(0.3), sorted(0.3));
});

test('buildStopsFn treats a single stop as a constant colour', () => {
    const f = buildStopsFn([{ t: 0.5, color: '#ff0000' }]);
    assertRgb(f(0), RED);
    assertRgb(f(1), RED);
});

test('buildStopsFn does not divide by zero on coincident stops', () => {
    const f = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 0.5, color: '#00ff00' }, { t: 0.5, color: '#0000ff' }]);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        for (const ch of f(u)) assert.ok(Number.isFinite(ch), `non-finite channel at u=${u}`);
    }
});

test('a returned colour cannot be mutated back into the ramp', () => {
    // The terminal branches return a stop's own array; without .slice() a
    // caller writing into the result would corrupt every later lookup.
    const f = buildStopsFn([{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }]);
    f(0)[0] = 0.123;
    assertRgb(f(0), RED);
});

test('buildColorMap resolves named ramps', () => {
    const viridis = buildColorMap('viridis');
    // Terminal stops of the shipped viridis table.
    assertRgb(viridis(0), [0x44 / 255, 0x01 / 255, 0x54 / 255]);
    assertRgb(viridis(1), [0xfd / 255, 0xe7 / 255, 0x25 / 255]);
});

test('buildColorMap falls back to viridis on an unknown name, without throwing', () => {
    const unknown = buildColorMap('not-a-colormap');
    assertRgb(unknown(0.4), buildColorMap('viridis')(0.4));
});

test('buildColorMap defaults to viridis when the spec is absent', () => {
    assertRgb(buildColorMap(undefined)(0.6), buildColorMap('viridis')(0.6));
});

test('buildColorMap accepts a custom {stops} spec', () => {
    const f = buildColorMap({ stops: [{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }] });
    assertRgb(f(0.5), [0.5, 0, 0.5]);
});

test('a two-stop colorMap equals the equivalent gradient stops', () => {
    // Pins the polygon.ts refactor: gradient.stops and colorMap.stops go
    // through one interpolator, so they must agree.
    const stops = [{ t: 0, color: '#ff0000' }, { t: 1, color: '#0000ff' }];
    assertRgb(buildColorMap({ stops })(0.375), buildStopsFn(stops)(0.375));
});

test('normalizeColorValue maps the default [0,1] domain through unchanged', () => {
    assert.equal(normalizeColorValue(0, undefined), 0);
    assert.equal(normalizeColorValue(0.5, undefined), 0.5);
    assert.equal(normalizeColorValue(1, undefined), 1);
});

test('normalizeColorValue rescales an explicit domain', () => {
    assert.equal(normalizeColorValue(5, [0, 10]), 0.5);
    assert.equal(normalizeColorValue(-1, [-2, 2]), 0.25);
});

test('normalizeColorValue clamps outside the domain', () => {
    assert.equal(normalizeColorValue(-3, [0, 1]), 0);
    assert.equal(normalizeColorValue(99, [0, 1]), 1);
});

test('normalizeColorValue pins a zero-width domain to the cold end', () => {
    assert.equal(normalizeColorValue(7, [3, 3]), 0);
});

test('normalizeColorValue returns null for a non-numeric value', () => {
    // null, not 0 — 0 is a legitimate cold colour, so the caller must be able
    // to tell "low value" from "expression returned something unusable" and
    // keep the previous frame's colour instead.
    assert.equal(normalizeColorValue(NaN, undefined), null);
    assert.equal(normalizeColorValue(Infinity, undefined), null);
    assert.equal(normalizeColorValue('not a number', undefined), null);
    assert.equal(normalizeColorValue({}, undefined), null);
});

test('normalizeColorValue ignores a malformed domain rather than failing', () => {
    assert.equal(normalizeColorValue(0.5, [NaN, 2]), 0.5);
    assert.equal(normalizeColorValue(0.5, [0]), 0.5);
    assert.equal(normalizeColorValue(0.5, 'nonsense'), 0.5);
});
