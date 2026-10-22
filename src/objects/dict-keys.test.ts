import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyText, keyIndex } from '/objects/dict-keys.js';

test('keys print as Python prints them', () => {
    assert.equal(keyText('a'), "'a'");
    assert.equal(keyText(7), '7');
    assert.equal(keyText(-2.5), '-2.5');
    assert.equal(keyText([1, 2]), '(1, 2)', 'a tuple key');
    assert.equal(keyText([3]), '(3,)', 'a one-element tuple keeps its comma');
    assert.equal(keyText(['r', [0, 1]]), "('r', (0, 1))", 'nested');
    assert.equal(keyText({valueOf: () => [4, 5]}), '(4, 5)', 'a math.js matrix');
    assert.equal(keyText(true), 'True');
    assert.equal(keyText(null), 'None');
    assert.equal(keyText("it's"), "'it\\'s'");
});

test('keyIndex finds an entry by its key, as Python compares keys', () => {
    assert.equal(keyIndex(['apple', 'kiwi', 'fig'], 'kiwi'), 1);
    assert.equal(keyIndex([2, 7, 11], 11), 2);
    assert.equal(keyIndex([2, 7, 11], '7'), -1, "the string '7' is not the number 7");
    assert.equal(keyIndex([[0, 0], [0, 1], [1, 2]], [0, 1]), 1, 'a tuple key');
    assert.equal(keyIndex({valueOf: () => [[1, 2]]}, {valueOf: () => [1, 2]}), 0, 'math.js matrices');
    assert.equal(keyIndex(['a'], 'z'), -1);
    assert.equal(keyIndex(null, 'a'), -1);
});
