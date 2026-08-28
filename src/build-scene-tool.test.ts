// The translation layer between the chat agent and the build_scene expert.
//
// Everything here is a CONVERSION, and each one has a silent failure mode: a
// 1-based scene number applied as an index rebuilds the wrong scene; a reply
// misread as a success reports a scene that was never built; a thread sent in
// the wrong shape makes the expert ask the same question forever. None of those
// throw — so they are asserted rather than trusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { LessonFormat } from '/types/lesson.js';
import type { BuildOp } from '/placement.js';

const { buildSceneRequestFromToolCall, interpretBuildSceneReply, sceneIndexFromArgs } =
    await import('/build-scene-tool.js');
const { applyBuildOps, ensureLessonFormat } = await import('/lesson-placement.js');

const lesson = JSON.parse(readFileSync('scenes/vector-operations.json', 'utf8')) as LessonFormat;

// ---- the agent counts from one -------------------------------------------

test('the agent`s 1-based scene number becomes a 0-based index', () => {
    // navigate_to(scene=2) means the SECOND scene. Off by one here rebuilds a
    // neighbour of the scene the user pointed at, which is not a visible bug —
    // it is a plausible-looking wrong answer.
    assert.equal(sceneIndexFromArgs(2), 1);
    assert.equal(sceneIndexFromArgs('3'), 2);
});

test('an absent scene number stays absent', () => {
    // On insert, `undefined` means APPEND. Defaulting it to 0 would silently
    // turn "add a scene about torque" into "put it first".
    assert.equal(sceneIndexFromArgs(undefined), undefined);
    assert.equal(sceneIndexFromArgs(null), undefined);
    assert.equal(sceneIndexFromArgs(''), undefined);
    assert.equal(sceneIndexFromArgs('not a number'), undefined);
});

test('a 0 from a model that already counted from zero is clamped, not negated', () => {
    assert.equal(sceneIndexFromArgs(0), 0);
});

test('insert with no scene number appends', () => {
    const body = buildSceneRequestFromToolCall({ intent: 'add one at the end' }, lesson);
    assert.equal(body.op, 'insert');
    assert.equal(body.sceneIndex, lesson.scenes.length);
});

test('replace names the scene the agent pointed at', () => {
    const body = buildSceneRequestFromToolCall({ intent: 'redo it', op: 'replace', scene: 2 }, lesson);
    assert.equal(body.op, 'replace');
    assert.equal(body.sceneIndex, 1);
    assert.equal(body.current?.title, lesson.scenes[1]!.title);
});

test('an op the model invented is an insert, never a replace', () => {
    // Guessing wrong towards `replace` OVERWRITES a scene the user still wanted;
    // guessing wrong towards `insert` adds one they can delete.
    for (const op of ['add', 'append', 'create', undefined]) {
        assert.equal(buildSceneRequestFromToolCall({ intent: 'x', op }, lesson).op, 'insert');
    }
});

test('an empty intent is refused locally rather than sent', () => {
    assert.throws(() => buildSceneRequestFromToolCall({ intent: '   ' }, lesson));
    assert.throws(() => buildSceneRequestFromToolCall({}, lesson));
});

// ---- the thread ----------------------------------------------------------

test('the thread is sent as {role, text}', () => {
    // `clarifications_from_thread` reads exactly these two keys. Any other shape
    // arrives as dicts with no `text`, every question/answer pair is skipped,
    // and the clarification loop never closes — silently.
    const body = buildSceneRequestFromToolCall({ intent: 'x' }, lesson, [
        { role: 'assistant', text: '2D or 3D?' },
        { role: 'user', text: '3D' },
    ]);
    assert.deepEqual(body.messages, [
        { role: 'assistant', text: '2D or 3D?' },
        { role: 'user', text: '3D' },
    ]);
});

