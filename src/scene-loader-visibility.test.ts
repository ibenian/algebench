// Covers the hide/show path of src/scene-loader.ts — hideElementById,
// showElementById and the fades they drive — plus the undo bookkeeping that
// decides whether a removal is still in force (#626, #635).
//
// The module is loaded the way scene-loader-pure.test.ts loads it: `math` and
// `window` stubbed before the import. On top of that this file owns the clock:
// requestAnimationFrame queues callbacks that a `frames()` helper drains against
// a fake performance.now, so a 200 ms fade-out or 350 ms fade-in runs to
// completion deterministically, and "a show that arrives mid-fade" is a real
// interleaving rather than a race.
//
// Meshes are plain objects shaped like what the fades touch: `visible`,
// `material.opacity`, `material.transparent`, `userData`. Nothing here needs
// three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

(globalThis as unknown as { math: typeof mathjs }).math = mathjs;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

// ----- fake animation clock -----

let now = 0;
let queue: Array<(t: number) => void> = [];
const realNow = performance.now.bind(performance);
type RafGlobal = { requestAnimationFrame?: (cb: (t: number) => void) => number };
const rafGlobal = globalThis as unknown as RafGlobal;
const realRaf = rafGlobal.requestAnimationFrame;   // undefined under node; restored as such
Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
rafGlobal.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };

/** Advance the clock by `ms` in `stepMs` frames, running every queued callback. */
function frames(ms: number, stepMs = 16): void {
    const end = now + ms;
    while (now < end) {
        now = Math.min(now + stepMs, end);
        const batch = queue; queue = [];
        for (const cb of batch) cb(now);
    }
}

const { hideElementById, showElementById, removalsStillInForce } = await import('/scene-loader.js');
const { state } = await import('/state.js');

// ----- fixtures -----

type FakeMesh = {
    visible: boolean;
    _hiddenByRemove?: boolean;
    material: { opacity: number; transparent: boolean };
    userData: Record<string, unknown>;
};

function mesh(opacity: number): FakeMesh {
    return { visible: true, material: { opacity, transparent: true }, userData: {} };
}

function register(id: string, planes: FakeMesh[], animState?: { stopped: boolean; hiddenByRemove?: boolean }) {
    const tracker = {
        group: null,
        arrowMeshes: [], labels: [], planeMeshes: planes,
        lineNodes: [], vectorLineNodes: [], axisLineNodes: [], pointNodes: [],
    };
    state.elementRegistry[id] = { tracker, hidden: false, animState: animState ?? null };
    return tracker;
}

test.beforeEach(() => {
    now = 0; queue = [];
    state.elementRegistry = {};
});
test.after(() => {
    Object.defineProperty(performance, 'now', { configurable: true, value: realNow });
    if (realRaf) rafGlobal.requestAnimationFrame = realRaf;
    else delete rafGlobal.requestAnimationFrame;
});

// ----- hide / show -----

test('hide fades a plane mesh out and show brings it back to the opacity it had', () => {
    const m = mesh(0.95);
    register('tensor', [m]);

    hideElementById('tensor');
    assert.equal(m.visible, false, 'hidden immediately');
    assert.equal(m._hiddenByRemove, true);
    assert.equal(m.userData.opacityBeforeHide, 0.95, 'resting opacity recorded before the fade');
    frames(250);
    assert.equal(m.material.opacity, 0, 'faded out');

    showElementById('tensor');
    assert.equal(m.visible, true);
    assert.equal(m._hiddenByRemove, false);
    assert.equal(m.userData.opacityBeforeHide, undefined, 'consumed by show');
    frames(400);
    assert.ok(Math.abs(m.material.opacity - 0.95) < 1e-9, `faded back in to 0.95, got ${m.material.opacity}`);
});

test('a hide that lands while a fade-in is still ramping records the fade target, not the 0 it started from', () => {
    // A forward jump runs several steps in one synchronous loop: the element's
    // fade-in has already set opacity to 0 and published its target when the
    // next step's hide arrives.
    const m = mesh(0);
    m.userData.fadeInTarget = 0.95;
    register('tensor', [m]);

    hideElementById('tensor');
    assert.equal(m.userData.opacityBeforeHide, 0.95);

    frames(250);
    showElementById('tensor');
    frames(400);
    assert.ok(Math.abs(m.material.opacity - 0.95) < 1e-9, `got ${m.material.opacity}`);
});

test('a show that overtakes a hide wins: the fade-out never stamps the mesh invisible', () => {
    const m = mesh(0.8);
    register('poly', [m]);

    hideElementById('poly');
    frames(50);                      // fade-out under way, 150 ms to go
    showElementById('poly');
    frames(400);                     // past both the fade-out's and the fade-in's end

    assert.equal(m.visible, true);
    assert.equal(m._hiddenByRemove, false);
    assert.ok(Math.abs(m.material.opacity - 0.8) < 1e-9, `got ${m.material.opacity}`);
});

test('hide and show flip the hidden flag on an element with a per-frame updater', () => {
    // An animated_vector born at zero length has no meshes to flag; its updater
    // reads this instead, before it creates anything.
    const anim: { stopped: boolean; hiddenByRemove?: boolean } = { stopped: false };
    register('vec', [], anim);

    hideElementById('vec');
    assert.equal(anim.hiddenByRemove, true);
    showElementById('vec');
    assert.equal(anim.hiddenByRemove, false);
});

test('hide and show are idempotent on the registry state', () => {
    const m = mesh(0.5);
    register('x', [m]);
    showElementById('x');            // not hidden: no-op
    assert.equal(m.material.opacity, 0.5);
    hideElementById('x');
    hideElementById('x');            // already hidden: no second snapshot
    assert.equal(m.userData.opacityBeforeHide, 0.5);
});

// ----- undo bookkeeping -----

test('a removal by an earlier step stays in force when a later step is undone', () => {
    const s2 = { removedIds: ['a'] };
    const s5 = { removedIds: ['a'] };
    assert.deepEqual([...removalsStillInForce([{}, s2, {}, s5], s5)], ['a']);
});

test('a step that re-declares an id clears earlier removals of it', () => {
    // The transformer lesson: tensor declared at step 2, removed at step 3,
    // declared again at step 5, removed at step 8. Undoing step 8 must bring
    // the step-5 copy back, so step 3's removal no longer counts.
    const s1 = { elementIds: ['tensor'] };
    const s2 = { removedIds: ['tensor'] };
    const s4 = { elementIds: ['tensor'] };
    const s7 = { removedIds: ['tensor'] };
    assert.deepEqual([...removalsStillInForce([{}, s1, s2, {}, s4, {}, {}, s7], s7)], []);
    // Undoing step 3 itself: nothing before it removed the id.
    assert.deepEqual([...removalsStillInForce([{}, s1, s2, {}, s4, {}, {}, s7], s2)], []);
});

test('only trackers before the one being undone count', () => {
    const s1 = { removedIds: ['a'] };
    const s3 = { removedIds: ['b'] };
    const later = { removedIds: ['c'] };
    assert.deepEqual([...removalsStillInForce([s1, {}, s3, later], s3)], ['a']);
});
