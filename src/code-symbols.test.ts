import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowSymbolKeys, lineReferences, codeLanguage, symbolKey } from '/code-symbols.js';
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
