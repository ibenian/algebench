// node:test — knowledge-graph parsing, validation and cross-lesson merging,
// including the real demo lessons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    conceptAtPlace, createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph, relationId, relationInfo,
} from '/graph-explorer/knowledge-model.js';

const LESSON = { lessonId: 'draft/demo', lessonTitle: 'Demo', draft: true };

test('a lesson without a knowledgeGraph block yields nothing and no issues (backward compatible)', () => {
    const p = parseLessonKnowledgeGraph(undefined, LESSON);
    assert.deepEqual(p, { concepts: [], relations: [], issues: [] });
});

test('valid concepts and typed, directed relations parse with stable ids', () => {
    const p = parseLessonKnowledgeGraph({
        focus: 'b',
        concepts: [
            { id: 'a', label: 'A', category: 'problem', refs: [{ scene: 0 }, { scene: 1, step: 2, label: 'here' }] },
            { id: 'b', label: 'B', definition: 'Bee' },
        ],
        relations: [{ source: 'b', target: 'a', type: 'solves', description: 'why' }],
    }, LESSON);
    assert.deepEqual(p.issues, []);
    assert.equal(p.focus, 'b');
    assert.equal(p.concepts[0]!.data.lessons[0]!.places[0]!.step, -1, 'omitted step = scene base view');
    assert.deepEqual(p.concepts[0]!.data.lessons[0]!.places[1], { scene: 1, step: 2, label: 'here' });
    const r = p.relations[0]!;
    assert.equal(r.id, relationId('b', 'solves', 'a'));
    assert.equal(r.id, 'b|solves|a');
    assert.equal(r.source, 'b'); assert.equal(r.target, 'a'); assert.equal(r.type, 'solves');
});

test('malformed entries are dropped with an issue, never thrown', () => {
    const p = parseLessonKnowledgeGraph({
        focus: 'nope',
        concepts: [
            { id: 'a', label: 'A' },
            { id: 'a', label: 'dup' },             // duplicate in one lesson
            { id: '', label: 'no id' },
            { id: 'nolabel' },
            'not an object',
            { id: 'r', label: 'R', refs: [{ scene: -1 }, { scene: 0, step: 'x' }] },
        ],
        relations: [
            { source: 'a', target: 'ghost', type: 'uses' },     // unknown endpoint: never fabricated
            { source: 'a', target: 'a', type: 'uses' },         // self relation
            { source: 'a', target: 'r', type: 'Bad Type' },
            { source: 'a', target: 'r', type: 'uses' },
            { source: 'a', target: 'r', type: 'uses' },         // duplicate
        ],
    }, LESSON);
    assert.deepEqual(p.concepts.map((c) => c.id), ['a', 'r']);
    assert.equal(p.concepts[1]!.data.lessons[0]!.places.length, 0);
    assert.deepEqual(p.relations.map((r) => r.id), ['a|uses|r']);
    assert.equal(p.focus, undefined);
    for (const frag of ['duplicate concept', 'invalid id', 'missing label', 'unknown concept', 'cannot relate to itself',
                        'lowercase-kebab', 'duplicate relation', 'focus']) {
        assert.ok(p.issues.some((m) => m.includes(frag)), `issue mentioning "${frag}"`);
    }
    assert.deepEqual(parseLessonKnowledgeGraph([], LESSON).issues, ['"knowledgeGraph" must be an object']);
});

test('glossary definitions are used only through an explicit key', () => {
    const glossary = { deque: { term: 'Deque', markdown: 'double-ended queue' } };
    const p = parseLessonKnowledgeGraph({
        concepts: [
            { id: 'x', label: 'Deque' },                        // same label, no key: NOT linked
            { id: 'y', label: 'Q', glossary: 'deque' },
            { id: 'z', label: 'Z', glossary: 'missing' },
        ],
    }, { ...LESSON, glossary });
    assert.equal(p.concepts[0]!.data.definition, undefined);
    assert.equal(p.concepts[1]!.data.definition, 'double-ended queue');
    assert.ok(p.issues.some((m) => m.includes('"missing" not found')));
});

