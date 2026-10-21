import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineJump, jumpArrowPath, waitingCalls, callArrowPath, callBow, callStagger, lineTransitions, movesAt } from '/code-jump.js';

test('a move is one marked line giving way to a different one', () => {
    assert.deepEqual(lineJump(new Set([6]), new Set([9])), {from: 6, to: 9});
    assert.deepEqual(lineJump(new Set([9]), new Set([6])), {from: 9, to: 6}, 'a jump back up, as a loop repeats');
    assert.equal(lineJump(new Set([6]), new Set([6])), null, 'staying on a line');
    assert.equal(lineJump(new Set(), new Set([6])), null, 'nothing was marked before');
    assert.equal(lineJump(new Set([6]), new Set([7, 8])), null, 'several lines are not one move');
});

test('the arrow bows left from the old line to the new one, in proportion to its length, and ends level', () => {
    assert.equal(jumpArrowPath(40, 20, 100), 'M 40 20 C 26 20, 19 100, 33 100 L 40 100');
    assert.equal(jumpArrowPath(40, 100, 20), 'M 40 100 C 26 100, 19 20, 33 20 L 40 20', 'upward keeps its direction');
    assert.equal(jumpArrowPath(40, 20, 44), 'M 40 20 C 33 20, 26 44, 33 44 L 40 44', 'adjacent lines: a small hook');
});

test('waiting calls are the call-site lines of a callsExpr value, outermost first, repeats kept', () => {
    assert.deepEqual(waitingCalls([11, 8, 8], 12), [11, 8, 8], 'a recursive call waits on the same line as its caller');
    assert.deepEqual(waitingCalls({toArray: () => [4, 4]}, 12), [4, 4], 'a math.js matrix');
    assert.deepEqual(waitingCalls([0, 3, 99, 2.5, '4'], 12), [3], 'only real lines of the file');
    assert.deepEqual(waitingCalls(null, 12), []);
});

test('longer arrows bow further; deeper calls a little further and lower, so arrows nest, up to a cap', () => {
    assert.ok(callBow(1, 92) > callBow(0, 92) && callBow(2, 92) > callBow(1, 92), 'same lines: deeper bows further');
    assert.ok(callBow(9, 92) < callBow(0, 160), 'a short arrow stays inside a longer one, however deep');
    assert.equal(callBow(9, 400), 28, 'kept inside the gutter');
    assert.ok(callStagger(1) > callStagger(0) && callStagger(9) === callStagger(4), 'ends step down, then stop');
    assert.equal(callArrowPath(40, 100, 20, 0), 'M 40 96 C 26 96, 19 16, 33 16 L 40 16');
    assert.equal(callArrowPath(40, 100, 20, 2), 'M 40 101 C 22 101, 15 21, 33 21 L 40 21', 'deeper: further out, lower');
});

test('a run gives each distinct move once; a line has the moves into it and out of it', () => {
    // A loop: 6 → 7 → 8 → 9, back to 6, then out to 12.
    const moves = lineTransitions([2, 6, 6, 7, 8, 9, 6, 7, 8, 9, 6, 12]);
    assert.deepEqual(moves, [{from: 2, to: 6}, {from: 6, to: 7}, {from: 7, to: 8}, {from: 8, to: 9}, {from: 9, to: 6}, {from: 6, to: 12}]);
    assert.deepEqual(movesAt(moves, 6), {incoming: [{from: 2, to: 6}, {from: 9, to: 6}], outgoing: [{from: 6, to: 7}, {from: 6, to: 12}]});
    assert.deepEqual(lineTransitions([]), []);
});
