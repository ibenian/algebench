import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unionBoxes, boxOfPoints, fitBox, needsRefocus, type Basis, type Box } from './focus-frame.js';

// Looking down −z at the xy plane, as the lesson boards are viewed.
const basis: Basis = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
const fov = Math.PI / 4, aspect = 1.6;
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ min: [x0, y0, 0], max: [x1, y1, 0] });
const opts = { margin: 0.3, minHalfHeight: 1, maxDistance: 1000 };

test('union and point boxes', () => {
    assert.equal(unionBoxes([null, undefined]), null);
    assert.deepEqual(unionBoxes([box(0, 0, 1, 1), null, box(-2, 3, 0, 4)]), { min: [-2, 0, 0], max: [1, 4, 0] });
    assert.deepEqual(boxOfPoints([[1, 2, 0], [3, -1, 0]], 0.5), { min: [0.5, -1.5, -0.5], max: [3.5, 2.5, 0.5] });
    assert.equal(boxOfPoints([]), null);
});

test('fitBox centres the box and backs off so it fits with margin', () => {
    const f = fitBox(box(-4, -2, 4, 2), basis, fov, aspect, opts);
    assert.deepEqual(f.center, [0, 0, 0]);
    // Width-limited: half-width 4 / aspect 1.6 = 2.5 > half-height 2.
    assert.ok(Math.abs(f.distance - (2.5 * 1.3) / Math.tan(fov / 2)) < 1e-9);
});

test('fitBox never zooms closer than the minimum half-height, nor further than the maximum', () => {
    const tiny = fitBox(box(0, 0, 0.1, 0.1), basis, fov, aspect, opts);
    assert.ok(Math.abs(tiny.distance - 1.3 / Math.tan(fov / 2)) < 1e-9);
    assert.equal(fitBox(box(-500, -500, 500, 500), basis, fov, aspect, { ...opts, maxDistance: 50 }).distance, 50);
});

test('needsRefocus: stays put while the changes sit comfortably in view at about the right zoom', () => {
    const b = box(-1, -1, 1, 1);
    const next = fitBox(b, basis, fov, aspect, opts);
    // Camera already at about the fitted distance, centred: no move.
    assert.equal(needsRefocus([0, 0, 0], next.distance * 1.1, next, b, basis, fov, aspect), false);
});

test('needsRefocus: zooms in when the changes would sit well inside the view', () => {
    const b = box(-1, -1, 1, 1);
    const next = fitBox(b, basis, fov, aspect, opts);
    assert.equal(needsRefocus([0, 0, 0], next.distance * 1.4, next, b, basis, fov, aspect), true);
});

test('needsRefocus: moves when the changes leave the central view, or become small on screen', () => {
    const b = box(10, 10, 12, 12);
    const next = fitBox(b, basis, fov, aspect, opts);
    assert.equal(needsRefocus([0, 0, 0], 8, next, b, basis, fov, aspect), true, 'off-centre box outside the view');
    const small = box(-0.5, -0.5, 0.5, 0.5);
    assert.equal(needsRefocus([0, 0, 0], 60, fitBox(small, basis, fov, aspect, opts), small, basis, fov, aspect), true, 'far too far away');
});