test('a long thread is trimmed from the FRONT', () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: `turn ${i}` }));
    const body = buildSceneRequestFromToolCall({ intent: 'x' }, lesson, turns);
    // The clarification round being recovered is the most RECENT one. Trimming
    // the tail would drop precisely the turns the field exists to carry.
    assert.equal(body.messages.at(-1)!.text, 'turn 39');
    assert.ok(body.messages.length < turns.length);
});

// ---- reading the reply ---------------------------------------------------

test('each of the four outcomes is read as itself', () => {
    assert.equal(interpretBuildSceneReply({ fallback_to_chat: true }).kind, 'passthrough');
    assert.equal(interpretBuildSceneReply({ question: 'flat or curved?' }).kind, 'question');
    assert.equal(interpretBuildSceneReply({ reason: 'coordinates were LaTeX' }).kind, 'refused');
    assert.equal(
        interpretBuildSceneReply({ result: { ops: [{ op: 'insert', kind: 'scene', at: { index: 0 }, node: {} }] } }).kind,
        'result');
});

test('an empty ops list is not a success', () => {
    // It applies cleanly and renders nothing, so reporting it as a build tells
    // the user a scene exists that does not.
    assert.equal(interpretBuildSceneReply({ result: { ops: [] } }).kind, 'refused');
});

test('an unreadable reply is refused, not passed to chat', () => {
    // `passthrough` means "the user asked a question" — handing them the tutor
    // would hide a broken contract behind a conversational answer.
    assert.equal(interpretBuildSceneReply({}).kind, 'refused');
    assert.equal(interpretBuildSceneReply(null).kind, 'refused');
});

test('`focus` crosses the wire as an index and arrives as a Placement', () => {
    const out = interpretBuildSceneReply({ question: 'which axis?', focus: 3 });
    assert.equal(out.kind === 'question' && out.focus?.index, 3);
});

test('a summary names the scene that landed', () => {
    const node = { title: 'Cross Product' };
    const added = interpretBuildSceneReply({ result: { ops: [{ op: 'insert', kind: 'scene', at: { index: 1 }, node }] } });
    assert.match(added.kind === 'result' ? added.result.summary : '', /Added.*Cross Product/);
    const redone = interpretBuildSceneReply({ result: { ops: [{ op: 'replace', kind: 'scene', at: { index: 1 }, node }] } });
    assert.match(redone.kind === 'result' ? redone.result.summary : '', /Rebuilt.*Cross Product/);
});

// ---- the whole round trip ------------------------------------------------

test('a reply in the handler`s exact shape applies to the lesson', () => {
    // The end-to-end claim: what backend/experts/handlers/build_scene/handler.py
    // returns can be applied by the client. This is the check that was missing
    // when the handler emitted `at: {scene: N}` — the contract model validated
    // it, every backend test passed, and every op was unapplicable.
    const reply = {
        result: {
            ops: [{
                op: 'insert', kind: 'scene',
                at: { index: 1 },
                node: { id: 's-new', title: 'Torque', elements: [] },
            }],
        },
        focus: 1,
    };
    const outcome = interpretBuildSceneReply(reply);
    assert.equal(outcome.kind, 'result');

    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const before = target.scenes.length;
    const inverse = applyBuildOps(target, (outcome as { result: { ops: BuildOp[] } }).result.ops);

    assert.equal(target.scenes.length, before + 1);
    assert.equal(target.scenes[1]!.title, 'Torque');
    applyBuildOps(target, inverse);
    assert.equal(target.scenes.length, before, 'the build must be undoable');
});

test('the first build in an empty app bootstraps a lesson', () => {
    // No lessonSpec at all: the op has to land somewhere, and `scenes` must exist
    // before applyBuildOps can splice into it.
    const { lesson: target, bootstrap } = ensureLessonFormat(null, null);
    assert.equal(bootstrap.bootstrapped, true);
    applyBuildOps(target, [{ op: 'insert', kind: 'scene', at: { index: 0 }, node: { title: 'First' } } as BuildOp]);
    assert.equal(target.scenes.length, 1);
});

