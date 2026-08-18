// Extra node:test coverage for the deeplink cluster's PURE logic — the parts
// src/view-state.test.js and src/nav-history-core.test.js don't reach.
//
// The emphasis is round-tripping: a deeplink that serializes one way and parses
// back a different way is a real, user-visible regression (a shared link lands
// on the wrong view). These lock down the encoding edges — separator handling,
// key ordering, malformed input, and null-vs-absent — that a type conversion
// could quietly change.
//
// Run: node --test src/deeplink-roundtrip.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeViewState, parseViewState, viewStatesEqual, decodeCamera, encodeCamera,
} from './view-state.js';
import type { ViewState, ViewStateCamera } from './view-state.js';
import { NavStack } from './nav-history-core.js';

/** serialize -> parse -> serialize must be a fixed point. */
function assertStable(vs: ViewState): void {
  const once = serializeViewState(vs);
  assert.equal(serializeViewState(parseViewState(once)), once);
}

// ----- Slider packing -----

test('sliders serialize in id order regardless of key insertion order', () => {
  const a = serializeViewState({ sliders: { b: 2, a: 1 } });
  const b = serializeViewState({ sliders: { a: 1, b: 2 } });
  assert.equal(a, 'sl=a~1,b~2');
  assert.equal(a, b);
  // Equality-by-serialization is what viewStatesEqual promises, so the sort
  // order is load-bearing, not cosmetic.
  assert.ok(viewStatesEqual({ sliders: { b: 2, a: 1 } }, { sliders: { a: 1, b: 2 } }));
});

test('non-finite slider values are dropped, not emitted as NaN', () => {
  assert.equal(serializeViewState({ sliders: { a: NaN, b: 3 } }), 'sl=b~3');
  // Every value unusable => no `sl` param at all.
  assert.equal(serializeViewState({ sliders: { a: Infinity } }), '');
});

test('sliders round-trip through parse, negatives and decimals included', () => {
  const vs = { sliders: { a: 1.5, b: -2, c: 0 } };
  assert.deepEqual(parseViewState(serializeViewState(vs)).sliders, { a: 1.5, b: -2, c: 0 });
  assertStable(vs);
});

test('malformed slider pairs are skipped without poisoning the rest', () => {
  // '~5' has no id (separator at index 0), 'bad' has no separator, and 'c~x'
  // has an unparseable value.
  assert.deepEqual(parseViewState('sl=~5,bad,a~1,c~x').sliders, { a: 1 });
  // Nothing usable => `sliders` stays absent rather than an empty object.
  assert.equal('sliders' in parseViewState('sl=bad'), false);
});

// ----- Node selection -----

test('node ids keep their literal comma separator in the URL', () => {
  // encMin() deliberately un-escapes ',' and '~' so links stay readable.
  assert.equal(serializeViewState({ nodes: ['a', 'b', 'c'] }), 'nodes=a,b,c');
});

test('node list trims blanks and drops an all-empty list', () => {
  assert.deepEqual(parseViewState('nodes= a , ,b ').nodes, ['a', 'b']);
  assert.equal('nodes' in parseViewState('nodes=,,'), false);
});

// ----- Flags: explicit false vs absent -----

test('dock distinguishes explicit false from absent', () => {
  assert.equal(parseViewState('dock=0').dock, false);
  assert.equal(parseViewState('dock=false').dock, false);
  // An unrecognised value is treated as absent, so applyViewState leaves the
  // recipient's persisted dock preference alone.
  assert.equal('dock' in parseViewState('dock=yes'), false);
  assert.equal('dock' in parseViewState(''), false);
});

test('pp accepts both spellings and is absent otherwise', () => {
  assert.equal(parseViewState('pp=1').pp, true);
  assert.equal(parseViewState('pp=true').pp, true);
  assert.equal('pp' in parseViewState('pp=0'), false);
});

// ----- Numbers -----

test('oz keeps a literal zero and rejects unparseable input', () => {
  // 0 is a legitimate value and must survive the `!= null && !== ''` guard.
  assert.equal(parseViewState('oz=0').oz, 0);
  assert.equal('oz' in parseViewState('oz=abc'), false);
  assert.equal('oz' in parseViewState('oz='), false);
});

// ----- Encoding -----

