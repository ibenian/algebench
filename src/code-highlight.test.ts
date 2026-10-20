import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode, lineTokens } from '/code-highlight.js';

test("a line's tokens come back in column order, empty ranges dropped", () => {
    const tokens = [
        {line: 2, col: 6, endCol: 9, kind: 'string'}, {line: 1, col: 0, endCol: 3, kind: 'keyword'},
        {line: 2, col: 0, endCol: 3, kind: 'keyword'}, {line: 2, col: 4, endCol: 4, kind: 'operator'},
    ];
    assert.deepEqual(lineTokens(tokens, 2).map(t => t.col), [0, 6]);
    assert.deepEqual(lineTokens(tokens, 3), []);
});

test('tokens are fetched once per language and source; failures and missing languages give none', async () => {
    const calls: string[] = [];
    const g = globalThis as unknown as {fetch: typeof fetch};
    const saved = g.fetch;
    g.fetch = (async (_url: string, init: {body: string}) => {
        const {language} = JSON.parse(init.body);
        calls.push(language);
        if (language === 'broken') throw new Error('offline');
        return {ok: true, json: async () => ({tokens: [{line: 1, col: 0, endCol: 3, kind: 'keyword'}]})};
    }) as unknown as typeof fetch;
    try {
        const file = {language: 'Python', source: 'def f(): pass'};
        assert.equal((await highlightCode(file)).length, 1);
        assert.equal((await highlightCode({...file})).length, 1);
        assert.deepEqual(calls, ['python'], 'one request, language normalized');
        assert.deepEqual(await highlightCode({source: 'x'}), [], 'no language, no request');
        assert.deepEqual(await highlightCode({language: 'broken', source: 'x'}), []);
    } finally { g.fetch = saved; }
});
