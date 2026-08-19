// Covers the side-effect-free exports of src/overlay.ts:
// getAllElements() (which replays a scene's add/remove list up to a step) and
// resolveInfoContent() (the {{expr}} interpolation in info overlays).
//
// overlay pulls in the whole render stack, which expects `math` (the math.js
// CDN bundle, instantiated by expr.ts) and `window` at module-eval time. Both
// are stubbed before the import; nothing below touches the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

// The stubs stand in for browser globals overlay.ts's import chain reads at
// module-eval time. `globalThis` is typed as the real global, so install them
// through one deliberately loose view of it rather than casting per line.
const g = globalThis as unknown as { math: typeof mathjs; window: typeof globalThis };
g.math = mathjs;
g.window ??= globalThis;

const { state } = await import('/state.js');
const { getAllElements, resolveInfoContent } = await import('/overlay.js');

/** overlay.ts keeps its scene interface module-private; recover it by name. */
type OverlayScene = Parameters<typeof getAllElements>[0];

/**
 * A minimal stand-in for a scene: getAllElements only walks `elements`,
 * `steps[].add` and `steps[].remove`, and only reads `id` / `type` off each
 * entry — the schema's full Element (which requires `type`) is more than the
 * function under test ever looks at. One cast, at the boundary.
 */
function fakeScene(scene: {
  elements?: { id?: string; type?: string }[];
  steps?: {
    add?: { id?: string; type?: string }[];
    remove?: { id?: string; type?: string }[];
  }[];
}): OverlayScene {
  return scene as unknown as OverlayScene;
}

/**
 * A minimal stand-in for the live slider map: resolveInfoContent only reads
 * `.value` off each entry, so the full SceneSlider (min/max/step/label/…) is
 * unnecessary here.
 */
function fakeSliders(sliders: Record<string, { value: number }>): typeof state.sceneSliders {
  return sliders as unknown as typeof state.sceneSliders;
}

test('getAllElements returns just the base elements at step -1', () => {
  const scene = fakeScene({
    elements: [{ id: 'a', type: 'vector' }, { id: 'b', type: 'point' }],
    steps: [{ add: [{ id: 'c', type: 'line' }] }],
  });
  assert.deepEqual(getAllElements(scene, -1).map(e => e.id), ['a', 'b']);
});

test('getAllElements accumulates each step\'s additions in order', () => {
  const scene = fakeScene({
    elements: [{ id: 'a' }],
    steps: [{ add: [{ id: 'b' }] }, { add: [{ id: 'c' }, { id: 'd' }] }],
  });
  assert.deepEqual(getAllElements(scene, 0).map(e => e.id), ['a', 'b']);
  assert.deepEqual(getAllElements(scene, 1).map(e => e.id), ['a', 'b', 'c', 'd']);
});

test('getAllElements applies a step\'s removes by id and by type', () => {
  const scene = fakeScene({
    elements: [{ id: 'a', type: 'vector' }, { id: 'b', type: 'point' }, { id: 'c', type: 'point' }],
    steps: [
      { remove: [{ id: 'a' }] },
      { remove: [{ type: 'point' }] },
    ],
  });
  assert.deepEqual(getAllElements(scene, 0).map(e => e.id), ['b', 'c']);
  assert.deepEqual(getAllElements(scene, 1).map(e => e.id), []);
});

test('getAllElements treats remove:* as clearing everything so far', () => {
  const scene = fakeScene({
    elements: [{ id: 'a' }, { id: 'b' }],
    steps: [{ remove: [{ id: '*' }], add: [{ id: 'fresh' }] }],
  });
  // The wildcard clears what came before; this step's own add survives.
  assert.deepEqual(getAllElements(scene, 0).map(e => e.id), ['fresh']);
});

test('getAllElements tolerates a scene with no steps', () => {
  assert.deepEqual(getAllElements(fakeScene({ elements: [{ id: 'a' }] }), 3).map(e => e.id), ['a']);
  assert.deepEqual(getAllElements(fakeScene({}), 0), []);
});

test('resolveInfoContent evaluates {{expr}} against the live sliders', () => {
  const saved = state.sceneSliders;
  state.sceneSliders = fakeSliders({ v: { value: 3 }, w: { value: 4 } });
  try {
    assert.equal(resolveInfoContent('speed = {{v}}'), 'speed = 3');
    assert.equal(resolveInfoContent('{{v + w}}'), '7');
    // Formatting: integers stay bare, floats are trimmed to 3 decimals.
    assert.equal(resolveInfoContent('{{v / w}}'), '0.75');
    // Unknown identifiers degrade to '?' rather than leaking template text.
    assert.equal(resolveInfoContent('{{nosuchslider}}'), '?');
  } finally {
    state.sceneSliders = saved;
  }
});

test('resolveInfoContent leaves single-brace groups untouched', () => {
  const saved = state.sceneSliders;
  state.sceneSliders = fakeSliders({ v: { value: 2 } });
  try {
    // Single braces are LaTeX, not bindings — only {{…}} is evaluated.
    assert.equal(resolveInfoContent('\\frac{v}{2} and {{v}}'), '\\frac{v}{2} and 2');
  } finally {
    state.sceneSliders = saved;
  }
});

test('resolveInfoContent passes through content with no bindings', () => {
  assert.equal(resolveInfoContent('plain text'), 'plain text');
  assert.equal(resolveInfoContent(''), '');
});
