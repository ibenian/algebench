// renderMarkdown / renderKaTeX with the active glossary (issue #665): terms
// are matched on the source, so math, code spans and attributes that mention
// the same word are left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';

// The CDN globals the renderers reach for. katex is stubbed to echo its TeX,
// which is enough to see whether a term leaked into a formula.
const g = globalThis as unknown as {
    marked: typeof marked;
    katex: { renderToString(tex: string): string };
    document: { createElement(tag: string): { textContent: string; readonly innerHTML: string } };
    window: typeof globalThis;
};
g.marked = marked;
g.katex = { renderToString: (tex) => `<span class="katex">${tex}</span>` };
g.document = {
    createElement: () => ({
        textContent: '',
        get innerHTML() { return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    }),
};
g.window ??= globalThis;

const { renderMarkdown, renderKaTeX } = await import('/labels.js');
const { setActiveGlossary, setGlossaryThreshold } = await import('/glossary-core.js');

setActiveGlossary({ MAD: { term: 'median absolute deviation', markdown: 'm' } });

function terms(html: string): string[] {
    return [...html.matchAll(/<span class="glossary-term"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!);
}

test('MAD, \\mathrm{MAD} and `MAD` in one paragraph: only the prose word links', () => {
    setGlossaryThreshold(3);
    const md = 'The MAD is $\\mathrm{MAD}(x)$, computed by `MAD()`, see <abbr title="MAD">it</abbr>.';
    const html = renderMarkdown(md);
    assert.deepEqual(terms(html), ['MAD']);
    assert.match(html, /<span class="katex">\\mathrm\{MAD\}\(x\)<\/span>/);
    assert.match(html, /<code>MAD\(\)<\/code>/);
    assert.match(html, /title="MAD"/);
    setGlossaryThreshold(undefined);
});

test('explicit marker renders a term in both renderers', () => {
    assert.deepEqual(terms(renderMarkdown('a {{glossary:MAD}} b')), ['MAD']);
    assert.deepEqual(terms(renderKaTeX('a **{{glossary:MAD}}** $x$', false)), ['MAD']);
});

test('glossary: false renders a marker as plain text', () => {
    const html = renderKaTeX('a {{glossary:MAD|the MAD}} b', false, { glossary: false });
    assert.deepEqual(terms(html), []);
    assert.match(html, /a the MAD b/);
});
