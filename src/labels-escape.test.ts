// escapeHtml and renderMarkdown's untrusted mode — the escaping applied to
// text the lesson didn't write (AI replies in chat). Plan text itself never
// reaches HTML: it is built as DOM (plan-text.ts, tested in plan-text.test.ts).

import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g.window ??= { addEventListener() {}, dispatchEvent() {} };
g.document ??= { createElement: () => ({}), getElementById: () => null, addEventListener() {} };

// The real marked (the same 12.x the page loads from the CDN) as the page's global.
g.marked ??= (await import('marked')).marked;

const { escapeHtml, renderKaTeX, renderMarkdown } = await import('/labels.js');

test('escapeHtml escapes every HTML metacharacter', () => {
    assert.equal(escapeHtml(`<img src=x onerror="a('b')"> & co`),
        '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; co');
    assert.equal(escapeHtml('plain text'), 'plain text');
});

test('renderKaTeX keeps markup in its text inert', () => {
    const out = renderKaTeX('Because <img src=x onerror="x()"> works');
    assert.ok(!out.includes('<img'), out);
    assert.ok(out.includes('&lt;img'), out);
});

test('untrusted Markdown (an AI reply) renders no raw HTML and no script links', () => {
    const md = 'Hi <img src=x onerror="x()"> and <script>x()</script>\n\n'
        + '[ok](https://example.com) [bad](javascript:alert(1)) ![pic](data:text/html,x)';
    const out = renderMarkdown(md, { untrusted: true, glossary: false });
    assert.ok(!/<img|<script/i.test(out), out);
    assert.ok(out.includes('&lt;img'), 'the markup is shown as text');
    assert.ok(out.includes('href="https://example.com"'), 'a safe link stays a link');
    assert.ok(!/javascript:|data:text/i.test(out), out);
});

test('lesson Markdown (trusted) keeps its HTML', () => {
    const out = renderMarkdown('A <span class="hl">highlight</span>', { glossary: false });
    assert.ok(out.includes('<span class="hl">highlight</span>'), out);
});
