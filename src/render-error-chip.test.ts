// render-error-chip.test.js — one un-renderable step must not shrink the rest,
// and the source it replaced must still be liftable.
//
// `_renderInto` renders with KaTeX's throwOnError:false, which turns an
// unparseable step into a single .katex-error span holding the RAW source. For a
// decorated step that source is thousands of \htmlData characters on one
// unwrapped line, and `_fit()` scales the whole derivation to the widest step —
// so one bad step rendered every other step microscopic (issue #549). The chip
// keeps the failure visible at a bounded width; clicking it opens the full
// source as real, selectable, copyable text.

import test from 'node:test';
import assert from 'node:assert/strict';

/** Handlers registered on the doubles below; the chip only reads `ev.target`. */
type Listener = (ev: { target?: unknown }) => void;

// Minimal element stand-in: enough surface for _renderErrorChip's DOM calls.
class El {
    tagName: string;
    children: El[];
    className: string;
    textContent: string;
    attrs: Record<string, string>;
    hidden: boolean;
    listeners: Record<string, Listener[] | undefined>;
    classList: {
        names: Set<string>;
        toggle: (n: string, on?: boolean) => void;
        remove: (n: string) => void;
        has: (n: string) => boolean;
    };
    constructor(tag: string) {
        this.tagName = tag; this.children = []; this.className = '';
        this.textContent = ''; this.attrs = {}; this.hidden = false;
        this.listeners = {};
        this.classList = {
            names: new Set(),
            toggle: (n, on) => { on ? this.classList.names.add(n) : this.classList.names.delete(n); },
            remove: (n) => this.classList.names.delete(n),
            has: (n) => this.classList.names.has(n),
        };
    }
    setAttribute(name: string, value: unknown) { this.attrs[name] = String(value); }
    getAttribute(name: string) { return this.attrs[name] ?? null; }
    addEventListener(type: string, fn: Listener) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type: string, fn: Listener) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }
    fire(type: string, ev: { target?: unknown } = {}) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
    contains(node: unknown): boolean {
        if (node === this) return true;
        return this.children.some((c) => (c.contains ? c.contains(node) : false));
    }
    set innerHTML(_v: string) { this.children = []; }
    get innerHTML(): string { return ''; }
    appendChild(c: El) { this.children.push(c); return c; }
    append(...nodes: El[]) { this.children.push(...nodes); }
    querySelector(sel: string): El | null {
        const want = sel.replace(/^\./, '');
        for (const c of this.children) {
            if (String(c.className).split(/\s+/).includes(want)) return c;
            const deep = c.querySelector ? c.querySelector(sel) : null;
            if (deep) return deep;
        }
        return null;
    }
}

// The document doubles as an event target: the chip registers an outside-click
// listener there while the panel is up. Kept in a typed local because the tests
// below read `.listeners` and call `.fire()` on it — bookkeeping the double
// owns, which the real `Document` interface knows nothing about.
const docEl = new El('#document');
const fakeDocument = Object.assign(docEl, { createElement: (tag: string) => new El(tag) });
// A stand-in for `document`: the code under test only calls createElement,
// add/removeEventListener and (on the clipboard-fallback path) createRange /
// execCommand, so a full Document is unnecessary.
globalThis.document = fakeDocument as unknown as Document;

// A KaTeX stub: `fails` decides whether the render lands as a .katex-error span
// (what throwOnError:false actually produces for unparseable input).
const katexStub = (fails: boolean) => ({
    render(latex: string, host: El) {
        const span = new El('span');
        span.className = fails ? 'katex-error' : 'katex';
        span.textContent = latex;
        host.appendChild(span);
    },
});

// The animator's constructor wants a live DOM; the render path only needs
// `katex` and `stage`, so drive it off a bare prototype instance. `Object.create`
// hands back `any`, so the slice installed and read here is named instead — the
// El doubles stand in for the HTMLElements the real signatures ask for.
interface BareAnimator {
    katex: ReturnType<typeof katexStub>;
    stage: El;
    _renderInto(el: El, latex: string): El;
}
const bareAnimator = (fails: boolean): BareAnimator => {
    const animator = Object.create(ProofAnimator.prototype) as BareAnimator;
    animator.katex = katexStub(fails);
    animator.stage = new El('div');
    return animator;
};
const render = (latex: string, fails: boolean) => {
    const animator = bareAnimator(fails);
    const host = animator._renderInto(new El('div'), latex);
    return { animator, host, stage: animator.stage };
};
const renderInto = (latex: string, fails: boolean) => render(latex, fails).host;

const { ProofAnimator } = await import('./proof-animation/proof-animation.js');

const BAD = '\\htmlData{n=dleft}{\\mathrm{d}\\left} '.repeat(200);

test('an un-renderable step collapses to a bounded chip', () => {
    const host = renderInto(BAD, true);
    assert.equal(host.querySelector('.katex-error'), null, 'raw source span survived');
    const chip = host.querySelector('.pa-expr-error')!;
    assert.ok(chip, 'no error chip');
    // The chip's text is what _fit() measures — it must be short and fixed,
    // never a function of the failing step's length.
    assert.ok(chip.textContent.length < 40, chip.textContent);
    assert.ok(!chip.textContent.includes('htmlData'), chip.textContent);
});

