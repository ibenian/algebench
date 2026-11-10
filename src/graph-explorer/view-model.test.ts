// node:test — exploration / presentation state (no renderer involved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphEngine } from '/graph-explorer/graph-engine.js';
import { GraphViewModel, type ViewPatch } from '/graph-explorer/view-model.js';

type G = GraphEngine<{ label: string }, null>;

/**   a → b → c → d        (chain)
 *    b → e, c → e         (e shared by b and c)
 *    f → a, d → f         (cycle a b c d f)
 *    x → y                (separate component)
 */
function sample(): G {
    const g: G = new GraphEngine();
    g.batch(() => {
        for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'x', 'y']) g.addNode(id, { label: id.toUpperCase() });
        const E = (s: string, t: string, type = 'uses') => g.addEdge({ id: `${s}|${type}|${t}`, source: s, target: t, type, data: null });
        E('a', 'b'); E('b', 'c'); E('c', 'd'); E('b', 'e'); E('c', 'e'); E('f', 'a', 'part-of'); E('d', 'f'); E('x', 'y');
    });
    return g;
}

function vmOf(g: G, opts: { maxVisible?: number } = {}) {
    const vm = new GraphViewModel(g, { graphType: 'knowledge', contextId: 'test',
        searchText: (n) => n.data.label.toLowerCase(), ...opts });
    const patches: ViewPatch[] = [];
    const states: string[] = [];
    vm.events.on('view', (p) => patches.push(p));
    vm.events.on('state', (s) => states.push(s.reason));
    return { vm, patches, states };
}

const sorted = (s: Iterable<string>) => [...s].sort();

test('focus defaults to a 1-hop neighbourhood and selects the focus', () => {
    const { vm, patches } = vmOf(sample());
    assert.equal(vm.focusOn('b'), true);
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'e']);
    assert.deepEqual(vm.selection, { kind: 'node', id: 'b' });
    assert.deepEqual(sorted(vm.visibleEdges), ['a|uses|b', 'b|uses|c', 'b|uses|e', 'c|uses|e']);
    assert.equal(patches.length, 1);
    assert.equal(patches[0]!.anchor, 'b');
    assert.equal(vm.focusOn('nope'), false);
});

test('depth: expanding the focus to 2 hops, and back down to 0', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('a');
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'f']);
    vm.setFocusDepth(2);
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(vm.focusDepth, 2);
    vm.setFocusDepth(0);
    assert.deepEqual(sorted(vm.visibleNodes), ['a']);
});

test('expand/collapse keeps nodes still needed by another expanded neighbourhood (shared neighbours)', () => {
    const { vm, patches } = vmOf(sample());
    vm.focusOn('b');                  // a b c e
    vm.expand('c');                   // + d (e already shown)
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'd', 'e']);
    const expandPatch = patches.at(-1)!;
    assert.deepEqual(expandPatch.nodesAdded, ['d'], 'no duplicate add for the shared neighbour e');
    assert.equal(expandPatch.anchor, 'c');
    vm.collapse('c');
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'e'], 'e and c stay: the focus still reaches them');
    assert.deepEqual(patches.at(-1)!.nodesRemoved, ['d']);
    assert.equal(vm.collapse('c'), false, 'collapsing twice is a no-op');
});

test('cycles are visited once; no duplicate nodes or edges', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('a', 6);
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(vm.visibleEdges.size, 7);
});

test('collapsing the focus shrinks it to depth 0 rather than hiding it', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('c');
    vm.collapse('c');
    assert.deepEqual(sorted(vm.visibleNodes), ['c']);
    assert.equal(vm.focus, 'c');
});

test('history: back restores the previous focus, expansions and selection', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('a');
    vm.expand('b');
    vm.select({ kind: 'edge', id: 'a|uses|b' });
    const before = { vis: sorted(vm.visibleNodes), roots: [...vm.roots], sel: vm.selection };
    vm.focusOn('x');
    assert.deepEqual(sorted(vm.visibleNodes), ['x', 'y']);
    assert.equal(vm.canGoBack, true);
    assert.equal(vm.back(), true);
    assert.equal(vm.focus, 'a');
    assert.deepEqual(sorted(vm.visibleNodes), before.vis);
    assert.deepEqual([...vm.roots], before.roots);
    assert.deepEqual(vm.selection, before.sel);
    assert.equal(vm.back(), false, 'nothing before the first focus');
});

