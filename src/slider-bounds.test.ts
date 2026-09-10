// Covers refreshSliderBounds() — the pass that re-evaluates `minExpr` /
// `maxExpr` and re-clamps the sliders that carry one.
//
// Every case here was found by hand in the browser first; they live here so
// they stay found. The two that matter most are the ones a manual check can
// barely see: a moving `min` shifting the step grid under a value that never
// left the range, and a bounds pass arriving while a slider is animating.
//
// sliders.ts imports expr.ts, which instantiates the math.js CDN bundle at
// module-eval time, so `math` is stubbed before the import — the same setup
// sliders-pure.test.ts uses. Nothing here touches the DOM: refreshSliderBounds
// reaches the panel only through the optional `_onBoundsChange` hook, which
// these fixtures leave unset.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';
import type { SceneSlider } from '/sliders.js';

(globalThis as unknown as { math: typeof mathjs }).math = mathjs;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

const { state } = await import('/state.js');
const { refreshSliderBounds } = await import('/sliders.js');
const { compileExpr } = await import('/expr.js');

/** A scalar slider carrying whatever the case under test needs. */
function slider(over: Partial<SceneSlider> & { minExpr?: string; maxExpr?: string }): SceneSlider {
  const { minExpr, maxExpr, ...rest } = over;
  const s = {
    value: 0, min: 0, max: 10, step: 1, label: 'x', default: undefined,
    kind: 'scalar', shape: null, values: null, defaults: null, _nested: null,
    animate: false, animateMode: 'loop', autoplay: false, duration: 3000,
    _loopPlaying: false, _loopRaf: null,
    _valueExprString: null, _valueExprCompiled: null,
    _minExprString: minExpr ?? null, _maxExprString: maxExpr ?? null,
    _minExprCompiled: minExpr ? compileExpr(minExpr) : null,
    _maxExprCompiled: maxExpr ? compileExpr(maxExpr) : null,
    _staticMin: 0, _staticMax: 10,
    _desired: 0,
    ...rest,
  } as unknown as SceneSlider;
  return s;
}

function withSliders(entries: Record<string, SceneSlider>, fn: () => void): void {
  const saved = state.sceneSliders;
  state.sceneSliders = entries as Record<string, SceneSlider>;
  try { fn(); } finally { state.sceneSliders = saved; }
}

test('a max expression narrows the range and clamps the value into it', () => {
  withSliders({
    n: slider({ value: 4, min: 1, max: 8, _desired: 4 }),
    sel: slider({ value: 3, max: 3, _staticMax: 3, maxExpr: 'n - 1', _desired: 3 }),
  }, () => {
    state.sceneSliders.n!.value = 2;
    assert.equal(refreshSliderBounds(), true);
    assert.equal(state.sceneSliders.sel!.max, 1);
    assert.equal(state.sceneSliders.sel!.value, 1);
  });
});

test('widening the range restores the position the clamp took away', () => {
  withSliders({
    n: slider({ value: 2, min: 1, max: 8, _desired: 2 }),
    sel: slider({ value: 3, max: 3, _staticMax: 3, maxExpr: 'n - 1', _desired: 3 }),
  }, () => {
    refreshSliderBounds();
    assert.equal(state.sceneSliders.sel!.value, 1, 'clamped while the range excludes 3');

    state.sceneSliders.n!.value = 4;
    refreshSliderBounds();
    assert.equal(state.sceneSliders.sel!.max, 3);
    assert.equal(state.sceneSliders.sel!.value, 3, 'the remembered position comes back');
  });
});

test('a moving min re-snaps a value the range still contains', () => {
  // The DOM range input lays its step lattice out from `min`, so a value that
  // never left the range can still fall off the grid when `min` moves. Snapping
  // only on a clamp left s.value where the control could not represent it.
  withSliders({
    k: slider({ value: 3, min: 0, max: 10, _desired: 3 }),
    p: slider({ value: 4, min: 0, max: 10, step: 1, minExpr: 'k * 0.5', _desired: 4 }),
  }, () => {
    refreshSliderBounds();
    assert.equal(state.sceneSliders.p!.min, 1.5);
    assert.equal(state.sceneSliders.p!.value, 4.5, 'snapped onto the grid the new min defines');
  });
});

