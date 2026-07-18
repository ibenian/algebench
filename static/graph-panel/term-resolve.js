/**
 * term-resolve — resolve a proof-animation term to a node of an
 * INDEPENDENTLY-derived semantic graph. Pure functions (no DOM, no d3), so the
 * ladder is unit-testable under `node --test`.
 *
 * The animation and the displayed graph come from two separate parses, which
 * splits the id space in two:
 *
 * - **Named-symbol ids** (`pi`, `sigma`, `C`, `e`, …) are deterministic slugs
 *   of the symbol name (backend id_utils._slug_id) — the same symbol gets the
 *   same id in ANY parse, so raw id equality is meaningful.
 * - **Structural ids** (`__power_7`, `__multiply_2`, …) are allocation-order
 *   artifacts: `__power_7` means "the 7th anonymous node of THAT parse" and
 *   nothing more. Two parses of related expressions routinely stamp the same
 *   counter value on unrelated nodes — the animation's `__power_7` (√π) landed
 *   on the app graph's `__power_7` (the Gaussian exponential), so clicking √π
 *   confidently selected the wrong node. Raw id equality across parses is
 *   NOISE for these ids; a structural-id hit must be verified against the
 *   node's rendered content before it is trusted.
 */

// Layout-only LaTeX commands: they shape the typography but carry no symbol
// content, so they never distinguish one subexpression from another.
const NOISE_COMMANDS = new Set([
    'left', 'right', 'cdot', 'limits', 'displaystyle', 'mathrm', 'operatorname',
    'big', 'bigl', 'bigr', 'bigg', 'biggl', 'biggr', 'quad', 'qquad',
]);

// Rendered-glyph → LaTeX-command-name equivalents, so a DOM textContent
// ("√π") and a node's latex ("\sqrt{\pi}") reduce to the same tokens. Covers
// the glyphs KaTeX emits for the symbols the graph actually uses.
const GLYPH_TOKENS = {
    'π': 'pi', 'σ': 'sigma', 'μ': 'mu', 'θ': 'theta', 'λ': 'lambda',
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ρ': 'rho', 'τ': 'tau', 'φ': 'phi', 'ω': 'omega', 'Δ': 'delta',
    'Ω': 'omega', 'Γ': 'gamma', '√': 'sqrt', '∞': 'infty', '∫': 'int',
    'ℏ': 'hbar', '∂': 'partial',
    // KaTeX text is plain digits, but tolerate unicode super/subscripts too.
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
};

/**
 * Reduce a rendered term text OR a node's latex/subexpr to a sorted token
 * skeleton. Order-insensitive by design: a node's `subexpr` carries sympy's
 * canonical ordering (`\sqrt{\pi} \sigma C \sqrt{2}`) while the term renders
 * in display order (`C·√2·σ·√π`) — same content, different order, so the
 * skeleton compares the token MULTISET, not the sequence.
 */
export function apprSkeleton(s) {
    if (!s) return '';
    const tokens = [];
    const str = String(s);
    const cmdRe = /\\([a-zA-Z]+)/g;
    let m;
    while ((m = cmdRe.exec(str)) !== null) {
        const name = m[1].toLowerCase();
        if (!NOISE_COMMANDS.has(name)) tokens.push(name);
    }
    // Everything outside commands: letters/digits one token each, mapped glyphs
    // by name, and MINUS signs. Order-insensitivity must not erase sign
    // structure — `x+y` and `x−y` are different content, so dropping signs
    // would let a counter-collision between them "verify". Minus count is the
    // reorder-proof invariant: sympy prints `x - μ` as `- \mu + x`, so a `+`
    // appears/disappears with term order while the `-` glyph count doesn't —
    // keep `-`, ignore `+` (implied by absence). Remaining punctuation /
    // multiplication dots / whitespace are layout noise.
    for (const ch of str.replace(/\\[a-zA-Z]+/g, '')) {
        if (/[a-zA-Z0-9]/.test(ch)) tokens.push(ch.toLowerCase());
        else if (ch === '-' || ch === '−') tokens.push('-');
        else if (GLYPH_TOKENS[ch]) tokens.push(GLYPH_TOKENS[ch]);
    }
    return tokens.sort().join(' ');
}

