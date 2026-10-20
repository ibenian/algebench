import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuPlacement } from '/menu-placement.js';

test('a menu that fits opens aligned with its button', () => {
    assert.deepEqual(menuPlacement(100, 220, 0, 600), {offset: 0, maxWidth: 584});
});

test('near the right edge it shifts left just enough to stay inside', () => {
    // Button at 500 in a panel ending at 600: the menu's right edge stops at 592.
    assert.equal(menuPlacement(500, 220, 0, 600).offset, 372 - 500);
});

test('it never goes past the left edge, which is what clipped it before', () => {
    // A panel from 300 to 560 with the button at 480: right-aligning a 220 px menu would start at 268 (< 300).
    const {offset} = menuPlacement(480, 220, 300, 560);
    assert.equal(480 + offset, 332, 'inside the left edge (300 + 8), and its right edge at 552 is inside too');
    // Narrower than the menu: it starts at the left margin and is narrowed to the room.
    assert.deepEqual(menuPlacement(380, 220, 300, 500), {offset: 308 - 380, maxWidth: 184});
});