test('a value forced past max lands on the last grid point inside the range', () => {
  withSliders({
    n: slider({ value: 3.5, min: 0, max: 10, _desired: 3.5 }),
    p: slider({ value: 9, min: 0, max: 10, step: 2, maxExpr: 'n', _desired: 9 }),
  }, () => {
    refreshSliderBounds();
    const p = state.sceneSliders.p!;
    assert.equal(p.max, 3.5);
    assert.ok(p.value <= p.max, 'never above the live max');
    assert.equal(p.value, 2, 'the grid point below max, not max itself');
  });
});

test('an animating slider is not dragged to _desired by someone else’s refresh', () => {
  // Both animation kinds, for opposite reasons. A sweep would be yanked back to
  // a pre-sweep request; a tween — whose _desired is already its destination —
  // would jump straight to the end and drop the frames it exists to show.
  for (const flag of ['_loopPlaying', '_tweening'] as const) {
    withSliders({
      n: slider({ value: 8, min: 1, max: 8, _desired: 8 }),
      a: slider({
        value: 5, min: 0, max: 10, maxExpr: 'n', _desired: 9,
        [flag]: true,
      } as Partial<SceneSlider>),
    }, () => {
      refreshSliderBounds();
      assert.equal(state.sceneSliders.a!.value, 5, `${flag}: mid-animation position kept`);
    });
  }
});

test('an animating slider is still clamped when its range excludes it', () => {
  withSliders({
    n: slider({ value: 3, min: 1, max: 8, _desired: 3 }),
    a: slider({ value: 7, min: 0, max: 10, maxExpr: 'n', _desired: 9, _tweening: true } as Partial<SceneSlider>),
  }, () => {
    refreshSliderBounds();
    assert.equal(state.sceneSliders.a!.max, 3);
    assert.equal(state.sceneSliders.a!.value, 3, 'animating does not exempt it from the range');
  });
});

test('an expression cannot widen the range past the declared envelope', () => {
  // The readout reserves its width from the declared bounds, so a live range
  // wider than they are would resize the track — reintroducing the drag jitter
  // (#649) through the mechanism meant to prevent it.
  withSliders({
    n: slider({ value: 50, min: 0, max: 100, _desired: 50 }),
    p: slider({
      value: 5, min: 2, max: 8, _staticMin: 2, _staticMax: 8,
      minExpr: '0 - n', maxExpr: 'n', _desired: 5,
    }),
  }, () => {
    refreshSliderBounds();
    const p = state.sceneSliders.p!;
    assert.equal(p.max, 8, 'a wider max is clamped to the declared one');
    assert.equal(p.min, 2, 'a lower min is clamped to the declared one');
  });
});

test('an expression still narrows freely inside the envelope', () => {
  withSliders({
    n: slider({ value: 5, min: 0, max: 100, _desired: 5 }),
    p: slider({
      value: 7, min: 2, max: 8, _staticMin: 2, _staticMax: 8,
      maxExpr: 'n', _desired: 7,
    }),
  }, () => {
    refreshSliderBounds();
    assert.equal(state.sceneSliders.p!.max, 5, 'narrowing is what the envelope is for');
    assert.equal(state.sceneSliders.p!.value, 5);
  });
});

test('a bound that throws or goes non-finite leaves the declared one in force', () => {
  withSliders({
    bad: slider({ value: 5, min: 0, max: 10, _staticMax: 10, maxExpr: 'nosuchfn(1)', _desired: 5 }),
    inf: slider({ value: 5, min: 0, max: 10, _staticMax: 10, maxExpr: '1 / 0', _desired: 5 }),
  }, () => {
    refreshSliderBounds();
    assert.equal(state.sceneSliders.bad!.max, 10, 'a refused expression falls back');
    assert.equal(state.sceneSliders.inf!.max, 10, 'so does a non-finite one');
    assert.equal(state.sceneSliders.bad!.value, 5);
  });
});

test('an inverted range collapses to a point instead of picking an end at random', () => {
  withSliders({
    n: slider({ value: -5, min: -10, max: 10, _desired: -5 }),
    p: slider({ value: 4, min: 2, max: 10, maxExpr: 'n', _desired: 4 }),
  }, () => {
    refreshSliderBounds();
    const p = state.sceneSliders.p!;
    assert.equal(p.max, p.min, 'max never sits below min');
    assert.equal(p.value, p.min);
  });
});

test('sliders without a bound expression are left alone', () => {
  withSliders({
    plain: slider({ value: 7, min: 0, max: 10, _desired: 3 }),
  }, () => {
    assert.equal(refreshSliderBounds(), false, 'nothing moved');
    assert.equal(state.sceneSliders.plain!.value, 7, '_desired is not applied to unbounded sliders');
  });
});
