// planTextInto — imported plan text into the DOM without ever parsing it as
// HTML. A fake DOM refuses innerHTML outright, so any regression to an HTML
// sink fails here, not just an escaping slip.

import { test } from 'node:test';
import assert from 'node:assert/strict';

type Node = { kind: 'text'; text: string } | El;
class El {
    kind = 'el' as const;
    children: Node[] = [];
    textContent = '';
    tag: string;
    constructor(tag: string) { this.tag = tag; }
    appendChild(n: Node) { this.children.push(n); return n; }
    set innerHTML(_v: string) { throw new Error('innerHTML must never be used for plan text'); }
}

const rendered: Array<{ tex: string; display: boolean }> = [];
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
    createElement: (tag: string) => new El(tag),
    createTextNode: (text: string) => ({ kind: 'text', text }),
};
g.katex = {
    render(tex: string, el: El, opts: { displayMode?: boolean }) {
        rendered.push({ tex, display: !!opts.displayMode });
        el.textContent = `[math:${tex}]`;
    },
};

const { planTextInto } = await import('/plan-text.js');

const fill = (text: string) => planTextInto(new El('div') as unknown as HTMLElement, text) as unknown as El;

test('hostile markup stays text; math goes through KaTeX', () => {
    rendered.length = 0;
    const out = fill('Evil <img src=x onerror="x()"> and $x^2 < y$ then $$\\frac{a}{b}$$ <script>y()</script>');
    const tags = out.children.filter((n): n is El => n.kind === 'el').map((n) => n.tag);
    assert.deepEqual(tags, ['span', 'span'], 'only the two math spans are elements');
    const texts = out.children.filter((n) => n.kind === 'text').map((n) => (n as { text: string }).text);
    assert.equal(texts.join('|'), 'Evil <img src=x onerror="x()"> and | then | <script>y()</script>');
    assert.deepEqual(rendered, [{ tex: 'x^2 < y', display: false }, { tex: '\\frac{a}{b}', display: true }]);
});

test('a KaTeX failure falls back to the source as text', () => {
    const g2 = globalThis as unknown as { katex: { render: unknown } };
    const real = g2.katex.render;
    g2.katex.render = () => { throw new Error('bad tex'); };
    try {
        const out = fill('see $\\bad{$');
        const span = out.children.find((n): n is El => n.kind === 'el')!;
        assert.equal(span.textContent, '$\\bad{$');
    } finally { g2.katex.render = real; }
});

test('glossary markers render as their plain text', () => {
    const out = fill('the {{glossary:drag coefficient|drag}} term');
    const text = out.children.map((n) => (n.kind === 'text' ? n.text : '')).join('');
    assert.equal(text, 'the drag term');
});
