// node:test unit tests for the pure view-state serializer.
// Run: node --test static/view-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    serializeViewState,
    parseViewState,
    encodeCamera,
    decodeCamera,
    slugify,
    fmtNum,
    viewStatesEqual,
} from './view-state.js';

test('round-trips a full ViewState', () => {
    const vs = {
        builtin: 'conditional-probability',
        sc: 'bayes-theorem',
        st: 'derive-numerator',
        pf: 'main-proof',
        ps: 'step-3',
        nodes: ['n_a', 'n_b', 'n_c'],
        sliders: { pA: 0.7, pBgA: 0.8 },
        cam: { position: [2.5, 1.8, 2.5], target: [0, 0, 0] },
    };
    const round = parseViewState(serializeViewState(vs));
    assert.deepEqual(round, vs);
});

test('builtin and scene are mutually exclusive (builtin wins)', () => {
    const q = serializeViewState({ builtin: 'x', scene: '/p.json' });
    assert.ok(q.includes('builtin=x'));
    assert.ok(!q.includes('scene='));
});

test('scene path round-trips with encoding', () => {
    const vs = { scene: '/scenes/my lesson.json', sc: 'intro' };
    const round = parseViewState(serializeViewState(vs));
    assert.deepEqual(round, vs);
});

test('empty ViewState serializes to empty string', () => {
    assert.equal(serializeViewState({}), '');
    assert.deepEqual(parseViewState(''), {});
});

test('omits base step / goal proof step when absent', () => {
    const q = serializeViewState({ sc: 's1' });
    assert.equal(q, 'sc=s1');
    assert.deepEqual(parseViewState(q), { sc: 's1' });
});

test('view flag round-trips and omits the scene default', () => {
    assert.equal(serializeViewState({ view: 'math', sc: 's1' }), 'view=math&sc=s1');
    assert.equal(serializeViewState({ view: 'scene', sc: 's1' }), 'sc=s1');
    assert.deepEqual(parseViewState('view=math&sc=s1'), { view: 'math', sc: 's1' });
});

test('panel + proof-panel flags round-trip and omit defaults', () => {
    assert.equal(serializeViewState({ panel: 'chat', pp: true, sc: 's1' }), 'panel=chat&pp=1&sc=s1');
    assert.equal(serializeViewState({ panel: 'doc', pp: false, sc: 's1' }), 'sc=s1');
    assert.deepEqual(parseViewState('panel=chat&pp=1&sc=s1'), { panel: 'chat', pp: true, sc: 's1' });
    assert.deepEqual(parseViewState('sc=s1'), { sc: 's1' });
});

test('dock (split) flag round-trips only when on, explicit off is not serialized', () => {
    // Only the docked state is shareable; false/absent leaves it implicit.
    assert.equal(serializeViewState({ dock: true, sc: 's1' }), 'dock=1&sc=s1');
    assert.equal(serializeViewState({ dock: false, sc: 's1' }), 'sc=s1');
    assert.equal(serializeViewState({ sc: 's1' }), 'sc=s1');
    // Parse: explicit 1/0 → boolean; absent → undefined (key omitted entirely).
    assert.deepEqual(parseViewState('dock=1&sc=s1'), { dock: true, sc: 's1' });
    assert.deepEqual(parseViewState('dock=true&sc=s1'), { dock: true, sc: 's1' });
    assert.deepEqual(parseViewState('dock=0&sc=s1'), { dock: false, sc: 's1' });
    assert.deepEqual(parseViewState('dock=false&sc=s1'), { dock: false, sc: 's1' });
    assert.deepEqual(parseViewState('sc=s1'), { sc: 's1' });
    // A garbage value is ignored (no dock key), not coerced.
    assert.deepEqual(parseViewState('dock=maybe&sc=s1'), { sc: 's1' });
});

test('node selection preserves order', () => {
    const vs = { nodes: ['z', 'a', 'm'] };
    const round = parseViewState(serializeViewState(vs));
    assert.deepEqual(round.nodes, ['z', 'a', 'm']);
});

test('sliders pack/unpack with separators that stay readable', () => {
    const q = serializeViewState({ sliders: { pA: 0.7, p_B: 1.25 } });
    assert.ok(q.includes('sl=pA~0.7,p_B~1.25'), q);
    assert.deepEqual(parseViewState(q).sliders, { pA: 0.7, p_B: 1.25 });
});

test('camera-view preset (cv) round-trips alongside cam', () => {
    const vs = { cv: 'iso', cam: { position: [1, 2, 3], target: [0, 0, 0] } };
    const round = parseViewState(serializeViewState(vs));
    assert.deepEqual(round, vs);
    assert.ok(serializeViewState({ cv: 'top' }).includes('cv=top'));
});

test('projection (proj) round-trips and omits perspective default', () => {
    assert.equal(serializeViewState({ proj: 'orthographic', sc: 's1' }), 'sc=s1&proj=orthographic');
    assert.equal(serializeViewState({ proj: 'perspective', sc: 's1' }), 'sc=s1');
    assert.deepEqual(parseViewState('proj=orthographic&sc=s1'), { proj: 'orthographic', sc: 's1' });
});

