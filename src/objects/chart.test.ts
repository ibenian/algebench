// Covers the pure layer of src/objects/chart.ts: tick placement, automatic
// domains and tick formatting. The renderer itself needs a scene; these are
// the decisions it makes before drawing anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

const g = globalThis as unknown as { math: typeof mathjs; window: typeof globalThis };
g.math = mathjs;
g.window ??= globalThis;

const { niceTicks, autoDomain, formatTick, axisLabelList, staticTickLabel } = await import('/objects/chart.js');

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

const { affineMissSampled, rightAxisDomain, rightAxisPlace } = await import('/objects/chart.js');

// The two decisions the right axis makes beyond the affine check: deriving its
// domain from a transform, and placing a value from that domain back onto the
// plot. Both are what `sample()` and the draw loop call, so a regression in
// either now fails here rather than silently mislabelling an axis.

const C_TO_F = (v: number): number => v * 9 / 5 + 32;

test('rightAxisDomain maps the primary endpoints through the transform', () => {
    // 0..40 C -> 32..104 F, the demo's own pairing.
    assert.deepEqual(rightAxisDomain(C_TO_F, [0, 40]), [32, 104]);
});

test('rightAxisDomain retires the axis when an endpoint will not evaluate', () => {
    // A slider-driven denominator reaching zero: the transform yields a
    // non-finite value, and the axis must go rather than keep a stale scale.
    assert.equal(rightAxisDomain(() => null, [0, 40]), null);
    assert.equal(rightAxisDomain((v) => v / 0, [0, 40]), null);
    assert.equal(rightAxisDomain((v) => (v === 0 ? 1 : NaN), [0, 40]), null);
    // Degenerate: a constant transform has no rows to distinguish.
    assert.equal(rightAxisDomain(() => 7, [0, 40]), null);
});

test('rightAxisPlace inverts the mapping onto the plot', () => {
    const dom: readonly [number, number] = [32, 104];
    assert.equal(rightAxisPlace(32, dom, 100), 0);      // bottom
    assert.equal(rightAxisPlace(104, dom, 100), 100);   // top
    assert.equal(rightAxisPlace(68, dom, 100), 50);     // 20 C, halfway
});

test('rightAxisPlace handles a descending transform', () => {
    // Negative slope: dom is [f(yLo), f(yHi)], so the fraction simply inverts
    // and the axis reads downward without any special case.
    const dom = rightAxisDomain((v: number) => 100 - v, [0, 40]);
    assert.ok(dom, 'a descending transform still yields a domain');
    // `+ 0` normalises the signed zero a descending domain produces:
    // (100 - 100) / (60 - 100) is -0, which positions identically to 0 and
    // stringifies to "0", so it is an artifact of strict equality, not a bug.
    assert.equal(rightAxisPlace(100, dom, 100) + 0, 0);
    assert.equal(rightAxisPlace(60, dom, 100), 100);
    assert.equal(rightAxisPlace(80, dom, 100), 50);
});

test('rightAxisPlace does not divide by zero on a collapsed domain', () => {
    // rightAxisDomain rejects these, but the helper is defensive on its own.
    assert.equal(Number.isFinite(rightAxisPlace(5, [5, 5], 100)), true);
});

test('a z-transform restretches with its denominator', () => {
    // The demo's own axis: (v - 18) / (1 + k) over 0..40 C. These are the
    // figures the PR quotes, asserted rather than remembered.
    const z = (k: number) => {
        const d = rightAxisDomain((v: number) => (v - 18) / (1 + k), [0, 40]);
        assert.ok(d, `k=${k} must yield a domain`);
        return d;
    };
    const z1 = z(1), z4 = z(4);
    assert.deepEqual(z1.map((n) => +n.toFixed(4)), [-9, 11]);
    assert.deepEqual(z4.map((n) => +n.toFixed(4)), [-3.6, 4.4]);
    // Same rows either way: the bottom of the plot stays the bottom while the
    // number printed beside it changes.
    assert.equal(rightAxisPlace(z1[0], z1, 100), 0);
    assert.equal(rightAxisPlace(z4[0], z4, 100), 0);
});

// A single midpoint sample is not enough to certify an affine transform, so
// the renderer samples several interior points. These pin the cases that
// defeat one sample.

test('affineMissSampled certifies a genuinely affine transform', () => {
    const at = (t: number) => 32 + t * (104 - 32);      // C -> F over 0..40
    assert.equal(affineMissSampled(at, 32, 104), 0);
});

test('affineMissSampled catches a cubic that the midpoint alone misses', () => {
    // value^3 over [-1, 1] is odd-symmetric about the domain's centre, so a
    // MIDPOINT-ONLY check sees no departure at all...
    const at = (t: number) => Math.pow(-1 + t * 2, 3);
    assert.equal(at(0.5) - (-1 + 0.5 * 2), 0, 'the midpoint alone looks affine');
    // ...while an interior tick at 0.5 belongs at 0.125 and would be drawn at
    // 0.5. Sampling several unequal fractions is what catches it.
    const miss = affineMissSampled(at, -1, 1);
    assert.ok(miss !== null && miss > 0.1, `expected a large miss, got ${miss}`);
});

test('affineMissSampled reports null when the transform cannot be sampled', () => {
    // A singularity inside the domain: "cannot verify", not "fine".
    assert.equal(affineMissSampled(() => null, 0, 10), null);
    assert.equal(affineMissSampled((t) => (t === 0.5 ? NaN : t), 0, 10), null);
    assert.equal(affineMissSampled((t) => 1 / (t - 0.5), 0, 10), null);
});

test('affineMissSampled still flags a plainly curved transform', () => {
    const at = (t: number) => Math.pow(t * 40, 2);      // value^2 over 0..40
    const miss = affineMissSampled(at, 0, 1600);
    assert.ok(miss !== null && miss > 0.1, `expected a large miss, got ${miss}`);
});

test('axisLabelList reads a categorical labels array, coercing non-strings to blank', () => {
    assert.deepEqual(axisLabelList({ labels: ['a', 'b', 'c'] }, false), ['a', 'b', 'c']);
    // a stray number must not print itself as a label
    assert.deepEqual(axisLabelList({ labels: ['a', 7, null, 'd'] }, false), ['a', '', '', 'd']);
    assert.equal(axisLabelList({ labels: [] }, false)?.length, 0);
});

test('axisLabelList contributes nothing when the axis has no labels array', () => {
    assert.equal(axisLabelList({}, false), null);
    assert.equal(axisLabelList(undefined, false), null);
    assert.equal(axisLabelList({ labels: 'not an array' }, false), null);
});

test('labelExpr wins over labels, so a declared expression suppresses the array', () => {
    // the schema's rule, and the one tensor.ts follows: reading the array
    // anyway would render a stale list and never evaluate the expression
    assert.equal(axisLabelList({ labels: ['a', 'b'] }, true), null);
    assert.equal(axisLabelList({ labels: ['a', 'b'] }, false)?.length, 2);
});

test('staticTickLabel maps positionally and leaves the remainder unlabelled', () => {
    const list = ['first', 'second'];
    assert.equal(staticTickLabel(list, 0), 'first');
    assert.equal(staticTickLabel(list, 1), 'second');
    // too few labels: the rest are blank, not undefined and not recycled
    assert.equal(staticTickLabel(list, 2), '');
    assert.equal(staticTickLabel(list, 99), '');
    // extra labels are simply never asked for, which is "extra labels ignored"
    assert.equal(staticTickLabel(['a', 'b', 'c'], 1), 'b');
});
