import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

// expr.ts instantiates the math.js browser bundle when it loads, so the global is set before the import.
(globalThis as unknown as { math: typeof mathjs }).math = mathjs;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;
const { compileLinkTargets, evaluateLinkTargets } = await import('/objects/link-targets.js');

test('a list target links to each index, and slot keeps each target in its place for its port', () => {
    const targets = compileLinkTargets({indexExpr: '[idx == 0 ? -1 : 2, 3]', fromPortExpr: 'slot'}, 'g', true);
    const [group] = evaluateLinkTargets(targets, [10, 20]);
    assert.equal(group!.to, 'g', 'no object: the same graph');
    assert.deepEqual(group!.pairs, [[0, 3], [1, 2], [1, 3]], '-1 draws nothing');
    assert.deepEqual(group!.styles!.map(s => s?.port), [1, 0, 1], "node 0's target 3 stays in slot 1");
});

test('per-link routes: a finite arc centre makes an arc, NaN leaves the bend', () => {
    const targets = compileLinkTargets({object: 'g', indexExpr: 'idx + 1', bendExpr: '0', arcCenterExpr: ['idx == 0 ? 1 : NaN', '2', '0']}, 'h', false);
    const [group] = evaluateLinkTargets(targets, [0, 0]);
    assert.deepEqual(group!.styles!.map(s => [s?.bend, s?.arcCentre]), [[0, [1, 2, 0]], [0, undefined]]);
});
