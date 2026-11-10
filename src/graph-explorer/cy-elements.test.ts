// node:test — AlgeBench records → Cytoscape element definitions, stable
// placement, and the knowledge adapter's labels / classes / details HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLabel, ringPlacement, toCyEdge, toCyNode } from '/graph-explorer/cy-elements.js';
import { classToken } from '/graph-explorer/graph-type.js';
import { createKnowledgeAdapter } from '/graph-explorer/knowledge-adapter.js';
import { createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph } from '/graph-explorer/knowledge-model.js';

const adapter = createKnowledgeAdapter({ renderMarkdown: (md) => `<p>${md.replace(/</g, '&lt;')}</p>` });

function store() {
    const kg = createKnowledgeGraph();
    const p = parseLessonKnowledgeGraph({
        concepts: [
            { id: 'dsa.monotonic-deque', label: 'Monotonic Deque', category: 'data-structure', definition: 'def', refs: [{ scene: 1, step: 3, label: 'there' }] },
            { id: 'dsa.deque', label: 'Deque <b>', category: 'Data Structure!' },
            { id: 'x"y', label: 'Quote' },
        ],
        relations: [
            { source: 'dsa.monotonic-deque', target: 'dsa.deque', type: 'specializes', description: 'why' },
            { source: 'x"y', target: 'dsa.deque', type: 'related-to' },
        ],
    }, { lessonId: 'draft/swm', lessonTitle: 'SWM', draft: true });
    mergeIntoGraph(kg, p);
    return kg;
}

test('node conversion: id/label kept, classes from the adapter, position optional', () => {
    const kg = store();
    const def = toCyNode(kg.getNode('dsa.monotonic-deque')!, adapter, { x: 1, y: 2 });
    assert.equal(def.group, 'nodes');
    assert.equal(def.data.id, 'dsa.monotonic-deque');
    assert.equal(def.data.label, 'Monotonic Deque');
    assert.deepEqual(def.classes.split(' '), ['node', 'concept', 'cat-data-structure']);
    assert.deepEqual(def.position, { x: 1, y: 2 });
    assert.equal(toCyNode(kg.getNode('dsa.deque')!, adapter).position, undefined);
});

test('edge conversion keeps direction, type and the stable relation id', () => {
    const kg = store();
    const def = toCyEdge(kg.getEdge('dsa.monotonic-deque|specializes|dsa.deque')!, adapter);
    assert.equal(def.group, 'edges');
    assert.equal(def.data.id, 'dsa.monotonic-deque|specializes|dsa.deque');
    assert.equal(def.data.source, 'dsa.monotonic-deque');
    assert.equal(def.data.target, 'dsa.deque');
    assert.equal(def.data.relType, 'specializes');
    assert.equal(def.data.label, 'specializes');
    assert.ok(def.classes.includes('kind-structural'));
    assert.ok(toCyEdge(kg.getEdge('x"y|related-to|dsa.deque')!, adapter).classes.includes('kind-association'));
});

test('conversion is deterministic (stable ids → stable elements)', () => {
    const kg = store();
    const a = JSON.stringify([...kg.allNodes()].map((n) => toCyNode(n, adapter)));
    const b = JSON.stringify([...kg.allNodes()].map((n) => toCyNode(n, adapter)));
    assert.equal(a, b);
});

test('class tokens are sanitised', () => {
    assert.equal(classToken('Data Structure!'), 'data-structure');
    assert.equal(classToken('<script>'), 'script');
    assert.equal(classToken('!!!'), 'x');
    const kg = store();
    assert.ok(toCyNode(kg.getNode('dsa.deque')!, adapter).classes.includes('cat-data-structure'));
});

test('ring placement: new nodes avoid existing ones and never move them', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 0, y: -104 }];
    const copy = JSON.parse(JSON.stringify(occupied));
    const pts = ringPlacement({ x: 0, y: 0 }, 12, occupied, { minGap: 90 });
    assert.equal(pts.length, 12);
    assert.deepEqual(occupied, copy, 'inputs untouched');
    const all = [...occupied, ...pts];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i]!.x - all[j]!.x, all[i]!.y - all[j]!.y);
        assert.ok(d >= 89.9 || i < occupied.length && j < occupied.length, `points ${i},${j} too close (${d})`);
    }
});

