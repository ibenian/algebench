import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationFor, annotatedExpressions, annotatedBlockAt } from '/code-annotations.js';

const entries = [
    { name: 'cell', text: 'the popped cell' },
    { name: 'cell', line: 5, endLine: 6, text: "h's parameter" },
    { name: 'g', text: 'best known costs' },
    { line: 17, endLine: 25, text: 'relax the neighbours' },
    { line: 19, endLine: 20, text: 'skip walls' },
    { line: 9, col: 13, endCol: 21, text: 'the first guess' },
];

test('a name is documented by the narrowest range holding the line, else file-wide', () => {
    assert.equal(annotationFor(entries, ['cell'], 5)?.text, "h's parameter");
    assert.equal(annotationFor(entries, ['cell'], 11)?.text, 'the popped cell');
    assert.equal(annotationFor(entries, ['nb'], 11), null);
});

test('an expression key falls back to its root', () => {
    assert.equal(annotationFor(entries, ['g[cell]', 'g'], 14)?.text, 'best known costs');
});

test('unnamed entries are blocks (the narrowest holding a line) or expressions (a column range)', () => {
    assert.equal(annotatedBlockAt(entries, 19)?.text, 'skip walls');
    assert.equal(annotatedBlockAt(entries, 23)?.text, 'relax the neighbours');
    assert.equal(annotatedBlockAt(entries, 9), null, 'an expression is not a block');
    assert.deepEqual(annotatedExpressions(entries).map(e => e.text), ['the first guess']);
});
