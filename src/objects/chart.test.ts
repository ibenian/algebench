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

test('a label goes where it fits, and out of the way of one already placed', async () => {
    const { makeLabelOccupancy, chooseLabelPlacement } = await import('/objects/chart.js');
    const plot = { left: 0, top: 0, right: 200, bottom: 200 };
    // Two candidates: above the point, then below it.
    const candidates = [{ left: 100, top: 90, tag: 'above' }, { left: 100, top: 120, tag: 'below' }];
    const occ = makeLabelOccupancy(20);

    // Nothing placed yet: the first candidate wins.
    const first = chooseLabelPlacement(candidates, 20, 10, plot, 0, occ);
    assert.equal(first.tag, 'above');
    occ.add({ left: first.left, top: first.top, right: first.left + 20, bottom: first.top + 10 });

    // A second label at the same point must not sit on top of it.
    assert.equal(chooseLabelPlacement(candidates, 20, 10, plot, 0, occ).tag, 'below');
});

test('a label outside the plot is rejected, and one that fits nowhere still gets a position', async () => {
    const { makeLabelOccupancy, chooseLabelPlacement } = await import('/objects/chart.js');
    const occ = makeLabelOccupancy(20);
    const plot = { left: 0, top: 0, right: 100, bottom: 100 };

    // First candidate hangs off the right edge; the second is inside.
    const escaped = [{ left: 95, top: 10, tag: 'out' }, { left: 10, top: 10, tag: 'in' }];
    assert.equal(chooseLabelPlacement(escaped, 20, 10, plot, 0, occ).tag, 'in');

    // Nothing fits: the first candidate is returned rather than the label
    // being dropped, so a cramped chart still says what its points are.
    const allOut = [{ left: -50, top: 10, tag: 'a' }, { left: 500, top: 10, tag: 'b' }];
    assert.equal(chooseLabelPlacement(allOut, 20, 10, plot, 0, occ).tag, 'a');
});

test('startAt rotates the preference order so a row of points does not stack one way', async () => {
    const { makeLabelOccupancy, chooseLabelPlacement } = await import('/objects/chart.js');
    const plot = { left: 0, top: 0, right: 500, bottom: 500 };
    const cands = [{ left: 10, top: 10, tag: 'a' }, { left: 60, top: 10, tag: 'b' }, { left: 110, top: 10, tag: 'c' }];
    for (const [startAt, expected] of [[0, 'a'], [1, 'b'], [2, 'c'], [3, 'a'], [-1, 'c']] as const) {
        assert.equal(chooseLabelPlacement(cands, 20, 10, plot, startAt, makeLabelOccupancy(20)).tag, expected,
            `startAt ${startAt}`);
    }
});

test('the occupancy grid answers exactly what a full scan would', async () => {
    const { makeLabelOccupancy, LABEL_GAP_PX } = await import('/objects/chart.js');
    // The grid exists for speed, so its whole job is to be indistinguishable
    // from the O(n^2) scan it replaced. Pin that against a brute-force list.
    const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const occ = makeLabelOccupancy(20);
    const g = LABEL_GAP_PX;
    const brute = (b: { left: number; top: number; right: number; bottom: number }) =>
        boxes.some(o => b.left < o.right + g && b.right + g > o.left
            && b.top < o.bottom + g && b.bottom + g > o.top);

    // A deterministic pseudo-random spread, including boxes that span cells
    // and boxes far apart.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 400; n++) {
        const left = Math.round(rnd() * 600) - 100, top = Math.round(rnd() * 600) - 100;
        const box = { left, top, right: left + Math.round(rnd() * 60) + 4, bottom: top + Math.round(rnd() * 30) + 4 };
        assert.equal(occ.overlaps(box), brute(box), `box ${n}: ${JSON.stringify(box)}`);
        if (!brute(box)) { occ.add(box); boxes.push(box); }
    }
    assert.ok(boxes.length > 20, 'expected the spread to place a meaningful number of boxes');
});

// --- right-hand axes -------------------------------------------------------
// A right axis relabels the primary y through a transform, and is drawn from
// that transform's value at the two domain endpoints. That is exact for an
// affine map and wrong in the middle for anything else, so the renderer
// measures the departure and warns once. These pin the measure.

const { affineMiss } = await import('/objects/chart.js');

test('affineMiss is zero for an affine transform', () => {
    // C -> F over 0..40 C: 32, 68, 104. The midpoint is exactly halfway.
    assert.equal(affineMiss(32, 68, 104), 0);
    // A z-scale: (v - 18) / 3 over 0..40.
    assert.equal(affineMiss(-6, 0.6666666666666666, 7.333333333333333) < 1e-12, true);
    // Negative slope is still affine.
    assert.equal(affineMiss(100, 50, 0), 0);
});

test('affineMiss catches a curved transform', () => {
    // v^2 over 0..40 -> 0, 400, 1600. Halfway would be 800; it is 400.
    assert.equal(affineMiss(0, 400, 1600), 0.25);
    // log10 over 1..100 -> 0, log10(50)=1.699, 2. Halfway would be 1.
    assert.ok(affineMiss(0, Math.log10(50), 2) > 0.3);
});

test('affineMiss is defined on a degenerate or unusable span', () => {
    assert.equal(affineMiss(5, 5, 5), 0);          // zero span: nothing to mislabel
    assert.equal(affineMiss(0, NaN, 10), 0);       // a refused midpoint accuses nobody
    assert.equal(affineMiss(0, Infinity, 10), 0);
});
