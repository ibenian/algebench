// Coordinate conversion round-trips.
//
// This file also exercises the `node --test` resolve hook added in phase 4.0
// (scripts/node-test-resolver.mjs): both specifiers below are
// SERVER-ROOT-ABSOLUTE (`/coords.js`, `/state.js`) — Node cannot resolve those
// on its own — and `/coords.js` is backed by src/coords.ts, so the hook must
// also prefer the .ts source and Node must strip its types.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dataToWorld, dataCameraToWorld, worldCameraToData, dataLenToWorld,
         isotropicScale, isDefaultScale } from '/coords.js';
import type { Vec3 } from '/coords.js';
import { state } from '/state.js';

/**
 * Set the module-level range/scale coords.ts reads through `state`.
 *
 * `range` is nullable here while `state.currentRange` is declared
 * non-nullable — but coords.ts re-reads it as `Range3 | null` and every
 * exported function guards the no-range case, which the tests below exercise
 * on purpose. The cast keeps that disagreement at this single boundary rather
 * than loosening the shared state type, which non-null consumers
 * (src/objects/skybox.ts, src/scene-loader.ts) depend on.
 */
function setView(range: number[][] | null, scale: number[],
                 declared: number[] = scale): void {
  state.currentRange = range as number[][];
  state.currentScale = scale;
  // A scene that declares a `scale` gets it for both, which is what
  // scene-loader does; the isotropic default is the case where they differ.
  state.declaredScale = declared;
}

const UNIT_RANGE = [[-5, 5], [-5, 5], [-5, 5]];
const UNIT_SCALE = [1, 1, 1];

test('dataToWorld maps the range midpoint to the world origin', () => {
  setView(UNIT_RANGE, UNIT_SCALE);
  assert.deepEqual(dataToWorld([0, 0, 0]), [0, 0, 0]);
});

test('dataToWorld maps range endpoints to ±scale', () => {
  setView(UNIT_RANGE, [2, 3, 4]);
  assert.deepEqual(dataToWorld([5, 5, 5]), [2, 3, 4]);
  assert.deepEqual(dataToWorld([-5, -5, -5]), [-2, -3, -4]);
});

test('dataToWorld returns the origin when no range is set', () => {
  setView(null, UNIT_SCALE);
  assert.deepEqual(dataToWorld([1, 2, 3]), [0, 0, 0]);
});

test('worldCameraToData inverts dataCameraToWorld', () => {
  setView([[-4, 6], [-2, 2], [0, 10]], [1, 1, 1]);
  const pt: Vec3 = [3, -1, 7];
  const round = worldCameraToData(dataCameraToWorld(pt));
  // Both are Vec3 tuples, so indices 0..2 are always present.
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(round[i]! - pt[i]!) < 1e-9);
});

test('dataCameraToWorld normalizes uniformly by the largest half-span', () => {
  // z half-span 5 is the largest, so a full x half-span (5) maps to 1.0 too.
  setView([[-5, 5], [-1, 1], [-5, 5]], [1, 1, 1]);
  assert.deepEqual(dataCameraToWorld([5, 1, 5]), [1, 0.2, 1]);
});

test('dataLenToWorld averages the per-axis scale factors', () => {
  setView([[-5, 5], [-5, 5], [-5, 5]], [1, 1, 1]);
  // each axis factor is 2*1/10 = 0.2
  assert.ok(Math.abs(dataLenToWorld(10) - 2) < 1e-9);
});

test('dataLenToWorld still throws when no range is set', () => {
  // Faithful-port check: the JavaScript threw here and the TypeScript keeps a
  // non-null assertion rather than a silent fallback.
  setView(null, UNIT_SCALE);
  assert.throws(() => dataLenToWorld(1), TypeError);
});

// ---- isotropy is the default when a scene does not choose ----------------

/** How many data units one unit of world distance covers, per axis. */
function unitsPerWorld(range: number[][], scale: Vec3): number[] {
    return range.map(([lo, hi], i) => (hi! - lo!) / (2 * scale[i]!));
}

test('a scene with unequal ranges still renders isotropically', () => {
    // `scale` IS the world half-extent of an axis, so a constant [1,1,1] gives
    // every axis the same world size however many data units it spans. A vector
    // (0,0,0) -> (5,1,0) lives in a [6,2,2] range and was drawn at about 45°
    // instead of 11° — its direction, the one thing a vector is for.
    const range = [[-0.5, 5.5], [-0.5, 1.5], [-1, 1]];
    const upw = unitsPerWorld(range, isotropicScale(range));
    assert.ok(Math.max(...upw) - Math.min(...upw) < 1e-9,
        `one data unit must be the same distance on every axis, got ${upw}`);
});

