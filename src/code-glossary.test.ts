import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glossaryFor, glossaryExpressions, glossaryBlockAt } from '/code-glossary.js';

const entries = [
    { name: 'cell', text: 'the popped cell' },
    { name: 'cell', from: 5, to: 6, text: "h's parameter" },
    { name: 'g', text: 'best known costs' },
    { from: 17, to: 25, text: 'relax the neighbours' },
    { from: 19, to: 20, text: 'skip walls' },
    { from: 9, col: 13, endCol: 21, text: 'the first guess' },
];

test('a name is documented by the narrowest range holding the line, else file-wide', () => {
    assert.equal(glossaryFor(entries, ['cell'], 5)?.text, "h's parameter");
    assert.equal(glossaryFor(entries, ['cell'], 11)?.text, 'the popped cell');
    assert.equal(glossaryFor(entries, ['nb'], 11), null);
});

test('an expression key falls back to its root', () => {
    assert.equal(glossaryFor(entries, ['g[cell]', 'g'], 14)?.text, 'best known costs');
});

test('unnamed entries are blocks (the narrowest holding a line) or expressions (a column range)', () => {
    assert.equal(glossaryBlockAt(entries, 19)?.text, 'skip walls');
    assert.equal(glossaryBlockAt(entries, 23)?.text, 'relax the neighbours');
    assert.equal(glossaryBlockAt(entries, 9), null, 'an expression is not a block');
    assert.deepEqual(glossaryExpressions(entries).map(e => e.text), ['the first guess']);
});
