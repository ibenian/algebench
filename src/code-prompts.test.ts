import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_PROMPTS, enclosingFunction, codePromptMessage } from '/code-prompts.js';

const SOURCE = `def subsets(nums):
    out, path = [], []

    def backtrack(start):
        out.append(path[:])
        for i in range(start, len(nums)):
            path.append(nums[i])
            backtrack(i + 1)
            path.pop()

    backtrack(0)
    return out`;

test('a line belongs to the nearest def above it that is indented less', () => {
    assert.deepEqual(enclosingFunction(SOURCE, 7), {name: 'backtrack', line: 4}, 'inside the loop of the inner function');
    assert.deepEqual(enclosingFunction(SOURCE, 11), {name: 'subsets', line: 1}, 'after the inner function ends');
    assert.deepEqual(enclosingFunction(SOURCE, 4), {name: 'backtrack', line: 4}, 'a def line is its own function');
    assert.deepEqual(enclosingFunction(SOURCE, 3), {name: 'subsets', line: 1}, 'a blank line');
    assert.equal(enclosingFunction('x = 1\ny = 2', 2), null, 'module level');
});

test('a prompt carries the selection, its function, execution, waiting calls and the numbered source', () => {
    const message = codePromptMessage(CODE_PROMPTS[2]!, {path: 'patterns/subsets.py', source: SOURCE, first: 8, last: 8,
        excerpt: '            backtrack(i + 1)', executing: [5], waitingCalls: [11, 8], scene: 'Backtracking', step: 1, values: {frame: 9}});
    assert.ok(message.startsWith(CODE_PROMPTS[2]!.prompt));
    assert.match(message, /Selected: line 8, inside backtrack\(\) \(line 4\)/);
    assert.match(message, /Executing now: line 5/);
    assert.match(message, /Calls waiting to return \(call-site lines, outermost first\): 11, 8/);
    assert.match(message, / {2}8 {2}\s+backtrack\(i \+ 1\)/, 'numbered, so the tutor can cite lines');
    assert.equal(new Set(CODE_PROMPTS.map(p => p.label)).size, CODE_PROMPTS.length);
});
