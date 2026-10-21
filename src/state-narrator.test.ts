import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createNarrator } from '/state-narrator.js';

function harness() {
    const sent: string[] = []; const prompts: string[] = []; const options: {silent?: boolean; noTools?: boolean}[] = []; let stops = 0; let key: string | null = 's:0';
    let resolveTurn: ((ok: boolean) => void) | null = null;
    (globalThis as any).window = {
        sendChatMessage: (text: string, opts?: {silent?: boolean; noTools?: boolean}) => { sent.push(key!); prompts.push(text); options.push(opts ?? {}); return new Promise<boolean>(r => { resolveTurn = r; }); },
        algebenchStopTTS: () => { stops++; },
    };
    const narrator = createNarrator(() => key, () => `state ${key}`);
    return { narrator, sent, prompts, options, stops: () => stops, setKey: (k: string | null) => { key = k; }, finish: (ok = true) => resolveTurn?.(ok) };
}

test('turning on narrates at once; changes settle, stop speech, and never overlap a turn', async () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness();
        h.narrator.set(true);
        assert.deepEqual(h.sent, ['s:0'], 'sent immediately');
        assert.deepEqual(h.options[0], {silent: true, noTools: true}, 'silent, and no tools: narrating never moves the lesson');
        h.setKey('s:1'); h.narrator.stateChanged(); h.setKey('s:2'); h.narrator.stateChanged();
        assert.equal(h.stops(), 2, 'speech for the old state stops on each change');
        mock.timers.tick(600);
        assert.deepEqual(h.sent, ['s:0'], 'no second request while the first is in flight');
        h.finish(); await Promise.resolve(); await Promise.resolve();
        mock.timers.tick(600);
        assert.deepEqual(h.sent, ['s:0', 's:2'], 'the settled state is sent once after the turn');
        h.narrator.set(false);
        assert.equal(h.stops(), 3, 'turning off stops speech');
        h.setKey('s:3'); h.narrator.stateChanged(); mock.timers.tick(2000);
        assert.deepEqual(h.sent, ['s:0', 's:2'], 'nothing is sent while off');
    } finally { mock.timers.reset(); }
});

test('the request names the current view, and a new view waits longer to settle', async () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
        const h = harness();
        h.narrator.set(true); h.finish(); await Promise.resolve(); await Promise.resolve();
        assert.match(h.prompts[0]!, /now at: state s:0\./);
        h.setKey('t:0'); h.narrator.stateChanged();
        mock.timers.tick(600);
        assert.equal(h.sent.length, 1, 'a scene/step change has not settled after 600 ms');
        mock.timers.tick(600);
        assert.deepEqual(h.sent, ['s:0', 't:0']);
        assert.match(h.prompts[1]!, /now at: state t:0\..*describe this one fresh/);
    } finally { mock.timers.reset(); }
});

test('stepping quickly sends once, after the learner stops; a single step after a pause is quick', async () => {
    mock.timers.enable({apis: ['setTimeout', 'Date']});
    try {
        const h = harness();
        h.narrator.set(true); h.finish(); await Promise.resolve(); await Promise.resolve();
        // The first step after a pause is narrated at once (no way to know a burst follows)...
        h.setKey('s:1'); h.narrator.stateChanged(); mock.timers.tick(250);
        assert.deepEqual(h.sent, ['s:0', 's:1']);
        h.finish(); await Promise.resolve(); await Promise.resolve();
        // ...then scrubbing back and forth every 250 ms sends nothing until it stops.
        for (const k of ['s:2', 's:1', 's:2', 's:3', 's:2']) { h.setKey(k); h.narrator.stateChanged(); mock.timers.tick(250); }
        assert.deepEqual(h.sent, ['s:0', 's:1'], 'no request during the burst');
        mock.timers.tick(2500);
        assert.deepEqual(h.sent, ['s:0', 's:1', 's:2'], 'one request for where the learner stopped');
        h.finish(); await Promise.resolve(); await Promise.resolve();
        mock.timers.tick(5000);
        h.setKey('s:3'); h.narrator.stateChanged();
        mock.timers.tick(100);
        assert.deepEqual(h.sent, ['s:0', 's:1', 's:2', 's:3'], 'after a pause, the next step is narrated within 100 ms');
    } finally { mock.timers.reset(); }
});

test('busy holds until the state on screen is narrated and its speech has had time to start', async () => {
    mock.timers.enable({apis: ['setTimeout', 'Date']});
    try {
        const h = harness();
        assert.equal(h.narrator.busy, false, 'off: never busy');
        h.narrator.set(true);
        assert.equal(h.narrator.busy, true, 'the request is in flight');
        h.finish(); await Promise.resolve(); await Promise.resolve();
        assert.equal(h.narrator.busy, true, 'answered, but speech has not started yet');
        mock.timers.tick(800);
        assert.equal(h.narrator.busy, false, 'answered and past the speech start window');
        h.setKey('s:1'); h.narrator.stateChanged();
        assert.equal(h.narrator.busy, true, 'a new state is not narrated yet');
        mock.timers.tick(100);
        h.finish(); await Promise.resolve(); await Promise.resolve();
        mock.timers.tick(800);
        assert.equal(h.narrator.busy, false);
        // A failed request releases playback rather than holding it forever.
        (globalThis as any).window.sendChatMessage = () => Promise.reject(new Error('offline'));
        mock.timers.tick(5000);
        h.setKey('s:2'); h.narrator.stateChanged();
        assert.equal(h.narrator.busy, true);
        mock.timers.tick(100);
        await Promise.resolve(); await Promise.resolve();
        assert.equal(h.narrator.busy, false, 'failed narration does not block');
    } finally { mock.timers.reset(); }
});
