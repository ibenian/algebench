// node:test — performance characterisation of the model + view-model layers at
// representative sizes (20 / 100 / 500 / 1,000 concepts, ~3 relations each).
// Renderer timings depend on a browser and are recorded separately in
// docs/knowledge-graph-explorer.md. Bounds here are deliberately generous —
// they catch accidental quadratic behaviour, not micro-regressions.
// Run alone with timings:  node --experimental-strip-types \
//   --import ./scripts/register-test-resolver.mjs --test src/graph-explorer/perf.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { GraphEngine } from '/graph-explorer/graph-engine.js';
import { GraphViewModel } from '/graph-explorer/view-model.js';

/** Deterministic pseudo-random graph: a spanning chain plus random extra edges. */
function build(n: number, perNode = 3): GraphEngine<{ label: string }, null> {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const g = new GraphEngine<{ label: string }, null>();
    g.batch(() => {
        for (let i = 0; i < n; i++) g.addNode(`c${i}`, { label: `Concept ${i}` });
        for (let i = 1; i < n; i++) g.addEdge({ id: `t${i}`, source: `c${Math.floor(rnd() * i)}`, target: `c${i}`, type: 'uses', data: null });
        for (let k = 0; k < n * (perNode - 1); k++) {
            const s = Math.floor(rnd() * n), t = Math.floor(rnd() * n);
            const id = `r${s}-${t}`;
            if (s !== t && !g.hasEdge(id)) g.addEdge({ id, source: `c${s}`, target: `c${t}`, type: 'related-to', data: null });
        }
    });
    return g;
}

const time = (fn: () => void): number => { const t = performance.now(); fn(); return performance.now() - t; };

for (const n of [20, 100, 500, 1000]) {
    test(`model + view model at ${n} concepts`, (t) => {
        let g!: GraphEngine<{ label: string }, null>;
        const buildMs = time(() => { g = build(n); });
        const vm = new GraphViewModel(g, { graphType: 'knowledge', contextId: 'perf', maxVisible: 250 });
        let patches = 0;
        vm.events.on('view', () => patches++);
        const focus1 = time(() => vm.focusOn('c0', 1));
        const focus2 = time(() => vm.setFocusDepth(2));
        const visible2 = vm.visibleNodes.size;
        const expand = time(() => vm.expand(`c${n - 1}`));
        const before = patches;
        const update = time(() => g.batch(() => {
            g.addNode('live', { label: 'Live' });
            g.addEdge({ id: 'live-e', source: 'c0', target: 'live', type: 'uses', data: null });
        }));
        assert.equal(patches, before + 1, 'one incremental patch per batched update');
        assert.ok(vm.visibleNodes.has('live'));
        const overview = time(() => vm.showOverview(40));
        const query = time(() => { for (let i = 0; i < 1000; i++) g.neighbors(`c${i % n}`); });
        assert.ok(vm.visibleNodes.size <= 250);
        t.diagnostic(`n=${n} edges=${g.edgeCount} build=${buildMs.toFixed(2)}ms focus1=${focus1.toFixed(2)}ms `
            + `depth2=${focus2.toFixed(2)}ms (2-hop visible ${visible2}) expand=${expand.toFixed(2)}ms `
            + `update=${update.toFixed(2)}ms overview=${overview.toFixed(2)}ms 1000xneighbors=${query.toFixed(2)}ms`);
        // Generous ceilings (CI machines vary): anything near these is a complexity bug.
        assert.ok(buildMs < 1500, `build ${buildMs}`);
        for (const [name, ms] of [['focus1', focus1], ['depth2', focus2], ['expand', expand], ['update', update], ['overview', overview]] as const) {
            assert.ok(ms < 400, `${name} took ${ms}ms`);
        }
    });
}