test('the same concept id in two lessons merges; labels and aliases never merge', () => {
    const kg = createKnowledgeGraph();
    const l1 = parseLessonKnowledgeGraph({
        concepts: [{ id: 'dsa.deque', label: 'Deque', refs: [{ scene: 1 }] }, { id: 'dsa.stack', label: 'Stack' }],
        relations: [{ source: 'dsa.stack', target: 'dsa.deque', type: 'specializes' }],
    }, { lessonId: 'one', lessonTitle: 'One' });
    let patches = 0;
    kg.subscribe(() => patches++);
    mergeIntoGraph(kg, l1);
    // Parsed after lesson one is in the store, so its relation may use dsa.stack.
    const l2 = parseLessonKnowledgeGraph({
        concepts: [
            { id: 'dsa.deque', label: 'Double-ended queue', definition: 'later def' },
            { id: 'other.stack', label: 'Stack' },                 // same label, different id: separate concept
        ],
        relations: [{ source: 'dsa.stack', target: 'dsa.deque', type: 'specializes' }],
    }, { lessonId: 'two', lessonTitle: 'Two' }, (id) => kg.hasNode(id));
    const res = mergeIntoGraph(kg, l2);
    assert.equal(patches, 2, 'one patch per merged lesson');
    assert.equal(kg.nodeCount, 3);
    const deque = kg.getNode('dsa.deque')!.data;
    assert.equal(deque.label, 'Deque', 'first label kept');
    assert.ok(res.issues.some((m) => m.includes('labelled "Deque" elsewhere')));
    assert.equal(deque.definition, 'later def', 'missing definition filled from another lesson');
    assert.deepEqual(deque.lessons.map((l) => l.lessonId), ['one', 'two']);
    assert.equal(kg.edgeCount, 1, 'the same relation asserted twice is one edge');
    assert.deepEqual(kg.getEdge('dsa.stack|specializes|dsa.deque')!.data.lessons, ['one', 'two']);
    // idempotent: merging the same lesson again changes nothing
    const again = mergeIntoGraph(kg, l1);
    assert.equal(again.conceptsAdded, 0);
    assert.equal(patches, 2, 'no-op merge publishes nothing');
});

test('relation vocabulary has inverse readings; unknown types still render', () => {
    assert.equal(relationInfo('uses').inverse, 'is used by');
    assert.equal(relationInfo('prerequisite-of').kind, 'dependency');
    assert.equal(relationInfo('cites-heavily').verb, 'cites heavily');
});

test('a block carrying the removed liveUpdateExample field gets no special treatment', () => {
    // The demo moved to a test fixture + the runtime API; the parser ignores the
    // key (strict schema validation rejects it — tests/test_knowledge_graph_api.py).
    const p = parseLessonKnowledgeGraph({
        concepts: [{ id: 'a', label: 'A' }],
        liveUpdateExample: { concepts: [{ id: 'b', label: 'B' }] },
    }, LESSON);
    assert.deepEqual(p.concepts.map((c) => c.id), ['a']);
    assert.equal('liveUpdate' in p, false);
});

// ---------- the real lesson files ----------

const ROOT = join(import.meta.dirname, '..', '..');
function lessonFiles(): string[] {
    const dir = join(ROOT, 'scenes');
    return [
        ...readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)),
        ...readdirSync(join(dir, 'draft')).filter((f) => f.endsWith('.json')).map((f) => join(dir, 'draft', f)),
    ];
}

test('every lesson knowledgeGraph block in scenes/ parses without issues', () => {
    let withGraph = 0;
    const kg = createKnowledgeGraph();
    const parsed = [];
    for (const f of lessonFiles()) {
        const spec = JSON.parse(readFileSync(f, 'utf8'));
        if (spec.knowledgeGraph === undefined) continue;
        withGraph++;
        const p = parseLessonKnowledgeGraph(spec.knowledgeGraph, { lessonId: f, lessonTitle: spec.title, glossary: spec.glossary }, () => true);
        assert.deepEqual(p.issues, [], f);
        parsed.push(p);
    }
    assert.ok(withGraph >= 2, 'the demo lesson and the second lesson carry graphs');
    for (const p of parsed) mergeIntoGraph(kg, { concepts: p.concepts, relations: [] });
    for (const p of parsed) assert.deepEqual(mergeIntoGraph(kg, { concepts: [], relations: p.relations }).issues, []);
});

