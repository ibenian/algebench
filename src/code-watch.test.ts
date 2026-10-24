import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchExpr, formatWatch, WatchError } from '/code-watch.js';

const names = ['u', 'v', 'color', 'queue'];
const col = (n: string) => `dataTable('trace', frame, '${n}')`;

test('names read their column at the current frame; indexing and len translate', () => {
    assert.equal(watchExpr('1 - color[u]', 'trace', names), `1 - arrayAt(${col('color')}, ${col('u')})`);
    assert.equal(watchExpr('len(queue) > 0', 'trace', names), `arrayCount(${col('queue')}) > 0`);
    assert.equal(watchExpr('color[v] == color[u] and not u == v', 'trace', names),
        `arrayAt(${col('color')}, ${col('v')}) == arrayAt(${col('color')}, ${col('u')}) and not (${col('u')} == ${col('v')})`);
});

test('Python operators become math.js ones', () => {
    assert.equal(watchExpr('u // 2', 'trace', names), `floor((${col('u')}) / (2))`);
    assert.equal(watchExpr('u % 2', 'trace', names), `${col('u')} mod 2`);
    assert.equal(watchExpr('u ** 2', 'trace', names), `(${col('u')}) ^ (2)`);
    assert.equal(watchExpr('True', 'trace', names), 'true');
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
