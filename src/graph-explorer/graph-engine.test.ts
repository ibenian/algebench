// node:test — the renderer-independent graph engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphEngine, GraphValidationError, isValidId, type GraphPatch } from '/graph-explorer/graph-engine.js';

type P = GraphPatch<{ v: number }, { w?: number }>;

function line(n: number): GraphEngine<{ v: number }, { w?: number }> {
    const g = new GraphEngine<{ v: number }, { w?: number }>();
    g.batch(() => {
        for (let i = 0; i < n; i++) g.addNode(`n${i}`, { v: i });
        for (let i = 0; i + 1 < n; i++) g.addEdge({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}`, type: 'next', data: {} });
    });
    return g;
}

test('ids are validated', () => {
    assert.equal(isValidId('dsa.deque'), true);
    for (const bad of ['', ' x', 'x ', 'a\nb', 7, null, 'x'.repeat(300)]) assert.equal(isValidId(bad), false, String(bad));
    const g = new GraphEngine<number, null>();
    assert.throws(() => g.addNode('', 1), GraphValidationError);
});

test('duplicate node and edge ids are rejected; upsert merges instead', () => {
    const g = new GraphEngine<{ tags: string[] }, null>();
    g.addNode('a', { tags: ['x'] });
    assert.throws(() => g.addNode('a', { tags: [] }), /duplicate node/);
    const merge = (a: { tags: string[] }, b: { tags: string[] }) =>
        b.tags.every((t) => a.tags.includes(t)) ? a : { tags: [...a.tags, ...b.tags.filter((t) => !a.tags.includes(t))] };
    assert.equal(g.upsertNode('a', { tags: ['x'] }, merge), 'unchanged');
    assert.equal(g.upsertNode('a', { tags: ['y'] }, merge), 'updated');
    assert.deepEqual(g.getNode('a')!.data.tags, ['x', 'y']);
    g.addNode('b', { tags: [] });
    g.addEdge({ id: 'ab', source: 'a', target: 'b', type: 'uses', data: null });
    assert.throws(() => g.addEdge({ id: 'ab', source: 'a', target: 'b', type: 'uses', data: null }), /duplicate edge/);
    assert.throws(() => g.upsertEdge({ id: 'ab', source: 'b', target: 'a', type: 'uses', data: null }, (x) => x), /different relationship/);
});

test('edges need existing endpoints and a type', () => {
    const g = new GraphEngine<number, null>();
    g.addNode('a', 1);
    assert.throws(() => g.addEdge({ id: 'e', source: 'a', target: 'zz', type: 't', data: null }), /unknown target/);
    assert.throws(() => g.addEdge({ id: 'e', source: 'zz', target: 'a', type: 't', data: null }), /unknown source/);
    g.addNode('b', 2);
    assert.throws(() => g.addEdge({ id: 'e', source: 'a', target: 'b', type: '', data: null }), /missing type/);
});

test('edges are directed and typed; adjacency is indexed both ways', () => {
    const g = new GraphEngine<number, null>();
    g.addNode('a', 1); g.addNode('b', 2); g.addNode('c', 3);
    g.addEdge({ id: 'ab', source: 'a', target: 'b', type: 'uses', data: null });
    g.addEdge({ id: 'cb', source: 'c', target: 'b', type: 'specializes', data: null });
    assert.deepEqual(g.edgeIdsOf('b', 'in').sort(), ['ab', 'cb']);
    assert.deepEqual(g.edgeIdsOf('b', 'out'), []);
    assert.deepEqual(g.neighbors('a', 'out'), ['b']);
    assert.deepEqual(g.neighbors('a', 'in'), []);
    assert.deepEqual(g.neighbors('b').sort(), ['a', 'c']);
    assert.equal(g.getEdge('cb')!.type, 'specializes');
    assert.equal(g.degree('b'), 2);
});

test('removing a node removes its edges and cleans the indexes', () => {
    const g = line(4);
    const patches: P[] = [];
    g.subscribe((p) => patches.push(p));
    g.removeNode('n1');
    assert.equal(g.hasEdge('e0'), false);
    assert.equal(g.hasEdge('e1'), false);
    assert.deepEqual(g.neighbors('n0'), []);
    assert.equal(patches.length, 1, 'one patch for the node and its edges');
    assert.deepEqual(patches[0]!.nodesRemoved.map((n) => n.id), ['n1']);
    assert.deepEqual(patches[0]!.edgesRemoved.map((e) => e.id).sort(), ['e0', 'e1']);
    assert.equal(patches[0]!.edgesRemoved[0]!.source !== undefined, true, 'removed edges keep their endpoints');
});

test('neighbourhood handles cycles and shared neighbours, with depth and limit', () => {
    const g = new GraphEngine<number, null>();
    for (const id of ['a', 'b', 'c', 'd', 'e']) g.addNode(id, 0);
    // cycle a→b→c→a, plus d shared by b and c, e two hops from d
    g.addEdge({ id: '1', source: 'a', target: 'b', type: 't', data: null });
    g.addEdge({ id: '2', source: 'b', target: 'c', type: 't', data: null });
    g.addEdge({ id: '3', source: 'c', target: 'a', type: 't', data: null });
    g.addEdge({ id: '4', source: 'b', target: 'd', type: 't', data: null });
    g.addEdge({ id: '5', source: 'c', target: 'd', type: 't', data: null });
    g.addEdge({ id: '6', source: 'd', target: 'e', type: 't', data: null });
    const one = g.neighborhood(['a'], 1).nodes;
    assert.deepEqual([...one.keys()].sort(), ['a', 'b', 'c']);
    const two = g.neighborhood(['a'], 2).nodes;
    assert.deepEqual([...two.keys()].sort(), ['a', 'b', 'c', 'd']);
    assert.equal(two.get('d'), 2);
    const outOnly = g.neighborhood(['d'], 3, { dir: 'out' }).nodes;
    assert.deepEqual([...outOnly.keys()].sort(), ['d', 'e']);
    const capped = g.neighborhood(['a'], 5, { limit: 3 });
    assert.equal(capped.nodes.size, 3);
    assert.equal(capped.truncated, true);
    const filtered = g.neighborhood(['b'], 1, { edgeFilter: (e) => e.id !== '4' }).nodes;
    assert.equal(filtered.has('d'), false);
});

test('batch coalesces many mutations into one patch; add+remove inside a batch cancels', () => {
    const g = new GraphEngine<number, null>();
    const patches: GraphPatch<number, null>[] = [];
    g.subscribe((p) => patches.push(p));
    g.batch(() => {
        g.addNode('a', 1); g.addNode('b', 2); g.addNode('tmp', 0);
        g.updateNode('a', 10);                           // update of a fresh add = just the add
        g.addEdge({ id: 'ab', source: 'a', target: 'b', type: 't', data: null });
        g.removeNode('tmp');
    });
    assert.equal(patches.length, 1);
    const p = patches[0]!;
    assert.deepEqual(p.nodesAdded, ['a', 'b']);
    assert.deepEqual(p.nodesUpdated, []);
    assert.deepEqual(p.nodesRemoved, []);
    assert.deepEqual(p.edgesAdded, ['ab']);
    assert.equal(g.getNode('a')!.data, 10);
    g.batch(() => {});                                      // empty batch: no patch
    assert.equal(patches.length, 1);
});

test('subscriptions: unsubscribe, a throwing listener does not stop others', () => {
    const g = new GraphEngine<number, null>();
    const seen: string[] = [];
    const orig = console.error; console.error = () => {};
    try {
        const offBad = g.subscribe(() => { throw new Error('boom'); });
        const off = g.subscribe((p) => seen.push(...p.nodesAdded));
        g.addNode('a', 1);
        off(); offBad();
        g.addNode('b', 2);
        assert.deepEqual(seen, ['a']);
        assert.equal(g.listenerCount, 0);
    } finally { console.error = orig; }
});

test('updates only touch the record; no whole-graph copies', () => {
    const g = line(50);
    const before = g.getNode('n10');
    const rev = g.revision;
    g.updateNode('n25', { v: -1 });
    assert.equal(g.getNode('n10'), before, 'unrelated records keep identity');
    assert.equal(g.revision, rev + 1);
    assert.equal(g.updateNode('missing', { v: 0 }), false);
    assert.equal(g.removeEdge('missing'), false);
});

test('clear empties the graph in one patch', () => {
    const g = line(5);
    let n = 0;
    g.subscribe(() => n++);
    g.clear();
    assert.equal(g.nodeCount, 0);
    assert.equal(g.edgeCount, 0);
    assert.equal(n, 1);
});
