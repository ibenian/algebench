// makeSilentAiAskButton — the silent Ask-AI path and its single-flight contract.
//
// A silent ask sends a tutor-facing prompt without posting it as the learner's
// message (the quiz's hint ladder, say). The chat is single-flight: while a
// turn is in flight a second send is turned away, and every Ask-AI button is
// disabled until it lands. Covered here: silent forwarding, the pending
// events a caller builds its "thinking" line and hint ladder on, the app-wide
// disable/re-enable, turning away clicks while busy, and cleanup after a
// failed request.

import test from 'node:test';
import assert from 'node:assert/strict';

interface FakeClick { stopPropagation(): void; metaKey?: boolean; ctrlKey?: boolean }
type Listener = (ev: { type: string; detail?: unknown } & Partial<FakeClick>) => void;

class El {
    tagName: string;
    className = '';
    title = '';
    type = '';
    value = '';
    disabled = false;
    attrs: Record<string, string> = {};
    listeners: Record<string, Listener[]> = {};
    events: Array<{ type: string; detail?: unknown }> = [];
    classList = {
        names: new Set<string>(),
        add: (n: string) => { this.classList.names.add(n); },
        remove: (n: string) => { this.classList.names.delete(n); },
        contains: (n: string) => this.classList.names.has(n),
    };
    constructor(tag: string) { this.tagName = tag; }
    setAttribute(name: string, value: unknown) { this.attrs[name] = String(value); }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    addEventListener(type: string, fn: Listener) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(ev: { type: string; detail?: unknown }) {
        this.events.push({ type: ev.type, detail: ev.detail });
        (this.listeners[ev.type] || []).forEach((fn) => fn(ev));
    }
    focus() {}
    click(ev: Partial<FakeClick> = {}) {
        (this.listeners.click || []).forEach((fn) => fn({ type: 'click', stopPropagation() {}, ...ev }));
    }
    set innerHTML(_v: string) {}
    get innerHTML() { return ''; }
}

const created: El[] = [];
const panel = new El('div');
const chatInput = new El('textarea');
const windowListeners: Record<string, Listener[]> = {};

/** A stand-in chat: single-flight, with a reply the test resolves (or fails). */
const chat = {
    busy: false,
    calls: [] as Array<{ text: string; silent: boolean }>,
    finish: null as null | ((ok: boolean) => void),
    send(text: string, opts: { silent?: boolean } = {}): Promise<boolean> {
        if (chat.busy) return Promise.resolve(false);
        chat.calls.push({ text, silent: !!opts.silent });
        chat.setBusy(true);
        return new Promise<boolean>((resolve, reject) => {
            chat.finish = (ok) => {
                chat.setBusy(false);
                if (ok) resolve(true);
                else reject(new Error('network'));
            };
        });
    },
    setBusy(busy: boolean) {
        chat.busy = busy;
        (windowListeners['algebench:chatbusy'] || []).forEach((fn) => fn({ type: 'algebench:chatbusy', detail: { busy } }));
    },
};

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
    createElement: (tag: string) => { const e = new El(tag); created.push(e); return e; },
    getElementById: (id: string) => (id === 'chat-input' ? chatInput : id === 'explanation-panel' ? panel : null),
    querySelectorAll: (sel: string) => (sel === 'button[data-ai-ask]'
        ? created.filter((e) => e.tagName === 'button' && e.getAttribute('data-ai-ask') !== null)
        : []),
};
g.Event = class { type: string; constructor(type: string) { this.type = type; } };
g.CustomEvent = class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } };
g.window = {
    dispatchEvent() {},
    addEventListener(type: string, fn: Listener) { (windowListeners[type] ||= []).push(fn); },
    algebenchChatBusy: () => chat.busy,
};
g.setTimeout = () => 0;
g.sendChatMessage = (text: string, opts?: { silent?: boolean }) => chat.send(text, opts);

const { makeAiAskButton, makeSilentAiAskButton } = await import('/labels.js');

const silent = (msg: string): El => makeSilentAiAskButton('c', 't', () => msg) as unknown as El;
const plain = (msg: string): El => makeAiAskButton('c', 't', () => msg) as unknown as El;
const pendingEvents = (b: El) => b.events.filter((e) => e.type === 'ai-ask-pending').map((e) => e.detail);
const settle = () => new Promise((r) => setImmediate(r));

function reset() {
    chat.calls.length = 0;
    chat.busy = false;
    chat.finish = null;
    created.length = 0;
}

test('a silent ask forwards its prompt with silent: true and reports pending → done', async () => {
    reset();
    const b = silent('hint please');
    b.click();
    assert.deepEqual(chat.calls, [{ text: 'hint please', silent: true }]);
    assert.deepEqual(pendingEvents(b), [true]);
    assert.equal(b.getAttribute('aria-busy'), 'true');
    chat.finish!(true);
    await settle();
    assert.deepEqual(pendingEvents(b), [true, false]);
    assert.equal(b.getAttribute('aria-busy'), 'false');
});

test('a regular ask forwards silent: false and reports no pending events', () => {
    reset();
    const b = plain('explain');
    b.click();
    assert.deepEqual(chat.calls, [{ text: 'explain', silent: false }]);
    assert.deepEqual(pendingEvents(b), []);
    chat.finish!(true);
});

test('while a turn is in flight every Ask-AI button is disabled, then re-enabled', async () => {
    reset();
    const a = silent('one'), b = silent('two'), c = plain('three');
    a.click();
    assert.deepEqual([a.disabled, b.disabled, c.disabled], [true, true, true]);
    const late = silent('created meanwhile');
    assert.equal(late.disabled, true, 'a button created mid-flight starts disabled');
    chat.finish!(true);
    await settle();
    assert.deepEqual([a.disabled, b.disabled, c.disabled, late.disabled], [false, false, false, false]);
});

test('a click while busy is turned away: nothing sent, no pending event', () => {
    reset();
    const a = silent('first'), b = silent('second');
    a.click();
    a.click();                       // double-click
    b.click();                       // another button
    assert.equal(chat.calls.length, 1, 'only the first send goes out');
    assert.deepEqual(pendingEvents(b), [], 'no pending event for a send that never happened');
    chat.finish!(true);
});

test('a failed request still clears pending and re-enables the buttons', async () => {
    reset();
    const a = silent('will fail'), b = plain('other');
    a.click();
    chat.finish!(false);
    await settle();
    assert.deepEqual(pendingEvents(a), [true, false]);
    assert.equal(a.getAttribute('aria-busy'), 'false');
    assert.deepEqual([a.disabled, b.disabled], [false, false]);
});

test('⌘-click on a silent ask only fills the input: no send, no pending', () => {
    reset();
    const b = silent('edit me');
    b.click({ metaKey: true });
    assert.equal(chat.calls.length, 0);
    assert.equal(chatInput.value, 'edit me');
    assert.deepEqual(pendingEvents(b), []);
});
