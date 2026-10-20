import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSettler } from '/adaptive-settle.js';

function harness(options = {}) {
    let t = 0, runs = 0;
    const settler = createSettler(() => { runs++; }, {now: () => t, ...options});
    const advance = (ms: number) => { t += ms; mock.timers.tick(ms); };
    return {settler, advance, runs: () => runs, at: () => t};
}

test('a transition after a quiet spell runs almost at once', () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness();
        h.settler.poke();
        h.advance(99); assert.equal(h.runs(), 0);
        h.advance(1); assert.equal(h.runs(), 1, 'first transition: 100 ms');
        h.advance(3000);
        h.settler.poke();
        h.advance(100); assert.equal(h.runs(), 2, 'after a pause it is quick again');
    } finally { mock.timers.reset(); }
});

test('a burst waits longer and longer, and runs once when it stops', () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness();
        const waits: number[] = [];
        for (let i = 0; i < 6; i++) { waits.push(h.settler.nextDelay()); h.settler.poke(); h.advance(300); }
        // The first step after a pause cannot know a burst follows, so it runs at once; the rest wait it out.
        assert.equal(h.runs(), 1, 'only the first step of the burst ran');
        assert.equal(waits[0], 100);
        for (let i = 2; i < waits.length; i++) assert.ok(waits[i]! > waits[i - 1]!, `wait grows: ${waits}`);
        h.advance(2500);
        assert.equal(h.runs(), 2, 'one more run once the burst settles');
    } finally { mock.timers.reset(); }
});

test('waits are capped, a floor can raise one, and back-and-forth counts as a burst', () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness({maxMs: 800});
        for (let i = 0; i < 10; i++) { h.settler.poke(); h.advance(50); }
        assert.ok(h.settler.nextDelay() <= 800);
        h.advance(800); assert.equal(h.runs(), 1);
        h.advance(5000);
        h.settler.poke(1200);
        h.advance(1100); assert.equal(h.runs(), 1, 'the floor holds a quick wait back');
        h.advance(100); assert.equal(h.runs(), 2);
    } finally { mock.timers.reset(); }
});

test('after() schedules a retry without counting a transition, and cancel() drops everything', () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness();
        h.settler.after(700);
        assert.equal(h.settler.nextDelay(), 100, 'a retry is not a transition');
        h.advance(700); assert.equal(h.runs(), 1);
        h.settler.poke(); h.settler.after(5000);
        h.advance(100); assert.equal(h.runs(), 2, 'a retry never moves a pending run');
        h.settler.poke(); h.settler.cancel();
        assert.equal(h.settler.pending, false);
        h.advance(3000); assert.equal(h.runs(), 2);
    } finally { mock.timers.reset(); }
});
