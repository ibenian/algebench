// node:test unit tests for the proof edit tool — variant assembly and the lock.
// Run: node --test static/proof-edit-tool.test.js
//
// Historical note, because it shaped the design: this module used to decide for
// itself whether a message was an edit, via a keyword regex. That approach is
// unfixable — "move c to the right" and "why did they move c to the right?"
// share every keyword — and it failed in exactly that way. Routing now lives in
// the chat agent's `edit_step` tool call, so there is nothing here to test about
// classifying messages, only about honouring the lock and rendering the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleVariant, createProofEditTool } from './proof-edit-tool.js';

// --------------------------------------------------------------------------- //
// assembleVariant — mirrored by tests/backend/experts/test_proof_edit_patch.py
// --------------------------------------------------------------------------- //

const step = (id, extra = {}) => ({ index: id, input_latex: `s${id}`, ...extra });
const ORIGINAL = {
    title: 'p',
    steps: [step(0), step(1), step(2), step(3)],
    terms: { a: { latex: 'a' } },
};
const NEW_STEPS = [
    { input_latex: 'n0', operation: 'op0' },
    { input_latex: 'n1', operation: 'op1' },
];

test('insert splices after `at` and renumbers', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        { at: 1, take: 1, delete_count: 0 });
    assert.deepEqual(out.steps.map((s) => s.input_latex),
        ['s0', 's1', 'n0', 's2', 's3']);
    assert.deepEqual(out.steps.map((s) => s.index), [0, 1, 2, 3, 4]);
});

test('take selects a prefix of the shared new_steps', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        { at: 1, take: 2, delete_count: 0 });
    assert.deepEqual(out.steps.map((s) => s.input_latex),
        ['s0', 's1', 'n0', 'n1', 's2', 's3']);
});

test('delete_count drops the superseded steps', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        { at: 1, take: 1, delete_count: 2 });
    assert.deepEqual(out.steps.map((s) => s.input_latex), ['s0', 's1', 'n0']);
});

test('step_updates are keyed by ORIGINAL index, applied before renumbering', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS, {
        at: 1, take: 1, delete_count: 0,
        step_updates: { 0: { plain: 'head' }, 2: { plain: 'tail' } },
    });
    assert.equal(out.steps[0].plain, 'head');          // still at 0
    assert.equal(out.steps[3].plain, 'tail');          // original 2, shifted by 1
});

test('assembling does not mutate the original proof', () => {
    const before = JSON.stringify(ORIGINAL);
    assembleVariant(ORIGINAL, NEW_STEPS, {
        at: 1, take: 1, delete_count: 1, step_updates: { 2: { plain: 'x' } },
    });
    assert.equal(JSON.stringify(ORIGINAL), before);
});

test('terms_added merges over the original terms', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        { at: 0, take: 1, delete_count: 0, terms_added: { u: { latex: 'u' } } });
    assert.deepEqual(Object.keys(out.terms).sort(), ['a', 'u']);
});

// --------------------------------------------------------------------------- //
// routing
// --------------------------------------------------------------------------- //
//
// There is nothing to test about "does this message look like an edit", because
// the module no longer asks. That decision belongs to the chat agent, which
// calls its `edit_step` tool with the whole conversation in view — the only
// vantage point from which "move c to the right" and "why did they move c to
// the right?" are distinguishable. What IS testable is that this module honours
// the lock and consumes what it is handed.

// The picker builds real DOM. Node has none, so stub just enough of it — a
// jsdom dependency would be a lot of weight for "does appendChild get called".
// `validateProofData` also reads location.origin when sanitising deeplinks.
function stubDom() {
    const el = () => ({
        className: '', textContent: '', type: '', disabled: false,
        dataset: {}, children: [],
        setAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, remove() {}, classList: { toggle() {} },
        closest() { return null; },
        append(...kids) { this.children.push(...kids); },
        appendChild(kid) { this.children.push(kid); return kid; },
        querySelectorAll() { return []; },
    });
    // A document whose keydown listeners we can fire, so the Esc-to-cancel
    // binding is exercised rather than stubbed to a no-op.
    const listeners = {};
    globalThis.document = {
        createElement: el,
        addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
        removeEventListener(type, fn) { listeners[type]?.delete(fn); },
        dispatchKey(key) { for (const fn of listeners.keydown || []) fn({ key, preventDefault() {} }); },
    };
    globalThis.location = { origin: 'http://localhost' };
}
stubDom();

function makeTool(overrides = {}) {
    const calls = [];
    const mounted = [];       // [proof, startStep] per remount
    let committed = null;
    const tool = createProofEditTool({
        getProof: () => committed
            || { steps: [step(0), step(1), step(2)], domain: 'algebra' },
        getCurrentStep: () => 1,
        onMount: (proof, startStep) => mounted.push([proof, startStep]),
        onCommit: (proof) => { committed = proof; },
        setEditPending: () => {},
        addBubble: (role, text) => calls.push([role, text]),
        mountBar: () => {},
        ...overrides,
    });
    return { tool, calls, mounted, getCommitted: () => committed };
}

const VARIANTS_RESULT = {
    edit: {
        new_steps: [{ input_latex: 'n0', operation: 'op' }],
        variants: [{ kind: 'insert', at: 1, take: 1, delete_count: 0 }],
        summary: 'Did the thing.',
    },
};

