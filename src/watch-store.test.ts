import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchStore, watchKey } from '/watch-store.js';

test('without IndexedDB, watches last the session and stay per lesson', async () => {
    const store = createWatchStore(undefined);
    const a = {lesson: 'Graphs', file: 'bipartite', line: 15, expr: '1 - color[u]'};
    await store.add(a);
    await store.add({...a, lesson: 'Other'});
    await store.add(a);
    assert.deepEqual(await store.list('Graphs'), [a], 'the same watch once');
    await store.remove(a);
    assert.deepEqual(await store.list('Graphs'), []);
    assert.equal((await store.list('Other')).length, 1);
});

test('a watch is keyed by lesson, file, line and expression', () => {
    const w = {lesson: 'L', file: 'f', line: 3, expr: 'u'};
    assert.notEqual(watchKey(w), watchKey({...w, lesson: 'M'}));
    assert.notEqual(watchKey(w), watchKey({...w, line: 4}));
});