test('forward re-applies what back undid; a new focus clears the forward trail', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('a');
    vm.focusOn('c');
    vm.expand('d');
    assert.equal(vm.canGoForward, false);
    vm.back();
    assert.equal(vm.focus, 'a');
    assert.equal(vm.canGoForward, true);
    assert.equal(vm.forward(), true);
    assert.equal(vm.focus, 'c');
    assert.deepEqual([...vm.roots], [['c', 1], ['d', 1]], 'expansions come back too');
    assert.equal(vm.forward(), false);
    vm.back();
    assert.equal(vm.back(), false, 'the empty view before the first focus is not history');
    assert.equal(vm.focus, 'a');
    vm.focusOn('x');                         // new navigation: forward history dropped
    assert.equal(vm.canGoForward, false);
    assert.equal(vm.back(), true);
    assert.equal(vm.focus, 'a');
});

test('selection: nodes and edges, invalid ids ignored, re-selecting is silent', () => {
    const { vm, states } = vmOf(sample());
    vm.focusOn('a');
    states.length = 0;
    vm.select({ kind: 'edge', id: 'a|uses|b' });
    vm.select({ kind: 'edge', id: 'a|uses|b' });
    assert.deepEqual(states, ['selection']);
    vm.select({ kind: 'node', id: 'ghost' });
    assert.equal(vm.selection, null);
});

test('presentation transitions (embedded → popup → fullscreen) never change exploration state', () => {
    const { vm, patches } = vmOf(sample());
    vm.setPresentation('embedded');
    vm.focusOn('b');
    vm.expand('c');
    vm.select({ kind: 'node', id: 'd' });
    vm.saveViewport({ zoom: 1.7, pan: { x: 12, y: -40 } });
    vm.savePosition('d', { x: 5, y: 6 });
    const snapshot = JSON.stringify({ f: vm.focus, r: [...vm.roots], s: vm.selection, v: sorted(vm.visibleNodes),
        e: sorted(vm.visibleEdges), vp: vm.viewport, p: [...vm.positions], h: vm.historyLength });
    const patchCount = patches.length;
    for (const m of ['popup', 'fullscreen', 'popup', 'embedded', 'closed', 'fullscreen'] as const) vm.setPresentation(m);
    assert.equal(vm.presentation, 'fullscreen');
    assert.equal(patches.length, patchCount, 'no view patches from presentation changes');
    assert.equal(JSON.stringify({ f: vm.focus, r: [...vm.roots], s: vm.selection, v: sorted(vm.visibleNodes),
        e: sorted(vm.visibleEdges), vp: vm.viewport, p: [...vm.positions], h: vm.historyLength }), snapshot);
});

test('presentation changes never mutate graph data', () => {
    const g = sample();
    const { vm } = vmOf(g);
    const rev = g.revision;
    vm.focusOn('a'); vm.expand('b'); vm.collapse('b'); vm.select(null); vm.back();
    vm.setPresentation('fullscreen'); vm.saveViewport({ zoom: 2, pan: { x: 0, y: 0 } }); vm.showOverview(3);
    vm.setRelationTypeVisible('uses', false);
    assert.equal(g.revision, rev);
});

test('runtime data change while open: new node + relation appear incrementally, anchored', () => {
    const g = sample();
    const { vm, patches } = vmOf(g);
    vm.focusOn('b');
    const n = patches.length;
    g.batch(() => {
        g.addNode('new', { label: 'New' });
        g.addEdge({ id: 'b|uses|new', source: 'b', target: 'new', type: 'uses', data: null });
    });
    assert.equal(patches.length, n + 1, 'one view patch for the batched change');
    const p = patches.at(-1)!;
    assert.deepEqual(p.nodesAdded, ['new']);
    assert.deepEqual(p.edgesAdded, ['b|uses|new']);
    assert.deepEqual(p.nodesRemoved, []);
    assert.equal(p.anchor, 'b');
    // a node added far from the view is not shown
    g.addNode('far', { label: 'Far' });
    assert.equal(vm.visibleNodes.has('far'), false);
    // an update to a visible node is forwarded
    g.updateNode('c', { label: 'C2' });
    assert.deepEqual(patches.at(-1)!.nodesUpdated, ['c']);
});

test('removing the focused node clears focus/selection and its neighbourhood', () => {
    const g = sample();
    const { vm, states } = vmOf(g);
    vm.focusOn('x');
    g.removeNode('x');
    assert.equal(vm.focus, null);
    assert.equal(vm.selection, null);
    assert.equal(vm.visibleNodes.size, 0);
    assert.ok(states.includes('data'));
});

test('bounded rendering: the cap limits visible nodes and flags truncation; focus survives', () => {
    const g: G = new GraphEngine();
    g.batch(() => {
        g.addNode('hub', { label: 'hub' });
        for (let i = 0; i < 500; i++) {
            g.addNode(`s${i}`, { label: `s${i}` });
            g.addEdge({ id: `h${i}`, source: 'hub', target: `s${i}`, type: 'uses', data: null });
        }
    });
    const { vm } = vmOf(g, { maxVisible: 50 });
    vm.focusOn('hub');
    assert.equal(vm.visibleNodes.size, 50);
    assert.equal(vm.truncated, true);
    assert.ok(vm.visibleNodes.has('hub'));
    vm.showOverview(10);
    assert.equal(vm.visibleNodes.size, 10);
    assert.ok(vm.visibleNodes.has('hub'), 'overview ranks by degree');
    assert.equal(vm.focus, null);
});

