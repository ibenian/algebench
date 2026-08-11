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

// Minimal element stand-in: enough surface for _renderErrorChip's DOM calls.
class El {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.className = '';
        this.textContent = ''; this.attrs = {}; this.hidden = false;
        this.listeners = {};
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
    set innerHTML(_v) { this.children = []; }
    get innerHTML() { return ''; }
    appendChild(c) { this.children.push(c); return c; }
    append(...nodes) { this.children.push(...nodes); }
    querySelector(sel) {
        const want = sel.replace(/^\./, '');
        for (const c of this.children) {
            if (String(c.className).split(/\s+/).includes(want)) return c;
            const deep = c.querySelector ? c.querySelector(sel) : null;
            if (deep) return deep;
        }
        return null;
    }
}
globalThis.document = { createElement: (tag) => new El(tag) };

// A KaTeX stub: `fails` decides whether the render lands as a .katex-error span
// (what throwOnError:false actually produces for unparseable input).
const katexStub = (fails) => ({
    render(latex, host) {
        const span = new El('span');
        span.className = fails ? 'katex-error' : 'katex';
        span.textContent = latex;
        host.appendChild(span);
    },
});

// The animator's constructor wants a live DOM; the render path only needs
// `katex`, so drive it off a bare prototype instance.
const renderInto = (latex, fails) => {
    const animator = Object.create(ProofAnimator.prototype);
    animator.katex = katexStub(fails);
    return animator._renderInto(new El('div'), latex);
};

const { ProofAnimator } = await import('./proof-animation/proof-animation.js');

const BAD = '\\htmlData{n=dleft}{\\mathrm{d}\\left} '.repeat(200);

test('an un-renderable step collapses to a bounded chip', () => {
    const host = renderInto(BAD, true);
    assert.equal(host.querySelector('.katex-error'), null, 'raw source span survived');
    const chip = host.querySelector('.pa-expr-error');
    assert.ok(chip, 'no error chip');
    // The chip's text is what _fit() measures — it must be short and fixed,
    // never a function of the failing step's length.
    assert.ok(chip.textContent.length < 40, chip.textContent);
    assert.ok(!chip.textContent.includes('htmlData'), chip.textContent);
});

test('the source panel starts closed and carries the failing source in full', () => {
    const host = renderInto(BAD, true);
    const panel = host.querySelector('.pa-expr-error-panel');
    assert.ok(panel, 'no source panel');
    assert.equal(panel.hidden, true, 'panel should start closed');
    // Whole string, untruncated — it IS the diagnostic, and a clipped dump just
    // moves the dead end. In a <pre> as real text, so it can be selected.
    assert.equal(host.querySelector('.pa-expr-error-src').textContent, BAD);
});

test('clicking the chip toggles the panel open and shut', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error');
    const panel = host.querySelector('.pa-expr-error-panel');

    chip.fire('click');
    assert.equal(panel.hidden, false);
    assert.equal(chip.getAttribute('aria-expanded'), 'true');

    chip.fire('click');
    assert.equal(panel.hidden, true);
    assert.equal(chip.getAttribute('aria-expanded'), 'false');
});

test('the copy button puts the whole source on the clipboard', async () => {
    let written = null;
    // Node's global navigator is getter-only, so redefine rather than assign.
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: (t) => { written = t; return Promise.resolve(); } } },
    });
    const host = renderInto(BAD, true);
    const copy = host.querySelector('.pa-expr-error-copy');
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
    let selected = null;
    const range = { selectNodeContents: (el) => { selected = el; } };
    document.createRange = () => range;
    document.execCommand = () => false;              // command refused too
    globalThis.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };

    const host = renderInto(BAD, true);
    const copy = host.querySelector('.pa-expr-error-copy');
    copy.fire('click');
    await new Promise((r) => setImmediate(r));
    assert.equal(selected, host.querySelector('.pa-expr-error-src'), 'source was not selected');
    assert.equal(copy.textContent, 'Press ⌘C');
});

test('a step that renders is left exactly as KaTeX produced it', () => {
    const host = renderInto('x = 1', false);
    assert.equal(host.querySelector('.pa-expr-error'), null);
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].className, 'katex');
});
