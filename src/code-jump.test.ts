import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineJump, jumpArrowPath, waitingCalls, callArrowPath, callBow, endReach, lineTransitions, movesAt } from '/code-jump.js';

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
    assert.ok(endReach(20) > endReach(14) && endReach(99) === 8 && endReach(0) === -8, 'reach follows the bow, capped');
    // Upward from y 100 to 20 (bow 14): ends pulled 2 px in. A deeper arrow (bow 18) reaches 2 px out at both ends.
    assert.equal(callArrowPath(40, 100, 20, 0), 'M 40 98 C 26 98, 19 22, 33 22 L 40 22');
    assert.equal(callArrowPath(40, 100, 20, 2), 'M 40 102 C 22 102, 15 18, 33 18 L 40 18', 'deeper: further out at both ends');
    assert.equal(callArrowPath(40, 20, 100, 2), 'M 40 18 C 22 18, 15 102, 33 102 L 40 102', 'downward mirrors it');
    // Arrows of different lengths into one line nest too: the longer one bows further, so it lands further out.
    const end = (d: string) => Number(d.split(' ').at(-1));
    assert.ok(end(callArrowPath(40, 260, 100, 0)) < end(callArrowPath(40, 190, 100, 3)), 'the long arrow encloses the short ones');
});

test('a run gives each distinct move once; a line has the moves into it and out of it', () => {
    // A loop: 6 → 7 → 8 → 9, back to 6, then out to 12.
    const moves = lineTransitions([2, 6, 6, 7, 8, 9, 6, 7, 8, 9, 6, 12]);
    assert.deepEqual(moves, [{from: 2, to: 6}, {from: 6, to: 7}, {from: 7, to: 8}, {from: 8, to: 9}, {from: 9, to: 6}, {from: 6, to: 12}]);
    assert.deepEqual(movesAt(moves, 6), {incoming: [{from: 2, to: 6}, {from: 9, to: 6}], outgoing: [{from: 6, to: 7}, {from: 6, to: 12}]});
    assert.deepEqual(lineTransitions([]), []);
});
