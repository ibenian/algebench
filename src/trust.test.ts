// What the trust scanner looks at, and what that decides.
//
// `scanSpecForUnsafeJs` does NOT gate execution — `compileExpr` does that
// itself, returning `compile('0')` for a JS-only string whenever the scene is
// untrusted. What the scanner decides is whether the reader is OFFERED the
// dialog at all. A key it skips is therefore not an execution bypass; it is a
// value that silently renders as 0 with no explanation and no choice.

import test from 'node:test';
import assert from 'node:assert/strict';

// `trust.ts` imports `/expr.js` for `_JS_ONLY_RE`, and `expr.ts` calls
// `math.create(math.all)` at module scope — `math` being the CDN <script> global
// from index.html. So the module graph needs that global present BEFORE it
// loads, which is why the import below is dynamic. Nothing here exercises
// math.js itself; the scanner only needs the regex.
(globalThis as unknown as { math: unknown }).math = {
    all: {},
    create: () => ({
        import: () => {},
        compile: () => ({ evaluate: () => 0 }),
        combinations: () => 0, erf: () => 0, gamma: () => 1, conj: (x: unknown) => x,
    }),
};

const { scanSpecForUnsafeJs } = await import('/trust.js');

const animatedLine = (points: string[][]) => ({
    elements: [{ type: 'animated_line', id: 'l', points }],
});

test('a JS-only expression nested in `points` is found', () => {
    // `animated_line` compiles every string in `points` through `compileExpr`,
    // exactly as it would an `expr`. Neither `points` nor `vertices` ends in
    // `Expr`, so the suffix rule that catches everything else misses both.
    assert.equal(scanSpecForUnsafeJs(animatedLine(
        [['Math.sin(t)', '0', '0'], ['1', '1', '1']])), true);
});

test('a math.js expression in the same place is not flagged', () => {
    // The point of the scan is unsafe JS, not any expression. Flagging `sin(t)`
    // would train the reader to dismiss the dialog.
    assert.equal(scanSpecForUnsafeJs(animatedLine(
        [['sin(t)', '0', '0'], ['1', '1', '1']])), false);
});

test('depth does not hide it — the walker carries the key down', () => {
    // The string lives two levels below its key (`points` -> row -> coordinate).
    // `walk` passes `parentKey` through arrays unchanged, which is what makes a
    // key-based predicate work at all here; if it reset per level, the coordinate
    // would be scanned with a null key and never tested.
    assert.equal(scanSpecForUnsafeJs(animatedLine(
        [['0', '0', '0'], ['1', '1', '() => 1']])), true);
});

test('a flat expression key still works', () => {
    // Guards the refactor rather than the feature: `_carriesExpressions` wraps
    // `_isExprKey`, so a mistake there would silently narrow the original scan.
    assert.equal(scanSpecForUnsafeJs(
        { elements: [{ type: 'point', expr: ['Math.cos(t)', '0', '0'] }] }), true);
    assert.equal(scanSpecForUnsafeJs(
        { elements: [{ type: 'point', positionExpr: ['new Date()', '0', '0'] }] }), true);
});

test('prose keys are not scanned, however alarming they read', () => {
    // The allowlist is the whole design: 70 of the schema's 86 element
    // properties are not expressions, and scanning them would flag a
    // description that happens to mention `Math.floor`.
    assert.equal(scanSpecForUnsafeJs(
        { elements: [{ type: 'text', label: 'use Math.floor(x) to round down' }] }), false);
});
