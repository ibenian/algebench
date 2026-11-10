// node:test — runtime Knowledge Graph updates (the path a future tutor /
// Expert integration uses): validation boundary, incremental propagation to
// every view sharing the store, and the dev demo staying out of the bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphPatch } from '/graph-explorer/graph-engine.js';
import { GraphViewModel, type ViewPatch } from '/graph-explorer/view-model.js';
import {
    applyRuntimeUpdate, createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph,
    type ConceptData, type KnowledgeGraph, type RelationData,
} from '/graph-explorer/knowledge-model.js';
import { SLIDING_WINDOW_MINIMUM_UPDATE } from '/graph-explorer/fixtures/sliding-window-minimum.js';

const ROOT = join(import.meta.dirname, '..', '..');
const MIN = 'dsa.sliding-window-minimum';

/** The store as the app builds it: every real lesson block, concepts first. */
function lessonStore(): KnowledgeGraph {
    const kg = createKnowledgeGraph();
    const blocks = ['scenes/draft/sliding-window-maximum.json', 'scenes/draft/parenthesis-validation.json'].map((f) => {
        const spec = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
        return parseLessonKnowledgeGraph(spec.knowledgeGraph, { lessonId: f, lessonTitle: spec.title, glossary: spec.glossary }, () => true);
    });
    for (const p of blocks) mergeIntoGraph(kg, { concepts: p.concepts, relations: [] });
    for (const p of blocks) mergeIntoGraph(kg, { concepts: [], relations: p.relations });
    return kg;
}

function watch(kg: KnowledgeGraph, setup: (vm: GraphViewModel<ConceptData, RelationData>) => void) {
    const vm = new GraphViewModel<ConceptData, RelationData>(kg, { graphType: 'knowledge', contextId: 'test' });
    setup(vm);
    const patches: ViewPatch[] = [];
    vm.events.on('view', (p) => patches.push(p));
    return { vm, patches };
}

test('a runtime update adds concepts and typed relations, tagged runtime, without lesson JSON', () => {
    const kg = lessonStore();
    const before = kg.nodeCount;
    const res = applyRuntimeUpdate(kg, SLIDING_WINDOW_MINIMUM_UPDATE);
    assert.deepEqual([...res.parseIssues, ...res.issues], []);
    assert.equal(res.conceptsAdded, 1);
    assert.equal(res.relationsAdded, 3);
    assert.equal(kg.nodeCount, before + 1);
    const node = kg.getNode(MIN)!.data;
    assert.equal(node.origin, 'runtime');
    assert.deepEqual(node.lessons, [], 'no lesson reference is invented');
    const solves = kg.getEdge(`dsa.monotonic-deque|solves|${MIN}`)!;
    assert.equal(solves.type, 'solves');
    assert.equal(solves.source, 'dsa.monotonic-deque');
    assert.equal(solves.data.origin, 'runtime');
});

test('every view sharing the store gets ONE incremental patch; nothing is rebuilt', () => {
    const kg = lessonStore();
    const lesson = watch(kg, (vm) => vm.focusOn('dsa.monotonic-deque'));
    const global = watch(kg, (vm) => vm.showOverview(40));
    const enginePatches: GraphPatch<ConceptData, RelationData>[] = [];
    kg.subscribe((p) => enginePatches.push(p));
    const untouched = kg.getNode('dsa.deque');
    const visibleBefore = new Set(lesson.vm.visibleNodes);

    applyRuntimeUpdate(kg, SLIDING_WINDOW_MINIMUM_UPDATE);

    // Engine: one patch naming exactly the new records.
    assert.equal(enginePatches.length, 1);
    const ep = enginePatches[0]!;
    assert.deepEqual(ep.nodesAdded, [MIN]);
    assert.equal(ep.edgesAdded.length, 3);
    assert.deepEqual([ep.nodesUpdated, ep.nodesRemoved, ep.edgesUpdated, ep.edgesRemoved], [[], [], [], []]);
    assert.equal(kg.getNode('dsa.deque'), untouched, 'unrelated records keep identity (no copy)');

    // Lesson view (focused on Monotonic Deque, 1-hop): the new neighbour appears next to it.
    assert.equal(lesson.patches.length, 1);
    const lp = lesson.patches[0]!;
    assert.deepEqual(lp.nodesAdded, [MIN]);
    assert.ok(lp.edgesAdded.includes(`dsa.monotonic-deque|solves|${MIN}`));
    assert.deepEqual([lp.nodesRemoved, lp.edgesRemoved, lp.nodesUpdated], [[], [], []]);
    assert.equal(lp.anchor, 'dsa.monotonic-deque');
    for (const id of visibleBefore) assert.ok(lesson.vm.visibleNodes.has(id), `${id} stays visible`);

    // Global overview (no focus): the store changed but its bounded view did not grow.
    assert.ok(global.patches.every((p) => !p.nodesRemoved.length), 'nothing removed from the other view');
});