test('ids needing percent-encoding survive a full round-trip', () => {
  // '+' is the dangerous one: URLSearchParams decodes a raw '+' as a space, so
  // it must go out as %2B.
  const vs = { sc: 'a b', st: 'x+y', pf: 'p&q', ps: 'r=s' };
  const parsed = parseViewState(serializeViewState(vs));
  assert.equal(parsed.sc, 'a b');
  assert.equal(parsed.st, 'x+y');
  assert.equal(parsed.pf, 'p&q');
  assert.equal(parsed.ps, 'r=s');
  assertStable(vs);
});

// ----- Camera -----

test('camera decode rejects a trailing comma rather than reading a spurious 0', () => {
  assert.equal(decodeCamera('1,2,3,4,5,'), null);
  assert.equal(decodeCamera('1,2,3,4,5,6,7'), null);
  assert.equal(decodeCamera(''), null);
  assert.equal(decodeCamera(null), null);
});

test('camera round-trips through the query string with a non-default up', () => {
  // Annotated so the literals land as the [x, y, z] tuples ViewStateCamera
  // declares, rather than widening to number[].
  const cam: ViewStateCamera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] };
  const parsed = parseViewState(serializeViewState({ cam }));
  assert.deepEqual(parsed.cam, cam);
  // The default up is dropped on the way out and absent on the way back.
  const flat = parseViewState(serializeViewState({
    cam: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] },
  }));
  // `!`: the camera above encodes, so parsing it back always yields a cam.
  assert.equal('up' in flat.cam!, false);
});

test('an incomplete camera encodes to nothing rather than a broken param', () => {
  // These two stand in for a half-built camera arriving from untyped runtime
  // input (a hand-edited URL, a partially restored snapshot). ViewStateCamera
  // requires both position and target, so the type cannot express them — but
  // encodeCamera guards for exactly this at runtime, and that guard is what is
  // under test. Cast at the call boundary rather than loosening the type.
  assert.equal(encodeCamera({ position: [1, 2, 3] } as unknown as ViewStateCamera), '');
  assert.equal(encodeCamera(null), '');
  assert.equal(serializeViewState({
    cam: { target: [0, 0, 0] } as unknown as ViewStateCamera,
  }), '');
});

// ----- Whole-state stability -----

test('a full ViewState is a fixed point of serialize -> parse -> serialize', () => {
  assertStable({
    builtin: 'vector-operations',
    view: 'math',
    panel: 'chat',
    pp: true,
    dock: true,
    sc: 'intro',
    st: 'step-2',
    pf: 'bayes',
    ps: 'apply-def',
    fa: 'fa-7',
    nodes: ['n1', 'n2'],
    sliders: { t: 0.5, k: 3 },
    cv: 'iso',
    proj: 'orthographic',
    oz: 3.25,
    cam: { position: [1.5, 2, 3], target: [0, 0, 0], up: [0, 0, 1] },
  });
});

// ----- NavStack -----

test('getStack hands back a copy, not the live array', () => {
  const s = new NavStack();
  s.push('a');
  const copy = s.getStack();
  copy.push('b');
  assert.equal(s.size, 1);
  assert.equal(s.current(), 'a');
});

test('an empty stack reports no current entry and refuses to move', () => {
  const s = new NavStack();
  assert.equal(s.current(), null);
  assert.equal(s.getCursor(), -1);
  assert.equal(s.canBack(), false);
  assert.equal(s.canForward(), false);
  assert.equal(s.back(), null);
  assert.equal(s.forward(), null);
});

test('a max below 1 is clamped to a one-entry stack', () => {
  const s = new NavStack(0);
  s.push('a');
  s.push('b');
  assert.deepEqual(s.getStack(), ['b']);
  assert.equal(s.getCursor(), 0);
});

test('syncTo picks the occurrence nearest the cursor and reports misses', () => {
  const s = new NavStack();
  // 'x' appears twice; the cursor sits on index 3.
  ['x', 'a', 'b', 'c', 'x'].forEach((e) => s.push(e));
  s.back();                       // cursor -> 3 ('c')
  assert.equal(s.getCursor(), 3);
  assert.equal(s.syncTo('x'), true);
  assert.equal(s.getCursor(), 4); // index 4 is nearer than index 0
  assert.equal(s.syncTo('nope'), false);
  assert.equal(s.getCursor(), 4); // a miss leaves the cursor alone
});

test('syncTo on the current entry is a no-op that still reports success', () => {
  const s = new NavStack();
  s.push('a');
  s.push('b');
  assert.equal(s.syncTo('b'), true);
  assert.equal(s.getCursor(), 1);
});
