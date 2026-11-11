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

test('untrusted Markdown drops script links hidden by entities or control characters', () => {
    // The browser decodes these when the HTML is inserted, so each would run script.
    const hidden = [
        'java&#x73;cript:alert(1)',
        'java&#115;cript:alert(1)',
        '&#106;avascript:alert(1)',
        '&#x6A;&#x61;&#x76;&#x61;script:alert(1)',
        'javascript&colon;alert(1)',
        'javascript&#58;alert(1)',
        'java&Tab;script:alert(1)',
        'JaVaScRiPt:alert(1)',
        '&#x64;ata:text/html,x',
        'vbscript:x',
    ];
    for (const href of hidden) {
        const out = renderMarkdown(`[bad](${href}) ![img](${href})`, { untrusted: true, glossary: false });
        assert.ok(!/<a\s|<img/i.test(out), `${href} => ${out}`);
    }
});

test('safeHref keeps ordinary links', async () => {
    const { safeHref } = await import('/labels.js');
    for (const href of ['https://example.com/a?b=1&c=2', 'http://x.y', 'mailto:a@b.c', '#sec', '/lesson?id=1', 'notes.md', 'a&amp;b'])
        assert.ok(safeHref(href), href);
    for (const href of ['javascript:x', ' java\nscript:x', 'java&#x73;cript:x', 'x&unknown;y:z', 'data:,x'])
        assert.ok(!safeHref(href), href);
});

test('lesson Markdown (trusted) keeps its HTML', () => {
    const out = renderMarkdown('A <span class="hl">highlight</span>', { glossary: false });
    assert.ok(out.includes('<span class="hl">highlight</span>'), out);
});
