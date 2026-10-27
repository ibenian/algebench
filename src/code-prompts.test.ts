import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_PROMPTS, enclosingFunction, codePromptMessage, explainPrompt } from '/code-prompts.js';

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

test('a prompt with an active block answers for that block only, the rest of the file being context', () => {
    const source = `def bfs(g):\n    return 1\n\ndef dfs(g):\n    return 2`;
    const message = codePromptMessage(CODE_PROMPTS[6]!, {path: 'g.py', source, first: 5, last: 5, excerpt: '    return 2',
        executing: [5], waitingCalls: [], scene: 'S', step: 1, values: {}, active: {from: 4, to: 5}});
    assert.match(message, /Answer only for the active code: lines 4–5, dfs\(\)/);
    assert.match(message, /Active code:\n {2}4 {2}def dfs\(g\):\n {2}5 {6}return 2/);
    assert.doesNotMatch(message.split('Full source')[0]!, /def bfs/, 'the other function is only in the full source');
    assert.match(message, /Full source \(context only\):/);
    const whole = codePromptMessage(CODE_PROMPTS[6]!, {path: 'g.py', source, first: 1, last: 1, excerpt: 'def bfs(g):',
        executing: [], waitingCalls: [], scene: 'S', step: 1, values: {}, active: {from: 1, to: 5}});
    assert.doesNotMatch(whole, /Answer only/, 'a block that is the whole file needs no restriction');
});

test('without a selection a prompt is about the active code as a whole; line prompts are marked as needing one', () => {
    const source = `def bfs(g):\n    return 1\n\ndef dfs(g):\n    return 2`;
    const gist = CODE_PROMPTS[0]!;
    const message = codePromptMessage(gist, {path: 'g.py', source, first: 0, last: 0, excerpt: '',
        executing: [5], waitingCalls: [], scene: 'S', step: 1, values: {}, active: {from: 4, to: 5}});
    assert.doesNotMatch(message, /Selected/);
    assert.match(message, /Nothing is selected: the question is about the active code as a whole\./);
    assert.match(message, /Answer only for the active code: lines 4–5, dfs\(\)/);
    assert.ok(!gist.line, 'the gist needs no selection');
    assert.ok(CODE_PROMPTS.some(p => p.line) && CODE_PROMPTS.some(p => !p.line));
});

test("the tooltip's explain prompt names its subject and carries the code's note when there is one", () => {
    const withNote = explainPrompt('`h`', 'The heuristic.');
    assert.ok(withNote.line, 'it is about the selected lines');
    assert.match(withNote.prompt, /^Explain `h` in the selected code/);
    assert.match(withNote.prompt, /The code's own note about it:\nThe heuristic\.$/);
    assert.doesNotMatch(explainPrompt('lines 3–5', null).prompt, /note/);
});
