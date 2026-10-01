// singleFlightSender — one chat turn at a time, without losing a visible ask.

import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlightSender } from '/chat-flight.js';

/** A stand-in turn: marks the chat busy until the test finishes (or fails) it. */
function rig() {
    let busy = false;
    const sent: Array<{ text: string; silent: boolean }> = [];
    const finishers: Array<(ok: boolean) => void> = [];
    const opts: Array<{ silent: boolean; noTools: boolean }> = [];
    const send = singleFlightSender(() => busy, (text, o) => {
        const { silent } = o;
        opts.push(o);
        busy = true;
        sent.push({ text, silent });
        return new Promise<void>((resolve, reject) => {
            finishers.push((ok) => { busy = false; if (ok) resolve(); else reject(new Error('network')); });
        });
    });
    const finish = async (ok = true) => { finishers.shift()!(ok); await new Promise((r) => setImmediate(r)); };
    return { send, sent, finish, isBusy: () => busy, opts };
}

test('an idle chat sends at once and resolves true when the turn ends', async () => {
    const r = rig();
    const p = r.send('hello');
    assert.deepEqual(r.sent, [{ text: 'hello', silent: false }]);
    await r.finish();
    assert.equal(await p, true);
});

test('a visible ask made mid-turn is queued, then sent when the chat is free', async () => {
    const r = rig();
    const first = r.send('first');
    const second = r.send('Please commentate');
    assert.equal(r.sent.length, 1, 'the second ask does not race the first');
    await r.finish();
    assert.equal(await first, true);
    assert.deepEqual(r.sent.map((s) => s.text), ['first', 'Please commentate']);
    await r.finish();
    assert.equal(await second, true);
    assert.equal(r.isBusy(), false);
});

test('queued asks go out in order, and a repeated one is queued only once', async () => {
    const r = rig();
    void r.send('now');
    const a = r.send('A'), again = r.send('A'), b = r.send('B');
    assert.equal(again, a, 'a double-click shares the queued turn');
    await r.finish();
    await r.finish();
    await r.finish();
    assert.deepEqual(r.sent.map((s) => s.text), ['now', 'A', 'B']);
    assert.deepEqual(await Promise.all([a, b]), [true, true]);
});

test('repeating the ask in flight shares that turn instead of queueing a duplicate', async () => {
    const r = rig();
    const first = r.send('Please commentate');
    const again = r.send('Please commentate');
    assert.equal(again, first, 'a double-click while idle sends once');
    await r.finish();
    assert.equal(await again, true);
    assert.deepEqual(r.sent.map((s) => s.text), ['Please commentate']);
    assert.equal(r.isBusy(), false, 'nothing left queued');
    const later = r.send('Please commentate');
    assert.notEqual(later, first, 'once the turn is over, asking again is a new turn');
    await r.finish();
    assert.deepEqual(r.sent.map((s) => s.text), ['Please commentate', 'Please commentate']);
});

test('a silent ask made mid-turn is turned away with false, never queued', async () => {
    const r = rig();
    void r.send('busy');
    assert.equal(await r.send('hint', { silent: true }), false);
    await r.finish();
    assert.deepEqual(r.sent.map((s) => s.text), ['busy']);
});

test('a failed turn still lets the queue move on', async () => {
    const r = rig();
    const failing = r.send('boom');
    const queued = r.send('next');
    failing.catch(() => undefined);
    await r.finish(false);
    await assert.rejects(failing);
    assert.deepEqual(r.sent.map((s) => s.text), ['boom', 'next']);
    await r.finish();
    assert.equal(await queued, true);
});

test('a text-only (noTools) ask reaches the turn sender as such', async () => {
    const r = rig();
    void r.send('guide me', { silent: true, noTools: true });
    assert.deepEqual(r.opts[0], { silent: true, noTools: true });
    await r.finish();
    void r.send('plain');
    assert.deepEqual(r.opts[1], { silent: false, noTools: false });
    await r.finish();
});

test('a queued text-only ask keeps noTools, and never shares a tool-enabled turn', async () => {
    const r = rig();
    void r.send('busy');                                     // in flight, tools allowed
    const same = r.send('busy', { noTools: true });          // same text, text-only: its own turn
    const queued = r.send('guide', { noTools: true });
    await r.finish();                                        // 'busy' ends → queue moves on
    await r.finish();
    await r.finish();
    assert.deepEqual(r.sent.map((s) => s.text), ['busy', 'busy', 'guide']);
    assert.deepEqual(r.opts.map((o) => o.noTools), [false, true, true]);
    assert.deepEqual(await Promise.all([same, queued]), [true, true]);
});
