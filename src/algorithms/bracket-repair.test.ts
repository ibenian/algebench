import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairTrace } from './bracket-repair.js';
import { bracketTrace } from './bracket-validation.js';

test('repair inserts missing brackets, replaces mismatches, and preserves ordinary text', () => {
    for (const [input, output] of [['([)]', '([])'], ['())', '()()'], ['([', '([])'], [']', '[]'], ['a[b)c', 'a[b]c'], ['', ''], ['(🙂)', '(🙂)']]) {
        const end = repairTrace(input!).at(-1)!;
        assert.equal(end.chars.join(''), output);
        assert.equal(bracketTrace(end.chars.join('')).at(-1)!.status, 'Valid');
    }
});

test('all short bracket sequences repair to valid input with independent snapshots', () => {
    let corpus = [''];
    for (let depth = 0; depth <= 4; depth++) {
        for (const input of corpus) {
            const trace = repairTrace(input), end = trace.at(-1)!;
            assert.equal(bracketTrace(end.chars.join('')).at(-1)!.status, 'Valid', input);
            if (bracketTrace(input).at(-1)!.status === 'Valid') {
                assert.equal(end.chars.join(''), input); assert.equal(end.edits, 0);
            }
            for (let j = 1; j < trace.length; j++) {
                assert.notEqual(trace[j]!.chars, trace[j - 1]!.chars);
                assert.notEqual(trace[j]!.stack, trace[j - 1]!.stack);
            }
        }
        corpus = corpus.flatMap(s => [...'()[]{}'].map(c => s + c));
    }
    assert.equal(repairTrace('('.repeat(128)).at(-1)!.chars.length, 256);
    assert.throws(() => repairTrace('('.repeat(129)), /128/);
});
