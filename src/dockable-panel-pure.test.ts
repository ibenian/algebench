// Covers resolvePlacement(), the one rule that decides where a dockable panel
// opens: the viewer's stored placement, or the corner the scene asked for.
//
// dockable-panel.ts is DOM-heavy, but resolvePlacement is pure and imports
// nothing; the stub below only satisfies its import chain at module-eval time.
import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as { window: typeof globalThis };
g.window ??= globalThis;

const { resolvePlacement } = await import('/dockable-panel.js');

test('a panel the viewer never dragged follows the scene default, one they placed does not', async () => {
    // Nothing stored: the scene decides, with no offsets to apply.
    assert.deepEqual(resolvePlacement(null, 'bottom-left'), { corner: 'bottom-left', h: null, v: null });

    // Stored, but h/v are null — the viewer never dragged it, so the stored
    // corner is only the scene's OLD default and the new one wins. This is
    // what lets a card that used to cover the camera controls move away for
    // viewers who have already opened the scene.
    assert.deepEqual(resolvePlacement({ corner: 'top-left', h: null, v: null }, 'bottom-left'),
        { corner: 'bottom-left', h: null, v: null });
    assert.deepEqual(resolvePlacement({ corner: 'top-left', h: null, v: null, collapsed: true }, 'bottom-left'),
        { corner: 'bottom-left', h: null, v: null });

    // Dragged: a drag writes both offsets, and that placement outranks the
    // scene. Zero is a placement, not an absence.
    assert.deepEqual(resolvePlacement({ corner: 'bottom-right', h: 0, v: 0 }, 'bottom-left'),
        { corner: 'bottom-right', h: 0, v: 0 });
    assert.deepEqual(resolvePlacement({ corner: 'top-left', h: 12, v: 40 }, 'bottom-left'),
        { corner: 'top-left', h: 12, v: 40 });
});

test('half a placement, or one measured from a corner that is not a corner, is discarded whole', async () => {
    // A drag never writes a lone offset, so a blob carrying one is incomplete.
    // Keeping it would let applyGeom render the missing coordinate as the
    // string "nullpx" and lose the anchor.
    assert.deepEqual(resolvePlacement({ corner: 'top-left', h: 12, v: null }, 'bottom-left'),
        { corner: 'bottom-left', h: null, v: null });
    assert.deepEqual(resolvePlacement({ corner: 'top-left', h: null, v: 40 }, 'bottom-left'),
        { corner: 'bottom-left', h: null, v: null });

    // localStorage is viewer-writable. An offset means nothing without the
    // corner it was measured from, so rejecting the corner drops the offsets
    // with it rather than applying 9px against a corner nobody chose.
    assert.deepEqual(resolvePlacement({ corner: 'middle', h: 9, v: 9 }, 'bottom-left'),
        { corner: 'bottom-left', h: null, v: null });
    assert.deepEqual(resolvePlacement({ corner: 'middle', h: 9, v: 9 }, 'nowhere'),
        { corner: 'top-left', h: null, v: null });

    // A scene asking for nonsense falls back to a corner the viewer has stored,
    // and to top-left when there is none — still without stale offsets.
    assert.deepEqual(resolvePlacement({ corner: 'bottom-right', h: null, v: null }, 'nowhere'),
        { corner: 'bottom-right', h: null, v: null });
    assert.deepEqual(resolvePlacement(null, 'nowhere'), { corner: 'top-left', h: null, v: null });
});
