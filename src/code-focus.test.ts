import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusMatches } from './code-focus.js';

test('focus matches a reference inside the selected range of the same file', () => {
    const focus = { fileId: 'consumer', first: 10, last: 12 };
    assert.equal(focusMatches([{ fileId: 'consumer', line: 11 }], focus), true);
    assert.equal(focusMatches([{ fileId: 'consumer', line: 13 }], focus), false);
    assert.equal(focusMatches([{ fileId: 'producer', line: 11 }], focus), false);
    assert.equal(focusMatches([null, { fileId: 'consumer', line: 10 }], focus), true);
    assert.equal(focusMatches([{ fileId: 'consumer', line: 11 }], null), false);
});
