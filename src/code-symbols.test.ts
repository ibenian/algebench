import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowSymbolKeys, lineReferences, codeLanguage, symbolKey, usesAt, useSentence } from '/code-symbols.js';
import type { CodeReference } from '/code-symbols.js';

test('a row names the expressions left of its value, merged marker names included', () => {
    assert.deepEqual(rowSymbolKeys('temps[stack[-1]] = 74'), ['temps[stack[-1]]']);
    assert.deepEqual(rowSymbolKeys('i = j = 3'), ['i', 'j']);
    assert.deepEqual(rowSymbolKeys('node.next = 4'), ['node.next']);
    assert.deepEqual(rowSymbolKeys('while stack and temps[stack[-1]] < t → 75 < 72 → False'), [], 'conditions name nothing');
    assert.deepEqual(rowSymbolKeys('top slot = 0'), [], 'display names with spaces are not code');
    assert.equal(symbolKey('temps[ stack[-1] ]'), 'temps[stack[-1]]');
});

test('line references come outermost first so nested ones wrap inside', () => {
    const ref = (key: string, col: number, endCol: number, line = 5): CodeReference => ({key, root: 'x', kind: 'name', store: false, line, col, endLine: line, endCol});
    const refs = [ref('stack', 25, 30), ref('temps[stack[-1]]', 19, 35), ref('temps', 19, 24), ref('other', 0, 5, 6)];
    assert.deepEqual(lineReferences(refs, 5).map(r => r.key), ['temps[stack[-1]]', 'temps', 'stack']);
});

test('python files are analyzed by language or extension', () => {
    assert.equal(codeLanguage({path: 'patterns/a.py'}), 'python');
    assert.equal(codeLanguage({path: 'a.txt', language: 'Python'}), 'python');
    assert.equal(codeLanguage({path: 'a.ts'}), null);
});

test('a variable\'s uses are those of the function the line is in, else the module\'s', () => {
    const none = { read: [], update: [], grow: [], shrink: [] };
    const uses = [
        { name: 'seen', from: 1, to: 8, ...none, grow: [7] },
        { name: 'seen', from: 10, to: 17, ...none, grow: [16] },
        { name: 'seen', from: 0, to: 0, ...none, read: [20] },
    ];
    assert.deepEqual(usesAt(uses, 'seen', 12)?.grow, [16]);
    assert.deepEqual(usesAt(uses, 'seen', 20)?.read, [20]);
    assert.equal(usesAt(uses, 'count', 12), null);
});

test('a use says what its line does to the variable', () => {
    assert.equal(useSentence('count', { line: 16, kinds: ['update', 'grow'], how: 'add-key', code: 'count[prefix]' }),
        '`count[prefix]` = … sets the entry for that key: if `count` does not have the key yet it gains an entry (grows), otherwise its value is replaced.');
    assert.equal(useSentence('stack', { line: 3, kinds: ['update', 'shrink'], how: 'method:pop', code: 'stack.pop()' }),
        '`stack.pop()` removes an item and gives it back (the last one, or the one at the given index or key).');
    assert.equal(useSentence('total', { line: 7, kinds: ['read'], how: 'read', code: 'total' }), 'Uses the value of `total` without changing it.');
});
