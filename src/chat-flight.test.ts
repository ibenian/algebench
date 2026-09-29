// singleFlightSender — one chat turn at a time, without losing a visible ask.

import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlightSender } from '/chat-flight.js';

/** A stand-in turn: marks the chat busy until the test finishes (or fails) it. */
function rig() {
    let busy = false;
    const sent: Array<{ text: string; silent: boolean }> = [];
    const finishers: Array<(ok: boolean) => void> = [];
    const send = singleFlightSender(() => busy, (text, silent) => {
        busy = true;
        sent.push({ text, silent });
        return new Promise<void>((resolve, reject) => {
            finishers.push((ok) => { busy = false; if (ok) resolve(); else reject(new Error('network')); });
        });
    });
    const finish = async (ok = true) => { finishers.shift()!(ok); await new Promise((r) => setImmediate(r)); };
    return { send, sent, finish, isBusy: () => busy };
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
