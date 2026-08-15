// node:test unit tests for the pure NavStack core.
// Run: node --test static/nav-history-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NavStack } from './nav-history-core.js';

test('push advances cursor and stores entries', () => {
    const s = new NavStack();
    s.push('a'); s.push('b'); s.push('c');
    assert.deepEqual(s.getStack(), ['a', 'b', 'c']);
    assert.equal(s.getCursor(), 2);
    assert.equal(s.current(), 'c');
});

test('push dedups against the current entry', () => {
    const s = new NavStack();
    assert.equal(s.push('a'), true);
    assert.equal(s.push('a'), false);
    assert.equal(s.size, 1);
});

test('push truncates forward history', () => {
    const s = new NavStack();
    s.push('a'); s.push('b'); s.push('c');
    s.back(); // cursor at 'b'
    s.push('d');
    assert.deepEqual(s.getStack(), ['a', 'b', 'd']);
    assert.equal(s.current(), 'd');
});

test('back / forward move the cursor with bounds', () => {
    const s = new NavStack();
    s.push('a'); s.push('b');
    assert.equal(s.canForward(), false);
    assert.equal(s.back(), 'a');
    assert.equal(s.canBack(), false);
    assert.equal(s.back(), null);
    assert.equal(s.forward(), 'b');
    assert.equal(s.forward(), null);
});

test('replace swaps the current entry without growing the stack', () => {
    const s = new NavStack();
    s.push('a'); s.push('b');
    s.replace('b2');
    assert.deepEqual(s.getStack(), ['a', 'b2']);
    assert.equal(s.size, 2);
});

test('replace seeds an empty stack', () => {
    const s = new NavStack();
    s.replace('x');
    assert.deepEqual(s.getStack(), ['x']);
    assert.equal(s.getCursor(), 0);
});

test('enforces the max size by dropping oldest', () => {
    const s = new NavStack(3);
    s.push('a'); s.push('b'); s.push('c'); s.push('d');
    assert.deepEqual(s.getStack(), ['b', 'c', 'd']);
    assert.equal(s.current(), 'd');
    assert.equal(s.getCursor(), 2);
});

test('default cap is 100', () => {
    const s = new NavStack();
    for (let i = 0; i < 150; i++) s.push('e' + i);
    assert.equal(s.size, 100);
    assert.equal(s.current(), 'e149');
});

test('syncTo locates an entry and moves the cursor', () => {
    const s = new NavStack();
    s.push('a'); s.push('b'); s.push('c');
    assert.equal(s.syncTo('a'), true);
    assert.equal(s.getCursor(), 0);
    assert.equal(s.syncTo('zzz'), false);
});
