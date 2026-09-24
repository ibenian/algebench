// glossary-core — source-level term matching (issue #665). Everything here is
// pure string work; no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    buildGlossaryMatcher, extractGlossaryTerms, restoreGlossaryTerms, resolveGlossaryKey,
    stripGlossaryMarkers, stripGlossaryMath, setActiveGlossary, setGlossaryThreshold, extractActiveGlossaryTerms,
} = await import('/glossary-core.js');
type Glossary = import('/glossary-core.js').Glossary;

const G: Glossary = {
    RBF: { term: 'Gaussian RBF kernel', aliases: ['radial basis function'], markdown: 'k', prompt: 'p' },
    MAD: { term: 'median absolute deviation' },
    kernel: {},
    nu: { term: 'ν' },
};

/** Run the source pass and render sentinels as [text|key] for easy asserts. */
function mark(src: string, threshold: number | null, g: Glossary = G): string {
    const matcher = threshold == null ? null : buildGlossaryMatcher(g, threshold);
    const { text, terms } = extractGlossaryTerms(src, g, matcher);
    return text.replace(/%%GLOSSARY_(\d+)%%/g, (_m, i: string) => `[${terms[+i]!.text}|${terms[+i]!.key}]`);
}

test('explicit markers link by key, term or alias, with optional shown text', () => {
    assert.equal(mark('The {{glossary:RBF}} is picked.', null), 'The [RBF|RBF] is picked.');
    assert.equal(mark('A {{glossary:radial basis function}}.', null), 'A [radial basis function|RBF].');
    assert.equal(mark('Two {{glossary:RBF|RBF kernels}}.', null), 'Two [RBF kernels|RBF].');
});

test('an unresolved explicit marker renders as plain text', () => {
    assert.equal(mark('See {{glossary:nope}} here.', null), 'See nope here.');
});

test('no threshold means no automatic matching', () => {
    assert.equal(mark('The RBF kernel and MAD.', null), 'The RBF kernel and MAD.');
});

test('automatic matching: first occurrence per paragraph, longest match wins', () => {
    assert.equal(
        mark('A Gaussian RBF kernel, then RBF again.', 3),
        'A [Gaussian RBF kernel|RBF], then RBF again.',
    );
    assert.equal(mark('kernel and kernel', 3), '[kernel|kernel] and kernel');
});

test('threshold filters short names; explicit markers ignore it', () => {
    assert.equal(mark('RBF and MAD', 4), 'RBF and MAD');
    assert.equal(mark('{{glossary:nu}} is small', 4), '[nu|nu] is small');
});

test('acronyms match exact case only; plain words are case-insensitive', () => {
    assert.equal(mark('he was mad at it', 3), 'he was mad at it');
    assert.equal(mark('The Kernel trick', 3), 'The [Kernel|kernel] trick');
});

test('word boundaries: no match inside a longer word', () => {
    assert.equal(mark('MADness and kernels', 3), 'MADness and kernels');
});

test('code spans, HTML attributes and bare math symbols are never touched', () => {
    const src = 'Use $MAD(x)$ via `MAD()` <span title="MAD">x</span> then MAD.';
    assert.equal(mark(src, 3), 'Use $MAD(x)$ via `MAD()` <span title="MAD">x</span> then [MAD|MAD].');
    assert.equal(mark('$$MAD = 1$$ and ```\nMAD\n``` MAD', 3), '$$MAD = 1$$ and ```\nMAD\n``` [MAD|MAD]');
});

test('a whole \\mathrm / \\operatorname / \\text name inside math is wrapped', () => {
    const { text, terms } = extractGlossaryTerms('$1.4826\\,\\mathrm{MAD}$', G, buildGlossaryMatcher(G, 3));
    assert.equal(text, '$1.4826\\,\\htmlClass{glossary-term glossary-k-0}{\\mathrm{MAD}}$');
    assert.deepEqual(terms, [{ text: 'MAD', key: 'MAD' }]);
    // once per paragraph, shared with the prose
    assert.equal(mark('MAD is $\\operatorname{MAD}$', 3), '[MAD|MAD] is $\\operatorname{MAD}$');
    // a partial name, or a name below the threshold, is left alone
    assert.equal(mark('$\\mathrm{MADx}$ $\\mathrm{MAD}$', 4), '$\\mathrm{MADx}$ $\\mathrm{MAD}$');
});

test('explicit markers are never linked inside math', () => {
    assert.equal(mark('${{glossary:MAD}}$', null), '${{glossary:MAD}}$');
    assert.equal(mark('$\\mathrm{MAD}$', null), '$\\mathrm{MAD}$');
});

test('restore turns a math wrapper class into term attributes; strip undoes the wrap', () => {
    const html = restoreGlossaryTerms('<span class="enclosing glossary-term glossary-k-0">M</span>', [{ text: 'MAD', key: 'MAD' }]);
    assert.equal(html, '<span class="enclosing glossary-term" data-glossary-key="MAD" tabindex="0" role="button" aria-haspopup="dialog">M</span>');
    assert.equal(stripGlossaryMath('1.4\\,\\htmlClass{glossary-term glossary-k-3}{\\mathrm{MAD}}'), '1.4\\,\\mathrm{MAD}');
});

test('markers inside protected regions stay verbatim', () => {
    assert.equal(mark('`{{glossary:RBF}}`', null), '`{{glossary:RBF}}`');
});

test('links (text and URL) are protected', () => {
    assert.equal(mark('[MAD docs](https://x/MAD) and MAD', 3), '[MAD docs](https://x/MAD) and [MAD|MAD]');
});

test('restore escapes term text and key into the span', () => {
    const html = restoreGlossaryTerms('<p>%%GLOSSARY_0%%</p>', [{ text: 'a<b', key: 'k"1' }]);
    assert.match(html, /data-glossary-key="k&quot;1"/);
    assert.match(html, />a&lt;b<\/span>/);
    assert.match(html, /class="glossary-term"/);
});

test('resolveGlossaryKey and stripGlossaryMarkers', () => {
    assert.equal(resolveGlossaryKey(G, 'gaussian rbf kernel'), 'RBF');
    assert.equal(resolveGlossaryKey(G, 'unknown'), null);
    assert.equal(stripGlossaryMarkers('a {{glossary:RBF}} b {{glossary:MAD|the MAD}}'), 'a RBF b the MAD');
});

test('active glossary follows the threshold setting', () => {
    setActiveGlossary(G);
    setGlossaryThreshold(undefined);
    assert.equal(extractActiveGlossaryTerms('MAD').terms.length, 0);
    setGlossaryThreshold(3);
    assert.equal(extractActiveGlossaryTerms('MAD').terms.length, 1);
    setActiveGlossary({});
    assert.equal(extractActiveGlossaryTerms('MAD').terms.length, 0);
    setGlossaryThreshold(undefined);
});

test('automatic matching restarts every paragraph, list item, table row and heading', () => {
    assert.equal(mark('MAD one. MAD two.\n\nMAD three.', 3), '[MAD|MAD] one. MAD two.\n\n[MAD|MAD] three.');
    assert.equal(mark('- MAD a\n- MAD b', 3), '- [MAD|MAD] a\n- [MAD|MAD] b');
    assert.equal(mark('| MAD | MAD |\n| MAD | x |', 3), '| [MAD|MAD] | MAD |\n| [MAD|MAD] | x |');
    assert.equal(mark('## MAD\nMAD here', 3), '## [MAD|MAD]\nMAD here');
    assert.equal(mark('MAD wraps\nonto MAD', 3), '[MAD|MAD] wraps\nonto MAD');
});
