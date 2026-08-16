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

// Minimal element/document stand-in: enough surface for makeAiAskButton.
class El {
    constructor(tag) {
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
            names: new Set(),
            add: (n) => this.classList.names.add(n),
            remove: (n) => this.classList.names.delete(n),
            contains: (n) => this.classList.names.has(n),
        };
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(ev) { this.events.push(ev && ev.type); }
    focus() { this.focused = true; }
    click(ev = {}) { (this.listeners.click || []).forEach((fn) => fn({ stopPropagation() {}, ...ev })); }
    set innerHTML(_v) {}
    get innerHTML() { return ''; }
}

const chatInput = new El('textarea');
const panel = new El('div');
panel.classList.add('hidden');

globalThis.document = {
    createElement: (tag) => new El(tag),
    getElementById: (id) => (id === 'chat-input' ? chatInput : id === 'explanation-panel' ? panel : null),
};
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.window = { dispatchEvent() {} };
globalThis.setTimeout = () => 0;

const sent = [];
globalThis.sendChatMessage = (m) => sent.push(m);

const { makeAiAskButton } = await import('/labels.js');

function reset() {
    sent.length = 0;
    chatInput.value = '';
    chatInput.focused = false;
    panel.classList.add('hidden');
}

test('a real message is sent, and ⌘-click puts it in the input', () => {
    reset();
    makeAiAskButton('c', 't', () => 'Explain this').click();
    assert.deepEqual(sent, ['Explain this']);
    assert.equal(panel.classList.contains('hidden'), false, 'chat panel opens');

    reset();
    makeAiAskButton('c', 't', () => 'Explain this').click({ metaKey: true });
    assert.deepEqual(sent, []);
    assert.equal(chatInput.value, 'Explain this');
});

test('a null message sends nothing and never writes "null" to the input', () => {
    reset();
    makeAiAskButton('c', 't', () => null).click();
    assert.deepEqual(sent, [], 'nothing is sent to the tutor');
    assert.equal(chatInput.value, '', 'the chat input is untouched');
    assert.equal(panel.classList.contains('hidden'), true, 'the chat panel stays closed');
});

test('a null message under ⌘-click is also a no-op', () => {
    reset();
    makeAiAskButton('c', 't', () => null).click({ metaKey: true });
    assert.equal(chatInput.value, '', 'the chat input is untouched');
    assert.equal(chatInput.focused, false, 'focus is not stolen');
    assert.equal(panel.classList.contains('hidden'), true, 'the chat panel stays closed');
});

test('an empty message is treated the same as null', () => {
    reset();
    makeAiAskButton('c', 't', () => '').click();
    assert.deepEqual(sent, []);
    assert.equal(panel.classList.contains('hidden'), true);
});
