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

import {
    assembleVariant, createProofEditTool,
    type ChatReply, type EditProof, type EditProofStep, type EditStepResult,
    type EditVariant, type ProofEditToolDeps,
} from './proof-edit-tool.js';

// --------------------------------------------------------------------------- //
// assembleVariant — mirrored by tests/backend/experts/test_proof_edit_patch.py
// --------------------------------------------------------------------------- //

// `EditProofStep` deliberately declares only `index`: the server owns the rest
// of the field set and this module never writes it, it only spreads it through.
// The suite asserts on two of those server-owned fields, so it names them here
// rather than widening the module's own view of a step.
type TestStep = EditProofStep & { input_latex?: string; operation?: string; plain?: string };

// assembleVariant always writes `steps` — it renumbers every one of them before
// returning — so the non-null is the function's own invariant, not a guess.
const stepsOf = (p: EditProof): TestStep[] => p.steps! as TestStep[];

// `kind` is required on EditVariant because the PICKER labels a variant by it;
// assembleVariant never reads it. The assembly cases below therefore hand over
// the splice fields alone — exactly the input they always did — and the one
// cast that reconciles that with the declared type lives here.
const splice = (v: Omit<EditVariant, 'kind'>): EditVariant => v as EditVariant;

const step = (id: number, extra: Partial<TestStep> = {}): TestStep => ({ index: id, input_latex: `s${id}`, ...extra });
const ORIGINAL = {
    title: 'p',
    steps: [step(0), step(1), step(2), step(3)],
    terms: { a: { latex: 'a' } },
};
const NEW_STEPS: TestStep[] = [
    { input_latex: 'n0', operation: 'op0' },
    { input_latex: 'n1', operation: 'op1' },
];

test('insert splices after `at` and renumbers', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        splice({ at: 1, take: 1, delete_count: 0 }));
    assert.deepEqual(stepsOf(out).map((s) => s.input_latex),
        ['s0', 's1', 'n0', 's2', 's3']);
    assert.deepEqual(stepsOf(out).map((s) => s.index), [0, 1, 2, 3, 4]);
});

test('take selects a prefix of the shared new_steps', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        splice({ at: 1, take: 2, delete_count: 0 }));
    assert.deepEqual(stepsOf(out).map((s) => s.input_latex),
        ['s0', 's1', 'n0', 'n1', 's2', 's3']);
});

test('delete_count drops the superseded steps', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        splice({ at: 1, take: 1, delete_count: 2 }));
    assert.deepEqual(stepsOf(out).map((s) => s.input_latex), ['s0', 's1', 'n0']);
});

test('step_updates are keyed by ORIGINAL index, applied before renumbering', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS, splice({
        at: 1, take: 1, delete_count: 0,
        step_updates: { 0: { plain: 'head' }, 2: { plain: 'tail' } },
    }));
    assert.equal(stepsOf(out)[0]!.plain, 'head');          // still at 0
    assert.equal(stepsOf(out)[3]!.plain, 'tail');          // original 2, shifted by 1
});

test('assembling does not mutate the original proof', () => {
    const before = JSON.stringify(ORIGINAL);
    assembleVariant(ORIGINAL, NEW_STEPS, splice({
        at: 1, take: 1, delete_count: 1, step_updates: { 2: { plain: 'x' } },
    }));
    assert.equal(JSON.stringify(ORIGINAL), before);
});

