// render-error-chip.test.js — one un-renderable step must not shrink the rest.
//
// `_renderInto` renders with KaTeX's throwOnError:false, which turns an
// unparseable step into a single .katex-error span holding the RAW source. For a
// decorated step that source is thousands of \htmlData characters on one
// unwrapped line, and `_fit()` scales the whole derivation to the widest step —
// so one bad step rendered every other step microscopic (issue #549). The chip
// keeps the failure visible at a bounded width.

import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal element stand-in: enough surface for _renderInto's DOM calls.
class El {
    constructor(tag) {
        this.tagName = tag; this.children = []; this.className = '';
        this.textContent = ''; this.attrs = {};
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    set innerHTML(_v) { this.children = []; }
    get innerHTML() { return ''; }
    appendChild(c) { this.children.push(c); return c; }
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

const { ProofAnimator } = await import('./proof-animation/proof-animation.js');

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

test('the chip tooltip carries the failing source in full', () => {
    // Whole string, untruncated — it IS the diagnostic, and a clipped dump just
    // moves the dead end. data-tip, not title: the project tooltip renders in
    // embedded/zoomed contexts where the native one doesn't.
    const chip = renderInto(BAD, true).querySelector('.pa-expr-error');
    assert.equal(chip.getAttribute('data-tip'), BAD);
});

test('a step that renders is left exactly as KaTeX produced it', () => {
    const host = renderInto('x = 1', false);
    assert.equal(host.querySelector('.pa-expr-error'), null);
    assert.equal(host.children.length, 1);
    assert.equal(host.children[0].className, 'katex');
});
