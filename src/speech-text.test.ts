import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechText, extractInlineToolCalls } from '/speech-text.js';

test('a tool call written into a reply is removed and its JSON arguments recovered', () => {
    const reply = 'Want to see Day 0 pushed? <?set_preset_prompts prompts=["Next step", "Skip to the first \'pop\'"] ?>';
    const {text, calls} = extractInlineToolCalls(reply);
    assert.equal(text, 'Want to see Day 0 pushed?');
    assert.deepEqual(calls, [{name: 'set_preset_prompts', args: {prompts: ['Next step', "Skip to the first 'pop'"]}}]);
    const other = extractInlineToolCalls('Index 5 joins.\n\n<call:set_preset_prompts prompts=["Next window"] />');
    assert.deepEqual(other, {text: 'Index 5 joins.', calls: [{name: 'set_preset_prompts', args: {prompts: ['Next window']}}]}, 'the <call:… /> spelling too');
});

test('speech reads the words, not the markdown or LaTeX', () => {
    assert.equal(speechText('Exactly! Since $74 > 73$, Day 0 is **popped** and `answer[0]` is $1 - 0 = 1$.'),
        'Exactly! Since 74 > 73, Day 0 is popped and answer[0] is 1 - 0 = 1.');
    assert.equal(speechText('# Key points\n- one *idea*\n- $\\text{total} \\le 18$'), 'Key points. one idea. total ≤ 18');
    assert.equal(speechText('See [the docs](https://x.y) <?set_preset_prompts prompts=["a"] ?>'), 'See the docs');
    assert.equal(speechText('snake_case_name stays'), 'snake_case_name stays', 'underscores inside words are not emphasis');
});