test('the longest axis keeps scale 1, so the scene still fills the frame', () => {
    // Raw widths would work for the ratio and break everything else: a
    // 2200-unit range would put the scene at ±2200 in world space, which the
    // camera transform and getAbstractWidthScale do not expect.
    assert.deepEqual(isotropicScale([[0, 2200], [0, 2200], [0, 200]]), [1, 1, 0.09090909090909091]);
    assert.equal(Math.max(...isotropicScale([[0, 12], [0, 130], [-1, 1]])), 1);
});

test('a cubic range is unchanged, because it was already isotropic', () => {
    assert.deepEqual(isotropicScale([[-5, 5], [-5, 5], [-5, 5]]), [1, 1, 1]);
});

test('a degenerate range falls back rather than collapsing the scene', () => {
    // Width 0 would scale that axis to nothing and flatten everything into a
    // plane; a non-finite one poisons the whole ratio. `compose` cannot produce
    // either — MIN_EXTENT floors every width at 2 — but a hand-authored scene
    // can, so this decides rather than propagates.
    for (const bad of [
        [[0, 0], [0, 5], [0, 5]],          // zero width
        [[5, 0], [0, 5], [0, 5]],          // inverted
        [[0, NaN], [0, 5], [0, 5]],        // non-finite
        [[0, 5], [0, 5]],                  // too few axes
        [[0, 5], [0, 5], [0]],             // malformed pair
    ] as number[][][]) {
        assert.deepEqual(isotropicScale(bad), [1, 1, 1], `${JSON.stringify(bad)}`);
    }
    assert.deepEqual(isotropicScale(null), [1, 1, 1]);
    assert.deepEqual(isotropicScale('nonsense'), [1, 1, 1]);
});

test('an implicit scale does not drag the camera into the scene', () => {
    // The regression that made isotropy unusable. A 2D scene laid out in x-y
    // with a token z depth: range widths [12, 20, 2] give an isotropic scale
    // whose z is 0.1. `dataCameraToWorld` already removes the aspect by
    // normalising on the single largest half-span, so multiplying by that 0.1
    // afterwards reapplied it inverted and pulled a camera 30 units back in z
    // to a tenth of its distance — inside the content it was meant to frame.
    const range = [[-6, 6], [-10, 10], [-1, 1]];
    const iso = isotropicScale(range);
    assert.deepEqual(iso, [0.6, 1, 0.1]);

    setView(range, iso, [1, 1, 1]);
    const withIsotropy = dataCameraToWorld([0, 0, 30]);

    setView(range, [1, 1, 1]);
    assert.deepEqual(withIsotropy, dataCameraToWorld([0, 0, 30]),
        'the camera must land where it did before isotropy changed the content');
    assert.equal(withIsotropy[2], 3);
});

test('a declared scale still steers the camera, so tuned framings survive', () => {
    // 41 published scenes set `scale` and their cameras were placed by eye
    // against that framing. They pass the same array for both, so the per-axis
    // multiply has to keep applying.
    setView([[-5, 5], [-5, 5], [-5, 5]], [1, 0.5, 0.25]);
    assert.deepEqual(dataCameraToWorld([5, 5, 5]), [1, 0.5, 0.25]);
    assert.deepEqual(worldCameraToData([1, 0.5, 0.25]), [5, 5, 5]);
});

test('worldCameraToData inverts the declared scale it was given', () => {
    const range = [[-6, 6], [-10, 10], [-1, 1]];
    setView(range, isotropicScale(range), [1, 1, 1]);
    const roundTripped = worldCameraToData(dataCameraToWorld([2, -3, 30]));
    roundTripped.forEach((v, i) => assert.ok(Math.abs(v - [2, -3, 30][i]!) < 1e-9, `${roundTripped}`));
});

test('a literal [1,1,1] reads as unspecified, not as a decision', () => {
    // 37 of 41 scenes "declaring" a scale declare exactly this — the legacy
    // default written out. fourier-series drew its unit circle 2.8x taller than
    // wide because of it.
    assert.equal(isDefaultScale([1, 1, 1]), true);
    assert.equal(isDefaultScale([1.0, 1, 1]), true);
});

test('a scale that says something is still honoured', () => {
    // artemis-ii declares [25, 12, 4] against widths [50, 24, 8] — 1 world unit
    // per data unit. Already isotropic, and must stay at its own magnitude.
    assert.equal(isDefaultScale([25, 12, 4]), false);
    assert.equal(isDefaultScale([1, 1, 0.5]), false);
    assert.equal(isDefaultScale([1, 1]), false);
    assert.equal(isDefaultScale(null), false);
    assert.equal(isDefaultScale('1,1,1'), false);
});