test('relation-type filter hides edges and the neighbours reached only through them', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('a');
    assert.ok(vm.visibleNodes.has('f'));
    vm.setRelationTypeVisible('part-of', false);
    assert.equal(vm.visibleNodes.has('f'), false);
    vm.setRelationTypeVisible('part-of', true);
    assert.ok(vm.visibleNodes.has('f'));
});

test('search: prefix matches rank first', () => {
    const g: G = new GraphEngine();
    g.addNode('1', { label: 'monotonic deque' });
    g.addNode('2', { label: 'deque' });
    g.addNode('3', { label: 'stack' });
    const { vm } = vmOf(g);
    assert.deepEqual(vm.search('deque'), ['2', '1']);
    assert.deepEqual(vm.search('  '), []);
});

test('dispose unsubscribes from the engine (no leaked listeners)', () => {
    const g = sample();
    const before = g.listenerCount;
    const { vm } = vmOf(g);
    assert.equal(g.listenerCount, before + 1);
    vm.dispose();
    assert.equal(g.listenerCount, before);
    assert.equal(vm.events.listenerCount(), 0);
    g.addNode('later', { label: 'L' });   // must not throw or notify
});

test('two contexts over one engine keep independent exploration state', () => {
    const g = sample();
    const global = vmOf(g).vm;
    const lesson = vmOf(g).vm;
    global.showOverview(3);
    lesson.focusOn('c');
    lesson.expand('d');
    assert.equal(global.focus, null);
    assert.equal(global.visibleNodes.size, 3);
    g.addNode('n', { label: 'n' });
    g.addEdge({ id: 'd|uses|n', source: 'd', target: 'n', type: 'uses', data: null });
    assert.ok(lesson.visibleNodes.has('n'), 'lesson context sees the update next to its expansion');
});

test('hidden-neighbour count: what an expand would reveal', () => {
    const { vm } = vmOf(sample());
    vm.focusOn('b');                       // a b c e visible
    assert.equal(vm.hiddenNeighborCount('c'), 1, 'd is hidden');
    assert.equal(vm.hiddenNeighborCount('b'), 0);
    assert.equal(vm.hiddenNeighborCount('a'), 1, 'f via the part-of edge');
    vm.setRelationTypeVisible('part-of', false);
    assert.equal(vm.hiddenNeighborCount('a'), 0, 'filtered relation types do not count');
    vm.expand('c');
    assert.equal(vm.hiddenNeighborCount('c'), 0);
});

test('scope: a local scope limits focus neighbourhoods, overview, search and edges; global restores them', () => {
    const g = sample();
    const { vm, patches } = vmOf(g);
    const local = new Set(['a', 'b', 'c']);                 // "this lesson's" concepts
    vm.focusOn('b');                                        // a b c e
    const rev = g.revision;
    vm.setScope('local', (id) => local.has(id));
    assert.equal(vm.scopeId, 'local');
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c']);
    assert.deepEqual(patches.at(-1)!.nodesRemoved, ['e'], 'switching scope is an incremental diff');
    assert.ok([...vm.visibleEdges].every((e) => e.split('|').every((p, i) => i === 1 || local.has(p))), 'no edge leaves the scope');
    assert.deepEqual(vm.search('e'), [], 'search stays in scope');
    assert.equal(vm.hiddenNeighborCount('c'), 0, 'out-of-scope neighbours are not offered');
    vm.showOverview(10);
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c']);
    vm.back();
    vm.setScope('global', null);
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b', 'c', 'e'], 'global restores the full neighbourhood');
    assert.equal(g.revision, rev, 'scope is presentation-only: the graph data never changes');
});

test('scope: a focus outside the scope shows nothing until refocused; data added later is classified live', () => {
    const g = sample();
    const { vm } = vmOf(g);
    vm.focusOn('x');
    const local = new Set(['a', 'b']);
    vm.setScope('local', (id) => local.has(id));
    assert.equal(vm.visibleNodes.size, 0);
    vm.focusOn('a');
    assert.deepEqual(sorted(vm.visibleNodes), ['a', 'b']);
    g.addNode('n', { label: 'n' });
    g.addEdge({ id: 'a|uses|n', source: 'a', target: 'n', type: 'uses', data: null });
    assert.equal(vm.visibleNodes.has('n'), false, 'not in scope yet');
    local.add('n');
    g.updateNode('n', { label: 'N' });                      // any data change re-evaluates the scope
    assert.ok(vm.visibleNodes.has('n'));
});