test('the source panel starts closed and carries the failing source in full', () => {
    const host = renderInto(BAD, true);
    const panel = host.querySelector('.pa-expr-error-panel')!;
    assert.ok(panel, 'no source panel');
    assert.equal(panel.hidden, true, 'panel should start closed');
    // Whole string, untruncated — it IS the diagnostic, and a clipped dump just
    // moves the dead end. In a <pre> as real text, so it can be selected.
    assert.equal(host.querySelector('.pa-expr-error-src')!.textContent, BAD);
});

// The chip parts below are non-null-asserted: `_renderInto` builds the whole
// wrap/chip/panel/source/copy group together for a failing render, and the two
// tests above assert that presence explicitly.
test('hovering shows the panel like a tooltip, leaving hides it', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error')!;
    const wrap = host.querySelector('.pa-expr-error-wrap')!;
    const panel = host.querySelector('.pa-expr-error-panel')!;

    chip.fire('mouseenter');
    assert.equal(panel.hidden, false, 'hover did not open it');
    wrap.fire('mouseleave');
    assert.equal(panel.hidden, true, 'unpinned panel should close on hover-out');
});

test('clicking pins the panel so hover-out no longer closes it', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error')!;
    const wrap = host.querySelector('.pa-expr-error-wrap')!;
    const panel = host.querySelector('.pa-expr-error-panel')!;

    chip.fire('click');
    assert.equal(panel.hidden, false);
    assert.equal(chip.getAttribute('aria-expanded'), 'true');
    // The whole reason to pin: the pointer has to leave the chip to reach the
    // text, and the panel must survive that.
    wrap.fire('mouseleave');
    assert.equal(panel.hidden, false, 'pinned panel closed on hover-out');

    chip.fire('click');
    assert.equal(panel.hidden, true);
});

test('a click outside unpins and closes the panel', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error')!;
    const wrap = host.querySelector('.pa-expr-error-wrap')!;
    const panel = host.querySelector('.pa-expr-error-panel')!;

    chip.fire('click');
    assert.equal(panel.hidden, false);
    fakeDocument.fire('pointerdown', { target: new El('div') });     // elsewhere on the page
    assert.equal(panel.hidden, true, 'outside click did not close it');

    // ...and a click INSIDE the panel must not, or selecting the text would
    // dismiss the thing you are selecting from.
    chip.fire('click');
    fakeDocument.fire('pointerdown', { target: host.querySelector('.pa-expr-error-src') });
    assert.equal(panel.hidden, false, 'clicking the source closed the panel');
    assert.ok(wrap.contains(host.querySelector('.pa-expr-error-src')));
});

test('the stage is lifted only while the panel is up', () => {
    // .pa-meta is a later positioned sibling, so the caption paints over
    // anything inside the stage — the stage itself has to rise.
    const { host, stage } = render(BAD, true);
    const chip = host.querySelector('.pa-expr-error')!;

    assert.equal(stage.classList.has('pa-stage-lift'), false);
    chip.fire('click');
    assert.equal(stage.classList.has('pa-stage-lift'), true);
    chip.fire('click');
    assert.equal(stage.classList.has('pa-stage-lift'), false);
});

test('a re-render tears down the previous chip listener and stage lift', () => {
    const animator = bareAnimator(true);
    const host = animator._renderInto(new El('div'), BAD);
    host.querySelector('.pa-expr-error')!.fire('click');
    const before = (fakeDocument.listeners.pointerdown || []).length;

    animator._renderInto(new El('div'), BAD);                    // relayout rebuilds the chip
    assert.equal((fakeDocument.listeners.pointerdown || []).length, before - 1,
        'the detached chip left its document listener behind');
    assert.equal(animator.stage.classList.has('pa-stage-lift'), false);
});

test('the copy button puts the whole source on the clipboard', async () => {
    let written: string | null = null;
    // Node's global navigator is getter-only, so redefine rather than assign.
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: (t: string) => { written = t; return Promise.resolve(); } } },
    });
    const host = renderInto(BAD, true);
    const copy = host.querySelector('.pa-expr-error-copy')!;
    copy.fire('click');
    await new Promise((r) => setImmediate(r));
    assert.equal(written, BAD);
    assert.equal(copy.textContent, 'Copied');
});

test('a refused clipboard falls back to selecting the source', async () => {
    // The widget ships as an iframe snippet; an embed without clipboard-write
    // rejects writeText. Selecting the <pre> leaves the user one ⌘C away.
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: () => Promise.reject(new Error('blocked')) } },
    });
    let selected: unknown = null;
    // Stand-ins for the selection APIs the fallback reaches for: it only calls
    // selectNodeContents on the Range and removeAllRanges/addRange on the
    // Selection, so the full DOM interfaces are unnecessary.
    const range = { selectNodeContents: (el: unknown) => { selected = el; } };
    document.createRange = () => range as unknown as Range;
    document.execCommand = () => false;              // command refused too
    globalThis.window = {
        getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    } as unknown as Window & typeof globalThis;

    const host = renderInto(BAD, true);
    const copy = host.querySelector('.pa-expr-error-copy')!;
    copy.fire('click');
    await new Promise((r) => setImmediate(r));
    assert.equal(selected, host.querySelector('.pa-expr-error-src'), 'source was not selected');
    assert.equal(copy.textContent, 'Press ⌘C');
});

test('a step that renders is left exactly as KaTeX produced it', () => {
    const host = renderInto('x = 1', false);
    assert.equal(host.querySelector('.pa-expr-error'), null);
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0]!.className, 'katex');
});