test('details HTML escapes data and exposes explicit navigation, not automatic', () => {
    const kg = store();
    const html = adapter.nodeDetailsHtml(kg.getNode('dsa.deque')!, kg, { expanded: false, isFocus: false });
    assert.ok(html.includes('Deque &lt;b&gt;'), 'label escaped');
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('is generalized by'), 'incoming relation read backwards');
    assert.ok(html.includes('data-kg-action="expand"'));
    assert.ok(html.includes('data-kg-lesson="draft/swm"'), 'lesson navigation is a button');
    assert.ok(html.includes('No definition authored'), 'missing metadata is stated, not invented');
    const md = adapter.nodeDetailsHtml(kg.getNode('dsa.monotonic-deque')!, kg, { expanded: true, isFocus: true });
    assert.ok(md.includes('Scene 2 · Step 4 — there'));
    assert.ok(md.includes('data-kg-action="collapse"'));
    assert.ok(!md.includes('data-kg-action="focus"'));
    const q = adapter.nodeDetailsHtml(kg.getNode('x"y')!, kg, { expanded: false, isFocus: false });
    assert.ok(q.includes('x&quot;y'));
});

test('edge details state type and direction', () => {
    const kg = store();
    const html = adapter.edgeDetailsHtml(kg.getEdge('dsa.monotonic-deque|specializes|dsa.deque')!, kg);
    assert.ok(html.includes('Direction: Monotonic Deque → Deque &lt;b&gt;'));
    assert.ok(html.includes('>specializes<'));
    assert.ok(html.includes('SWM'), 'asserting lesson listed by title');
});

test('Ask-AI prompts carry the concept, its relationships and what is visible', () => {
    const kg = store();
    const view = { focus: 'dsa.monotonic-deque', nodes: new Set(['dsa.monotonic-deque', 'dsa.deque', 'x"y']),
                   edges: new Set(['dsa.monotonic-deque|specializes|dsa.deque', 'x"y|related-to|dsa.deque']) };
    const q = adapter.askPrompt!(kg.getNode('dsa.deque')!, kg, view);
    assert.ok(q.startsWith('Explain the concept "Deque <b>".'));
    assert.ok(q.includes('Its relationships in the knowledge graph: Monotonic Deque specializes Deque <b>'), 'incoming read source-first');
    assert.ok(q.includes('Other concepts visible in my knowledge graph: Monotonic Deque (focus), Quote.'), 'focus first, self excluded');
    assert.ok(q.includes('Visible relationships: Monotonic Deque specializes Deque <b>; Quote is related to Deque <b>.'));
    const e = adapter.askEdgePrompt!(kg.getEdge('dsa.monotonic-deque|specializes|dsa.deque')!, kg, view);
    assert.ok(e.startsWith('Explain why "Monotonic Deque" specializes "Deque <b>". (The lesson says: why)'));
    assert.ok(e.includes('Other concepts visible in my knowledge graph:'));
    const alone = adapter.askPrompt!(kg.getNode('dsa.deque')!, kg, { focus: 'dsa.deque', nodes: new Set(['dsa.deque']), edges: new Set() });
    assert.ok(!alone.includes('Other concepts visible'), 'nothing else on screen: no context line');
});

test('visible context is bounded and says what it left out', () => {
    const kg = createKnowledgeGraph();
    const concepts = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, label: `C${String(i).padStart(2, '0')}` }));
    mergeIntoGraph(kg, parseLessonKnowledgeGraph({ concepts }, { lessonId: 'l', lessonTitle: 'L' }));
    const q = adapter.askPrompt!(kg.getNode('c0')!, kg, { focus: null, nodes: new Set(concepts.map((c) => c.id)), edges: new Set() });
    assert.ok(q.includes('and 19 more.'));
});

test('display label carries the hidden-neighbour badge only when there are hidden neighbours', () => {
    assert.equal(displayLabel('Deque', 0), 'Deque');
    assert.equal(displayLabel('Deque', 3), 'Deque  ＋3');
    const kg = store();
    const html = adapter.nodeDetailsHtml(kg.getNode('dsa.deque')!, kg, { expanded: false, isFocus: false, hidden: 2 });
    assert.ok(html.includes('Show 2 hidden neighbours'));
    const none = adapter.nodeDetailsHtml(kg.getNode('dsa.deque')!, kg, { expanded: false, isFocus: false, hidden: 0 });
    assert.ok(none.includes('All neighbours shown') && !none.includes('data-kg-action="expand"'));
});
