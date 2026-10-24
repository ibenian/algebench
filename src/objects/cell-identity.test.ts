import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchIdentities, identityMoves, identityTracker } from '/objects/cell-identity.js';

const counter = () => { let n = 0; return () => `new-${n++}`; };
const k = (...v: number[]) => v.map(String);

test('a swap keeps both identities, exchanged', () => {
    assert.deepEqual(matchIdentities(k(7, 4), ['a', 'b'], k(4, 7), counter()), ['b', 'a']);
});
test('a push adds one new identity at the end', () => {
    assert.deepEqual(matchIdentities(k(4, 7), ['a', 'b'], k(4, 7, 1), counter()), ['a', 'b', 'new-0']);
});
test('a pop drops the root and moves the last value to the root', () => {
    // [1, 4, 9, 7] → heappop → [7, 4, 9]: 1 leaves, 7 moves from slot 3 to slot 0.
    assert.deepEqual(matchIdentities(k(1, 4, 9, 7), ['r', 'b', 'c', 'd'], k(7, 4, 9), counter()), ['d', 'b', 'c']);
});
test('equal values prefer staying put, then the nearest cell', () => {
    assert.deepEqual(matchIdentities(k(5, 5, 3), ['a', 'b', 'c'], k(3, 5, 5), counter()), ['c', 'b', 'a']);
    assert.deepEqual(matchIdentities([], [], k(2, 2), counter()), ['new-0', 'new-1']);
});
test('moves map each moved cell to the cell its value came from', () => {
    assert.deepEqual([...identityMoves(['r', 'b', 'c', 'd'], ['d', 'b', 'c'])], [[0, 3]]);
    const track = identityTracker('t');
    assert.equal(track.next(k(7, 4)).size, 0);
    assert.deepEqual([...track.next(k(4, 7))], [[0, 1], [1, 0]]);
    assert.deepEqual([...track.next(k(4, 7))], []);
});