test('runtime updates can fill in existing concepts and relations (update, not just add)', () => {
    const kg = createKnowledgeGraph();
    applyRuntimeUpdate(kg, { concepts: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
                             relations: [{ source: 'x', target: 'y', type: 'uses' }] });
    const patches: GraphPatch<ConceptData, RelationData>[] = [];
    kg.subscribe((p) => patches.push(p));
    applyRuntimeUpdate(kg, { concepts: [{ id: 'x', label: 'X', definition: 'now defined', category: 'technique' }],
                             relations: [{ source: 'x', target: 'y', type: 'uses', description: 'because' }] });
    assert.equal(kg.getNode('x')!.data.definition, 'now defined');
    assert.equal(kg.getNode('x')!.data.category, 'technique');
    assert.equal(kg.getEdge('x|uses|y')!.data.description, 'because');
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]!.nodesUpdated, ['x']);
    assert.deepEqual(patches[0]!.edgesUpdated, ['x|uses|y']);
    // Re-sending the same proposal is a no-op: no patch at all.
    applyRuntimeUpdate(kg, { concepts: [{ id: 'x', label: 'X', definition: 'now defined' }] });
    assert.equal(patches.length, 1);
});

test('the validation boundary holds for runtime payloads (an Expert proposal is untrusted input)', () => {
    const kg = lessonStore();
    const rev = kg.revision;
    const bad = applyRuntimeUpdate(kg, {
        concepts: [{ id: '', label: 'no id' }, { label: 'missing id' }, 'nope'],
        relations: [
            { source: 'dsa.deque', target: 'dsa.ghost', type: 'uses' },       // unknown endpoint: never created
            { source: 'dsa.deque', target: 'dsa.deque', type: 'uses' },       // self relation
            { source: 'dsa.deque', target: 'dsa.stack', type: 'DROP TABLE' }, // bad type
        ],
    });
    assert.ok(bad.parseIssues.length >= 5);
    assert.equal(kg.revision, rev, 'a fully invalid payload changes nothing');
    assert.equal(kg.hasNode('dsa.ghost'), false);
    assert.equal(applyRuntimeUpdate(kg, [] as never).parseIssues[0], '"knowledgeGraph" must be an object');
});

test('runtime updates work on an empty store, independent of any lesson', () => {
    const kg = createKnowledgeGraph();
    const res = applyRuntimeUpdate(kg, SLIDING_WINDOW_MINIMUM_UPDATE);
    assert.equal(res.conceptsAdded, 1);
    assert.equal(res.relationsAdded, 0, 'relations to concepts nobody defined are rejected, not fabricated');
    assert.equal(res.parseIssues.length, 3);
});

test('the dev demo does not leak into the production bundle or lesson content', () => {
    const dist = join(ROOT, 'static', 'dist');
    for (const f of readdirSync(dist).filter((n) => n.endsWith('.js'))) {
        const js = readFileSync(join(dist, f), 'utf8');
        for (const needle of ['dsa.sliding-window-minimum', 'liveUpdateExample', 'SLIDING_WINDOW_MINIMUM_UPDATE']) {
            assert.equal(js.includes(needle), false, `${needle} found in static/dist/${f}`);
        }
    }
    const schema = readFileSync(join(ROOT, 'schemas', 'lesson.schema.json'), 'utf8');
    assert.equal(schema.includes('liveUpdateExample'), false);
});
