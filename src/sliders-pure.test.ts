// Covers the side-effect-free helpers of src/sliders.ts: _sliderValueNum()
// (the accessor every domain library reads slider values through) and
// getSliderIds() (whose ordering rule is load-bearing for launch/injection
// scenes).
//
// sliders imports expr.ts, which instantiates the math.js CDN bundle at
// module-eval time, so `math` is stubbed before the import. Nothing below
// touches the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';
import type { SceneSlider } from '/sliders.js';

// `math` is declared as a CDN `const` global (src/globals.d.ts), which types
// readers but not writers — so installing the stub casts globalThis once here.
(globalThis as unknown as { math: typeof mathjs }).math = mathjs;

const { state } = await import('/state.js');
const { _sliderValueNum, getSliderIds, formatTensorCell } = await import('/sliders.js');

/**
 * Replace the shared slider registry with `entries` for one test.
 *
 * The fixtures below stand in for SceneSlider but are deliberately partial and
 * sometimes ill-typed (a string, null or non-finite `value`) — coercing those
 * is exactly what _sliderValueNum() is being tested on. The single cast here
 * keeps that boundary in one place instead of at every call site.
 */
function withSliders(entries: Record<string, unknown>, fn: () => void): void {
  const saved = state.sceneSliders;
  state.sceneSliders = entries as Record<string, SceneSlider>;
  try { fn(); } finally { state.sceneSliders = saved; }
}

test('_sliderValueNum returns the value, or the fallback when unusable', () => {
  withSliders({
    a: { value: 2.5 },
    s: { value: '3.5' },        // string values coerce
    nan: { value: 'abc' },
    inf: { value: Infinity },
    nul: { value: null },
  }, () => {
    assert.equal(_sliderValueNum('a'), 2.5);
    assert.equal(_sliderValueNum('s'), 3.5);
    // Non-finite or unparseable values fall back rather than poisoning
    // downstream arithmetic with NaN.
    assert.equal(_sliderValueNum('nan', 7), 7);
    assert.equal(_sliderValueNum('inf', 7), 7);
    // null coerces to 0, which IS finite — so it is returned, not replaced.
    assert.equal(_sliderValueNum('nul', 7), 0);
    // A slider that does not exist at all.
    assert.equal(_sliderValueNum('missing', 7), 7);
    assert.equal(_sliderValueNum('missing'), 0);   // default fallback
  });
});

test('getSliderIds keeps insertion order when h/h_target are absent', () => {
  withSliders({ v0: {}, phi: {}, T: {} }, () => {
    assert.deepEqual(getSliderIds(), ['v0', 'phi', 'T']);
  });
});

test('getSliderIds moves h to sit directly before h_target', () => {
  // Launch altitude must be adjacent to injection altitude in the overlay,
  // whatever order the scene declared them in.
  withSliders({ h: {}, v0: {}, phi: {}, h_target: {} }, () => {
    assert.deepEqual(getSliderIds(), ['v0', 'phi', 'h', 'h_target']);
  });
});

test('getSliderIds leaves an already-adjacent h alone', () => {
  withSliders({ v0: {}, h: {}, h_target: {}, T: {} }, () => {
    assert.deepEqual(getSliderIds(), ['v0', 'h', 'h_target', 'T']);
  });
});

test('getSliderIds does not reorder when only one of the pair is present', () => {
  withSliders({ h: {}, v0: {} }, () => {
    assert.deepEqual(getSliderIds(), ['h', 'v0']);
  });
  withSliders({ v0: {}, h_target: {} }, () => {
    assert.deepEqual(getSliderIds(), ['v0', 'h_target']);
  });
});

// A tensor grid's columns are sized to their content, so the readout's
// character count has to be the same whatever the value is — a minus sign
// that widens the text reflows the column under it while the user scrubs.
// U+2007 FIGURE SPACE is one digit wide in the cell's monospace font and
// holds the sign's place open.
const SIGN_SLOT = '\u2007';

test('formatTensorCell keeps the sign slot filled on non-negative values', () => {
  assert.equal(formatTensorCell(2.5), SIGN_SLOT + '2.50');
  assert.equal(formatTensorCell(0), SIGN_SLOT + '0.00');
  assert.equal(formatTensorCell(-0), SIGN_SLOT + '0.00');
  assert.equal(formatTensorCell(-2.5), '-2.50');

  // Same width across zero is the whole point of the slot.
  assert.equal(formatTensorCell(2.5).length, formatTensorCell(-2.5).length);
  assert.equal(formatTensorCell(0).length, formatTensorCell(-1.25).length);
});

test('formatTensorCell drops a decimal at each magnitude boundary', () => {
  assert.equal(formatTensorCell(9.999), SIGN_SLOT + '10.00');   // below 10: two decimals
  assert.equal(formatTensorCell(10), SIGN_SLOT + '10.0');
  assert.equal(formatTensorCell(99.94), SIGN_SLOT + '99.9');
  assert.equal(formatTensorCell(100), SIGN_SLOT + '100');
  assert.equal(formatTensorCell(-10), '-10.0');
  assert.equal(formatTensorCell(-100), '-100');

  // The boundary is on the magnitude, so a sign never changes the precision.
  assert.equal(formatTensorCell(42.5).slice(1), formatTensorCell(-42.5).slice(1));
});

test('formatTensorCell shows a placeholder for non-finite values', () => {
  for (const v of [NaN, Infinity, -Infinity]) assert.equal(formatTensorCell(v), '\u00b7');
});