test('orthographic scale (oz) round-trips', () => {
    const q = serializeViewState({ proj: 'orthographic', oz: 3.25, sc: 's1' });
    assert.ok(q.includes('oz=3.25'), q);
    assert.deepEqual(parseViewState(q), { proj: 'orthographic', oz: 3.25, sc: 's1' });
    // oz is omitted when not a finite number
    assert.ok(!serializeViewState({ proj: 'orthographic', sc: 's1' }).includes('oz='));
});

test('camera encode omits default up, includes non-default up', () => {
    assert.equal(
        encodeCamera({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] }),
        '1,2,3,0,0,0',
    );
    assert.equal(
        encodeCamera({ position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] }),
        '1,2,3,0,0,0,0,0,1',
    );
});

test('camera decode handles 6 and 9 numbers, rejects garbage', () => {
    assert.deepEqual(decodeCamera('1,2,3,4,5,6'), {
        position: [1, 2, 3], target: [4, 5, 6],
    });
    assert.deepEqual(decodeCamera('1,2,3,4,5,6,0,0,1'), {
        position: [1, 2, 3], target: [4, 5, 6], up: [0, 0, 1],
    });
    assert.equal(decodeCamera('1,2,3'), null);
    assert.equal(decodeCamera('a,b,c,d,e,f'), null);
    assert.equal(decodeCamera(''), null);
    // Reject lengths that aren't exactly 6 or 9, and empty (trailing-comma) segments.
    assert.equal(decodeCamera('1,2,3,4,5,6,7'), null);
    assert.equal(decodeCamera('1,2,3,4,5,6,7,8'), null);
    assert.equal(decodeCamera('1,2,3,4,5,6,'), null);
    assert.equal(decodeCamera('1,2,3,4,5,'), null);
});

test('camera rounds to 4 decimals', () => {
    const enc = encodeCamera({ position: [1.234567, 0, 0], target: [0, 0, 0] });
    assert.equal(enc, '1.2346,0,0,0,0,0');
});

test('fmtNum drops trailing zeros and handles non-finite', () => {
    assert.equal(fmtNum(1.5000), '1.5');
    assert.equal(fmtNum(3), '3');
    assert.equal(fmtNum(NaN), '0');
});

test('slugify produces stable kebab ids', () => {
    assert.equal(slugify('Bayes’ Theorem!'), 'bayes-theorem');
    assert.equal(slugify('  Step 3: Derive  '), 'step-3-derive');
    assert.equal(slugify(''), '');
    assert.equal(slugify(null), '');
});

test('parseViewState accepts a leading ? and URLSearchParams', () => {
    assert.deepEqual(parseViewState('?sc=s1&st=s2'), { sc: 's1', st: 's2' });
    assert.deepEqual(parseViewState(new URLSearchParams('sc=s1')), { sc: 's1' });
});

test('viewStatesEqual compares by serialization', () => {
    assert.ok(viewStatesEqual({ sc: 'a', nodes: ['x'] }, { sc: 'a', nodes: ['x'] }));
    assert.ok(!viewStatesEqual({ sc: 'a' }, { sc: 'b' }));
});

// Boot-only directives (auto-ask + pre-baked proof): parsed for one-shot use but
// deliberately NOT serialized, so they never round-trip back into a URL.
test('aa (auto-ask) is captured on parse and capped, never serialized', () => {
    assert.equal(parseViewState('aa=explain%20this').aa, 'explain this');
    // capped to 2000 chars
    assert.equal(parseViewState('aa=' + 'x'.repeat(2500)).aa.length, 2000);
    // load-once: not emitted back out
    assert.equal(serializeViewState({ aa: 'explain this', sc: 's1' }), 'sc=s1');
});

test('pa (pre-baked proof slug) accepts only "<domain>/<name>", never serialized', () => {
    assert.equal(parseViewState('pa=physics/rotating-habitat-gravity').pa,
        'physics/rotating-habitat-gravity');
    // rejected shapes leave pa undefined (a slug the dock rejects must not set vs.pa)
    assert.equal(parseViewState('pa=/physics/x').pa, undefined);      // leading slash
    assert.equal(parseViewState('pa=a/b/c').pa, undefined);           // extra slash
    assert.equal(parseViewState('pa=nolash').pa, undefined);          // no slash
    assert.equal(parseViewState('pa=bad%20name/x').pa, undefined);    // illegal char
    // load-once: not serialized
    assert.equal(serializeViewState({ pa: 'physics/x', sc: 's1' }), 'sc=s1');
});

test('pas (pre-baked proof step) parses a small int, never serialized', () => {
    assert.equal(parseViewState('pas=3').pas, 3);
    assert.equal(parseViewState('pas=0').pas, 0);
    assert.equal(parseViewState('pas=abc').pas, undefined);   // non-numeric ignored
    assert.equal(parseViewState('pas=99999').pas, undefined); // >4 digits ignored
    assert.equal(serializeViewState({ pas: 3, sc: 's1' }), 'sc=s1');
});
