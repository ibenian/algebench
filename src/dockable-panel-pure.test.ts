// Covers resolveCorner(), the one rule that decides where a dockable panel
// opens: the viewer's stored placement, or the corner the scene asked for.
//
// dockable-panel.ts is DOM-heavy, but resolveCorner is pure and imports
// nothing; the stubs below only satisfy its import chain at module-eval time.
import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as { window: typeof globalThis };
g.window ??= globalThis;

const { resolveCorner } = await import('/dockable-panel.js');

test('a panel the viewer never dragged follows the scene default, one they placed does not', async () => {
    // Nothing stored: the scene decides.
    assert.equal(resolveCorner(null, 'bottom-left'), 'bottom-left');

    // Stored, but h/v are null — the viewer never dragged it, so the stored
    // corner is only the scene's OLD default and the new one wins. This is
    // what lets a card that used to cover the camera controls move away for
    // viewers who have already opened the scene.
    assert.equal(resolveCorner({ corner: 'top-left', h: null, v: null }, 'bottom-left'), 'bottom-left');
    assert.equal(resolveCorner({ corner: 'top-left', h: null, v: null, collapsed: true }, 'bottom-left'), 'bottom-left');

    // Dragged: a drag writes both offsets, and that placement outranks the
    // scene. Zero is a placement, not an absence.
    assert.equal(resolveCorner({ corner: 'bottom-right', h: 0, v: 0 }, 'bottom-left'), 'bottom-right');
    assert.equal(resolveCorner({ corner: 'top-left', h: 12, v: 40 }, 'bottom-left'), 'top-left');

    // Half a placement is not one. A drag never writes a lone offset, so a
    // blob carrying one is incomplete -- and applyGeom would turn the missing
    // coordinate into the string "nullpx" and lose the anchor. Treated as
    // un-dragged, which also sends applyGeom down its CSS-anchoring branch.
    assert.equal(resolveCorner({ corner: 'top-left', h: 12, v: null }, 'bottom-left'), 'bottom-left');
    assert.equal(resolveCorner({ corner: 'top-left', h: null, v: 40 }, 'bottom-left'), 'bottom-left');
});

test('resolveCorner trusts neither a stored corner nor an option that is not a corner', async () => {
    // localStorage is viewer-writable, so a stored value that is not one of
    // CORNERS is discarded rather than reaching the DOM.
    assert.equal(resolveCorner({ corner: 'middle', h: 9, v: 9 }, 'bottom-left'), 'bottom-left');
    assert.equal(resolveCorner({ corner: 'middle', h: 9, v: 9 }, 'nowhere'), 'top-left');

    // A scene asking for nonsense falls back to a placement the viewer has,
    // and to top-left when there is none.
    assert.equal(resolveCorner({ corner: 'bottom-right', h: null, v: null }, 'nowhere'), 'bottom-right');
    assert.equal(resolveCorner(null, 'nowhere'), 'top-left');
});