// ---- the reserved slot ---------------------------------------------------

const { landOnSlot, placeholderScene, releaseOp, reserveOp, isPlaceholder, slotIndex } =
    await import('/build-progress.js');

test('the placeholder is a valid, empty scene that says what it is waiting for', () => {
    const ph = placeholderScene('show the torque vector');
    // `$defs.scene` is additionalProperties:false, so an invented field would
    // fail validation on export — of a lesson the user thinks is fine.
    assert.deepEqual(Object.keys(ph).sort(), ['description', 'elements', 'id', 'title']);
    assert.deepEqual(ph.elements, []);
    assert.match(ph.description!, /show the torque vector/);
    assert.ok(isPlaceholder(ph));
    assert.ok(!isPlaceholder({ id: 's1-cross' }));
});

test('two placeholders never share an id', () => {
    // The id is what `at.id` verifies against. Two alike and a second build could
    // land on the first one's slot.
    assert.notEqual((placeholderScene('a') as { id: string }).id,
                    (placeholderScene('b') as { id: string }).id);
});

test('the expert`s insert lands ON the reserved slot, not beside it', () => {
    // The expert does not know a placeholder exists — it answers "insert at N".
    // Applying that verbatim after reserving N leaves TWO scenes: the real one
    // and the placeholder pushed down next to it.
    const ph = placeholderScene('torque');
    const built = { op: 'insert', kind: 'scene', at: { index: 2 }, node: { title: 'Torque' } } as BuildOp;
    const landed = landOnSlot(built, ph, 2);
    assert.equal(landed.op, 'replace');
    assert.equal(landed.at.index, 2);
    assert.equal(landed.at.id, (ph as { id: string }).id, 'the slot must be verified as still ours');
});

test('reserve then land leaves exactly one scene', () => {
    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const before = target.scenes.length;
    const ph = placeholderScene('torque');

    applyBuildOps(target, [reserveOp(2, ph)]);
    assert.equal(target.scenes.length, before + 1);
    assert.equal(target.scenes[2]!.title, 'Building…');

    const built = { op: 'insert', kind: 'scene', at: { index: 2 }, node: { title: 'Torque' } } as BuildOp;
    applyBuildOps(target, [landOnSlot(built, ph, slotIndex(target.scenes, ph))]);
    assert.equal(target.scenes.length, before + 1, 'the placeholder must be replaced, not joined');
    assert.equal(target.scenes[2]!.title, 'Torque');
});

test('reserve then release leaves the lesson as it was', () => {
    // Every outcome but `result` has to undo the reservation, or a refused build
    // leaves a permanent "Building…" scene in the lesson.
    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const snapshot = JSON.stringify(target);
    const ph = placeholderScene('torque');

    applyBuildOps(target, [reserveOp(1, ph)]);
    applyBuildOps(target, [releaseOp(slotIndex(target.scenes, ph), ph)!]);
    assert.equal(JSON.stringify(target), snapshot);
});

test('a slot that moved under us is followed, not overwritten by index', () => {
    // Another build (or the user) shifted the lesson while this one was in
    // flight. Replacing index 1 blind would destroy whatever now sits there.
    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const ph = placeholderScene('torque');
    applyBuildOps(target, [reserveOp(1, ph)]);
    applyBuildOps(target, [{ op: 'insert', kind: 'scene', at: { index: 0 }, node: { title: 'Jumped in' } } as BuildOp]);
    assert.equal(slotIndex(target.scenes, ph), 2, 'the slot moved down by one');

    const built = { op: 'insert', kind: 'scene', at: { index: 1 }, node: { title: 'Torque' } } as BuildOp;
    applyBuildOps(target, [landOnSlot(built, ph, slotIndex(target.scenes, ph))]);
    assert.equal(target.scenes[2]!.title, 'Torque');
    assert.equal(target.scenes[1]!.title, lesson.scenes[0]!.title, 'the displaced scene must survive');
});

