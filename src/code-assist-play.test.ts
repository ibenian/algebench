import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editsBetween, applyEdits, keystrokes, backspaces, keyDelay } from '/code-assist-play.js';

const cases: [string, string][] = [
    ['', 'def f(n):\n    return n'],
    ['def f(n):', 'def f(n):\n    total = 0'],
    ['def f(n):\n    total = 0\n    return total', 'def f(n):\n    count = 0\n    return count'],
    ['a\nb\nc', 'a\nc'],
    ['a\nc', 'a\nb\nc'],
    ['x = 1\ny = 2', ''],
    ['for i in range(n):\n    pass', 'for i in range(n + 1):\n    total += i'],
];

test('the edits between two texts make the second from the first', () => {
    for (const [from, to] of cases) assert.equal(applyEdits(from, editsBetween(from, to)), to, JSON.stringify([from, to]));
});

test('only what changes is typed: a new line at the end is Enter then the line, a rename retypes the name', () => {
    assert.deepEqual(editsBetween('def f(n):', 'def f(n):\n    total = 0'), [{at: 9, remove: 0, insert: '\n    total = 0'}]);
    const rename = editsBetween('    total = 0', '    count = 0');
    assert.equal(rename.length, 1);
    assert.ok(rename[0]!.remove <= 5 && rename[0]!.insert.length <= 5, JSON.stringify(rename));
});

test('a new line\'s indentation comes with its Enter; deletions go a word at a time when long', () => {
    assert.deepEqual(keystrokes('a\n    b'), ['a', '\n    ', 'b']);
    assert.deepEqual(backspaces('abc', 3), [1, 1, 1]);
    const words = backspaces('total = count + prefix', 22);
    assert.equal(words.reduce((s, n) => s + n, 0), 22);
    assert.ok(words.length < 10, 'a word at a time');
});

test('typing slows after a line and between words, never stalls', () => {
    const mid = () => 0.5;
    assert.ok(keyDelay('\n', 'x', mid) > keyDelay('a', 'b', mid));
    assert.ok(keyDelay('a', '\n    ', mid) > keyDelay('a', 'b', mid));
    for (const r of [0, 0.5, 0.99]) assert.ok(keyDelay(' ', 'x', () => r) < 600);
});