test('terms_added merges over the original terms', () => {
    const out = assembleVariant(ORIGINAL, NEW_STEPS,
        splice({ at: 0, take: 1, delete_count: 0, terms_added: { u: { latex: 'u' } } }));
    assert.deepEqual(Object.keys(out.terms!).sort(), ['a', 'u']);
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

/** The slice of an element the picker builds against and reads back. */
interface FakeEl {
    className: string;
    textContent: string;
    type: string;
    disabled: boolean;
    dataset: Record<string, string>;
    children: FakeEl[];
    setAttribute(name: string, value: string): void;
    getAttribute(name: string): string | null;
    addEventListener(type: string, fn: () => void): void;
    remove(): void;
    classList: { toggle(name: string, force?: boolean): void };
    closest(selector: string): FakeEl | null;
    append(...kids: FakeEl[]): void;
    appendChild(kid: FakeEl): FakeEl;
    querySelectorAll(selector: string): FakeEl[];
}

/** The document double: a createElement plus a hand-fireable keydown channel. */
interface FakeDocument {
    createElement(): FakeEl;
    addEventListener(type: string, fn: (e: { key: string; preventDefault(): void }) => void): void;
    removeEventListener(type: string, fn: (e: { key: string; preventDefault(): void }) => void): void;
    dispatchKey(key: string): void;
}

// The doubles stand in for globals the module reaches through directly, so they
// are installed on `globalThis` behind one cast rather than one per assignment.
const g = globalThis as unknown as {
    document: FakeDocument;
    location: { origin: string };
};

// The picker builds real DOM. Node has none, so stub just enough of it — a
// jsdom dependency would be a lot of weight for "does appendChild get called".
// `validateProofData` also reads location.origin when sanitising deeplinks.
function stubDom() {
    const el = (): FakeEl => ({
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
    const listeners: Record<string, Set<(e: { key: string; preventDefault(): void }) => void>> = {};
    g.document = {
        createElement: el,
        addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
        removeEventListener(type, fn) { listeners[type]?.delete(fn); },
        dispatchKey(key) { for (const fn of listeners.keydown || []) fn({ key, preventDefault() {} }); },
    };
    g.location = { origin: 'http://localhost' };
}
stubDom();

function makeTool(overrides: Partial<ProofEditToolDeps> = {}) {
    const calls: Array<[string, string]> = [];
    const mounted: Array<[EditProof, number]> = [];       // [proof, startStep] per remount
    let committed: EditProof | null = null;
    const tool = createProofEditTool({
        getProof: () => committed
            || { steps: [step(0), step(1), step(2)], domain: 'algebra' } as EditProof,
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

// An `edit_step` block as the server really sends it. `EditStepResult` covers
// only the fields this module READS, so the two extras are named here:
//   * `new_steps` entries carry the server-owned step fields (see TestStep);
//   * `fallback_to_chat` is a flag the module never reads — it reacts to the
//     absence of variants that comes with it — but the server does send it, and
//     the test below is about exactly that wire shape.
type TestEditStep = EditStepResult & { new_steps?: TestStep[]; fallback_to_chat?: boolean };
const editStep = (e: TestEditStep): ChatReply => ({ edit_step: e });

const VARIANTS_RESULT = editStep({
    new_steps: [{ input_latex: 'n0', operation: 'op' }],
    variants: [{ kind: 'insert', at: 1, take: 1, delete_count: 0 }],
    summary: 'Did the thing.',
});

// TWO options — the only shape that renders a picker. With one option the tool
// applies it directly (a list of one is not a choice), so any test about
// choosing, cancelling or Esc has to offer a real alternative.
const MULTI_RESULT = editStep({
    new_steps: [{ input_latex: 'n0', operation: 'op' },
                { input_latex: 'n1', operation: 'op1' }],
    variants: [{ kind: 'insert', at: 1, take: 1, delete_count: 0 },
               { kind: 'glue', at: 1, take: 2, delete_count: 0 }],
    summary: 'Did the thing.',
});

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
    tool.applyEditResult(MULTI_RESULT);
    const before = mounted.length;
    g.document.dispatchKey('Escape');
    // Cancel remounts the original at the return step — one more mount, and the
    // picker is gone so a second Esc does nothing.
    assert.equal(mounted.length, before + 1, 'Esc should cancel and remount');
    g.document.dispatchKey('Escape');
    assert.equal(mounted.length, before + 1, 'Esc after close is a no-op');
});

test('unlocked: variants are presented and the summary is spoken', () => {
    const { tool, calls, mounted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(MULTI_RESULT), true);
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
    assert.equal(mounted.at(-1)![1], 2, 'should land on the new step');
});

test('Done keeps the reader on the inserted step', () => {
    const { tool, mounted, getCommitted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    tool.commitSelected();
    assert.equal(mounted.at(-1)![1], 2);
    assert.equal(getCommitted()!.steps!.length, 4, 'the edit is now the live proof');
});

test('Cancel puts the reader back where they were', () => {
    const { tool, mounted } = makeTool();       // getCurrentStep() === 1
    tool.setUnlocked(true);
    tool.applyEditResult(MULTI_RESULT);
    tool.cancelSelected();
    assert.equal(mounted.at(-1)![1], 1, 'back to the step in view before the edit');
});

test('Undo restores the proof AND the step, clamped to the shorter proof', () => {
    const { tool, mounted, getCommitted } = makeTool();
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    tool.commitSelected();
    tool.undo();
    assert.equal(getCommitted()!.steps!.length, 3, 'the original is live again');
    assert.equal(mounted.at(-1)![1], 1, 'and the reader is back where they started');
});

test('an unconfirmed step is called out in words, not left to a badge', () => {
    // The CAS reserves "refuted" for steps it computed and found wrong, so
    // nonsense comes back "plausible" — a badge that reads as mild approval.
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    // MULTI_RESULT is built by `editStep` just above, so its block is present.
    tool.applyEditResult(editStep({ ...MULTI_RESULT.edit_step!, caveat: 'could not confirm' }));
    assert.match(calls.at(-1)![1], /could not confirm/);
});

test('a refusal is spoken and offers nothing', () => {
    const { tool, calls, mounted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(editStep({ reason: 'nope' })), true);
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
    assert.equal(tool.applyEditResult(editStep({ fallback_to_chat: true })), true);
    assert.match(calls.at(-1)![1], /couldn't turn that into a step operation/i);
    assert.equal(mounted.length, 0);
});

test('an edit against no open derivation says so', () => {
    const { tool, calls } = makeTool({ getProof: () => null });
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(VARIANTS_RESULT), true);
    assert.match(calls.at(-1)![1], /no derivation open/i);
});

test('a clarifying question is relayed as an ordinary chat turn', () => {
    // No client-side pending state: the agent keeps the thread, so the answer
    // comes back through the next normal turn.
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(editStep({ question: 'Definite or indefinite?' })), true);
    assert.deepEqual(calls.at(-1), ['bot', 'Definite or indefinite?']);
});

test('a plain chat reply carries no edit and is not claimed', () => {
    const { tool } = makeTool();
    tool.setUnlocked(true);
    // `ChatReply` describes only the part this module reads (`edit_step`). A
    // real reply also carries `answer`; the cast hands over that real shape
    // without widening the module's declared view of a reply.
    const answerOnly = { answer: 'because the roots are symmetric' } as unknown as ChatReply;
    assert.equal(tool.applyEditResult(answerOnly), false);
});

test('interceptLocal claims only undo', () => {
    const { tool, calls } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.interceptLocal('why does the plus-minus appear?'), false);
    assert.equal(tool.interceptLocal('move c to right'), false,
        'an edit must reach the agent, not be guessed at locally');
    assert.equal(tool.interceptLocal('undo'), true);
    assert.match(calls.at(-1)![1], /nothing to undo/i);
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

// ---- a single option is applied, not offered ----------------------------- //

test('one variant is applied directly, with no picker', () => {
    // A list of one is not a choice. Rendering a picker for it asks the reader to
    // pick from a single option and stalls an edit they already asked for behind
    // an extra click.
    const { tool, calls, mounted, getCommitted } = makeTool();
    tool.setUnlocked(true);
    assert.equal(tool.applyEditResult(VARIANTS_RESULT), true);

    assert.equal(getCommitted()!.steps!.length, 4, 'applied without waiting');
    assert.equal(mounted.at(-1)![1], 2, 'lands on the inserted step');
    // …and undo is named, because there was no Cancel button to notice.
    assert.match(calls.at(-1)![1], /undo/i);
});

test('an auto-applied edit is still undoable', () => {
    // Undo is the ONLY way back from an auto-applied edit — there was no Cancel
    // button — so it has to work, and the confirmation names it for that reason.
    const { tool, getCommitted } = makeTool();   // starts on a 3-step proof
    tool.setUnlocked(true);
    tool.applyEditResult(VARIANTS_RESULT);
    assert.equal(getCommitted()!.steps!.length, 4, 'applied');
    tool.interceptLocal('undo');
    assert.equal(getCommitted()!.steps!.length, 3,
                 'undo restores the proof the edit replaced');
});

test('two variants still open the picker', () => {
    const { tool, getCommitted } = makeTool();
    tool.setUnlocked(true);
    const before = getCommitted();
    tool.applyEditResult(MULTI_RESULT);
    assert.equal(getCommitted(), before, 'nothing is committed until Done');
});