test('demo lesson: the expected concepts and accurate typed relations', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'scenes/draft/sliding-window-maximum.json'), 'utf8'));
    const p = parseLessonKnowledgeGraph(spec.knowledgeGraph,
        { lessonId: 'draft/sliding-window-maximum', lessonTitle: spec.title, draft: true, glossary: spec.glossary });
    const labels = p.concepts.map((c) => c.data.label);
    for (const l of ['Sliding Window Maximum', 'Sliding Window', 'Deque', 'Monotonic Deque', 'Monotonic Invariant',
                     'Amortized Analysis', 'Time Complexity']) assert.ok(labels.includes(l), l);
    assert.equal(p.focus, 'dsa.monotonic-deque');
    const types = new Set(p.relations.map((r) => r.type));
    assert.ok(types.size >= 5, 'not every connection is a prerequisite');
    assert.ok(p.relations.some((r) => r.id === 'dsa.monotonic-deque|specializes|dsa.deque'));
    assert.ok(p.relations.some((r) => r.id === 'dsa.monotonic-deque|maintains|dsa.monotonic-invariant'));
    // every concept ref points at a real scene/step of the lesson
    for (const c of p.concepts) {
        for (const place of c.data.lessons[0]!.places) {
            const scene = spec.scenes[place.scene];
            assert.ok(scene, `${c.id} scene ${place.scene}`);
            assert.ok(place.step < (scene.steps?.length ?? 0), `${c.id} step ${place.step}`);
        }
    }
    // the glossary-linked definitions resolved
    assert.ok(p.concepts.find((c) => c.id === 'dsa.monotonic-deque')!.data.definition!.includes('indices'));
    assert.equal(spec.knowledgeGraph.liveUpdateExample, undefined, 'no demo payload in production lesson content');
    assert.ok(!p.concepts.some((c) => c.id === 'dsa.sliding-window-minimum'), 'the demo concept is not lesson content');
});

test('conceptAtPlace: exact step, else nearest earlier step, else the scene; ties to the main concept', () => {
    const p = parseLessonKnowledgeGraph({
        focus: 'b',
        concepts: [
            { id: 'a', label: 'A', refs: [{ scene: 0 }, { scene: 1 }] },
            { id: 'b', label: 'B', refs: [{ scene: 1 }, { scene: 1, step: 3 }] },
            { id: 'c', label: 'C', refs: [{ scene: 0, step: 1 }] },
            { id: 'd', label: 'D', refs: [{ scene: 0, step: 1 }] },
        ],
    }, LESSON);
    const at = (scene: number, step: number) => conceptAtPlace(p.concepts, LESSON.lessonId, scene, step, p.focus);
    assert.equal(at(0, -1), 'a', 'scene base view → scene-level ref');
    assert.equal(at(0, 0), 'a', 'no step ref yet → scene-level ref');
    assert.equal(at(0, 1), 'c', 'exact step ref; authored order breaks the tie');
    assert.equal(at(0, 5), 'c', 'later steps keep the nearest earlier step ref');
    assert.equal(at(1, -1), 'b', 'scene-level tie → the lesson main concept');
    assert.equal(at(1, 2), 'b', 'tie-break also applies to the scene-level fallback');
    assert.equal(at(1, 3), 'b');
    assert.equal(at(2, 0), null, 'nothing references this scene');
    assert.equal(conceptAtPlace(p.concepts, 'other-lesson', 0, 1), null, 'only this lesson\'s refs count');
});

test('demo lesson: navigation maps scenes/steps to the concept being taught', () => {
    const spec = JSON.parse(readFileSync(join(ROOT, 'scenes/draft/sliding-window-maximum.json'), 'utf8'));
    const id = 'draft/sliding-window-maximum';
    const p = parseLessonKnowledgeGraph(spec.knowledgeGraph, { lessonId: id, lessonTitle: spec.title, glossary: spec.glossary });
    const at = (scene: number, step: number) => conceptAtPlace(p.concepts, id, scene, step, p.focus);
    assert.equal(at(0, -1), 'dsa.sliding-window-maximum');
    assert.equal(at(0, 0), 'dsa.sliding-window');
    assert.equal(at(1, -1), 'dsa.monotonic-deque', 'the main concept wins the scene-level tie');
    assert.equal(at(1, 3), 'dsa.monotonic-invariant');
    assert.equal(at(1, 4), 'dsa.monotonic-deque');
    assert.equal(at(2, -1), 'cs.amortized-analysis');
});
