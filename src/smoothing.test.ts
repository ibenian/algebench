import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Smoother, VectorSmoother, SMOOTHING_MODES } from './smoothing.ts';

function run(s: Smoother, frames: number, dt = 1 / 60): number[] {
    const out: number[] = [];
    for (let i = 0; i < frames; i++) out.push(s.step(dt));
    return out;
}

test('every mode reaches the goal exactly and settles', () => {
    for (const mode of SMOOTHING_MODES) {
        const s = new Smoother(mode);
        s.push(Math.log(2));
        const steps = run(s, 120);
        const total = steps.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - Math.log(2)) < 1e-9, `${mode}: applied ${total}`);
        assert.ok(s.settled, `${mode} settled`);
    }
});

test('no mode overshoots a single push', () => {
    for (const mode of SMOOTHING_MODES) {
        const s = new Smoother(mode);
        s.push(1);
        for (let i = 0; i < 120; i++) { s.step(1 / 60); assert.ok(s.pos <= 1 + 1e-9, `${mode} overshot: ${s.pos}`); }
    }
});

test('same total zoom at 25 fps and 120 fps', () => {
    for (const mode of SMOOTHING_MODES) {
        const a = new Smoother(mode), b = new Smoother(mode);
        a.push(0.7); b.push(0.7);
        const ta = run(a, 50, 1 / 25).reduce((x, y) => x + y, 0);
        const tb = run(b, 240, 1 / 120).reduce((x, y) => x + y, 0);
        assert.ok(Math.abs(ta - tb) < 1e-9, mode);
    }
});

test('spring and min-jerk keep velocity continuous across a retarget', () => {
    for (const mode of ['spring', 'min-jerk'] as const) {
        const s = new Smoother(mode);
        s.push(0.5);
        run(s, 4);
        const before = s.vel;
        s.push(0.5);
        s.step(1e-4);
        assert.ok(Math.abs(s.vel - before) < Math.abs(before) * 0.1 + 1e-3, `${mode}: ${before} -> ${s.vel}`);
    }
});

test('halt stops motion where it is', () => {
    const s = new Smoother('spring');
    s.push(1);
    run(s, 3);
    s.halt();
    assert.equal(s.step(1 / 60), 0);
    assert.ok(s.settled);
});

test('VectorSmoother moves every component to its goal together', () => {
    const v = new VectorSmoother('min-jerk');
    v.push(1, -2, 0.5);
    const sum = [0, 0, 0];
    for (let i = 0; i < 60; i++) v.step(1 / 60).forEach((d, k) => { sum[k]! += d; });
    assert.deepEqual(sum.map(x => +x.toFixed(9)), [1, -2, 0.5]);
    assert.ok(v.settled);
});
