import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchExpr, formatWatch, WatchError, conditionOf, truthOf, callReturns, returnText } from '/code-watch.js';

const names = ['u', 'v', 'color', 'queue'];
const col = (n: string) => `dataTable('trace', frame, '${n}')`;

test('names read their column at the current frame; indexing and len translate', () => {
    assert.equal(watchExpr('1 - color[u]', 'trace', names), `1 - arrayAt(${col('color')}, ${col('u')})`);
    assert.equal(watchExpr('len(queue) > 0', 'trace', names), `arrayCount(${col('queue')}) > 0`);
    assert.equal(watchExpr('color[v] == color[u] and not u == v', 'trace', names),
        `arrayAt(${col('color')}, ${col('v')}) == arrayAt(${col('color')}, ${col('u')}) and not (${col('u')} == ${col('v')})`);
});

test('a name the run does not record reads from fixed, when given there', () => {
    const target = `dataTable('input', 0, 'target')`;
    assert.equal(watchExpr('u == target', 'trace', names, names, { target }), `${col('u')} == ${target}`);
    assert.equal(watchExpr('u', 'trace', names, names, { u: 'x' }), col('u'), 'a recorded column wins');
    assert.throws(() => watchExpr('u == target', 'trace', names), WatchError);
});

test('Python operators become math.js ones', () => {
    assert.equal(watchExpr('u // 2', 'trace', names), `floor((${col('u')}) / (2))`);
    assert.equal(watchExpr('u % 2', 'trace', names), `${col('u')} mod 2`);
    assert.equal(watchExpr('u ** 2', 'trace', names), `(${col('u')}) ^ (2)`);
    assert.equal(watchExpr('True', 'trace', names), 'true');
    assert.equal(watchExpr('u in queue', 'trace', names), `keyIndex(${col('queue')}, ${col('u')}) >= 0`);
    assert.equal(watchExpr('u + 1 not in queue', 'trace', names), `keyIndex(${col('queue')}, ${col('u')} + 1) < 0`);
    assert.equal(watchExpr('not u in queue', 'trace', names), `not (keyIndex(${col('queue')}, ${col('u')}) >= 0)`);
});

test('what cannot be watched says why', () => {
    assert.throws(() => watchExpr('adj[u]', 'trace', names), (e: unknown) => e instanceof WatchError && /"adj" isn't recorded.*It has: u, v, color, queue/.test((e as Error).message));
    assert.throws(() => watchExpr('color[v] = 1', 'trace', names), /assignment/);
    assert.throws(() => watchExpr('', 'trace', names), /Select an expression/);
    assert.throws(() => watchExpr('u +', 'trace', names), /ends too soon/);
    assert.throws(() => watchExpr('u; v', 'trace', names), /can't be watched/);
});

test('values print as Python would', () => {
    assert.equal(formatWatch([0, 1, -1]), '[0, 1, -1]');
    assert.equal(formatWatch(true), 'True');
    assert.equal(formatWatch(1 / 3), '0.3333');
});

test('an if, elif or while line gives its condition; other lines give none', () => {
    assert.equal(conditionOf('        if d + w < dist[v]:'), 'd + w < dist[v]');
    assert.equal(conditionOf('    while heap:'), 'heap');
    assert.equal(conditionOf('        elif color[v] == color[u]:  # a clash'), 'color[v] == color[u]');
    assert.equal(conditionOf('            continue  # stale'), null);
    assert.equal(conditionOf('    for v in adj[u]:'), null);
    assert.equal(conditionOf('    iffy = 1'), null);
});

test('a condition is true or false as Python tests it', () => {
    assert.equal(truthOf(true), true);
    assert.equal(truthOf(0), false);
    assert.equal(truthOf(3), true);
    assert.equal(truthOf([]), false, 'an empty list, as in while queue');
    assert.equal(truthOf([1]), true);
    assert.equal(truthOf({toArray: () => []}), false, 'a math.js matrix');
    assert.equal(truthOf(undefined), null);
});

test('returns map each call to its value; anything else, or no value, is none', () => {
    assert.deepEqual([...callReturns({'h(start)': 6, 'f(x)': [1, 2], 'g()': null})], [['h(start)', 6], ['f(x)', [1, 2]]]);
    for (const none of [undefined, null, 3, 'x', [1, 2], {toArray: () => []}]) assert.equal(callReturns(none).size, 0);
    assert.equal(returnText('h(start)', 6), 'h(start) → 6');
    assert.equal(returnText('find(x)', [0, 1]), 'find(x) → [0, 1]');
});
