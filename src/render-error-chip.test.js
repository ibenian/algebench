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
        this.classList = {
            names: new Set(),
            toggle: (n, on) => { on ? this.classList.names.add(n) : this.classList.names.delete(n); },
            remove: (n) => this.classList.names.delete(n),
            has: (n) => this.classList.names.has(n),
        };
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
        this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }
    fire(type, ev = {}) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
    contains(node) {
        if (node === this) return true;
        return this.children.some((c) => (c.contains ? c.contains(node) : false));
    }
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

// The document doubles as an event target: the chip registers an outside-click
// listener there while the panel is up.
const docEl = new El('#document');
globalThis.document = Object.assign(docEl, { createElement: (tag) => new El(tag) });

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
// `katex` and `stage`, so drive it off a bare prototype instance.
const render = (latex, fails) => {
    const animator = Object.create(ProofAnimator.prototype);
    animator.katex = katexStub(fails);
    animator.stage = new El('div');
    const host = animator._renderInto(new El('div'), latex);
    return { animator, host, stage: animator.stage };
};
const renderInto = (latex, fails) => render(latex, fails).host;

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

test('hovering shows the panel like a tooltip, leaving hides it', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error');
    const wrap = host.querySelector('.pa-expr-error-wrap');
    const panel = host.querySelector('.pa-expr-error-panel');

    chip.fire('mouseenter');
    assert.equal(panel.hidden, false, 'hover did not open it');
    wrap.fire('mouseleave');
    assert.equal(panel.hidden, true, 'unpinned panel should close on hover-out');
});

test('clicking pins the panel so hover-out no longer closes it', () => {
    const host = renderInto(BAD, true);
    const chip = host.querySelector('.pa-expr-error');
    const wrap = host.querySelector('.pa-expr-error-wrap');
    const panel = host.querySelector('.pa-expr-error-panel');

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
    const chip = host.querySelector('.pa-expr-error');
    const wrap = host.querySelector('.pa-expr-error-wrap');
    const panel = host.querySelector('.pa-expr-error-panel');

    chip.fire('click');
    assert.equal(panel.hidden, false);
    document.fire('pointerdown', { target: new El('div') });     // elsewhere on the page
    assert.equal(panel.hidden, true, 'outside click did not close it');

    // ...and a click INSIDE the panel must not, or selecting the text would
    // dismiss the thing you are selecting from.
    chip.fire('click');
    document.fire('pointerdown', { target: host.querySelector('.pa-expr-error-src') });
    assert.equal(panel.hidden, false, 'clicking the source closed the panel');
    assert.ok(wrap.contains(host.querySelector('.pa-expr-error-src')));
});

test('the stage is lifted only while the panel is up', () => {
    // .pa-meta is a later positioned sibling, so the caption paints over
    // anything inside the stage — the stage itself has to rise.
    const { host, stage } = render(BAD, true);
    const chip = host.querySelector('.pa-expr-error');

    assert.equal(stage.classList.has('pa-stage-lift'), false);
    chip.fire('click');
    assert.equal(stage.classList.has('pa-stage-lift'), true);
    chip.fire('click');
    assert.equal(stage.classList.has('pa-stage-lift'), false);
});

test('a re-render tears down the previous chip listener and stage lift', () => {
    const animator = Object.create(ProofAnimator.prototype);
    animator.katex = katexStub(true);
    animator.stage = new El('div');
    const host = animator._renderInto(new El('div'), BAD);
    host.querySelector('.pa-expr-error').fire('click');
    const before = (document.listeners.pointerdown || []).length;

    animator._renderInto(new El('div'), BAD);                    // relayout rebuilds the chip
    assert.equal((document.listeners.pointerdown || []).length, before - 1,
        'the detached chip left its document listener behind');
    assert.equal(animator.stage.classList.has('pa-stage-lift'), false);
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
