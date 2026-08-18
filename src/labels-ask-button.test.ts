// makeAiAskButton — a getMessage that can't build a message must be a no-op.
//
// The proof-animation engine's AskButtonFactory hands the factory a
// `() => string | null` (the step-ask chip returns null before it is anchored to
// a step). labels.ts used the result unguarded, so a null still opened the chat
// panel and called sendChatMessage(null) — an empty ask fired at the tutor. (The
// chat input itself survives: assigning null to a textarea's `value` yields ""
// per the IDL, not the string "null" — verified in the browser.) The button now
// does nothing at all in that case: no chat panel, no input text, no send.

import test from 'node:test';
import assert from 'node:assert/strict';

/** The slice of a click event the button's handler reads. */
interface FakeClick {
    stopPropagation(): void;
    metaKey?: boolean;
    ctrlKey?: boolean;
}

// Minimal element/document stand-in: enough surface for makeAiAskButton.
class El {
    tagName: string;
    children: El[];
    className: string;
    title: string;
    type: string;
    value: string;
    attrs: Record<string, string>;
    listeners: Record<string, Array<(ev: FakeClick) => void>>;
    focused: boolean;
    events: Array<string | null | undefined>;
    classList: {
        names: Set<string>;
        add(n: string): void;
        remove(n: string): void;
        contains(n: string): boolean;
    };

    constructor(tag: string) {
        this.tagName = tag;
        this.children = [];
        this.className = '';
        this.title = '';
        this.type = '';
        this.value = '';
        this.attrs = {};
        this.listeners = {};
        this.focused = false;
        this.events = [];
        this.classList = {
            names: new Set<string>(),
            add: (n) => { this.classList.names.add(n); },
            remove: (n) => { this.classList.names.delete(n); },
            contains: (n) => this.classList.names.has(n),
        };
    }
    setAttribute(name: string, value: unknown) { this.attrs[name] = String(value); }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    addEventListener(type: string, fn: (ev: FakeClick) => void) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(ev: { type: string } | null | undefined) { this.events.push(ev && ev.type); }
    focus() { this.focused = true; }
    click(ev: Partial<FakeClick> = {}) { (this.listeners.click || []).forEach((fn) => fn({ stopPropagation() {}, ...ev })); }
    set innerHTML(_v: string) {}
    get innerHTML() { return ''; }
}

const chatInput = new El('textarea');
const panel = new El('div');
panel.classList.add('hidden');

// The browser globals makeAiAskButton (and the openChatPanel it calls) reach
// for. Each is a stand-in covering only the surface the code under test
// touches, so the install goes through a single cast of `globalThis` rather
// than one cast per assignment. `sendChatMessage` is a genuine declared global
// (globals.d.ts — published by chat.ts); the double records instead of
// returning a Promise, which is all the assertions below need.
const g = globalThis as unknown as {
    document: { createElement(tag: string): El; getElementById(id: string): El | null };
    Event: new (type: string) => { type: string };
    window: { dispatchEvent(): void };
    setTimeout: () => number;
    sendChatMessage: (m: string) => void;
};

g.document = {
    createElement: (tag) => new El(tag),
    getElementById: (id) => (id === 'chat-input' ? chatInput : id === 'explanation-panel' ? panel : null),
};
g.Event = class { type: string; constructor(type: string) { this.type = type; } };
g.window = { dispatchEvent() {} };
g.setTimeout = () => 0;

const sent: string[] = [];
g.sendChatMessage = (m) => { sent.push(m); };

const { makeAiAskButton } = await import('/labels.js');

// makeAiAskButton is typed as returning an HTMLButtonElement, but with
// document.createElement stubbed the object it actually builds is an El. One
// cast here keeps every call site below reading exactly as it did.
const ask = (className: string, title: string, getMessage: () => string | null): El =>
    makeAiAskButton(className, title, getMessage) as unknown as El;

function reset() {
    sent.length = 0;
    chatInput.value = '';
    chatInput.focused = false;
    panel.classList.add('hidden');
}

test('a real message is sent, and ⌘-click puts it in the input', () => {
    reset();
    ask('c', 't', () => 'Explain this').click();
    assert.deepEqual(sent, ['Explain this']);
    assert.equal(panel.classList.contains('hidden'), false, 'chat panel opens');

    reset();
    ask('c', 't', () => 'Explain this').click({ metaKey: true });
    assert.deepEqual(sent, []);
    assert.equal(chatInput.value, 'Explain this');
});

test('a null message sends nothing and never writes "null" to the input', () => {
    reset();
    ask('c', 't', () => null).click();
    assert.deepEqual(sent, [], 'nothing is sent to the tutor');
    assert.equal(chatInput.value, '', 'the chat input is untouched');
    assert.equal(panel.classList.contains('hidden'), true, 'the chat panel stays closed');
});

test('a null message under ⌘-click is also a no-op', () => {
    reset();
    ask('c', 't', () => null).click({ metaKey: true });
    assert.equal(chatInput.value, '', 'the chat input is untouched');
    assert.equal(chatInput.focused, false, 'focus is not stolen');
    assert.equal(panel.classList.contains('hidden'), true, 'the chat panel stays closed');
});

test('an empty message is treated the same as null', () => {
    reset();
    ask('c', 't', () => '').click();
    assert.deepEqual(sent, []);
    assert.equal(panel.classList.contains('hidden'), true);
});