/** Does this graph node's stored content look like the term's rendered text? */
export function contentAgrees(node, termText) {
    const want = apprSkeleton(termText);
    if (!want) return false;              // nothing to verify against → don't trust
    return (
        apprSkeleton(node && node.subexpr) === want
        || apprSkeleton(node && node.latex) === want
        || apprSkeleton(node && node.label) === want
    );
}

/**
 * Resolve a proof-animation term id (its `data-n`) + rendered text to a node
 * id in `graph`, or null if the term has no selectable node there.
 *
 * Ladder: exact/affix-stripped id (named ids trusted as-is; structural ids
 * only when the node's content agrees with the term's rendered text — see the
 * module docstring for why); then the canonical symbol (occurrence suffix
 * `__<parent>` stripped) against node ids' own canonical symbols; then a loose
 * label/latex match on the rendered glyph text.
 */
export function resolveTermId(graph, termId, termText) {
    if (!termId || !graph || !Array.isArray(graph.nodes)) return null;
    const nodes = graph.nodes;
    const byId = id => nodes.find(n => n.id === id) || null;
    // The animation's ids carry affixes the graph node ids don't: a glyph
    // suffix on operator/structural glyphs (`__op`/`__op<n>`, `__exp`,
    // `__one`, `__m<n>`), and a rebase prefix on the threaded spine
    // (`_r<n>_`). Strip each to recover candidate node ids.
    const noGlyph = termId.replace(/__(?:op\d*|exp|one|m\d+)$/, '');
    const cands = [termId, noGlyph, noGlyph.replace(/^_r\d+_/, '')];
    for (const c of cands) {
        const n = byId(c);
        if (!n) continue;
        if (!c.startsWith('__')) return c;            // named-symbol id: parse-stable
        if (contentAgrees(n, termText)) return c;     // structural id: verified
        // structural id exists but denotes DIFFERENT content — a cross-parse
        // counter collision, not a match; keep walking the ladder.
    }
    const base = termId.split('__')[0];                        // canonical symbol
    if (base) {
        if (byId(base)) return base;
        const m = nodes.find(n => n.id.split('__')[0] === base);
        if (m) return m.id;
    }
    // Loose match on the rendered text — the safety net for nodes whose
    // positional id (operators, powers like a square) differs between the
    // independently-derived animation and this graph. Compare against label /
    // latex / subexpr (a power node carries only `subexpr`, e.g. "V^{2}"), with
    // superscripts and multiplication dots normalised away so "V²" ≡ "V^{2}".
    const t = (termText || '').trim();
    if (t) {
        const norm = s => (s || '').replace(/\\cdot|\\[a-zA-Z]+|[{}\\$\s^*·]/g, '').trim();
        // Skip a purely NUMERIC appearance ("2", "1/2"): a bare number is
        // ambiguous (an exponent, a denominator, a coefficient all render the
        // same), so matching it by text mis-links — e.g. a square's "2" to the
        // "2" in a denominator. Named symbols carry a letter.
        const nt = norm(t);
        if (nt && !/^[\d.,/]+$/.test(nt)) {
            // exact normalised match first; else the order-insensitive,
            // glyph-mapped skeleton (catches "(−μ+x)2" ≡ "\left(- \mu + x\right)^{2}",
            // where rendered unicode never string-equals the stored latex).
            const m = nodes.find(n =>
                norm(n.subexpr) === nt || norm(n.latex) === nt || norm(n.label) === nt)
                || nodes.find(n => contentAgrees(n, t));
            if (m) return m.id;
        }
    }
    return null;
}