test('a slot the user deleted mid-build takes nothing with it', () => {
    // Their delete stands. Releasing a vanished slot must be a no-op, not a
    // delete of whatever inherited the index.
    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const ph = placeholderScene('torque');
    applyBuildOps(target, [reserveOp(1, ph)]);
    applyBuildOps(target, [{ op: 'delete', kind: 'scene', at: { index: 1, id: (ph as { id: string }).id } } as BuildOp]);

    assert.equal(slotIndex(target.scenes, ph), -1);
    assert.equal(releaseOp(slotIndex(target.scenes, ph), ph), null);
    // And the built scene still arrives, at the index it was asked for.
    const built = { op: 'insert', kind: 'scene', at: { index: 1 }, node: { title: 'Torque' } } as BuildOp;
    const landed = landOnSlot(built, ph, -1);
    assert.equal(landed.op, 'insert', 'nothing to replace — it is an insert again');
});

test('releasing a slot that moved refuses rather than deleting a real scene', () => {
    // The build was refused, so the placeholder has to come out — but the lesson
    // shifted while the request was in flight. Deleting by index alone would
    // remove whatever now sits there, which is the user's own scene, and unlike a
    // bad replace there is nothing left to notice it by.
    const copy = JSON.parse(JSON.stringify(lesson)) as LessonFormat;
    const { lesson: target } = ensureLessonFormat(copy, null);
    const ph = placeholderScene('torque');
    applyBuildOps(target, [reserveOp(1, ph)]);
    applyBuildOps(target, [{ op: 'insert', kind: 'scene', at: { index: 0 }, node: { title: 'Jumped in' } } as BuildOp]);

    const before = target.scenes.length;
    // The index it was RESERVED at now holds someone else's scene. Releasing
    // there would delete it; releasing by identity finds the slot instead.
    assert.throws(() => applyBuildOps(target, [releaseOp(1, ph)!]));
    assert.equal(target.scenes.length, before, 'nothing may be deleted on a stale release');
    applyBuildOps(target, [releaseOp(slotIndex(target.scenes, ph), ph)!]);
    assert.equal(target.scenes.length, before - 1);
    assert.equal(slotIndex(target.scenes, ph), -1, 'the placeholder, and only it, is gone');
});

// ---- where a finished build lands ----------------------------------------

// The REAL function, not a copy of it. It lives in build-progress.ts rather than
// chat.ts precisely so this import does not drag in the DOM — a test that
// reimplements the thing it is testing passes no matter what the shipped code
// does, which is the one failure mode none of the other tests here can catch.
const { landingStep } = await import('/build-progress.js');

test('a build lands on the step that first has sliders, not step 0', () => {
    // `_pull_sliders_forward` in compose.py deliberately puts a slider on the
    // step that first USES it, which is routinely step 1 or later. Checking only
    // step 0 landed the reader on an empty root, and the scene they had just
    // asked for appeared to render nothing — the exact symptom this feature kept
    // producing for other reasons.
    // Sliders on a LATER step than the first content, so the priority is what
    // decides. With both on the same step the test passes either way — which is
    // how the first version of it passed while checking nothing.
    assert.equal(landingStep({ steps: [{ add: [{}] }, { sliders: [{ id: 'A' }] }, {}] }), 1);
});

test('with no sliders anywhere it lands on the first step that adds something', () => {
    assert.equal(landingStep({ steps: [{}, {}, { add: [{ type: 'vector' }] }] }), 2);
});

test('a scene whose content is all scene-level lands on the root', () => {
    // -1 is the root view, which is right when there is nothing in any step.
    assert.equal(landingStep({ steps: [{}, {}] }), -1);
    assert.equal(landingStep({}), -1);
    assert.equal(landingStep(undefined), -1);
});
