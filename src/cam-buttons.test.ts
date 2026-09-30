// findCamButton — the camera-view lookup behind deep links, the camera presets
// and the agent's set_camera. Keys carry selector metacharacters, so the
// lookup must match them exactly and never throw on a hostile one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCamButton } from './cam-buttons.js';

/**
 * A stand-in root whose querySelectorAll behaves like the DOM's: it parses
 * its selector strictly and throws on anything it doesn't understand. The
 * lookup must only ever ask it for the plain '.cam-btn' — a key spliced into a
 * selector (the old `[data-view="${cv}"]`) would reach the throw below.
 */
function root(keys: string[]) {
    const buttons = keys.map((view) => ({ dataset: { view } }));
    const queries: string[] = [];
    return {
        queries,
        buttons,
        querySelectorAll(sel: string) {
            queries.push(sel);
            if (sel !== '.cam-btn') throw new SyntaxError(`'${sel}' is not a valid selector`);
            return buttons;
        },
    };
}

const KEYS = ['iso', 'side-(yz)', 'ride:-chased-ship', 'ship-&-photon', 'a\\b', 'x"]', '$money'];

test('a key with selector metacharacters finds exactly its button', () => {
    const r = root(KEYS);
    for (const [i, key] of KEYS.entries()) {
        assert.equal(findCamButton(key, r as unknown as ParentNode), r.buttons[i], key);
    }
    assert.deepEqual([...new Set(r.queries)], ['.cam-btn'], 'the key never reaches a selector');
});

test('a hostile or unknown key selects nothing and does not throw', () => {
    const r = root(['iso', 'side-(yz)']);
    for (const key of ['x"]', '"]), body *', '', 'side-', 'side-(yz) ', 'ISO']) {
        assert.doesNotThrow(() => findCamButton(key, r as unknown as ParentNode));
        assert.equal(findCamButton(key, r as unknown as ParentNode), null, JSON.stringify(key));
    }
});