test('locked: an edit result is ignored even if the server sent one', () => {
    // Belt and braces. The server should never produce an edit while locked
    // (the tool is not declared), so this guards against the lock being turned
    // off in one place and not the other.
    const { tool } = makeTool();
    assert.equal(tool.isUnlocked(), false, 'locked is the default');
    assert.equal(tool.applyEditResult(VARIANTS_RESULT), false);
});

test('Esc cancels an open picker and restores the original', () => {
    const { tool, mounted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    const before = mounted.length;
    globalThis.document.dispatchKey('Escape');
    // Cancel remounts the original at the return step — one more mount, and the
    // picker is gone so a second Esc does nothing.
    assert.equal(mounted.length, before + 1, 'Esc should cancel and remount');
    globalThis.document.dispatchKey('Escape');
    assert.equal(mounted.length, before + 1, 'Esc after close is a no-op');
});

test('unlocked: variants are presented and the summary is spoken', () => {
    const { tool, calls, mounted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(VARIANTS_RESULT), true);
    assert.equal(mounted.length, 1, 'the selected variant is rendered immediately');
    assert.deepEqual(calls.at(-1), ['bot', 'Did the thing.']);
});

// ---- where the reader lands ---------------------------------------------- //
// Step 0 is wrong for all three of these: after an edit the interesting step is
// the one just inserted, and after cancel/undo it is wherever they were.

test('selecting a variant lands on the INSERTED step, not the top', () => {
    const { tool, mounted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);      // inserts after step 1
    assert.equal(mounted.at(-1)[1], 2, 'should land on the new step');
});

test('Done keeps the reader on the inserted step', () => {
    const { tool, mounted, getCommitted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    tool.commitSelected();
    assert.equal(mounted.at(-1)[1], 2);
    assert.equal(getCommitted().steps.length, 4, 'the edit is now the live proof');
});

test('Cancel puts the reader back where they were', () => {
    const { tool, mounted } = makeTool();       // getCurrentStep() === 1
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    tool.cancelSelected();
    assert.equal(mounted.at(-1)[1], 1, 'back to the step in view before the edit');
});

test('Undo restores the proof AND the step, clamped to the shorter proof', () => {
    const { tool, mounted, getCommitted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    tool.commitSelected();
    tool.undo();
    assert.equal(getCommitted().steps.length, 3, 'the original is live again');
    assert.equal(mounted.at(-1)[1], 1, 'and the reader is back where they started');
});

test('an unconfirmed step is called out in words, not left to a badge', () => {
    // The CAS reserves "refuted" for steps it computed and found wrong, so
    // nonsense comes back "plausible" — a badge that reads as mild approval.
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult({ edit: { ...VARIANTS_RESULT.edit, caveat: 'could not confirm' } });
    assert.match(calls.at(-1)[1], /could not confirm/);
});

test('a refusal is spoken and offers nothing', () => {
    const { tool, calls, mounted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult({ edit: { reason: 'nope' } }), true);
    assert.deepEqual(calls.at(-1), ['bot', 'nope']);
    assert.equal(mounted.length, 0, 'a refuted edit must never be pickable');
});

test('router disagreement is explained, never silent', () => {
    // Two routers decide in sequence: the chat agent says "this is an
    // instruction" by calling edit_step, then the expert decides whether it can
    // act. They can disagree (fallback_to_chat). Going quiet there leaves the
    // reader having asked for an edit and received nothing at all.
    const { tool, calls, mounted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult({ edit: { fallback_to_chat: true } }), true);
    assert.match(calls.at(-1)[1], /couldn't turn that into a step operation/i);
    assert.equal(mounted.length, 0);
});

test('an edit against no open derivation says so', () => {
    const { tool, calls } = makeTool({ getProof: () => null });
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(VARIANTS_RESULT), true);
    assert.match(calls.at(-1)[1], /no derivation open/i);
});

test('a clarifying question is relayed as an ordinary chat turn', () => {
    // No client-side pending state: the agent keeps the thread, so the answer
    // comes back through the next normal turn.
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult({ edit: { question: 'Definite or indefinite?' } }), true);
    assert.deepEqual(calls.at(-1), ['bot', 'Definite or indefinite?']);
});

test('a plain chat reply carries no edit and is not claimed', () => {
    const { tool } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult({ answer: 'because the roots are symmetric' }), false);
});

test('interceptLocal claims only undo', () => {
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.interceptLocal('why does the plus-minus appear?'), false);
    assert.equal(tool.interceptLocal('move c to right'), false,
        'an edit must reach the agent, not be guessed at locally');
    assert.equal(tool.interceptLocal('undo'), true);
    assert.match(calls.at(-1)[1], /nothing to undo/i);
});

test('locked: even undo is not intercepted', () => {
    const { tool } = makeTool();
    assert.equal(tool.interceptLocal('undo'), false);
});

test('reset re-locks — a freshly loaded proof is never born editable', () => {
    const { tool } = makeTool();
    tool.setUnlocked(true);
    tool.reset();
    assert.equal(tool.isUnlocked(), false);
});
