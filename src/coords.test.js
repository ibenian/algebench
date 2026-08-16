// Coordinate conversion round-trips.
//
// This file also exercises the `node --test` resolve hook added in phase 4.0
// (scripts/node-test-resolver.mjs): both specifiers below are
// SERVER-ROOT-ABSOLUTE (`/coords.js`, `/state.js`) — Node cannot resolve those
// on its own — and `/coords.js` is backed by src/coords.ts, so the hook must
// also prefer the .ts source and Node must strip its types.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dataToWorld, dataCameraToWorld, worldCameraToData, dataLenToWorld } from '/coords.js';
import { state } from '/state.js';

/** Set the module-level range/scale coords.ts reads through `state`. */
function setView(range, scale) {
  state.currentRange = range;
  state.currentScale = scale;
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
  const pt = [3, -1, 7];
  const round = worldCameraToData(dataCameraToWorld(pt));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(round[i] - pt[i]) < 1e-9);
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
